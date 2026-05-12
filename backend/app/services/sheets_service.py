from datetime import date, datetime, timedelta, timezone
import base64
import json
from pathlib import Path
import re
from typing import Any

from pydantic import ValidationError

from app.config import Settings, settings
from app.models.campaign import Campaign
from app.models.campaign_content import CampaignContentDueCandidate, CampaignContentQueueItem, CampaignDraftSet
from app.models.completed_job import CompletedJob
from app.models.content_draft import ContentDraft
from app.models.content_queue import ContentQueueItem
from app.services.campaign_image_service import CampaignImageMetadata


class SheetsConfigurationError(RuntimeError):
    """Raised when Google Sheets configuration is incomplete."""


class SheetsDataError(RuntimeError):
    """Raised when sheet data cannot be converted into application models."""


class SheetsService:
    """Google Sheets boundary.

    Agents should depend on this service for sheet-backed data instead of
    calling Google APIs directly.
    """

    required_headers = {
        "customer",
        "job_type",
        "location",
        "date_completed",
        "photos_uploaded",
        "notes",
    }
    campaign_required_headers = {
        "campaign_id",
        "campaign_name",
        "service_focus",
        "target_location",
        "target_customer",
        "offer",
        "cta",
        "landing_page_url",
        "start_date",
        "end_date",
        "status",
        "notes",
    }

    def __init__(self, app_settings: Settings = settings, sheets_client: Any | None = None) -> None:
        self.settings = app_settings
        self._sheets_client = sheets_client

    def list_completed_jobs(self) -> list[CompletedJob]:
        values = self._fetch_completed_job_rows()
        return self.rows_to_completed_jobs(values)

    def list_campaigns(self) -> list[Campaign]:
        values = self._fetch_campaign_rows()
        return self.rows_to_campaigns(values)

    def get_campaign_by_id(self, campaign_id: str) -> Campaign | None:
        normalized_campaign_id = campaign_id.strip()
        if not normalized_campaign_id:
            return None

        for campaign in self.list_campaigns():
            if campaign.campaign_id == normalized_campaign_id:
                return campaign

        return None

    def get_completed_job_by_id(self, job_id: str) -> CompletedJob | None:
        normalized_job_id = job_id.strip()
        if not normalized_job_id:
            return None

        for completed_job in self.list_completed_jobs():
            if completed_job.job_id == normalized_job_id:
                return completed_job

        return None

    def save_content_draft_to_queue(self, job_id: str, draft: ContentDraft) -> list[ContentQueueItem]:
        normalized_job_id = job_id.strip()
        if not normalized_job_id:
            raise SheetsDataError("Job ID is required to save content queue items.")

        queue_items = self._build_content_queue_items(job_id=normalized_job_id, draft=draft)
        rows = [self._content_queue_item_to_row(item) for item in queue_items]
        self._append_content_queue_rows(rows)
        return queue_items

    def approve_content_queue_item(self, content_id: str) -> ContentQueueItem | None:
        return self.update_content_queue_item_status(
            content_id=content_id,
            status="Approved",
            approved="Yes",
            published="No",
        )

    def reject_content_queue_item(self, content_id: str) -> ContentQueueItem | None:
        return self.update_content_queue_item_status(
            content_id=content_id,
            status="Rejected",
            approved="No",
            published="No",
        )

    def mark_content_queue_item_published(self, content_id: str) -> ContentQueueItem | None:
        return self.update_content_queue_item_status(
            content_id=content_id,
            status="Published",
            approved="Yes",
            published="Yes",
        )

    def list_content_queue_items(self) -> list[ContentQueueItem]:
        rows = self._fetch_content_queue_rows()
        return self.rows_to_content_queue_items(rows)

    def list_campaign_content_queue_items(self) -> list[CampaignContentQueueItem]:
        rows = self._fetch_campaign_content_queue_rows()
        return self.rows_to_campaign_content_queue_items(rows)

    def list_posts(self) -> list[CampaignContentQueueItem]:
        rows = self._fetch_posts_rows()
        return self.rows_to_campaign_content_queue_items(rows, sheet_label="Posts")

    def get_content_queue_items_by_job_id(self, job_id: str) -> list[ContentQueueItem]:
        normalized_job_id = job_id.strip()
        if not normalized_job_id:
            return []

        return [
            item
            for item in self.list_content_queue_items()
            if item.job_id.strip() == normalized_job_id
        ]

    def get_campaign_content_queue_items_by_campaign_id(self, campaign_id: str) -> list[CampaignContentQueueItem]:
        normalized_campaign_id = campaign_id.strip()
        if not normalized_campaign_id:
            return []

        return [
            item
            for item in self.list_campaign_content_queue_items()
            if item.campaign_id.strip() == normalized_campaign_id
        ]

    def get_posts_by_campaign_id(self, campaign_id: str) -> list[CampaignContentQueueItem]:
        normalized_campaign_id = campaign_id.strip()
        if not normalized_campaign_id:
            return []

        return [
            item
            for item in self.list_posts()
            if item.campaign_id.strip() == normalized_campaign_id
        ]

    def get_campaign_content_queue_item_by_id(self, content_id: str) -> CampaignContentQueueItem | None:
        match = self._find_campaign_content_queue_row_by_id(content_id)
        if match is None:
            return None

        return match[1]

    def save_campaign_draft_set_to_queue(
        self,
        campaign: Campaign,
        draft_set: CampaignDraftSet,
        image_metadata: CampaignImageMetadata | None = None,
    ) -> list[CampaignContentQueueItem]:
        normalized_campaign_id = campaign.campaign_id.strip()
        if not normalized_campaign_id:
            raise SheetsDataError("Campaign ID is required to save campaign content queue items.")

        queue_items = self._build_campaign_content_queue_items(
            campaign=campaign,
            draft_set=draft_set,
            image_metadata=image_metadata,
        )
        rows = [self._campaign_content_queue_item_to_row(item) for item in queue_items]
        self._append_campaign_content_queue_rows(rows)
        return queue_items

    def append_campaign_content_queue_items(
        self,
        queue_items: list[CampaignContentQueueItem],
    ) -> list[CampaignContentQueueItem]:
        if not queue_items:
            return []
        rows = [self._campaign_content_queue_item_to_row(item) for item in queue_items]
        self._append_campaign_content_queue_rows(rows)
        return queue_items

    def append_posts(
        self,
        posts: list[CampaignContentQueueItem],
    ) -> list[CampaignContentQueueItem]:
        if not posts:
            return []
        rows = [self._campaign_content_queue_item_to_row(item) for item in posts]
        self._append_posts_rows(rows)
        return posts

    def rows_to_content_queue_items(self, values: list[list[Any]]) -> list[ContentQueueItem]:
        if not values:
            return []

        headers = [self._normalize_header(header) for header in values[0]]
        missing_headers = self._content_queue_required_headers().difference(headers)
        if missing_headers:
            missing = ", ".join(sorted(missing_headers))
            raise SheetsDataError(f"Content Queue sheet is missing required columns: {missing}")

        queue_items: list[ContentQueueItem] = []
        for row_number, row in enumerate(values[1:], start=2):
            if not any(str(value).strip() for value in row):
                continue

            row_data = dict(zip(headers, row, strict=False))
            try:
                queue_items.append(self._row_to_content_queue_item(row_data))
            except ValidationError as exc:
                raise SheetsDataError(f"Content Queue row {row_number} is invalid.") from exc

        return queue_items

    def rows_to_campaigns(self, values: list[list[Any]]) -> list[Campaign]:
        if not values:
            return []

        headers = [self._normalize_header(header) for header in values[0]]
        missing_headers = self.campaign_required_headers.difference(headers)
        if missing_headers:
            missing = ", ".join(sorted(missing_headers))
            raise SheetsDataError(f"Campaigns sheet is missing required columns: {missing}")

        campaigns: list[Campaign] = []
        for row_number, row in enumerate(values[1:], start=2):
            if not any(str(value).strip() for value in row):
                continue

            row_data = dict(zip(headers, row, strict=False))
            try:
                campaigns.append(
                    Campaign.model_validate(
                        {
                            "campaign_id": self._read_cell(row_data, "campaign_id"),
                            "campaign_name": self._read_cell(row_data, "campaign_name"),
                            "service_focus": self._read_cell(row_data, "service_focus"),
                            "target_location": self._read_cell(row_data, "target_location"),
                            "target_customer": self._read_cell(row_data, "target_customer"),
                            "offer": self._read_optional_cell(row_data, "offer"),
                            "cta": self._read_cell(row_data, "cta"),
                            "landing_page_url": self._read_cell(row_data, "landing_page_url"),
                            "start_date": self._read_cell(row_data, "start_date"),
                            "end_date": self._read_cell(row_data, "end_date"),
                            "status": self._read_cell(row_data, "status"),
                            "notes": self._read_cell(row_data, "notes"),
                        }
                    )
                )
            except ValidationError as exc:
                raise SheetsDataError(f"Campaigns row {row_number} is invalid.") from exc

        return campaigns

    def rows_to_campaign_content_queue_items(
        self,
        values: list[list[Any]],
        sheet_label: str = "Campaign Content Queue",
    ) -> list[CampaignContentQueueItem]:
        if not values:
            return []

        headers = [self._normalize_header(header) for header in values[0]]
        missing_headers = self._campaign_content_queue_required_headers().difference(headers)
        if missing_headers:
            missing = ", ".join(sorted(missing_headers))
            raise SheetsDataError(f"{sheet_label} sheet is missing required columns: {missing}")

        queue_items: list[CampaignContentQueueItem] = []
        for row_number, row in enumerate(values[1:], start=2):
            if not any(str(value).strip() for value in row):
                continue

            row_data = dict(zip(headers, row, strict=False))
            if self._is_blank_campaign_content_queue_identity_row(row_data):
                continue

            try:
                queue_items.append(self._row_to_campaign_content_queue_item(row_data))
            except ValidationError as exc:
                raise SheetsDataError(f"{sheet_label} row {row_number} is invalid.") from exc

        return queue_items

    def update_content_queue_item_status(
        self,
        content_id: str,
        status: str,
        approved: str,
        published: str,
    ) -> ContentQueueItem | None:
        match = self._find_content_queue_row_by_id(content_id)
        if match is None:
            return None

        row_number, queue_item = match
        updated_item = queue_item.model_copy(
            update={
                "status": status,
                "approved": approved,
                "published": published,
            }
        )
        self._update_content_queue_row(row_number=row_number, item=updated_item)
        return updated_item

    def approve_campaign_content_queue_item(self, content_id: str) -> CampaignContentQueueItem | None:
        return self.update_campaign_content_queue_item_status(
            content_id=content_id,
            status="Approved",
            approved="Yes",
            published="No",
            published_at=None,
        )

    def reject_campaign_content_queue_item(self, content_id: str) -> CampaignContentQueueItem | None:
        return self.update_campaign_content_queue_item_status(
            content_id=content_id,
            status="Rejected",
            approved="No",
            published="No",
            published_at=None,
        )

    def mark_campaign_content_queue_item_published(self, content_id: str) -> CampaignContentQueueItem | None:
        published_at = self._utc_timestamp()
        return self.update_campaign_content_queue_item_status(
            content_id=content_id,
            status="Published",
            approved="Yes",
            published="Yes",
            published_at=published_at,
        )

    def mark_campaign_content_queue_item_copied(self, content_id: str) -> CampaignContentQueueItem | None:
        return self.update_campaign_content_queue_item_status(
            content_id=content_id,
            status="Copied",
            approved="No",
            published="No",
            published_at=None,
        )

    def mark_campaign_content_queue_item_posted(self, content_id: str) -> CampaignContentQueueItem | None:
        published_at = self._utc_timestamp()
        return self.update_campaign_content_queue_item_status(
            content_id=content_id,
            status="Posted",
            approved="Yes",
            published="Yes",
            published_at=published_at,
        )

    def mark_campaign_content_queue_item_skipped(self, content_id: str) -> CampaignContentQueueItem | None:
        return self.update_campaign_content_queue_item_status(
            content_id=content_id,
            status="Skipped",
            approved="No",
            published="No",
            published_at=None,
        )

    def mark_post_copied(self, content_id: str) -> CampaignContentQueueItem | None:
        return self.update_post_status(
            content_id=content_id,
            status="Copied",
            approved="No",
            published="No",
            published_at=None,
        )

    def mark_post_posted(self, content_id: str) -> CampaignContentQueueItem | None:
        published_at = self._utc_timestamp()
        return self.update_post_status(
            content_id=content_id,
            status="Posted",
            approved="Yes",
            published="Yes",
            published_at=published_at,
        )

    def mark_post_skipped(self, content_id: str) -> CampaignContentQueueItem | None:
        return self.update_post_status(
            content_id=content_id,
            status="Skipped",
            approved="No",
            published="No",
            published_at=None,
        )

    def restore_post_to_queue(self, content_id: str) -> CampaignContentQueueItem | None:
        return self.update_post_status(
            content_id=content_id,
            status="Draft",
            approved="No",
            published="No",
            published_at=None,
        )

    def update_post_draft_text(self, content_id: str, draft_text: str) -> CampaignContentQueueItem | None:
        match = self._find_post_row_by_id(content_id)
        if match is None:
            return None

        row_number, post = match
        updated_post = post.model_copy(update={"draft_text": draft_text})
        self._update_posts_row(row_number=row_number, item=updated_post)
        return updated_post

    def update_post_scheduled_at(self, content_id: str, scheduled_at: str) -> CampaignContentQueueItem | None:
        match = self._find_post_row_by_id(content_id)
        if match is None:
            return None

        row_number, post = match
        updated_post = post.model_copy(
            update={
                "scheduled_at": scheduled_at,
                "published": "No",
                "notes": self._update_schedule_notes(post.notes, scheduled_at),
            }
        )
        self._update_posts_row(row_number=row_number, item=updated_post)
        return updated_post

    def update_post_image(
        self,
        content_id: str,
        image_filename: str | None,
        image_path: str | None,
        image_url: str | None = None,
    ) -> CampaignContentQueueItem | None:
        match = self._find_post_row_by_id(content_id)
        if match is None:
            return None

        row_number, post = match
        updated_post = post.model_copy(
            update={
                "image_filename": image_filename,
                "image_path": image_path,
                "image_url": image_url,
            }
        )
        self._update_posts_row(row_number=row_number, item=updated_post)
        return updated_post

    def delete_post(self, content_id: str) -> CampaignContentQueueItem | None:
        match = self._find_post_row_by_id(content_id)
        if match is None:
            return None

        row_number, post = match
        self._delete_posts_row(row_number)
        return post

    def publish_campaign_content_queue_item(
        self,
        content_id: str,
        published_at: str,
        notes: str,
        external_post_id: str | None = None,
        published_url: str | None = None,
    ) -> CampaignContentQueueItem | None:
        match = self._find_campaign_content_queue_row_by_id(content_id)
        if match is None:
            return None

        row_number, queue_item = match
        updated_item = queue_item.model_copy(
            update={
                "status": "Published",
                "approved": "Yes",
                "published": "Yes",
                "published_at": published_at,
                "publish_attempts": queue_item.publish_attempts + 1,
                "last_publish_error": None,
                "external_post_id": external_post_id,
                "published_url": published_url,
                "notes": notes,
            }
        )
        self._update_campaign_content_queue_row(row_number=row_number, item=updated_item)
        return updated_item

    def record_campaign_content_publish_result(
        self,
        content_id: str,
        status: str,
        published: str,
        published_at: str | None,
        notes: str,
        external_post_id: str | None = None,
        published_url: str | None = None,
        last_publish_error: str | None = None,
    ) -> CampaignContentQueueItem | None:
        match = self._find_campaign_content_queue_row_by_id(content_id)
        if match is None:
            return None

        row_number, queue_item = match
        updated_item = queue_item.model_copy(
            update={
                "status": status,
                "approved": "Yes",
                "published": published,
                "published_at": published_at,
                "publish_attempts": queue_item.publish_attempts + 1,
                "last_publish_error": last_publish_error,
                "external_post_id": external_post_id,
                "published_url": published_url,
                "notes": notes,
            }
        )
        self._update_campaign_content_queue_row(row_number=row_number, item=updated_item)
        return updated_item

    def schedule_campaign_content_queue_item(
        self,
        content_id: str,
        scheduled_at: str,
    ) -> CampaignContentQueueItem | None:
        match = self._find_campaign_content_queue_row_by_id(content_id)
        if match is None:
            return None

        row_number, queue_item = match
        updated_item = queue_item.model_copy(
            update={
                "scheduled_at": scheduled_at,
                "published": "No",
            }
        )
        self._update_campaign_content_queue_row(row_number=row_number, item=updated_item)
        return updated_item

    def list_due_campaign_content_queue_items(self, now: datetime | None = None) -> list[CampaignContentQueueItem]:
        current_time = now or datetime.now(timezone.utc)
        queue_items = self.list_campaign_content_queue_items()
        candidates_by_id = {
            candidate.content_id: candidate
            for candidate in (
                self._campaign_content_due_candidate(item=item, now=current_time)
                for item in queue_items
            )
        }
        return [
            item
            for item in queue_items
            if candidates_by_id[item.content_id].eligible
        ]

    def list_campaign_content_due_candidates(
        self,
        now: datetime | None = None,
    ) -> list[CampaignContentDueCandidate]:
        current_time = now or datetime.now(timezone.utc)
        return [
            self._campaign_content_due_candidate(item=item, now=current_time)
            for item in self.list_campaign_content_queue_items()
        ]

    def record_campaign_content_publish_failure(
        self,
        content_id: str,
        error_message: str,
    ) -> CampaignContentQueueItem | None:
        match = self._find_campaign_content_queue_row_by_id(content_id)
        if match is None:
            return None

        row_number, queue_item = match
        updated_item = queue_item.model_copy(
            update={
                "publish_attempts": queue_item.publish_attempts + 1,
                "last_publish_error": error_message,
                "published": "No",
            }
        )
        self._update_campaign_content_queue_row(row_number=row_number, item=updated_item)
        return updated_item

    def record_campaign_content_manual_fallback(
        self,
        content_id: str,
        error_message: str,
        copy_ready_package: str,
    ) -> CampaignContentQueueItem | None:
        match = self._find_campaign_content_queue_row_by_id(content_id)
        if match is None:
            return None

        row_number, queue_item = match
        updated_item = queue_item.model_copy(
            update={
                "status": "Ready for Manual Post",
                "publish_attempts": queue_item.publish_attempts + 1,
                "last_publish_error": error_message,
                "published": "No",
                "notes": self._append_note(queue_item.notes, copy_ready_package),
            }
        )
        self._update_campaign_content_queue_row(row_number=row_number, item=updated_item)
        return updated_item

    def update_campaign_content_queue_item_status(
        self,
        content_id: str,
        status: str,
        approved: str,
        published: str,
        published_at: str | None,
        notes: str | None = None,
    ) -> CampaignContentQueueItem | None:
        match = self._find_campaign_content_queue_row_by_id(content_id)
        if match is None:
            return None

        row_number, queue_item = match
        update_payload = {
            "status": status,
            "approved": approved,
            "published": published,
            "published_at": published_at,
        }
        if notes is not None:
            update_payload["notes"] = notes

        updated_item = queue_item.model_copy(
            update=update_payload,
        )
        self._update_campaign_content_queue_row(row_number=row_number, item=updated_item)
        return updated_item

    def update_post_status(
        self,
        content_id: str,
        status: str,
        approved: str,
        published: str,
        published_at: str | None,
        notes: str | None = None,
    ) -> CampaignContentQueueItem | None:
        match = self._find_post_row_by_id(content_id)
        if match is None:
            return None

        row_number, post = match
        update_payload = {
            "status": status,
            "approved": approved,
            "published": published,
            "published_at": published_at,
        }
        if notes is not None:
            update_payload["notes"] = notes

        updated_post = post.model_copy(update=update_payload)
        self._update_posts_row(row_number=row_number, item=updated_post)
        return updated_post

    def rows_to_completed_jobs(self, values: list[list[Any]]) -> list[CompletedJob]:
        if not values:
            return []

        headers = [self._normalize_header(header) for header in values[0]]
        missing_headers = self.required_headers.difference(headers)
        if missing_headers:
            missing = ", ".join(sorted(missing_headers))
            raise SheetsDataError(f"Completed Jobs sheet is missing required columns: {missing}")

        completed_jobs: list[CompletedJob] = []
        for row_number, row in enumerate(values[1:], start=2):
            if not any(str(value).strip() for value in row):
                continue

            row_data = dict(zip(headers, row, strict=False))
            try:
                payload = {
                    "job_id": self._read_optional_cell(row_data, "job_id"),
                    "customer": self._read_cell(row_data, "customer"),
                    "job_type": self._read_cell(row_data, "job_type"),
                    "location": self._read_cell(row_data, "location"),
                    "date_completed": self._read_cell(row_data, "date_completed"),
                    "photos_uploaded": self._parse_bool(self._read_cell(row_data, "photos_uploaded")),
                    "notes": self._read_cell(row_data, "notes"),
                    "before_photo_url": self._read_optional_cell(row_data, "before_photo_url"),
                    "after_photo_url": self._read_optional_cell(row_data, "after_photo_url"),
                    "room_area": self._read_optional_cell(row_data, "room_area"),
                    "paint_colors": self._read_optional_cell(row_data, "paint_colors"),
                    "customer_outcome": self._read_optional_cell(row_data, "customer_outcome"),
                    "project_highlights": self._read_optional_cell(row_data, "project_highlights"),
                }
                completed_jobs.append(CompletedJob.model_validate(payload))
            except (SheetsDataError, ValidationError) as exc:
                raise SheetsDataError(f"Completed Jobs row {row_number} is invalid.") from exc

        return completed_jobs

    def _fetch_completed_job_rows(self) -> list[list[Any]]:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_completed_jobs_sheet_name
        range_name = f"'{sheet_name}'!A:AZ"
        result = (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=range_name)
            .execute()
        )
        return result.get("values", [])

    def _fetch_campaign_rows(self) -> list[list[Any]]:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_campaigns_sheet_name
        range_name = f"'{sheet_name}'!A:N"
        result = (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=range_name)
            .execute()
        )
        return result.get("values", [])

    def _append_content_queue_rows(self, rows: list[list[str]]) -> None:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_content_queue_sheet_name
        range_name = f"'{sheet_name}'!A:I"
        (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .append(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": rows},
            )
            .execute()
        )

    def _append_campaign_content_queue_rows(self, rows: list[list[str]]) -> None:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_campaign_content_queue_sheet_name
        range_name = f"'{sheet_name}'!A:S"
        (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .append(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": rows},
            )
            .execute()
        )

    def _append_posts_rows(self, rows: list[list[str]]) -> None:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_posts_sheet_name
        range_name = f"'{sheet_name}'!A:S"
        (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .append(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": rows},
            )
            .execute()
        )

    def _fetch_content_queue_rows(self) -> list[list[Any]]:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_content_queue_sheet_name
        range_name = f"'{sheet_name}'!A:I"
        result = (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=range_name)
            .execute()
        )
        return result.get("values", [])

    def _fetch_campaign_content_queue_rows(self) -> list[list[Any]]:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_campaign_content_queue_sheet_name
        range_name = f"'{sheet_name}'!A:S"
        result = (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=range_name)
            .execute()
        )
        return result.get("values", [])

    def _fetch_posts_rows(self) -> list[list[Any]]:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_posts_sheet_name
        range_name = f"'{sheet_name}'!A:AZ"
        result = (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=range_name)
            .execute()
        )
        return result.get("values", [])

    def _find_content_queue_row_by_id(self, content_id: str) -> tuple[int, ContentQueueItem] | None:
        normalized_content_id = content_id.strip()
        if not normalized_content_id:
            return None

        rows = self._fetch_content_queue_rows()
        if not rows:
            return None

        headers = [self._normalize_header(header) for header in rows[0]]
        missing_headers = self._content_queue_required_headers().difference(headers)
        if missing_headers:
            missing = ", ".join(sorted(missing_headers))
            raise SheetsDataError(f"Content Queue sheet is missing required columns: {missing}")

        for row_number, row in enumerate(rows[1:], start=2):
            row_data = dict(zip(headers, row, strict=False))
            if self._read_cell(row_data, "content_id") != normalized_content_id:
                continue

            try:
                return row_number, self._row_to_content_queue_item(row_data)
            except ValidationError as exc:
                raise SheetsDataError(f"Content Queue row {row_number} is invalid.") from exc

        return None

    def _find_campaign_content_queue_row_by_id(
        self, content_id: str
    ) -> tuple[int, CampaignContentQueueItem] | None:
        normalized_content_id = content_id.strip()
        if not normalized_content_id:
            return None

        rows = self._fetch_campaign_content_queue_rows()
        if not rows:
            return None

        headers = [self._normalize_header(header) for header in rows[0]]
        missing_headers = self._campaign_content_queue_required_headers().difference(headers)
        if missing_headers:
            missing = ", ".join(sorted(missing_headers))
            raise SheetsDataError(f"Campaign Content Queue sheet is missing required columns: {missing}")

        for row_number, row in enumerate(rows[1:], start=2):
            row_data = dict(zip(headers, row, strict=False))
            if self._read_cell(row_data, "content_id") != normalized_content_id:
                continue

            try:
                return row_number, self._row_to_campaign_content_queue_item(row_data)
            except ValidationError as exc:
                raise SheetsDataError(f"Campaign Content Queue row {row_number} is invalid.") from exc

        return None

    def _find_post_row_by_id(
        self, content_id: str
    ) -> tuple[int, CampaignContentQueueItem] | None:
        normalized_content_id = content_id.strip()
        if not normalized_content_id:
            return None

        rows = self._fetch_posts_rows()
        if not rows:
            return None

        headers = [self._normalize_header(header) for header in rows[0]]
        missing_headers = self._campaign_content_queue_required_headers().difference(headers)
        if missing_headers:
            missing = ", ".join(sorted(missing_headers))
            raise SheetsDataError(f"Posts sheet is missing required columns: {missing}")

        for row_number, row in enumerate(rows[1:], start=2):
            row_data = dict(zip(headers, row, strict=False))
            if self._read_cell(row_data, "content_id") != normalized_content_id:
                continue

            try:
                return row_number, self._row_to_campaign_content_queue_item(row_data)
            except ValidationError as exc:
                raise SheetsDataError(f"Posts row {row_number} is invalid.") from exc

        return None

    def _update_content_queue_row(self, row_number: int, item: ContentQueueItem) -> None:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_content_queue_sheet_name
        range_name = f"'{sheet_name}'!A{row_number}:I{row_number}"
        (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .update(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption="RAW",
                body={"values": [self._content_queue_item_to_row(item)]},
            )
            .execute()
        )

    def _update_campaign_content_queue_row(self, row_number: int, item: CampaignContentQueueItem) -> None:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_campaign_content_queue_sheet_name
        range_name = f"'{sheet_name}'!A{row_number}:S{row_number}"
        (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .update(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption="RAW",
                body={"values": [self._campaign_content_queue_item_to_row(item)]},
            )
            .execute()
        )

    def _update_posts_row(self, row_number: int, item: CampaignContentQueueItem) -> None:
        spreadsheet_id = self._get_spreadsheet_id()
        sheet_name = self.settings.google_posts_sheet_name
        rows = self._fetch_posts_rows()
        headers = [self._normalize_header(header) for header in rows[0]] if rows else []
        existing_row = rows[row_number - 1] if row_number - 1 < len(rows) else []
        row = self._campaign_content_queue_item_to_row_for_headers(
            item=item,
            headers=headers,
            existing_row=existing_row,
        )
        last_column = self._spreadsheet_column_name(len(row))
        range_name = f"'{sheet_name}'!A{row_number}:{last_column}{row_number}"
        (
            self._get_sheets_client()
            .spreadsheets()
            .values()
            .update(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption="RAW",
                body={"values": [row]},
            )
            .execute()
        )

    def _delete_posts_row(self, row_number: int) -> None:
        self._delete_sheet_row(
            sheet_name=self.settings.google_posts_sheet_name,
            row_number=row_number,
        )

    def _delete_sheet_row(self, sheet_name: str, row_number: int) -> None:
        if row_number <= 1:
            raise SheetsDataError("Refusing to delete a header row.")

        spreadsheet_id = self._get_spreadsheet_id()
        sheet_id = self._get_sheet_id(sheet_name)
        (
            self._get_sheets_client()
            .spreadsheets()
            .batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={
                    "requests": [
                        {
                            "deleteDimension": {
                                "range": {
                                    "sheetId": sheet_id,
                                    "dimension": "ROWS",
                                    "startIndex": row_number - 1,
                                    "endIndex": row_number,
                                }
                            }
                        }
                    ]
                },
            )
            .execute()
        )

    def _get_sheet_id(self, sheet_name: str) -> int:
        spreadsheet_id = self._get_spreadsheet_id()
        result = (
            self._get_sheets_client()
            .spreadsheets()
            .get(
                spreadsheetId=spreadsheet_id,
                fields="sheets(properties(sheetId,title))",
            )
            .execute()
        )
        for sheet in result.get("sheets", []):
            properties = sheet.get("properties", {})
            if properties.get("title") == sheet_name and "sheetId" in properties:
                return int(properties["sheetId"])

        raise SheetsDataError(f"Sheet not found: {sheet_name}")

    def _get_sheets_client(self) -> Any:
        if self._sheets_client is not None:
            return self._sheets_client

        try:
            from google.oauth2.service_account import Credentials
            from googleapiclient.discovery import build
        except ImportError as exc:
            raise SheetsConfigurationError(
                "Google Sheets dependencies are not installed. Run pip install -r requirements.txt."
            ) from exc

        scopes = ["https://www.googleapis.com/auth/spreadsheets"]
        if self.settings.google_service_account_json:
            service_account_info = self._parse_service_account_json(self.settings.google_service_account_json)
            credentials = Credentials.from_service_account_info(service_account_info, scopes=scopes)
        else:
            credentials = Credentials.from_service_account_file(
                self.settings.google_service_account_file,
                scopes=scopes,
            )
        self._sheets_client = build("sheets", "v4", credentials=credentials)
        return self._sheets_client

    def _get_spreadsheet_id(self) -> str:
        spreadsheet_id = self.settings.google_sheets_spreadsheet_id
        service_account_file = self.settings.google_service_account_file
        service_account_json = self.settings.google_service_account_json

        if not spreadsheet_id or (not service_account_file and not service_account_json):
            raise SheetsConfigurationError(
                "Google Sheets is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID "
                "and either GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON."
            )
        if service_account_file and not Path(service_account_file).is_file():
            raise SheetsConfigurationError(f"Google service account file was not found: {service_account_file}")

        return spreadsheet_id

    @staticmethod
    def _parse_service_account_json(value: str) -> dict[str, Any]:
        normalized_value = value.strip()
        if not normalized_value:
            raise SheetsConfigurationError("GOOGLE_SERVICE_ACCOUNT_JSON is empty.")

        try:
            service_account_info = json.loads(normalized_value)
        except json.JSONDecodeError:
            try:
                decoded_value = base64.b64decode(normalized_value, validate=True).decode("utf-8")
                service_account_info = json.loads(decoded_value)
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise SheetsConfigurationError(
                    "GOOGLE_SERVICE_ACCOUNT_JSON must be valid JSON or base64-encoded JSON."
                ) from exc

        if not isinstance(service_account_info, dict):
            raise SheetsConfigurationError("GOOGLE_SERVICE_ACCOUNT_JSON must decode to a JSON object.")
        private_key = service_account_info.get("private_key")
        if isinstance(private_key, str):
            service_account_info["private_key"] = private_key.replace("\\n", "\n")
        return service_account_info

    def _build_content_queue_items(self, job_id: str, draft: ContentDraft) -> list[ContentQueueItem]:
        created_at = datetime.now(timezone.utc)
        created_at_text = self._format_utc_timestamp(created_at)
        content_id_timestamp = created_at.strftime("%Y%m%dT%H%M%S%fZ")
        platform_drafts = [
            ("Facebook", "facebook", draft.facebook_post),
            ("Google Business", "google-business", draft.google_business_post),
            ("Instagram", "instagram", draft.instagram_caption),
            ("Review Request", "review-request", draft.review_request_text),
        ]

        return [
            ContentQueueItem(
                content_id=f"CQ-{content_id_timestamp}-{platform_slug}",
                job_id=job_id,
                platform=platform,
                draft_text=draft_text,
                status="Needs Review",
                approved="No",
                published="No",
                created_at=created_at_text,
                notes="Generated by ContentAgent",
            )
            for platform, platform_slug, draft_text in platform_drafts
        ]

    def _build_campaign_content_queue_items(
        self,
        campaign: Campaign,
        draft_set: CampaignDraftSet,
        image_metadata: CampaignImageMetadata | None = None,
    ) -> list[CampaignContentQueueItem]:
        created_at = datetime.now(timezone.utc)
        created_at_text = self._format_utc_timestamp(created_at)
        content_id_timestamp = created_at.strftime("%Y%m%dT%H%M%S%fZ")
        platform_drafts = [
            ("Facebook", "facebook", draft_set.facebook_post),
            ("Facebook Groups", "facebook-groups", draft_set.facebook_group_post or draft_set.facebook_post),
            ("Google Business", "google-business", draft_set.google_business_post),
            ("Instagram", "instagram", draft_set.instagram_caption),
            ("Craigslist", "craigslist", draft_set.craigslist_post),
            ("Nextdoor", "nextdoor", draft_set.nextdoor_post),
        ]

        return [
            CampaignContentQueueItem(
                content_id=f"CCQ-{content_id_timestamp}-{platform_slug}",
                campaign_id=campaign.campaign_id,
                platform=platform,
                draft_text=draft_text,
                cta=campaign.cta,
                landing_page_url=campaign.landing_page_url,
                image_filename=image_metadata.image_filename if image_metadata else None,
                image_path=image_metadata.image_path if image_metadata else None,
                status="Needs Review",
                approved="No",
                published="No",
                created_at=created_at_text,
                published_at=None,
                scheduled_at=None,
                publish_attempts=0,
                last_publish_error=None,
                external_post_id=None,
                published_url=None,
                notes="Generated by CampaignAgent",
            )
            for platform, platform_slug, draft_text in platform_drafts
        ]

    @staticmethod
    def _content_queue_item_to_row(item: ContentQueueItem) -> list[str]:
        return [
            item.content_id,
            item.job_id,
            item.platform,
            item.draft_text,
            item.status,
            item.approved,
            item.published,
            item.created_at,
            item.notes,
        ]

    @staticmethod
    def _campaign_content_queue_item_to_row(item: CampaignContentQueueItem) -> list[str]:
        return [
            item.content_id,
            item.campaign_id,
            item.platform,
            item.draft_text,
            item.cta,
            item.landing_page_url,
            item.image_filename or "",
            item.image_path or "",
            item.status,
            item.approved,
            item.published,
            item.created_at,
            item.published_at or "",
            item.notes,
            item.scheduled_at or "",
            str(item.publish_attempts),
            item.last_publish_error or "",
            item.external_post_id or "",
            item.published_url or "",
        ]

    @staticmethod
    def _campaign_content_queue_item_to_row_for_headers(
        item: CampaignContentQueueItem,
        headers: list[str],
        existing_row: list[Any] | None = None,
    ) -> list[str]:
        existing_values = [str(value) for value in (existing_row or [])]
        row_length = max(len(headers), len(existing_values), len(SheetsService._campaign_content_queue_item_to_row(item)))
        row = [existing_values[index] if index < len(existing_values) else "" for index in range(row_length)]
        values_by_header = {
            "content_id": item.content_id,
            "campaign_id": item.campaign_id,
            "platform": item.platform,
            "draft_text": item.draft_text,
            "cta": item.cta,
            "landing_page_url": item.landing_page_url,
            "image_filename": item.image_filename or "",
            "image_path": item.image_path or "",
            "image_url": item.image_url or "",
            "business": item.business or "",
            "post_type": item.post_type or "",
            "status": item.status,
            "approved": item.approved,
            "published": item.published,
            "created_at": item.created_at,
            "published_at": item.published_at or "",
            "notes": item.notes,
            "scheduled_at": item.scheduled_at or "",
            "publish_attempts": str(item.publish_attempts),
            "last_publish_error": item.last_publish_error or "",
            "external_post_id": item.external_post_id or "",
            "published_url": item.published_url or "",
        }
        for index, header in enumerate(headers):
            if header in values_by_header:
                row[index] = values_by_header[header]
        return row

    @staticmethod
    def _row_to_content_queue_item(row_data: dict[str, Any]) -> ContentQueueItem:
        return ContentQueueItem(
            content_id=SheetsService._read_cell(row_data, "content_id"),
            job_id=SheetsService._read_cell(row_data, "job_id"),
            platform=SheetsService._read_cell(row_data, "platform"),
            draft_text=SheetsService._read_cell(row_data, "draft_text"),
            status=SheetsService._read_cell(row_data, "status"),
            approved=SheetsService._read_cell(row_data, "approved"),
            published=SheetsService._read_cell(row_data, "published"),
            created_at=SheetsService._read_cell(row_data, "created_at"),
            notes=SheetsService._read_cell(row_data, "notes"),
        )

    @staticmethod
    def _row_to_campaign_content_queue_item(row_data: dict[str, Any]) -> CampaignContentQueueItem:
        return CampaignContentQueueItem(
            content_id=SheetsService._read_cell(row_data, "content_id"),
            campaign_id=SheetsService._read_cell(row_data, "campaign_id"),
            platform=SheetsService._read_cell(row_data, "platform"),
            draft_text=SheetsService._read_cell(row_data, "draft_text"),
            cta=SheetsService._read_cell(row_data, "cta"),
            landing_page_url=SheetsService._read_cell(row_data, "landing_page_url"),
            image_filename=SheetsService._read_optional_cell(row_data, "image_filename"),
            image_path=SheetsService._read_optional_cell(row_data, "image_path"),
            image_url=SheetsService._read_optional_cell(row_data, "image_url"),
            business=SheetsService._read_optional_cell(row_data, "business")
            or SheetsService._read_note_value(SheetsService._read_cell(row_data, "notes"), "Business"),
            post_type=SheetsService._read_optional_cell(row_data, "post_type")
            or SheetsService._read_note_value(SheetsService._read_cell(row_data, "notes"), "Post Type"),
            status=SheetsService._read_cell(row_data, "status"),
            approved=SheetsService._read_cell(row_data, "approved"),
            published=SheetsService._read_cell(row_data, "published"),
            created_at=SheetsService._read_cell(row_data, "created_at"),
            published_at=SheetsService._read_optional_cell(row_data, "published_at"),
            scheduled_at=SheetsService._read_optional_cell(row_data, "scheduled_at"),
            publish_attempts=SheetsService._parse_int(SheetsService._read_optional_cell(row_data, "publish_attempts")),
            last_publish_error=SheetsService._read_optional_cell(row_data, "last_publish_error"),
            external_post_id=SheetsService._read_optional_cell(row_data, "external_post_id"),
            published_url=SheetsService._read_optional_cell(row_data, "published_url"),
            notes=SheetsService._read_cell(row_data, "notes"),
        )

    @staticmethod
    def _content_queue_required_headers() -> set[str]:
        return {
            "content_id",
            "job_id",
            "platform",
            "draft_text",
            "status",
            "approved",
            "published",
            "created_at",
            "notes",
        }

    @staticmethod
    def _campaign_content_queue_required_headers() -> set[str]:
        return {
            "content_id",
            "campaign_id",
            "platform",
            "draft_text",
            "cta",
            "landing_page_url",
            "image_filename",
            "image_path",
            "status",
            "approved",
            "published",
            "created_at",
            "published_at",
            "notes",
        }

    @staticmethod
    def _campaign_content_queue_optional_headers() -> set[str]:
        return {
            "scheduled_at",
            "publish_attempts",
            "last_publish_error",
            "external_post_id",
            "published_url",
            "image_url",
            "business",
            "post_type",
        }

    @staticmethod
    def _is_blank_campaign_content_queue_identity_row(row_data: dict[str, Any]) -> bool:
        identity_fields = {
            "content_id",
            "campaign_id",
            "platform",
            "draft_text",
            "cta",
            "landing_page_url",
            "created_at",
        }
        return all(not SheetsService._read_cell(row_data, field) for field in identity_fields)

    @staticmethod
    def _normalize_header(header: Any) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "_", str(header).strip().lower())
        return normalized.strip("_")

    @staticmethod
    def _read_cell(row_data: dict[str, Any], key: str) -> str:
        return str(row_data.get(key, "")).strip()

    @staticmethod
    def _read_optional_cell(row_data: dict[str, Any], key: str) -> str | None:
        value = str(row_data.get(key, "")).strip()
        return value or None

    @staticmethod
    def _parse_bool(value: str) -> bool:
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "y", "1"}:
            return True
        if normalized in {"false", "no", "n", "0", ""}:
            return False
        raise SheetsDataError(f"Invalid boolean value for photos_uploaded: {value}")

    @staticmethod
    def _parse_int(value: str | None) -> int:
        if value is None or value == "":
            return 0
        try:
            return int(value)
        except ValueError as exc:
            raise SheetsDataError(f"Invalid integer value: {value}") from exc

    @staticmethod
    def _read_note_value(notes: str, key: str) -> str | None:
        prefix = f"{key}:"
        for line in notes.splitlines():
            if line.strip().lower().startswith(prefix.lower()):
                value = line.split(":", 1)[1].strip()
                return value or None
        return None

    @staticmethod
    def _update_schedule_notes(notes: str, scheduled_at: str) -> str:
        scheduled_date, day_of_week = SheetsService._schedule_note_values(scheduled_at)
        updated_notes = SheetsService._replace_note_value(notes, "Scheduled Date", scheduled_date)
        week_key = SheetsService._week_key_for_schedule_date(scheduled_date)
        if week_key:
            updated_notes = SheetsService._replace_note_value(updated_notes, "Week", week_key)
        week_start = SheetsService._week_start_for_schedule_date(scheduled_date)
        if week_start:
            updated_notes = SheetsService._replace_note_value(updated_notes, "Week Start", week_start)
        if day_of_week:
            updated_notes = SheetsService._replace_note_value(updated_notes, "Day of Week", day_of_week)
        return updated_notes

    @staticmethod
    def _schedule_note_values(scheduled_at: str) -> tuple[str, str]:
        try:
            scheduled_datetime = SheetsService._parse_iso_datetime(scheduled_at)
        except SheetsDataError:
            scheduled_date = scheduled_at.split("T", 1)[0].strip()
            return scheduled_date, ""
        return scheduled_datetime.date().isoformat(), scheduled_datetime.strftime("%A")

    @staticmethod
    def _week_key_for_schedule_date(scheduled_date: str) -> str:
        try:
            parsed_date = date.fromisoformat(scheduled_date)
        except ValueError:
            return ""

        year, week_number, _ = parsed_date.isocalendar()
        return f"{year}-W{week_number:02d}"

    @staticmethod
    def _week_start_for_schedule_date(scheduled_date: str) -> str:
        try:
            parsed_date = date.fromisoformat(scheduled_date)
        except ValueError:
            return ""

        return (parsed_date - timedelta(days=parsed_date.weekday())).isoformat()

    @staticmethod
    def _replace_note_value(notes: str, key: str, value: str) -> str:
        prefix = f"{key}:"
        lines = notes.splitlines()
        for index, line in enumerate(lines):
            if line.strip().lower().startswith(prefix.lower()):
                lines[index] = f"{key}: {value}"
                return "\n".join(lines)
        return "\n".join([*lines, f"{key}: {value}"]) if lines else f"{key}: {value}"

    @staticmethod
    def _spreadsheet_column_name(column_number: int) -> str:
        if column_number < 1:
            raise SheetsDataError("Spreadsheet column number must be positive.")
        column_name = ""
        current_column = column_number
        while current_column:
            current_column, remainder = divmod(current_column - 1, 26)
            column_name = f"{chr(65 + remainder)}{column_name}"
        return column_name

    @staticmethod
    def _parse_iso_datetime(value: str) -> datetime:
        normalized = value.strip()
        try:
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError as exc:
            raise SheetsDataError(f"Invalid datetime value: {value}") from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    @staticmethod
    def _is_due_campaign_content_queue_item(item: CampaignContentQueueItem, now: datetime) -> bool:
        return not SheetsService._campaign_content_due_skip_reasons(item=item, now=now)

    @staticmethod
    def _campaign_content_due_candidate(
        item: CampaignContentQueueItem,
        now: datetime,
    ) -> CampaignContentDueCandidate:
        skip_reasons = SheetsService._campaign_content_due_skip_reasons(item=item, now=now)
        return CampaignContentDueCandidate(
            content_id=item.content_id,
            platform=item.platform,
            status=item.status,
            approved=item.approved,
            published=item.published,
            scheduled=bool(item.scheduled_at),
            scheduled_at=item.scheduled_at,
            eligible=not skip_reasons,
            skip_reasons=skip_reasons,
        )

    @staticmethod
    def _campaign_content_due_skip_reasons(item: CampaignContentQueueItem, now: datetime) -> list[str]:
        skip_reasons: list[str] = []

        if item.platform == "Facebook Groups":
            skip_reasons.append("Facebook Groups posts are manual only.")
        if item.approved != "Yes":
            skip_reasons.append("Approved must be Yes.")
        if item.published == "Yes":
            skip_reasons.append("Published must not be Yes.")
        if not item.scheduled_at:
            skip_reasons.append("Scheduled At is required.")
        if item.status == "Needs Review":
            skip_reasons.append("Status must not be Needs Review.")
        if item.status == "Ready for Manual Post":
            skip_reasons.append("Status must not be Ready for Manual Post.")
        if item.status == "Ready for Meta Business Suite":
            skip_reasons.append("Status must not be Ready for Meta Business Suite.")
        if item.status == "Publish Blocked":
            skip_reasons.append("Status must not be Publish Blocked.")
        if item.status == "Rejected":
            skip_reasons.append("Status must not be Rejected.")
        if item.status == "Published":
            skip_reasons.append("Status must not be Published.")
        if item.scheduled_at:
            try:
                scheduled_at = SheetsService._parse_iso_datetime(item.scheduled_at)
            except SheetsDataError:
                skip_reasons.append("Scheduled At must be a valid ISO datetime.")
            else:
                if scheduled_at > now:
                    skip_reasons.append("Scheduled At must be due at or before now.")

        return skip_reasons

    @staticmethod
    def _append_note(existing_notes: str, note: str) -> str:
        return f"{existing_notes}\n\n{note}" if existing_notes else note

    @staticmethod
    def _format_utc_timestamp(value: datetime) -> str:
        return value.isoformat(timespec="seconds").replace("+00:00", "Z")

    @staticmethod
    def _utc_timestamp() -> str:
        return SheetsService._format_utc_timestamp(datetime.now(timezone.utc))
