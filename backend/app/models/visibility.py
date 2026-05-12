from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.campaign_content import BusinessProfileInput


VisibilityToolType = Literal[
    "local_reach_post",
    "review_request",
    "business_intro_post",
    "craigslist_service_ad",
]
VisibilityDestination = Literal[
    "Google Business Profile",
    "Facebook Group",
    "Craigslist",
    "Neighborhood Group",
    "General Social Post",
]
VisibilityGenerationMode = Literal["llm", "fallback"]


class VisibilityPhotoAssetMetadata(BaseModel):
    id: str | None = None
    title: str = ""
    description: str = ""
    category: str = ""
    service_type: str = ""
    location: str = ""
    tags: list[str] = Field(default_factory=list)
    quality: str = ""
    image_filename: str | None = None
    image_path: str | None = None
    image_url: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class VisibilityGenerationRequest(BaseModel):
    tool_type: VisibilityToolType = Field(..., alias="toolType")
    destination: VisibilityDestination | None = None
    post_type: str | None = Field(default=None, alias="postType")
    business_profile: BusinessProfileInput | None = Field(default=None, alias="businessProfile")
    service_focus: str = Field(default="", alias="serviceFocus")
    location: str = ""
    goal: str = ""
    tone: str = ""
    cta: str = ""
    notes: str = ""
    customer_name: str = Field(default="", alias="customerName")
    job_completed: str = Field(default="", alias="jobCompleted")
    review_link: str = Field(default="", alias="reviewLink")
    services_to_mention: str = Field(default="", alias="servicesToMention")
    business_background: str = Field(default="", alias="businessBackground")
    offer_details: str = Field(default="", alias="offerDetails")
    customer_pain_point: str = Field(default="", alias="customerPainPoint")
    trust_signals: str = Field(default="", alias="trustSignals")
    contact: str = ""
    photo_asset: VisibilityPhotoAssetMetadata | None = Field(default=None, alias="photoAsset")
    photo_assets: list[VisibilityPhotoAssetMetadata] = Field(default_factory=list, alias="photoAssets")
    output_format: str = Field(default="structured", alias="outputFormat")

    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)


class VisibilityGenerationResponse(BaseModel):
    primary: str = ""
    short_version: str = Field(default="", alias="shortVersion")
    cta_line: str = Field(default="", alias="ctaLine")
    titles: list[str] = Field(default_factory=list)
    hashtags_or_keywords: list[str] = Field(default_factory=list, alias="hashtagsOrKeywords")
    image_suggestions: list[str] = Field(default_factory=list, alias="imageSuggestions")
    generation_mode: VisibilityGenerationMode = Field(default="fallback", alias="generationMode")

    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)
