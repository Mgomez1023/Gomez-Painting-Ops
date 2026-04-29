from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.agents.campaign_agent import CampaignAgent
from app.api.dependencies import get_campaign_agent, get_campaign_image_service, get_sheets_service
from app.models.campaign import Campaign
from app.models.campaign_content import (
    CampaignContentQueueConflictResponse,
    CampaignContentQueueSaveResponse,
    CampaignDraftSet,
)
from app.services.campaign_workflow_service import (
    CampaignWorkflowService,
    DuplicateCampaignContentQueueItemsError,
)
from app.services.campaign_image_service import CampaignImageService
from app.services.llm_service import LLMServiceError
from app.services.sheets_service import SheetsConfigurationError, SheetsDataError, SheetsService

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


async def get_campaign_workflow_service(
    sheets_service: SheetsService = Depends(get_sheets_service),
    agent: CampaignAgent = Depends(get_campaign_agent),
    campaign_image_service: CampaignImageService = Depends(get_campaign_image_service),
) -> CampaignWorkflowService:
    return CampaignWorkflowService(
        sheets_service=sheets_service,
        campaign_agent=agent,
        campaign_image_service=campaign_image_service,
    )


@router.get("", response_model=list[Campaign])
async def list_campaigns(
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> list[Campaign]:
    try:
        return sheets_service.list_campaigns()
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


@router.post("/{campaign_id}/generate-content", response_model=CampaignDraftSet)
async def generate_campaign_content(
    campaign_id: str,
    workflow_service: CampaignWorkflowService = Depends(get_campaign_workflow_service),
) -> CampaignDraftSet:
    try:
        draft_set = workflow_service.generate_content(campaign_id)
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
    except LLMServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    if draft_set is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign not found for campaign_id: {campaign_id}",
        )

    return draft_set


@router.post("/{campaign_id}/generate-content/save", response_model=CampaignContentQueueSaveResponse)
async def generate_campaign_content_and_save(
    campaign_id: str,
    force: bool = False,
    workflow_service: CampaignWorkflowService = Depends(get_campaign_workflow_service),
) -> dict[str, Any] | JSONResponse:
    try:
        saved_draft_set = workflow_service.generate_content_and_save(campaign_id, force=force)
    except DuplicateCampaignContentQueueItemsError as exc:
        conflict = CampaignContentQueueConflictResponse(
            detail="Campaign drafts already exist. Review them in Campaign Content Queue instead of generating duplicates.",
            existing_queue_items=exc.existing_queue_items,
        )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=conflict.model_dump(mode="json"),
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
    except LLMServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    if saved_draft_set is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign not found for campaign_id: {campaign_id}",
        )

    return saved_draft_set.model_dump(mode="json")
