import re
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone

from app.agents.campaign_agent import CampaignAgent
from app.models.campaign import Campaign
from app.models.campaign_content import (
    CampaignContentQueueItem,
    CampaignDraftSet,
    CampaignPlatform,
    ManualSocialPostGenerateRequest,
    SocialQueueGenerateResponse,
    WeeklySocialQueueGenerateRequest,
)
from app.services.campaign_image_service import CampaignImageService, CampaignImageMetadata
from app.services.sheets_service import SheetsService


DEFAULT_WEEKLY_PLATFORMS: list[CampaignPlatform] = [
    "Google Business",
    "Meta Dual",
]
POSTS_LANDING_PAGE_URL = "https://marompainting.org"
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
        week_key = self._current_week_key()
        return [
            item
            for item in self.sheets_service.list_posts()
            if self._item_week_key(item) == week_key
        ]

    def generate_weekly_posts(
        self,
        request: WeeklySocialQueueGenerateRequest,
    ) -> SocialQueueGenerateResponse:
        selected_campaign = self._select_campaign(request.campaign_id)
        if selected_campaign is None:
            return SocialQueueGenerateResponse(queue_items=[], existing=False)
        campaign = self._campaign_for_posts(selected_campaign)

        platforms = self._weekly_platforms(request)
        expected_plan = self._weekly_post_plan(
            platforms=platforms,
            posts_per_platform=request.posts_per_platform,
        )
        week_key = self._current_week_key()
        existing_items = [
            item
            for item in self.sheets_service.get_posts_by_campaign_id(campaign.campaign_id)
            if self._item_week_key(item) == week_key
        ]
        taken_slot_keys = {
            (slot_index, self._normalize_post_platform(item.platform))
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

        for slots in self._group_weekly_slots_by_index(missing_slots):
            first_slot = slots[0]
            draft_set = self.campaign_agent.generate_for_post_type(
                campaign,
                post_type=first_slot.post_type,
                platform=", ".join(slot.platform for slot in slots),
                avoid_phrases=avoid_phrases,
            )
            avoid_phrases = self._extend_avoid_phrases_from_draft_set(avoid_phrases, draft_set)
            image_metadata = self.campaign_image_service.select_next_image()
            for slot in slots:
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
                    )
                )

        saved_items = self.sheets_service.append_posts(queue_items)
        return SocialQueueGenerateResponse(queue_items=[*existing_items, *saved_items], existing=False)

    def generate_manual_post(
        self,
        request: ManualSocialPostGenerateRequest,
    ) -> SocialQueueGenerateResponse:
        selected_campaign = self._select_campaign(request.campaign_id)
        if selected_campaign is None:
            return SocialQueueGenerateResponse(queue_items=[], existing=False)
        campaign = self._campaign_for_posts(selected_campaign)

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

    @staticmethod
    def _campaign_for_posts(campaign: Campaign) -> Campaign:
        return campaign.model_copy(update={"landing_page_url": POSTS_LANDING_PAGE_URL})

    @staticmethod
    def _weekly_platforms(request: WeeklySocialQueueGenerateRequest) -> list[CampaignPlatform]:
        requested_platforms = request.platforms or DEFAULT_WEEKLY_PLATFORMS
        platforms: list[CampaignPlatform] = []
        for requested_platform in requested_platforms:
            platform = SocialQueueService._normalize_post_platform(requested_platform)
            if platform not in platforms:
                platforms.append(platform)
        if request.include_facebook_groups and "Facebook Groups" not in platforms:
            platforms = [*platforms, "Facebook Groups"]
        return platforms

    @staticmethod
    def _normalize_post_platform(platform: CampaignPlatform) -> CampaignPlatform:
        if platform in {"Facebook", "Facebook Page", "Instagram", "Meta Dual"}:
            return "Meta Dual"
        return platform

    @staticmethod
    def _weekly_schedule_slots(posts_per_platform: int) -> list[str]:
        now = datetime.now(timezone.utc)
        monday = datetime.combine(
            (now - timedelta(days=now.weekday())).date(),
            time(hour=9, tzinfo=timezone.utc),
        )
        offsets = [0, 2, 4, 1, 3, 5, 6]
        return [
            (monday + timedelta(days=offsets[index])).isoformat(timespec="seconds").replace("+00:00", "Z")
            for index in range(posts_per_platform)
        ]

    def _weekly_post_plan(
        self,
        platforms: list[CampaignPlatform],
        posts_per_platform: int,
    ) -> list[WeeklyPostSlot]:
        schedule_slots = self._weekly_schedule_slots(posts_per_platform)
        post_types = self._weekly_post_types(posts_per_platform)
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
    def _weekly_post_types(posts_per_platform: int) -> list[str]:
        return [
            WEEKLY_POST_TYPES[index % len(WEEKLY_POST_TYPES)]
            for index in range(posts_per_platform)
        ]

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
    ) -> CampaignContentQueueItem:
        note_lines = [
            "Generated by Weekly Social Queue",
            f"Business: {campaign.campaign_name}",
            f"Week: {week_key}",
        ]
        if slot_index is not None:
            note_lines.append(f"Slot: {slot_index}")
        note_lines.append(f"Post Type: {post_type}")
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
        year, week_number, _ = datetime.now(timezone.utc).isocalendar()
        return f"{year}-W{week_number:02d}"

    @staticmethod
    def _utc_timestamp() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
