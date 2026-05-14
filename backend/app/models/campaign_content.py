from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


CampaignPlatform = Literal[
    "Facebook",
    "Facebook Page",
    "Google Business",
    "Instagram",
    "Meta Dual",
    "Facebook Groups",
    "Craigslist",
    "Nextdoor",
]
BusinessProfilePlatform = Literal["Facebook", "Instagram", "Google Business", "Facebook Groups"]


class CampaignDraftSet(BaseModel):
    facebook_post: str = Field(..., min_length=1)
    facebook_group_post: str = Field(default="", min_length=0)
    google_business_post: str = Field(..., min_length=1)
    instagram_caption: str = Field(..., min_length=1)
    craigslist_post: str = Field(..., min_length=1)
    nextdoor_post: str = Field(..., min_length=1)
    confidence: float = Field(..., ge=0.0, le=1.0)
    needs_human_review: bool = True

    model_config = ConfigDict(str_strip_whitespace=True)


class CampaignContentQueueItem(BaseModel):
    content_id: str = Field(..., min_length=1)
    campaign_id: str = Field(..., min_length=1)
    platform: CampaignPlatform
    draft_text: str = Field(..., min_length=1)
    cta: str = Field(..., min_length=1)
    landing_page_url: str = Field(..., min_length=1)
    image_filename: str | None = None
    image_path: str | None = None
    image_url: str | None = None
    business: str | None = None
    post_type: str | None = None
    status: str = "Needs Review"
    approved: str = "No"
    published: str = "No"
    created_at: str = Field(..., min_length=1)
    published_at: str | None = None
    scheduled_at: str | None = None
    publish_attempts: int = Field(default=0, ge=0)
    last_publish_error: str | None = None
    external_post_id: str | None = None
    published_url: str | None = None
    notes: str = ""

    model_config = ConfigDict(str_strip_whitespace=True)


class CampaignContentQueueSaveResponse(BaseModel):
    campaign_draft_set: CampaignDraftSet
    queue_items: list[CampaignContentQueueItem]


class CampaignContentQueueConflictResponse(BaseModel):
    detail: str
    existing_queue_items: list[CampaignContentQueueItem]


class CampaignContentPublishResult(BaseModel):
    external_post_id: str | None = None
    published_url: str | None = None
    status: str = "Published"
    published: str = "Yes"
    last_publish_error: str | None = None
    notes: str | None = None


class CampaignContentPublishResponse(BaseModel):
    queue_item: CampaignContentQueueItem
    publish_result: CampaignContentPublishResult


class CampaignContentScheduleRequest(BaseModel):
    scheduled_at: str = Field(..., min_length=1)


class CampaignContentImageUpdateRequest(BaseModel):
    image_filename: str | None = None
    image_path: str | None = None
    image_url: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class CampaignContentRunDueResponse(BaseModel):
    published_items: list[CampaignContentQueueItem]
    failed_items: list[CampaignContentQueueItem]


class CampaignContentDueCandidate(BaseModel):
    content_id: str
    platform: CampaignPlatform
    status: str
    approved: str
    published: str
    scheduled: bool
    scheduled_at: str | None = None
    eligible: bool
    skip_reasons: list[str]


class BusinessProfileInput(BaseModel):
    business_name: str = Field(..., min_length=1)
    industry: str | None = None
    service_area_cities: list[str] = Field(default_factory=list)
    services_offered: list[str] = Field(default_factory=list)
    website_url: str | None = None
    phone_number: str | None = None
    email: str | None = None
    brand_tone: str | None = None
    target_customer: str | None = None
    primary_cta: str | None = None
    platforms_used: list[BusinessProfilePlatform] = Field(default_factory=list)

    model_config = ConfigDict(str_strip_whitespace=True)


class WeeklySocialQueueGenerateRequest(BaseModel):
    campaign_id: str | None = None
    business_id: str | None = None
    platforms: list[CampaignPlatform] | None = None
    posts_per_platform: int = Field(default=3, ge=1, le=7)
    content_days: int | None = Field(default=None, ge=1, le=7)
    week_start_date: str | None = None
    content_types: list[str] | None = None
    campaign_theme: str | None = None
    separate_meta_platforms: bool = False
    include_facebook_groups: bool = False
    business_profile: BusinessProfileInput | None = None


class ManualSocialPostGenerateRequest(BaseModel):
    campaign_id: str | None = None
    business_id: str | None = None
    platform: CampaignPlatform | None = None
    post_type: str = "General"
    business_profile: BusinessProfileInput | None = None


class PostDraftTextUpdateRequest(BaseModel):
    draft_text: str = Field(..., min_length=1)


class SocialQueueGenerateResponse(BaseModel):
    queue_items: list[CampaignContentQueueItem]
    existing: bool = False
