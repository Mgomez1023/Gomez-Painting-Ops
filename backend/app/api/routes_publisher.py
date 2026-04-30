from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_publisher_service, get_publishing_workflow_service
from app.models.campaign_content import CampaignContentDueCandidate, CampaignContentRunDueResponse
from app.services.publisher_service import PublisherService, PublishingError
from app.services.publishing_workflow_service import PublishingWorkflowService
from app.services.sheets_service import SheetsConfigurationError, SheetsDataError

router = APIRouter(prefix="/publisher", tags=["publisher"])


@router.get("/due-candidates", response_model=list[CampaignContentDueCandidate])
async def list_due_candidates(
    publishing_workflow_service: PublishingWorkflowService = Depends(get_publishing_workflow_service),
) -> list[CampaignContentDueCandidate]:
    try:
        return publishing_workflow_service.list_due_candidates()
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


@router.post("/run-due", response_model=CampaignContentRunDueResponse)
async def run_due_publishing(
    publishing_workflow_service: PublishingWorkflowService = Depends(get_publishing_workflow_service),
) -> CampaignContentRunDueResponse:
    try:
        return publishing_workflow_service.run_due_publishing()
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


@router.get("/google-business/verify")
async def verify_google_business_credentials(
    publisher_service: PublisherService = Depends(get_publisher_service),
) -> dict[str, Any]:
    try:
        return publisher_service.verify_google_business_credentials()
    except PublishingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.get("/meta/diagnostics")
async def meta_diagnostics(
    publisher_service: PublisherService = Depends(get_publisher_service),
) -> dict[str, Any]:
    try:
        return publisher_service.meta_diagnostics()
    except PublishingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
