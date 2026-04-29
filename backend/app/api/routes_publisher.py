from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_publishing_workflow_service
from app.models.campaign_content import CampaignContentRunDueResponse
from app.services.publishing_workflow_service import PublishingWorkflowService
from app.services.sheets_service import SheetsConfigurationError, SheetsDataError

router = APIRouter(prefix="/publisher", tags=["publisher"])


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
