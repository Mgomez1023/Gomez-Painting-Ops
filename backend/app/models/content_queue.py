from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.content_draft import ContentDraft


ContentPlatform = Literal["Facebook", "Google Business", "Instagram", "Review Request"]


class ContentQueueItem(BaseModel):
    content_id: str = Field(..., min_length=1)
    job_id: str = Field(..., min_length=1)
    platform: ContentPlatform
    draft_text: str = Field(..., min_length=1)
    status: str = "Needs Review"
    approved: str = "No"
    published: str = "No"
    created_at: str = Field(..., min_length=1)
    notes: str = ""

    model_config = ConfigDict(str_strip_whitespace=True)


class ContentQueueSaveResponse(BaseModel):
    content_draft: ContentDraft
    queue_items: list[ContentQueueItem]


class ContentQueueConflictResponse(BaseModel):
    detail: str
    existing_queue_items: list[ContentQueueItem]
