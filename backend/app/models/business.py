from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Business(BaseModel):
    id: str = Field(..., min_length=1)
    owner_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    industry: str | None = None
    location: str | None = None
    website_url: str | None = None
    phone: str | None = None
    email: str | None = None
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class BusinessCreateRequest(BaseModel):
    name: str = Field(..., min_length=1)
    industry: str | None = None
    location: str | None = None
    website_url: str | None = None
    phone: str | None = None
    email: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class BusinessUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    industry: str | None = None
    location: str | None = None
    website_url: str | None = None
    phone: str | None = None
    email: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class BusinessContext(BaseModel):
    business_id: str = Field(..., min_length=1)
    services: list[str] = Field(default_factory=list)
    target_customers: str | None = None
    brand_voice: str | None = None
    differentiators: list[str] = Field(default_factory=list)
    service_area: str | None = None
    notes: str | None = None
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class BusinessContextUpsertRequest(BaseModel):
    services: list[str] = Field(default_factory=list)
    target_customers: str | None = None
    brand_voice: str | None = None
    differentiators: list[str] = Field(default_factory=list)
    service_area: str | None = None
    notes: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class PhotoAsset(BaseModel):
    id: str = Field(..., min_length=1)
    business_id: str = Field(..., min_length=1)
    storage_path: str = Field(..., min_length=1)
    public_url: str | None = None
    caption: str | None = None
    tags: list[str] = Field(default_factory=list)
    job_type: str | None = None
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class PhotoAssetCreateRequest(BaseModel):
    storage_path: str = Field(..., min_length=1)
    public_url: str | None = None
    caption: str | None = None
    tags: list[str] = Field(default_factory=list)
    job_type: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class GeneratedPost(BaseModel):
    id: str = Field(..., min_length=1)
    business_id: str = Field(..., min_length=1)
    tool_type: str = Field(..., min_length=1)
    platform: str | None = None
    title: str | None = None
    content: str = Field(..., min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: str = Field(default="draft", min_length=1)
    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class GeneratedPostCreateRequest(BaseModel):
    tool_type: str = Field(..., min_length=1)
    platform: str | None = None
    title: str | None = None
    content: str = Field(..., min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: str = Field(default="draft", min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class GeneratedPostUpdateRequest(BaseModel):
    tool_type: str | None = Field(default=None, min_length=1)
    platform: str | None = None
    title: str | None = None
    content: str | None = Field(default=None, min_length=1)
    metadata: dict[str, Any] | None = None
    status: str | None = Field(default=None, min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)
