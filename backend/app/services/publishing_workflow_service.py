from datetime import datetime, timezone

from app.models.campaign_content import (
    CampaignContentPublishResult,
    CampaignContentPublishResponse,
    CampaignContentQueueItem,
    CampaignContentRunDueResponse,
)
from app.services.publisher_service import PublisherResult, PublisherService, PublishingError
from app.services.sheets_service import SheetsService


class CampaignContentQueueItemNotFoundError(RuntimeError):
    """Raised when a Campaign Content Queue item does not exist."""


class CampaignContentPublishNotAllowedError(RuntimeError):
    """Raised when an item is not approved or otherwise not publishable."""


class CampaignContentScheduleError(RuntimeError):
    """Raised when a queue item cannot be scheduled."""


class PublishingWorkflowService:
    """Coordinates queue state with the publishing boundary."""

    def __init__(self, sheets_service: SheetsService, publisher_service: PublisherService) -> None:
        self.sheets_service = sheets_service
        self.publisher_service = publisher_service

    def schedule_campaign_content(self, content_id: str, scheduled_at: str) -> CampaignContentQueueItem:
        queue_item = self._get_queue_item(content_id)
        self._validate_schedulable(queue_item)
        normalized_scheduled_at = self._normalize_scheduled_at(scheduled_at)

        updated_item = self.sheets_service.schedule_campaign_content_queue_item(
            content_id=content_id,
            scheduled_at=normalized_scheduled_at,
        )
        if updated_item is None:
            raise CampaignContentQueueItemNotFoundError(content_id)
        return updated_item

    def publish_campaign_content(self, content_id: str) -> CampaignContentPublishResponse:
        queue_item = self._get_queue_item(content_id)
        self._validate_publishable(queue_item)
        publish_result = self.publisher_service.publish_campaign_content(queue_item)
        updated_item = self._record_publish_success(queue_item=queue_item, publish_result=publish_result)
        return CampaignContentPublishResponse(
            queue_item=updated_item,
            publish_result=CampaignContentPublishResult.model_validate(publish_result.model_dump()),
        )

    def run_due_publishing(self) -> CampaignContentRunDueResponse:
        published_items: list[CampaignContentQueueItem] = []
        failed_items: list[CampaignContentQueueItem] = []

        for queue_item in self.sheets_service.list_due_campaign_content_queue_items():
            try:
                self._validate_publishable(queue_item)
                publish_result = self.publisher_service.publish_campaign_content(queue_item)
                published_items.append(
                    self._record_publish_success(queue_item=queue_item, publish_result=publish_result)
                )
            except (CampaignContentPublishNotAllowedError, PublishingError) as exc:
                failed_item = self.sheets_service.record_campaign_content_publish_failure(
                    content_id=queue_item.content_id,
                    error_message=str(exc),
                )
                if failed_item is not None:
                    failed_items.append(failed_item)

        return CampaignContentRunDueResponse(
            published_items=published_items,
            failed_items=failed_items,
        )

    def _get_queue_item(self, content_id: str) -> CampaignContentQueueItem:
        queue_item = self.sheets_service.get_campaign_content_queue_item_by_id(content_id)
        if queue_item is None:
            raise CampaignContentQueueItemNotFoundError(content_id)
        return queue_item

    def _record_publish_success(
        self,
        queue_item: CampaignContentQueueItem,
        publish_result: PublisherResult,
    ) -> CampaignContentQueueItem:
        updated_item = self.sheets_service.publish_campaign_content_queue_item(
            content_id=queue_item.content_id,
            published_at=self._utc_timestamp(),
            external_post_id=publish_result.external_post_id,
            published_url=publish_result.published_url,
            notes=self._append_publish_notes(queue_item.notes, publish_result),
        )
        if updated_item is None:
            raise CampaignContentQueueItemNotFoundError(queue_item.content_id)
        return updated_item

    @staticmethod
    def _validate_publishable(queue_item: CampaignContentQueueItem) -> None:
        if queue_item.status in {"Rejected", "Needs Review"}:
            raise CampaignContentPublishNotAllowedError("Campaign content must be approved before publishing.")
        if queue_item.status == "Published" or queue_item.published == "Yes":
            raise CampaignContentPublishNotAllowedError("Campaign content has already been published.")
        if queue_item.approved != "Yes" and queue_item.status != "Approved":
            raise CampaignContentPublishNotAllowedError("Campaign content must be approved before publishing.")

    @staticmethod
    def _validate_schedulable(queue_item: CampaignContentQueueItem) -> None:
        if queue_item.status == "Published" or queue_item.published == "Yes":
            raise CampaignContentScheduleError("Published campaign content cannot be scheduled.")
        if queue_item.status == "Rejected" or (queue_item.status != "Approved" and queue_item.approved != "Yes"):
            raise CampaignContentScheduleError("Campaign content must be approved before scheduling.")

    @staticmethod
    def _append_publish_notes(existing_notes: str, publish_result: PublisherResult) -> str:
        publish_note = (
            "Published by PublisherService mock publisher: "
            f"external_post_id={publish_result.external_post_id}; "
            f"published_url={publish_result.published_url}"
        )
        return f"{existing_notes} | {publish_note}" if existing_notes else publish_note

    @staticmethod
    def _normalize_scheduled_at(value: str) -> str:
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError as exc:
            raise CampaignContentScheduleError(f"Invalid scheduled_at datetime: {value}") from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    @staticmethod
    def _utc_timestamp() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
