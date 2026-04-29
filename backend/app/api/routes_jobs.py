from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_sheets_service
from app.models.completed_job import CompletedJob
from app.services.sheets_service import SheetsConfigurationError, SheetsDataError, SheetsService

router = APIRouter(tags=["jobs"])


@router.get("/jobs", response_model=list[CompletedJob])
async def list_jobs(
    sheets_service: SheetsService = Depends(get_sheets_service),
) -> list[CompletedJob]:
    try:
        return sheets_service.list_completed_jobs()
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
