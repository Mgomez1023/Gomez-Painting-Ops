from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.api.dependencies import get_content_agent, get_sheets_service
from app.agents.content_agent import ContentAgent
from app.models.completed_job import CompletedJob
from app.models.content_draft import ContentDraft
from app.models.content_queue import ContentQueueConflictResponse, ContentQueueSaveResponse
from app.services.content_workflow_service import ContentWorkflowService, DuplicateContentQueueItemsError
from app.services.llm_service import LLMServiceError
from app.services.sheets_service import SheetsConfigurationError, SheetsDataError, SheetsService

router = APIRouter(prefix="/content", tags=["content"])


async def get_content_workflow_service(
    sheets_service: SheetsService = Depends(get_sheets_service),
    agent: ContentAgent = Depends(get_content_agent),
) -> ContentWorkflowService:
    return ContentWorkflowService(sheets_service=sheets_service, content_agent=agent)


@router.post("/generate", response_model=ContentDraft)
async def generate_content(
    job: CompletedJob,
    agent: ContentAgent = Depends(get_content_agent),
) -> ContentDraft:
    try:
        return agent.generate(job)
    except LLMServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.post("/generate-from-job/{job_id}", response_model=ContentDraft)
async def generate_content_from_job(
    job_id: str,
    workflow_service: ContentWorkflowService = Depends(get_content_workflow_service),
) -> ContentDraft:
    try:
        draft = workflow_service.generate_from_job_id(job_id)
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

    if draft is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Completed job not found for job_id: {job_id}",
        )

    return draft


@router.post("/generate-from-job/{job_id}/save", response_model=ContentQueueSaveResponse)
async def generate_content_from_job_and_save(
    job_id: str,
    force: bool = False,
    workflow_service: ContentWorkflowService = Depends(get_content_workflow_service),
) -> dict[str, Any] | JSONResponse:
    try:
        saved_draft = workflow_service.generate_from_job_id_and_save(job_id, force=force)
    except DuplicateContentQueueItemsError as exc:
        conflict = ContentQueueConflictResponse(
            detail="Drafts already exist for this job. Review them in Content Queue instead of generating duplicates.",
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

    if saved_draft is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Completed job not found for job_id: {job_id}",
        )

    return saved_draft.model_dump(mode="json")
