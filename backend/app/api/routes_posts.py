from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_sheets_service, get_social_queue_service
from app.models.campaign_content import (
    CampaignContentImageUpdateRequest,
    CampaignContentScheduleRequest,
    CampaignContentQueueItem,
    ManualSocialPostGenerateRequest,
    PostDraftTextUpdateRequest,
    SocialQueueGenerateResponse,
    WeeklySocialQueueGenerateRequest,
)
from app.services.sheets_service import SheetsConfigurationError, SheetsDataError, SheetsService
from app.services.social_queue_service import SocialQueueService

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=list[CampaignContentQueueItem])
async def list_posts(
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> list[CampaignContentQueueItem]:
    try:
        return sheets_service.list_posts()
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.get("/weekly", response_model=list[CampaignContentQueueItem])
async def list_weekly_posts(
    week_start_date: str | None = None,
    social_queue_service: SocialQueueService = Depends(get_social_queue_service),
) -> list[CampaignContentQueueItem]:
    try:
        return social_queue_service.list_week_posts(week_start_date)
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.post("/generate-weekly", response_model=SocialQueueGenerateResponse)
async def generate_weekly_posts(
    request: WeeklySocialQueueGenerateRequest,
    social_queue_service: SocialQueueService = Depends(get_social_queue_service),
) -> SocialQueueGenerateResponse:
    try:
        return social_queue_service.generate_weekly_posts(request)
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.post("/generate-post", response_model=SocialQueueGenerateResponse)
async def generate_manual_post(
    request: ManualSocialPostGenerateRequest,
    social_queue_service: SocialQueueService = Depends(get_social_queue_service),
) -> SocialQueueGenerateResponse:
    try:
        return social_queue_service.generate_manual_post(request)
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.post("/{content_id}/copy", response_model=CampaignContentQueueItem)
async def mark_post_copied(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_post(
        content_id=content_id,
        updated_post=_update_post("copied", content_id, sheets_service),
    )


@router.patch("/{content_id}/draft-text", response_model=CampaignContentQueueItem)
async def update_post_draft_text(
    content_id: str,
    request: PostDraftTextUpdateRequest,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    try:
        updated_post = sheets_service.update_post_draft_text(
            content_id=content_id,
            draft_text=request.draft_text,
        )
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    return _serialize_updated_post(content_id=content_id, updated_post=updated_post)


@router.patch("/{content_id}/schedule", response_model=CampaignContentQueueItem)
async def update_post_schedule(
    content_id: str,
    request: CampaignContentScheduleRequest,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    try:
        updated_post = sheets_service.update_post_scheduled_at(
            content_id=content_id,
            scheduled_at=request.scheduled_at,
        )
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    return _serialize_updated_post(content_id=content_id, updated_post=updated_post)


@router.patch("/{content_id}/image", response_model=CampaignContentQueueItem)
async def update_post_image(
    content_id: str,
    request: CampaignContentImageUpdateRequest,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    try:
        updated_post = sheets_service.update_post_image(
            content_id=content_id,
            image_filename=request.image_filename,
            image_path=request.image_path,
            image_url=request.image_url,
        )
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    return _serialize_updated_post(content_id=content_id, updated_post=updated_post)


@router.delete("/{content_id}", response_model=CampaignContentQueueItem)
async def delete_post(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    try:
        deleted_post = sheets_service.delete_post(content_id)
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    return _serialize_updated_post(content_id=content_id, updated_post=deleted_post)


@router.post("/{content_id}/posted", response_model=CampaignContentQueueItem)
async def mark_post_posted(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_post(
        content_id=content_id,
        updated_post=_update_post("posted", content_id, sheets_service),
    )


@router.post("/{content_id}/skip", response_model=CampaignContentQueueItem)
async def mark_post_skipped(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_post(
        content_id=content_id,
        updated_post=_update_post("skipped", content_id, sheets_service),
    )


@router.post("/{content_id}/restore", response_model=CampaignContentQueueItem)
async def restore_post_to_queue(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_post(
        content_id=content_id,
        updated_post=_update_post("restore", content_id, sheets_service),
    )


def _update_post(action: str, content_id: str, sheets_service: SheetsService) -> CampaignContentQueueItem | None:
    try:
        if action == "copied":
            return sheets_service.mark_post_copied(content_id)
        if action == "posted":
            return sheets_service.mark_post_posted(content_id)
        if action == "restore":
            return sheets_service.restore_post_to_queue(content_id)
        return sheets_service.mark_post_skipped(content_id)
    except SheetsConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SheetsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


def _serialize_updated_post(content_id: str, updated_post: CampaignContentQueueItem | None) -> dict[str, Any]:
    if updated_post is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Post not found for content_id: {content_id}",
        )

    return updated_post.model_dump(mode="json")
