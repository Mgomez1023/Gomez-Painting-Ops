from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


SocialProvider = Literal["meta", "google_business"]
PublishPlatform = Literal["Facebook", "Instagram", "Google Business"]


class SocialConnection(BaseModel):
    id: str = Field(..., min_length=1)
    owner_id: str = Field(..., min_length=1)
    provider: SocialProvider
    account_label: str = Field(..., min_length=1)
    external_account_id: str = Field(..., min_length=1)
    connection_kind: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class SocialTarget(BaseModel):
    id: str = Field(..., min_length=1)
    owner_id: str = Field(..., min_length=1)
    connection_id: str = Field(..., min_length=1)
    provider: SocialProvider
    platform: PublishPlatform
    target_type: str = Field(..., min_length=1)
    display_name: str = Field(..., min_length=1)
    external_target_id: str = Field(..., min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class BusinessPublishTarget(BaseModel):
    id: str = Field(..., min_length=1)
    owner_id: str = Field(..., min_length=1)
    business_id: str = Field(..., min_length=1)
    platform: PublishPlatform
    social_target_id: str = Field(..., min_length=1)
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class AssignBusinessPublishTargetRequest(BaseModel):
    social_target_id: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class CreateFakeConnectionRequest(BaseModel):
    provider: SocialProvider

    model_config = ConfigDict(str_strip_whitespace=True)
