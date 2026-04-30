from datetime import datetime, timezone

from app.models.campaign import Campaign
from app.models.campaign_content import (
    CampaignContentQueueItem,
    CampaignDraftSet,
    ManualSocialPostGenerateRequest,
    WeeklySocialQueueGenerateRequest,
)
from app.services.campaign_image_service import CampaignImageMetadata
from app.services.social_queue_service import SocialQueueService


def _campaign(campaign_id: str = "CAMP-1001", status: str = "Active") -> Campaign:
    return Campaign(
        campaign_id=campaign_id,
        campaign_name="Marom Painting",
        service_focus="Interior painting",
        target_location="Oak Park",
        target_customer="homeowners",
        offer="Free quote request",
        cta="Request a quote",
        landing_page_url="https://gomezpainting.org/quote",
        start_date="2026-04-01",
        end_date="2026-05-31",
        status=status,
        notes="Weekly social content campaign.",
    )


def _draft_set() -> CampaignDraftSet:
    return CampaignDraftSet(
        facebook_post="Facebook caption",
        google_business_post="Google Business caption",
        instagram_caption="Instagram caption",
        craigslist_post="Craigslist caption",
        nextdoor_post="Nextdoor caption",
        confidence=0.9,
        needs_human_review=False,
    )


class FakeCampaignAgent:
    def __init__(self) -> None:
        self.generate_count = 0

    def generate(self, campaign: Campaign) -> CampaignDraftSet:
        self.generate_count += 1
        draft_set = _draft_set()
        return draft_set.model_copy(
            update={
                "facebook_post": f"{draft_set.facebook_post} {campaign.landing_page_url}",
                "google_business_post": f"{draft_set.google_business_post} {campaign.landing_page_url}",
                "instagram_caption": f"{draft_set.instagram_caption} {campaign.landing_page_url}",
            }
        )


class FakeCampaignImageService:
    def __init__(self) -> None:
        self.selection_count = 0

    def select_next_image(self) -> CampaignImageMetadata:
        self.selection_count += 1
        return CampaignImageMetadata(
            image_filename=f"image-{self.selection_count}.jpg",
            image_path=f"/media/campaigns/image-{self.selection_count}.jpg",
        )


class FakeSheetsService:
    def __init__(
        self,
        campaigns: list[Campaign] | None = None,
        queue_items: list[CampaignContentQueueItem] | None = None,
    ) -> None:
        self.campaigns = campaigns or [_campaign()]
        self.queue_items = queue_items or []
        self.appended_items: list[CampaignContentQueueItem] = []

    def list_campaigns(self) -> list[Campaign]:
        return self.campaigns

    def get_campaign_by_id(self, campaign_id: str) -> Campaign | None:
        return next((campaign for campaign in self.campaigns if campaign.campaign_id == campaign_id), None)

    def list_posts(self) -> list[CampaignContentQueueItem]:
        return self.queue_items

    def get_posts_by_campaign_id(self, campaign_id: str) -> list[CampaignContentQueueItem]:
        return [item for item in self.queue_items if item.campaign_id == campaign_id]

    def append_posts(
        self,
        queue_items: list[CampaignContentQueueItem],
    ) -> list[CampaignContentQueueItem]:
        self.appended_items.extend(queue_items)
        self.queue_items.extend(queue_items)
        return queue_items


def _current_week_key() -> str:
    year, week_number, _ = datetime.now(timezone.utc).isocalendar()
    return f"{year}-W{week_number:02d}"


def test_generate_weekly_posts_creates_google_business_and_combined_meta_posts() -> None:
    sheets_service = FakeSheetsService()
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(WeeklySocialQueueGenerateRequest())

    assert result.existing is False
    assert len(result.queue_items) == 6
    assert campaign_agent.generate_count == 3
    assert image_service.selection_count == 3
    assert {item.platform for item in result.queue_items} == {
        "Google Business",
        "Meta Dual",
    }
    assert all(item.status == "Draft" for item in result.queue_items)
    assert all(item.approved == "No" for item in result.queue_items)
    assert all(item.published == "No" for item in result.queue_items)
    assert all(item.business == "Marom Painting" for item in result.queue_items)
    assert all(item.post_type == "Weekly" for item in result.queue_items)
    assert all(item.landing_page_url == "https://marompainting.org" for item in result.queue_items)
    assert all("marompainting.org" in item.draft_text for item in result.queue_items)
    assert all("gomezpainting.org" not in item.draft_text for item in result.queue_items)
    assert all(f"Week: {_current_week_key()}" in item.notes for item in result.queue_items)
    assert all(item.scheduled_at for item in result.queue_items)


def test_generate_weekly_posts_returns_existing_current_week_without_duplicates() -> None:
    existing_item = CampaignContentQueueItem(
        content_id="WSQ-existing-google",
        campaign_id="CAMP-1001",
        platform="Google Business",
        draft_text="Existing caption",
        cta="Request a quote",
        landing_page_url="https://marompainting.example/quote",
        status="Draft",
        approved="No",
        published="No",
        created_at="2026-04-29T12:00:00Z",
        scheduled_at="2026-04-29T12:00:00Z",
        notes=f"Generated by Weekly Social Queue\nBusiness: Marom Painting\nWeek: {_current_week_key()}",
    )
    sheets_service = FakeSheetsService(queue_items=[existing_item])
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(WeeklySocialQueueGenerateRequest())

    assert result.existing is True
    assert result.queue_items == [existing_item]
    assert sheets_service.appended_items == []
    assert campaign_agent.generate_count == 0
    assert image_service.selection_count == 0


def test_generate_weekly_posts_merges_facebook_and_instagram_into_meta_dual() -> None:
    sheets_service = FakeSheetsService()
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(
        WeeklySocialQueueGenerateRequest(platforms=["Facebook Page", "Instagram"], posts_per_platform=1)
    )

    assert len(result.queue_items) == 1
    assert result.queue_items[0].platform == "Meta Dual"
    assert "Facebook caption" in result.queue_items[0].draft_text


def test_generate_manual_post_creates_one_default_google_business_item() -> None:
    sheets_service = FakeSheetsService()
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_manual_post(ManualSocialPostGenerateRequest())

    assert result.existing is False
    assert len(result.queue_items) == 1
    queue_item = result.queue_items[0]
    assert queue_item.platform == "Google Business"
    assert queue_item.draft_text == "Google Business caption https://marompainting.org"
    assert queue_item.status == "Draft"
    assert queue_item.landing_page_url == "https://marompainting.org"
    assert queue_item.image_path == "/media/campaigns/image-1.jpg"
    assert queue_item.business == "Marom Painting"
    assert queue_item.post_type == "General"


def test_generate_manual_post_merges_instagram_into_meta_dual() -> None:
    sheets_service = FakeSheetsService()
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_manual_post(ManualSocialPostGenerateRequest(platform="Instagram"))

    assert len(result.queue_items) == 1
    queue_item = result.queue_items[0]
    assert queue_item.platform == "Meta Dual"
    assert queue_item.draft_text == "Facebook caption https://marompainting.org"
