from datetime import datetime, time, timedelta, timezone

from app.agents.campaign_agent import CampaignAgent
from app.models.campaign import Campaign
from app.models.campaign_content import (
    CampaignContentQueueItem,
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

        week_key = self._current_week_key()
        existing_items = [
            item
            for item in self.sheets_service.get_posts_by_campaign_id(campaign.campaign_id)
            if self._item_week_key(item) == week_key
        ]
        if existing_items:
            return SocialQueueGenerateResponse(queue_items=existing_items, existing=True)

        platforms = self._weekly_platforms(request)
        schedule_slots = self._weekly_schedule_slots(request.posts_per_platform)
        created_at = self._utc_timestamp()
        content_id_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        queue_items: list[CampaignContentQueueItem] = []

        for post_index, scheduled_at in enumerate(schedule_slots, start=1):
            draft_set = self.campaign_agent.generate(campaign)
            image_metadata = self.campaign_image_service.select_next_image()
            for platform in platforms:
                queue_items.append(
                    self._build_queue_item(
                        campaign=campaign,
                        platform=platform,
                        caption=self._caption_for_platform(draft_set, platform),
                        post_type="Weekly",
                        week_key=week_key,
                        content_id=f"WSQ-{content_id_stamp}-{self._platform_slug(platform)}-{post_index}",
                        created_at=created_at,
                        scheduled_at=scheduled_at,
                        image_metadata=image_metadata,
                    )
                )

        saved_items = self.sheets_service.append_posts(queue_items)
        return SocialQueueGenerateResponse(queue_items=saved_items, existing=False)

    def generate_manual_post(
        self,
        request: ManualSocialPostGenerateRequest,
    ) -> SocialQueueGenerateResponse:
        selected_campaign = self._select_campaign(request.campaign_id)
        if selected_campaign is None:
            return SocialQueueGenerateResponse(queue_items=[], existing=False)
        campaign = self._campaign_for_posts(selected_campaign)

        platform = self._normalize_post_platform(request.platform or "Google Business")
        draft_set = self.campaign_agent.generate(campaign)
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
    ) -> CampaignContentQueueItem:
        notes = "\n".join(
            [
                "Generated by Weekly Social Queue",
                f"Business: {campaign.campaign_name}",
                f"Week: {week_key}",
                f"Post Type: {post_type}",
            ]
        )
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
    def _current_week_key() -> str:
        year, week_number, _ = datetime.now(timezone.utc).isocalendar()
        return f"{year}-W{week_number:02d}"

    @staticmethod
    def _utc_timestamp() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
