import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from app.agents.campaign_agent import CampaignAgent
from app.models.campaign import Campaign
from app.models.campaign_content import (
    BusinessProfileInput,
    CampaignContentQueueItem,
    CampaignDraftSet,
    CampaignPlatform,
    ManualSocialPostGenerateRequest,
    SocialQueueGenerateResponse,
    WeeklySocialQueueGenerateRequest,
)
from app.services.campaign_image_service import CampaignImageService, CampaignImageMetadata
from app.services.sheets_service import SheetsDataError, SheetsService


DEFAULT_WEEKLY_PLATFORMS: list[CampaignPlatform] = [
    "Google Business",
    "Meta Dual",
]
POSTS_LANDING_PAGE_URL = "https://marompainting.org"
# Legacy fallback for existing sheet-backed campaign generation. Business Profile requests use the saved profile website.
WEEKLY_POST_TYPES = [
    "Seasonal Reminder",
    "Problem Solution",
    "Trust Local Proof",
    "Project Highlight",
    "FAQ Education",
    "Offer CTA",
    "Neighborhood Focus",
    "Preparation Tip",
]
STATIC_WEEKLY_AVOID_PHRASES = [
    "Spring is the perfect time",
    "brighten up your home",
    "fresh interior paint",
    "clean and vibrant",
    "transform your space",
    "request a free quote today",
]


@dataclass(frozen=True)
class WeeklyPostSlot:
    slot_index: int
    platform: CampaignPlatform
    post_type: str
    scheduled_at: str


class SocialQueueService:
    """Generates operator-facing weekly social posting queue items."""

    def __init__(
        self,
        sheets_service: SheetsService,
        campaign_agent: CampaignAgent,
        campaign_image_service: CampaignImageService,
    ) -> None:
        self.sheets_service = sheets_service
        self.campaign_agent = campaign_agent
        self.campaign_image_service = campaign_image_service

    def list_current_week_posts(self) -> list[CampaignContentQueueItem]:
        return self.list_week_posts()

    def list_week_posts(self, week_start_date: str | None = None) -> list[CampaignContentQueueItem]:
        week_key = self._week_key_for_start_date(week_start_date)
        return [
            item
            for item in self.sheets_service.list_posts()
            if self._item_week_key(item) == week_key
        ]

    def generate_weekly_posts(
        self,
        request: WeeklySocialQueueGenerateRequest,
    ) -> SocialQueueGenerateResponse:
        campaign = self._campaign_for_request(
            campaign_id=request.campaign_id,
            business_profile=request.business_profile,
        )
        if campaign is None:
            return SocialQueueGenerateResponse(queue_items=[], existing=False)

        platforms = self._weekly_platforms(request)
        content_days = request.content_days or request.posts_per_platform
        week_start = self._week_start_date(request.week_start_date)
        week_start_date = week_start.isoformat()
        week_key = self._week_key_for_date(week_start)
        expected_plan = self._weekly_post_plan(
            platforms=platforms,
            content_days=content_days,
            week_start_date=week_start_date,
            content_types=request.content_types,
        )
        existing_items = [
            item
            for item in self.sheets_service.get_posts_by_campaign_id(campaign.campaign_id)
            if self._item_week_key(item) == week_key
        ]
        taken_slot_keys = {
            (slot_index, self._post_slot_platform_key(item.platform, separate_meta_platforms=request.separate_meta_platforms))
            for item in existing_items
            if (slot_index := self._item_slot_index(item)) is not None and self._is_weekly_slot_taken(item)
        }
        missing_slots = [
            slot
            for slot in expected_plan
            if (slot.slot_index, slot.platform) not in taken_slot_keys
        ]
        if not missing_slots:
            return SocialQueueGenerateResponse(queue_items=existing_items, existing=True)

        avoid_phrases = self._campaign_avoid_phrases(campaign.campaign_id)
        created_at = self._utc_timestamp()
        content_id_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        queue_items: list[CampaignContentQueueItem] = []
        used_weekly_image_filenames = self._used_weekly_image_filenames(existing_items)

        for slots in self._group_weekly_slots_by_index(missing_slots):
            first_slot = slots[0]
            draft_set = self.campaign_agent.generate_for_post_type(
                campaign,
                post_type=first_slot.post_type,
                platform=", ".join(slot.platform for slot in slots),
                avoid_phrases=avoid_phrases,
            )
            avoid_phrases = self._extend_avoid_phrases_from_draft_set(avoid_phrases, draft_set)
            for slot in slots:
                image_metadata = self.campaign_image_service.select_next_unique_image(used_weekly_image_filenames)
                if image_metadata is not None:
                    used_weekly_image_filenames.add(image_metadata.image_filename.lower())
                queue_items.append(
                    self._build_queue_item(
                        campaign=campaign,
                        platform=slot.platform,
                        caption=self._caption_for_platform(draft_set, slot.platform),
                        post_type=slot.post_type,
                        week_key=week_key,
                        slot_index=slot.slot_index,
                        content_id=f"WSQ-{content_id_stamp}-{self._platform_slug(slot.platform)}-{slot.slot_index}",
                        created_at=created_at,
                        scheduled_at=slot.scheduled_at,
                        image_metadata=image_metadata,
                        campaign_theme=request.campaign_theme,
                        week_start_date=week_start_date,
                    )
                )

        saved_items = self.sheets_service.append_posts(queue_items)
        return SocialQueueGenerateResponse(queue_items=[*existing_items, *saved_items], existing=False)

    def generate_manual_post(
        self,
        request: ManualSocialPostGenerateRequest,
    ) -> SocialQueueGenerateResponse:
        campaign = self._campaign_for_request(
            campaign_id=request.campaign_id,
            business_profile=request.business_profile,
        )
        if campaign is None:
            return SocialQueueGenerateResponse(queue_items=[], existing=False)

        platform = self._normalize_post_platform(request.platform or "Google Business")
        draft_set = self.campaign_agent.generate_for_post_type(
            campaign,
            post_type=request.post_type,
            platform=platform,
            avoid_phrases=self._campaign_avoid_phrases(campaign.campaign_id),
        )
        image_metadata = self.campaign_image_service.select_next_image()
        created_at = self._utc_timestamp()
        content_id_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        queue_item = self._build_queue_item(
            campaign=campaign,
            platform=platform,
            caption=self._caption_for_platform(draft_set, platform),
            post_type=request.post_type,
            week_key=self._current_week_key(),
            content_id=f"MSQ-{content_id_stamp}-{self._platform_slug(platform)}",
            created_at=created_at,
            scheduled_at=created_at,
            image_metadata=image_metadata,
        )
        saved_items = self.sheets_service.append_posts([queue_item])
        return SocialQueueGenerateResponse(queue_items=saved_items, existing=False)

    def _select_campaign(self, campaign_id: str | None) -> Campaign | None:
        if campaign_id:
            return self.sheets_service.get_campaign_by_id(campaign_id)
        campaigns = self.sheets_service.list_campaigns()
        active_campaigns = [campaign for campaign in campaigns if campaign.status.lower() != "archived"]
        return active_campaigns[0] if active_campaigns else (campaigns[0] if campaigns else None)

    def _campaign_for_request(
        self,
        campaign_id: str | None,
        business_profile: BusinessProfileInput | None = None,
    ) -> Campaign | None:
        if business_profile is not None and not campaign_id:
            return self._campaign_from_business_profile(business_profile)

        selected_campaign = self._select_campaign(campaign_id)
        if selected_campaign is None:
            return None
        return self._campaign_for_posts(selected_campaign)

    @staticmethod
    def _campaign_for_posts(campaign: Campaign) -> Campaign:
        return campaign.model_copy(update={"landing_page_url": POSTS_LANDING_PAGE_URL})

    @staticmethod
    def _campaign_from_business_profile(profile: BusinessProfileInput) -> Campaign:
        business_name = profile.business_name.strip() or "Marom Painting"
        services = SocialQueueService._join_profile_values(profile.services_offered)
        service_focus = services or profile.industry or "painting services"
        service_area = SocialQueueService._join_profile_values(profile.service_area_cities) or "the local service area"
        target_customer = profile.target_customer or "local homeowners"
        cta = profile.primary_cta or "Request a free estimate"
        website_url = profile.website_url or POSTS_LANDING_PAGE_URL
        today = datetime.now(timezone.utc).date()
        platforms = SocialQueueService._join_profile_values(profile.platforms_used)
        notes = "\n".join(
            [
                "Generated from Business Profile",
                f"Industry: {profile.industry or service_focus}",
                f"Service Area: {service_area}",
                f"Services Offered: {service_focus}",
                f"Brand Tone: {profile.brand_tone or 'Professional, helpful, local'}",
                f"Target Customer: {target_customer}",
                f"Phone: {profile.phone_number or ''}",
                f"Email: {profile.email or ''}",
                f"Platforms Used: {platforms or 'Facebook, Instagram, Google Business'}",
            ]
        )
        return Campaign(
            campaign_id="BUSINESS-PROFILE",
            campaign_name=business_name,
            service_focus=service_focus,
            target_location=service_area,
            target_customer=target_customer,
            offer=cta,
            cta=cta,
            landing_page_url=website_url,
            start_date=today.isoformat(),
            end_date=(today + timedelta(days=90)).isoformat(),
            status="Active",
            notes=notes,
        )

    @staticmethod
    def _join_profile_values(values: list[str] | list[object]) -> str:
        return ", ".join(str(value).strip() for value in values if str(value).strip())

    @staticmethod
    def _weekly_platforms(request: WeeklySocialQueueGenerateRequest) -> list[CampaignPlatform]:
        requested_platforms = request.platforms or DEFAULT_WEEKLY_PLATFORMS
        platforms: list[CampaignPlatform] = []
        for requested_platform in requested_platforms:
            if request.separate_meta_platforms:
                normalized_platforms = SocialQueueService._platform_specific_posts(requested_platform)
            else:
                normalized_platforms = [SocialQueueService._normalize_post_platform(requested_platform)]
            for platform in normalized_platforms:
                if platform not in platforms:
                    platforms.append(platform)
        if request.include_facebook_groups and "Facebook Groups" not in platforms:
            platforms = [*platforms, "Facebook Groups"]
        return platforms

    @staticmethod
    def _platform_specific_posts(platform: CampaignPlatform) -> list[CampaignPlatform]:
        if platform == "Meta Dual":
            return ["Facebook", "Instagram"]
        if platform == "Facebook Page":
            return ["Facebook"]
        return [platform]

    @staticmethod
    def _post_slot_platform_key(platform: CampaignPlatform, separate_meta_platforms: bool) -> CampaignPlatform:
        if separate_meta_platforms:
            if platform == "Facebook Page":
                return "Facebook"
            return platform
        return SocialQueueService._normalize_post_platform(platform)

    @staticmethod
    def _normalize_post_platform(platform: CampaignPlatform) -> CampaignPlatform:
        if platform in {"Facebook", "Facebook Page", "Instagram", "Meta Dual"}:
            return "Meta Dual"
        return platform

    @staticmethod
    def _weekly_schedule_slots(content_days: int, week_start_date: str | None = None) -> list[str]:
        week_start = SocialQueueService._week_start_date(week_start_date)
        offsets = SocialQueueService._content_day_offsets(content_days)
        return [
            datetime.combine(
                week_start + timedelta(days=offset),
                time(hour=15, tzinfo=timezone.utc),
            )
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
            for offset in offsets
        ]

    @staticmethod
    def _content_day_offsets(content_days: int) -> list[int]:
        return {
            1: [0],
            2: [1, 3],
            3: [0, 2, 4],
            4: [0, 1, 3, 4],
            5: [0, 1, 2, 3, 4],
            6: [0, 1, 2, 3, 4, 5],
            7: [0, 1, 2, 3, 4, 5, 6],
        }[content_days]

    @staticmethod
    def _week_start_date(value: str | None = None) -> date:
        if value:
            try:
                return date.fromisoformat(value)
            except ValueError as exc:
                raise SheetsDataError(f"Invalid week_start_date: {value}") from exc

        now = datetime.now(timezone.utc)
        return (now - timedelta(days=now.weekday())).date()

    @staticmethod
    def _week_key_for_start_date(week_start_date: str | None = None) -> str:
        return SocialQueueService._week_key_for_date(SocialQueueService._week_start_date(week_start_date))

    @staticmethod
    def _week_key_for_date(value: date) -> str:
        year, week_number, _ = value.isocalendar()
        return f"{year}-W{week_number:02d}"

    @staticmethod
    def _weekly_post_plan(
        platforms: list[CampaignPlatform],
        content_days: int,
        week_start_date: str | None = None,
        content_types: list[str] | None = None,
    ) -> list[WeeklyPostSlot]:
        schedule_slots = SocialQueueService._weekly_schedule_slots(
            content_days=content_days,
            week_start_date=week_start_date,
        )
        post_types = SocialQueueService._weekly_post_types(content_days, content_types)
        plan: list[WeeklyPostSlot] = []
        for slot_index, scheduled_at in enumerate(schedule_slots, start=1):
            for platform in platforms:
                plan.append(
                    WeeklyPostSlot(
                        slot_index=slot_index,
                        platform=platform,
                        post_type=post_types[slot_index - 1],
                        scheduled_at=scheduled_at,
                    )
                )
        return plan

    @staticmethod
    def _weekly_post_types(content_days: int, content_types: list[str] | None = None) -> list[str]:
        selected_types = [
            post_type.strip()
            for post_type in (content_types or WEEKLY_POST_TYPES)
            if post_type.strip()
        ]
        if not selected_types:
            selected_types = WEEKLY_POST_TYPES
        return [
            selected_types[index % len(selected_types)]
            for index in range(content_days)
        ]

    @staticmethod
    def _used_weekly_image_filenames(items: list[CampaignContentQueueItem]) -> set[str]:
        used_filenames: set[str] = set()
        for item in items:
            for image_value in (item.image_filename, item.image_path, item.image_url):
                image_filename = SocialQueueService._image_filename(image_value)
                if image_filename:
                    used_filenames.add(image_filename.lower())
        return used_filenames

    @staticmethod
    def _image_filename(value: str | None) -> str | None:
        if not value:
            return None
        normalized_value = value.strip().rstrip("/")
        if not normalized_value:
            return None
        return normalized_value.rsplit("/", 1)[-1] or None

    @staticmethod
    def _group_weekly_slots_by_index(slots: list[WeeklyPostSlot]) -> list[list[WeeklyPostSlot]]:
        grouped_slots: list[list[WeeklyPostSlot]] = []
        slot_groups: dict[int, list[WeeklyPostSlot]] = {}
        for slot in slots:
            if slot.slot_index not in slot_groups:
                slot_groups[slot.slot_index] = []
                grouped_slots.append(slot_groups[slot.slot_index])
            slot_groups[slot.slot_index].append(slot)
        return grouped_slots

    def _campaign_avoid_phrases(self, campaign_id: str) -> list[str]:
        phrases = list(STATIC_WEEKLY_AVOID_PHRASES)
        recent_items = sorted(
            self.sheets_service.get_posts_by_campaign_id(campaign_id),
            key=lambda item: item.created_at or item.scheduled_at or "",
            reverse=True,
        )[:12]
        for item in recent_items:
            first_sentence = self._first_sentence(item.draft_text)
            if first_sentence:
                phrases.append(first_sentence)
        return self._unique_phrases(phrases)

    def _extend_avoid_phrases_from_draft_set(
        self,
        avoid_phrases: list[str],
        draft_set: CampaignDraftSet,
    ) -> list[str]:
        generated_openings = [
            self._first_sentence(draft_set.facebook_post),
            self._first_sentence(draft_set.google_business_post),
            self._first_sentence(draft_set.instagram_caption),
        ]
        return self._unique_phrases([*avoid_phrases, *generated_openings])

    @staticmethod
    def _first_sentence(text: str | None) -> str | None:
        if not text:
            return None
        normalized_text = " ".join(text.split())
        if not normalized_text:
            return None
        match = re.match(r"^(.+?[.!?])(?:\s|$)", normalized_text)
        if match:
            return match.group(1).strip()
        return normalized_text[:160].strip()

    @staticmethod
    def _unique_phrases(phrases: list[str | None]) -> list[str]:
        unique_phrases: list[str] = []
        seen: set[str] = set()
        for phrase in phrases:
            if not phrase:
                continue
            normalized_phrase = " ".join(phrase.split()).strip()
            key = normalized_phrase.lower()
            if normalized_phrase and key not in seen:
                seen.add(key)
                unique_phrases.append(normalized_phrase)
        return unique_phrases

    def _build_queue_item(
        self,
        campaign: Campaign,
        platform: CampaignPlatform,
        caption: str,
        post_type: str,
        week_key: str,
        content_id: str,
        created_at: str,
        scheduled_at: str,
        image_metadata: CampaignImageMetadata | None,
        slot_index: int | None = None,
        campaign_theme: str | None = None,
        week_start_date: str | None = None,
    ) -> CampaignContentQueueItem:
        scheduled_date = scheduled_at.split("T", 1)[0] if scheduled_at else ""
        day_of_week = ""
        if scheduled_date:
            try:
                day_of_week = date.fromisoformat(scheduled_date).strftime("%A")
            except ValueError:
                day_of_week = ""
        slot_id = f"WCS-{week_key}-{slot_index}" if slot_index is not None else f"WCS-{week_key}-{content_id}"
        theme = (campaign_theme or "Weekly Local Business Content").strip() or "Weekly Local Business Content"
        note_lines = [
            "Generated by Weekly Social Queue",
            f"Business: {campaign.campaign_name}",
            f"Campaign Theme: {theme}",
            f"Week: {week_key}",
            f"Week Start: {week_start_date or ''}",
            f"Content Slot ID: {slot_id}",
            f"Scheduled Date: {scheduled_date}",
            f"Day of Week: {day_of_week}",
        ]
        if slot_index is not None:
            note_lines.append(f"Slot: {slot_index}")
        note_lines.append(f"Post Type: {post_type}")
        note_lines.append(f"Topic: {theme} - {post_type}")
        if campaign.notes:
            note_lines.append(f"Business Profile Details: {campaign.notes}")
        notes = "\n".join(note_lines)
        return CampaignContentQueueItem(
            content_id=content_id,
            campaign_id=campaign.campaign_id,
            platform=platform,
            draft_text=caption,
            cta=campaign.cta,
            landing_page_url=campaign.landing_page_url,
            image_filename=image_metadata.image_filename if image_metadata else None,
            image_path=image_metadata.image_path if image_metadata else None,
            business=campaign.campaign_name,
            post_type=post_type,
            status="Draft",
            approved="No",
            published="No",
            created_at=created_at,
            scheduled_at=scheduled_at,
            notes=notes,
        )

    @staticmethod
    def _caption_for_platform(draft_set, platform: str) -> str:
        if platform == "Google Business":
            return draft_set.google_business_post
        if platform in {"Facebook", "Facebook Page", "Facebook Groups", "Meta Dual"}:
            return draft_set.facebook_post
        if platform == "Instagram":
            return draft_set.instagram_caption
        if platform == "Craigslist":
            return draft_set.craigslist_post
        if platform == "Nextdoor":
            return draft_set.nextdoor_post
        return draft_set.facebook_post

    @staticmethod
    def _platform_slug(platform: str) -> str:
        return platform.lower().replace(" ", "-")

    @staticmethod
    def _item_week_key(item: CampaignContentQueueItem) -> str | None:
        for line in item.notes.splitlines():
            if line.strip().lower().startswith("week:"):
                return line.split(":", 1)[1].strip() or None
        return None

    @staticmethod
    def _item_slot_index(item: CampaignContentQueueItem) -> int | None:
        for line in item.notes.splitlines():
            if line.strip().lower().startswith("slot:"):
                raw_value = line.split(":", 1)[1].strip()
                try:
                    slot_index = int(raw_value)
                except ValueError:
                    return None
                return slot_index if slot_index > 0 else None
        return None

    @staticmethod
    def _is_weekly_slot_taken(item: CampaignContentQueueItem) -> bool:
        status = item.status.strip().lower()
        if status in {"skipped", "rejected"}:
            return False
        return True

    @staticmethod
    def _current_week_key() -> str:
        return SocialQueueService._week_key_for_start_date()

    @staticmethod
    def _utc_timestamp() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
