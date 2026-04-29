from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_sheets_service
from app.models.content_queue import ContentQueueItem
from app.services.sheets_service import SheetsConfigurationError, SheetsDataError, SheetsService

router = APIRouter(prefix="/content-queue", tags=["content-queue"])


@router.get("", response_model=list[ContentQueueItem])
async def list_content_queue_items(
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> list[ContentQueueItem]:
    try:
        return sheets_service.list_content_queue_items()
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


@router.post("/{content_id}/approve", response_model=ContentQueueItem)
async def approve_content_queue_item(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_item(
        content_id=content_id,
        updated_item=_update_item("approve", content_id, sheets_service),
    )


@router.post("/{content_id}/reject", response_model=ContentQueueItem)
async def reject_content_queue_item(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_item(
        content_id=content_id,
        updated_item=_update_item("reject", content_id, sheets_service),
    )


@router.post("/{content_id}/mark-published", response_model=ContentQueueItem)
async def mark_content_queue_item_published(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_item(
        content_id=content_id,
        updated_item=_update_item("mark-published", content_id, sheets_service),
    )


def _update_item(action: str, content_id: str, sheets_service: SheetsService) -> ContentQueueItem | None:
    try:
        if action == "approve":
            return sheets_service.approve_content_queue_item(content_id)
        if action == "reject":
            return sheets_service.reject_content_queue_item(content_id)
        return sheets_service.mark_content_queue_item_published(content_id)
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


def _serialize_updated_item(content_id: str, updated_item: ContentQueueItem | None) -> dict[str, Any]:
    if updated_item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Content queue item not found for content_id: {content_id}",
        )

    return updated_item.model_dump(mode="json")
