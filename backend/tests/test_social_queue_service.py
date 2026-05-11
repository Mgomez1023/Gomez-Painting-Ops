from datetime import datetime, timezone

from app.models.campaign import Campaign
from app.models.campaign_content import (
    CampaignContentQueueItem,
    CampaignDraftSet,
    ManualSocialPostGenerateRequest,
    WeeklySocialQueueGenerateRequest,
)
from app.services.campaign_image_service import CampaignImageMetadata
from app.services.social_queue_service import STATIC_WEEKLY_AVOID_PHRASES, SocialQueueService


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
        self.generate_for_post_type_calls: list[dict[str, object]] = []

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

    def generate_for_post_type(
        self,
        campaign: Campaign,
        post_type: str,
        platform: str | None = None,
        avoid_phrases: list[str] | None = None,
    ) -> CampaignDraftSet:
        self.generate_count += 1
        self.generate_for_post_type_calls.append(
            {
                "post_type": post_type,
                "platform": platform,
                "avoid_phrases": avoid_phrases or [],
            }
        )
        draft_set = _draft_set()
        return draft_set.model_copy(
            update={
                "facebook_post": f"{post_type} Facebook caption. {campaign.landing_page_url}",
                "google_business_post": f"{post_type} Google Business caption. {campaign.landing_page_url}",
                "instagram_caption": f"{post_type} Instagram caption. {campaign.landing_page_url}",
            }
        )


class FakeCampaignImageService:
    def __init__(self) -> None:
        self.selection_count = 0

    def select_next_image(self) -> CampaignImageMetadata:
        return self.select_next_unique_image(set())

    def select_next_unique_image(self, excluded_image_filenames: set[str]) -> CampaignImageMetadata:
        self.selection_count += 1
        image_index = self.selection_count
        while f"image-{image_index}.jpg" in excluded_image_filenames:
            image_index += 1
        return CampaignImageMetadata(
            image_filename=f"image-{image_index}.jpg",
            image_path=f"/media/campaigns/image-{image_index}.jpg",
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


def _queue_item(
    content_id: str,
    platform: str = "Google Business",
    slot: int | None = 1,
    post_type: str = "Seasonal Reminder",
    status: str = "Draft",
    published: str = "No",
    notes_prefix: str = "Generated by Weekly Social Queue",
) -> CampaignContentQueueItem:
    note_lines = [
        notes_prefix,
        "Business: Marom Painting",
        f"Week: {_current_week_key()}",
    ]
    if slot is not None:
        note_lines.append(f"Slot: {slot}")
    note_lines.append(f"Post Type: {post_type}")
    return CampaignContentQueueItem(
        content_id=content_id,
        campaign_id="CAMP-1001",
        platform=platform,
        draft_text=f"Existing {platform} slot {slot}",
        cta="Request a quote",
        landing_page_url="https://marompainting.example/quote",
        status=status,
        approved="No",
        published=published,
        created_at="2026-04-29T12:00:00Z",
        scheduled_at="2026-04-29T12:00:00Z",
        notes="\n".join(note_lines),
    )


def test_generate_weekly_posts_creates_google_business_and_combined_meta_posts() -> None:
    sheets_service = FakeSheetsService()
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(WeeklySocialQueueGenerateRequest())

    assert result.existing is False
    assert len(result.queue_items) == 6
    assert campaign_agent.generate_count == 3
    assert image_service.selection_count == 6
    assert {item.platform for item in result.queue_items} == {
        "Google Business",
        "Meta Dual",
    }
    assert all(item.status == "Draft" for item in result.queue_items)
    assert all(item.approved == "No" for item in result.queue_items)
    assert all(item.published == "No" for item in result.queue_items)
    assert all(item.business == "Marom Painting" for item in result.queue_items)
    assert [item.post_type for item in result.queue_items] == [
        "Seasonal Reminder",
        "Seasonal Reminder",
        "Problem Solution",
        "Problem Solution",
        "Trust Local Proof",
        "Trust Local Proof",
    ]
    assert [call["post_type"] for call in campaign_agent.generate_for_post_type_calls] == [
        "Seasonal Reminder",
        "Problem Solution",
        "Trust Local Proof",
    ]
    assert all(call["platform"] == "Google Business, Meta Dual" for call in campaign_agent.generate_for_post_type_calls)
    assert all(item.landing_page_url == "https://marompainting.org" for item in result.queue_items)
    assert all("marompainting.org" in item.draft_text for item in result.queue_items)
    assert all("gomezpainting.org" not in item.draft_text for item in result.queue_items)
    assert all(f"Week: {_current_week_key()}" in item.notes for item in result.queue_items)
    assert [SocialQueueService._item_slot_index(item) for item in result.queue_items] == [1, 1, 2, 2, 3, 3]
    assert all(item.scheduled_at for item in result.queue_items)


def test_generate_weekly_posts_returns_existing_only_when_all_expected_slots_are_taken() -> None:
    existing_items = [
        _queue_item("WSQ-existing-google-1", platform="Google Business", slot=1, post_type="Seasonal Reminder"),
        _queue_item("WSQ-existing-meta-1", platform="Meta Dual", slot=1, post_type="Seasonal Reminder"),
        _queue_item("WSQ-existing-google-2", platform="Google Business", slot=2, post_type="Problem Solution"),
        _queue_item("WSQ-existing-meta-2", platform="Meta Dual", slot=2, post_type="Problem Solution"),
        _queue_item("WSQ-existing-google-3", platform="Google Business", slot=3, post_type="Trust Local Proof"),
        _queue_item("WSQ-existing-meta-3", platform="Meta Dual", slot=3, post_type="Trust Local Proof"),
    ]
    sheets_service = FakeSheetsService(queue_items=existing_items)
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(WeeklySocialQueueGenerateRequest())

    assert result.existing is True
    assert result.queue_items == existing_items
    assert sheets_service.appended_items == []
    assert campaign_agent.generate_count == 0
    assert image_service.selection_count == 0


def test_generate_weekly_posts_fills_only_missing_slots_without_duplicates() -> None:
    existing_items = [
        _queue_item("WSQ-existing-google-1", platform="Google Business", slot=1, post_type="Seasonal Reminder"),
        _queue_item("WSQ-existing-meta-1", platform="Meta Dual", slot=1, post_type="Seasonal Reminder"),
        _queue_item("WSQ-existing-google-2", platform="Google Business", slot=2, post_type="Problem Solution"),
        _queue_item("WSQ-existing-meta-3", platform="Meta Dual", slot=3, post_type="Trust Local Proof"),
    ]
    sheets_service = FakeSheetsService(queue_items=existing_items)
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(WeeklySocialQueueGenerateRequest())

    assert result.existing is False
    assert len(result.queue_items) == 6
    assert len(sheets_service.appended_items) == 2
    assert [(item.platform, SocialQueueService._item_slot_index(item)) for item in sheets_service.appended_items] == [
        ("Meta Dual", 2),
        ("Google Business", 3),
    ]
    assert [item.post_type for item in sheets_service.appended_items] == [
        "Problem Solution",
        "Trust Local Proof",
    ]
    assert campaign_agent.generate_count == 2
    assert image_service.selection_count == 2


def test_generate_weekly_posts_refills_skipped_or_rejected_slots_but_keeps_posted_slots() -> None:
    existing_items = [
        _queue_item("WSQ-existing-google-1", platform="Google Business", slot=1, status="Skipped"),
        _queue_item("WSQ-existing-meta-1", platform="Meta Dual", slot=1, status="Rejected"),
        _queue_item("WSQ-existing-google-2", platform="Google Business", slot=2, post_type="Problem Solution"),
        _queue_item(
            "WSQ-existing-meta-2",
            platform="Meta Dual",
            slot=2,
            post_type="Problem Solution",
            status="Posted",
            published="Yes",
        ),
    ]
    sheets_service = FakeSheetsService(queue_items=existing_items)
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    service.generate_weekly_posts(WeeklySocialQueueGenerateRequest(posts_per_platform=2))

    assert [(item.platform, SocialQueueService._item_slot_index(item)) for item in sheets_service.appended_items] == [
        ("Google Business", 1),
        ("Meta Dual", 1),
    ]
    assert campaign_agent.generate_count == 1
    assert image_service.selection_count == 2


def test_manual_current_week_post_does_not_count_as_weekly_slot() -> None:
    manual_item = _queue_item(
        "MSQ-existing-google",
        platform="Google Business",
        slot=None,
        post_type="General",
        notes_prefix="Generated by Weekly Social Queue",
    )
    sheets_service = FakeSheetsService(queue_items=[manual_item])
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(WeeklySocialQueueGenerateRequest(posts_per_platform=1))

    assert result.existing is False
    assert len(sheets_service.appended_items) == 2
    assert {item.platform for item in sheets_service.appended_items} == {"Google Business", "Meta Dual"}


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
    assert result.queue_items[0].post_type == "Seasonal Reminder"
    assert "Seasonal Reminder Facebook caption" in result.queue_items[0].draft_text


def test_generate_weekly_schedule_uses_selected_week_days_platforms_and_content_types() -> None:
    sheets_service = FakeSheetsService()
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(
        WeeklySocialQueueGenerateRequest(
            week_start_date="2026-05-11",
            content_days=5,
            posts_per_platform=5,
            platforms=["Facebook", "Instagram", "Google Business"],
            content_types=[
                "Seasonal Reminder",
                "Problem/Solution",
                "Trust Local Proof",
                "Before/After",
                "Service Education",
            ],
            campaign_theme="Weekly Local Business Content",
            separate_meta_platforms=True,
        )
    )

    assert result.existing is False
    assert len(result.queue_items) == 15
    assert campaign_agent.generate_count == 5
    assert image_service.selection_count == 15
    assert {item.platform for item in result.queue_items} == {"Facebook", "Instagram", "Google Business"}
    slot_dates = {
        SocialQueueService._item_slot_index(item): item.scheduled_at[:10]
        for item in result.queue_items
        if item.platform == "Facebook" and item.scheduled_at
    }
    assert slot_dates == {
        1: "2026-05-11",
        2: "2026-05-12",
        3: "2026-05-13",
        4: "2026-05-14",
        5: "2026-05-15",
    }
    assert [call["post_type"] for call in campaign_agent.generate_for_post_type_calls] == [
        "Seasonal Reminder",
        "Problem/Solution",
        "Trust Local Proof",
        "Before/After",
        "Service Education",
    ]
    assert all("Week: 2026-W20" in item.notes for item in result.queue_items)
    assert all("Week Start: 2026-05-11" in item.notes for item in result.queue_items)
    assert all("Campaign Theme: Weekly Local Business Content" in item.notes for item in result.queue_items)
    assert len({item.image_filename for item in result.queue_items}) == len(result.queue_items)
    instagram_item = next(item for item in result.queue_items if item.platform == "Instagram")
    assert "Instagram caption" in instagram_item.draft_text


def test_generate_weekly_posts_uses_business_profile_when_no_campaign_is_selected() -> None:
    sheets_service = FakeSheetsService(campaigns=[])
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(
        WeeklySocialQueueGenerateRequest(
            business_profile={
                "business_name": "Acme Roofing",
                "industry": "Roofing",
                "service_area_cities": ["Austin", "Round Rock"],
                "services_offered": ["Roof repair", "Storm damage inspections"],
                "website_url": "https://acme-roofing.example",
                "brand_tone": "Direct and reassuring",
                "target_customer": "homeowners with roof leaks",
                "primary_cta": "Schedule a roof inspection",
                "platforms_used": ["Facebook", "Instagram", "Google Business"],
            }
        )
    )

    assert result.existing is False
    assert len(result.queue_items) == 6
    assert all(item.campaign_id == "BUSINESS-PROFILE" for item in result.queue_items)
    assert all(item.business == "Acme Roofing" for item in result.queue_items)
    assert all(item.cta == "Schedule a roof inspection" for item in result.queue_items)
    assert all(item.landing_page_url == "https://acme-roofing.example" for item in result.queue_items)
    assert all("acme-roofing.example" in item.draft_text for item in result.queue_items)
    assert all("Generated from Business Profile" in item.notes for item in result.queue_items)
    assert all("Services Offered: Roof repair, Storm damage inspections" in item.notes for item in result.queue_items)


def test_generate_weekly_posts_avoids_images_already_used_in_same_week() -> None:
    existing_item = _queue_item(
        "WSQ-existing-google-1",
        platform="Google Business",
        slot=1,
        post_type="Seasonal Reminder",
    ).model_copy(update={"image_filename": "image-1.jpg", "image_path": "/media/campaigns/image-1.jpg"})
    sheets_service = FakeSheetsService(queue_items=[existing_item])
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_weekly_posts(WeeklySocialQueueGenerateRequest(posts_per_platform=1))

    generated_images = {
        item.image_filename
        for item in result.queue_items
        if item.content_id != existing_item.content_id
    }
    assert "image-1.jpg" not in generated_images
    assert len(generated_images) == len(result.queue_items) - 1


def test_generate_weekly_posts_passes_static_and_recent_openings_to_avoid() -> None:
    previous_item = CampaignContentQueueItem(
        content_id="WSQ-previous-google",
        campaign_id="CAMP-1001",
        platform="Google Business",
        draft_text="Spring is the perfect time to repaint your living room. Request a quote today.",
        cta="Request a quote",
        landing_page_url="https://marompainting.example/quote",
        status="Draft",
        approved="No",
        published="No",
        created_at="2026-04-01T12:00:00Z",
        scheduled_at="2026-04-01T12:00:00Z",
        notes="Generated by Weekly Social Queue\nBusiness: Marom Painting\nWeek: 2026-W01",
    )
    sheets_service = FakeSheetsService(queue_items=[previous_item])
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    service.generate_weekly_posts(WeeklySocialQueueGenerateRequest(posts_per_platform=2))

    first_call_phrases = campaign_agent.generate_for_post_type_calls[0]["avoid_phrases"]
    second_call_phrases = campaign_agent.generate_for_post_type_calls[1]["avoid_phrases"]
    assert isinstance(first_call_phrases, list)
    assert isinstance(second_call_phrases, list)
    assert "Spring is the perfect time" in first_call_phrases
    assert "Spring is the perfect time to repaint your living room." in first_call_phrases
    assert STATIC_WEEKLY_AVOID_PHRASES[-1] in first_call_phrases
    assert "Seasonal Reminder Facebook caption." in second_call_phrases


def test_generate_weekly_posts_uses_expected_post_type_rotation() -> None:
    assert SocialQueueService._weekly_post_types(8) == [
        "Seasonal Reminder",
        "Problem Solution",
        "Trust Local Proof",
        "Project Highlight",
        "FAQ Education",
        "Offer CTA",
        "Neighborhood Focus",
        "Preparation Tip",
    ]


def test_content_day_offsets_match_weekly_schedule_rules() -> None:
    assert SocialQueueService._content_day_offsets(5) == [0, 1, 2, 3, 4]
    assert SocialQueueService._content_day_offsets(7) == [0, 1, 2, 3, 4, 5, 6]
    assert SocialQueueService._content_day_offsets(3) == [0, 2, 4]
    assert SocialQueueService._content_day_offsets(2) == [1, 3]
    assert SocialQueueService._content_day_offsets(1) == [0]


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
    assert queue_item.draft_text == "General Google Business caption. https://marompainting.org"
    assert queue_item.status == "Draft"
    assert queue_item.landing_page_url == "https://marompainting.org"
    assert queue_item.image_path == "/media/campaigns/image-1.jpg"
    assert queue_item.business == "Marom Painting"
    assert queue_item.post_type == "General"
    assert campaign_agent.generate_for_post_type_calls == [
        {
            "post_type": "General",
            "platform": "Google Business",
            "avoid_phrases": STATIC_WEEKLY_AVOID_PHRASES,
        }
    ]


def test_generate_manual_post_uses_business_profile_when_no_campaign_is_selected() -> None:
    sheets_service = FakeSheetsService(campaigns=[])
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_manual_post(
        ManualSocialPostGenerateRequest(
            post_type="Offer / CTA",
            business_profile={
                "business_name": "Northside Landscaping",
                "industry": "Landscaping",
                "service_area_cities": ["Evanston"],
                "services_offered": ["Lawn care", "Mulch installation"],
                "website_url": "https://northside-landscaping.example",
                "target_customer": "busy homeowners",
                "primary_cta": "Request a lawn care quote",
                "platforms_used": ["Facebook", "Instagram", "Google Business"],
            },
        )
    )

    queue_item = result.queue_items[0]
    assert queue_item.campaign_id == "BUSINESS-PROFILE"
    assert queue_item.business == "Northside Landscaping"
    assert queue_item.cta == "Request a lawn care quote"
    assert queue_item.landing_page_url == "https://northside-landscaping.example"
    assert queue_item.draft_text == "Offer / CTA Google Business caption. https://northside-landscaping.example"


def test_generate_manual_post_passes_selected_post_type_into_generation() -> None:
    sheets_service = FakeSheetsService()
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_manual_post(ManualSocialPostGenerateRequest(post_type="FAQ / Education"))

    queue_item = result.queue_items[0]
    assert queue_item.post_type == "FAQ / Education"
    assert queue_item.draft_text == "FAQ / Education Google Business caption. https://marompainting.org"
    assert campaign_agent.generate_for_post_type_calls[0]["post_type"] == "FAQ / Education"


def test_generate_manual_post_merges_instagram_into_meta_dual() -> None:
    sheets_service = FakeSheetsService()
    campaign_agent = FakeCampaignAgent()
    image_service = FakeCampaignImageService()
    service = SocialQueueService(sheets_service, campaign_agent, image_service)

    result = service.generate_manual_post(ManualSocialPostGenerateRequest(platform="Instagram"))

    assert len(result.queue_items) == 1
    queue_item = result.queue_items[0]
    assert queue_item.platform == "Meta Dual"
    assert queue_item.draft_text == "General Facebook caption. https://marompainting.org"
    assert campaign_agent.generate_for_post_type_calls[0]["platform"] == "Meta Dual"
