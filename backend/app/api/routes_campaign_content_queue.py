from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_publishing_workflow_service, get_sheets_service
from app.models.campaign_content import (
    CampaignContentPublishResponse,
    CampaignContentQueueItem,
    CampaignContentScheduleRequest,
)
from app.services.publishing_workflow_service import (
    CampaignContentPublishNotAllowedError,
    CampaignContentQueueItemNotFoundError,
    CampaignContentScheduleError,
    PublishingWorkflowService,
)
from app.services.publisher_service import PublishingError
from app.services.sheets_service import SheetsConfigurationError, SheetsDataError, SheetsService

router = APIRouter(prefix="/campaign-content-queue", tags=["campaign-content-queue"])


@router.get("", response_model=list[CampaignContentQueueItem])
async def list_campaign_content_queue_items(
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> list[CampaignContentQueueItem]:
    try:
        return sheets_service.list_campaign_content_queue_items()
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


@router.post("/{content_id}/approve", response_model=CampaignContentQueueItem)
async def approve_campaign_content_queue_item(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_item(
        content_id=content_id,
        updated_item=_update_item("approve", content_id, sheets_service),
    )


@router.post("/{content_id}/reject", response_model=CampaignContentQueueItem)
async def reject_campaign_content_queue_item(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_item(
        content_id=content_id,
        updated_item=_update_item("reject", content_id, sheets_service),
    )


@router.post("/{content_id}/mark-published", response_model=CampaignContentQueueItem)
async def mark_campaign_content_queue_item_published(
    content_id: str,
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> dict[str, Any]:
    return _serialize_updated_item(
        content_id=content_id,
        updated_item=_update_item("published", content_id, sheets_service),
    )


@router.post("/{content_id}/publish", response_model=CampaignContentPublishResponse)
async def publish_campaign_content_queue_item(
    content_id: str,
    publishing_workflow_service: PublishingWorkflowService = Depends(get_publishing_workflow_service),
) -> dict[str, Any]:
    try:
        response = publishing_workflow_service.publish_campaign_content(content_id)
    except CampaignContentQueueItemNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign content queue item not found for content_id: {content_id}",
        ) from exc
    except CampaignContentPublishNotAllowedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except PublishingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
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

    return response.model_dump(mode="json")


@router.post("/{content_id}/schedule", response_model=CampaignContentQueueItem)
async def schedule_campaign_content_queue_item(
    content_id: str,
    request: CampaignContentScheduleRequest,
    publishing_workflow_service: PublishingWorkflowService = Depends(get_publishing_workflow_service),
) -> dict[str, Any]:
    try:
        queue_item = publishing_workflow_service.schedule_campaign_content(
            content_id=content_id,
            scheduled_at=request.scheduled_at,
        )
    except CampaignContentQueueItemNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign content queue item not found for content_id: {content_id}",
        ) from exc
    except CampaignContentScheduleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
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

    return queue_item.model_dump(mode="json")


def _update_item(action: str, content_id: str, sheets_service: SheetsService) -> CampaignContentQueueItem | None:
    try:
        if action == "approve":
            return sheets_service.approve_campaign_content_queue_item(content_id)
        if action == "reject":
            return sheets_service.reject_campaign_content_queue_item(content_id)
        return sheets_service.mark_campaign_content_queue_item_published(content_id)
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


def _serialize_updated_item(content_id: str, updated_item: CampaignContentQueueItem | None) -> dict[str, Any]:
    if updated_item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign content queue item not found for content_id: {content_id}",
        )

    return updated_item.model_dump(mode="json")
