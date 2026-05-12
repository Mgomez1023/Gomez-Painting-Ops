from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


PhotoAssetCategory = Literal[
    "Before",
    "After",
    "Before/After Pair",
    "Interior",
    "Exterior",
    "Cabinets",
    "Trim",
    "Drywall Repair",
    "Team / Work In Progress",
    "Finished Project",
]
PhotoAssetQuality = Literal["standard", "strong", "hero"]


class PhotoAsset(BaseModel):
    id: str = Field(..., min_length=1)
    business_id: str = Field(..., min_length=1)
    image_url: str | None = None
    image_path: str | None = None
    image_filename: str | None = None
    title: str = Field(..., min_length=1)
    description: str = ""
    category: PhotoAssetCategory
    service_type: str = ""
    location: str = ""
    tags: list[str] = Field(default_factory=list)
    quality: PhotoAssetQuality = "standard"
    used_count: int = Field(default=0, ge=0)
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class PhotoAssetCreateRequest(BaseModel):
    business_id: str | None = None
    image_data: str | None = None
    image_url: str | None = None
    image_filename: str | None = None
    title: str = Field(..., min_length=1)
    description: str = ""
    category: PhotoAssetCategory
    service_type: str = ""
    location: str = ""
    tags: list[str] = Field(default_factory=list)
    quality: PhotoAssetQuality = "standard"

    model_config = ConfigDict(str_strip_whitespace=True)


class PhotoAssetUpdateRequest(BaseModel):
    business_id: str | None = None
    image_data: str | None = None
    image_url: str | None = None
    image_filename: str | None = None
    title: str | None = None
    description: str | None = None
    category: PhotoAssetCategory | None = None
    service_type: str | None = None
    location: str | None = None
    tags: list[str] | None = None
    quality: PhotoAssetQuality | None = None

    model_config = ConfigDict(str_strip_whitespace=True)
