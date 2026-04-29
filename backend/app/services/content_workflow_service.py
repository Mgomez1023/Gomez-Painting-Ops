from app.agents.content_agent import ContentAgent
from app.models.content_queue import ContentQueueItem, ContentQueueSaveResponse
from app.models.content_draft import ContentDraft
from app.services.sheets_service import SheetsService


REQUIRED_CONTENT_QUEUE_PLATFORMS = {
    "Facebook",
    "Google Business",
    "Instagram",
    "Review Request",
}


class DuplicateContentQueueItemsError(RuntimeError):
    """Raised when a completed job already has a full set of saved drafts."""

    def __init__(self, existing_queue_items: list[ContentQueueItem]) -> None:
        super().__init__("Drafts already exist for this job.")
        self.existing_queue_items = existing_queue_items


class ContentWorkflowService:
    """Coordinates content workflows that need external job data."""

    def __init__(self, sheets_service: SheetsService, content_agent: ContentAgent) -> None:
        self.sheets_service = sheets_service
        self.content_agent = content_agent

    def generate_from_job_id(self, job_id: str) -> ContentDraft | None:
        completed_job = self.sheets_service.get_completed_job_by_id(job_id)
        if completed_job is None:
            return None

        return self.content_agent.generate(completed_job)

    def generate_from_job_id_and_save(self, job_id: str, force: bool = False) -> ContentQueueSaveResponse | None:
        completed_job = self.sheets_service.get_completed_job_by_id(job_id)
        if completed_job is None:
            return None

        existing_queue_items = self.sheets_service.get_content_queue_items_by_job_id(job_id)
        existing_platforms = {item.platform for item in existing_queue_items}
        if not force and REQUIRED_CONTENT_QUEUE_PLATFORMS.issubset(existing_platforms):
            raise DuplicateContentQueueItemsError(existing_queue_items=existing_queue_items)

        draft = self.content_agent.generate(completed_job)
        queue_items = self.sheets_service.save_content_draft_to_queue(job_id=job_id, draft=draft)
        return ContentQueueSaveResponse(content_draft=draft, queue_items=queue_items)
