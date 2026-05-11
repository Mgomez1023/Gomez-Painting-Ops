import base64

import pytest

from app.models.content_draft import ContentDraft
from app.models.content_queue import ContentQueueItem
from app.models.campaign_content import CampaignDraftSet, CampaignContentQueueItem
from app.services.campaign_image_service import CampaignImageMetadata
from app.services.sheets_service import SheetsDataError, SheetsService


def test_normalize_header_handles_spaces_slashes_and_casing() -> None:
    assert SheetsService._normalize_header("Before Photo URL") == "before_photo_url"
    assert SheetsService._normalize_header("After Photo URL") == "after_photo_url"
    assert SheetsService._normalize_header("Room/Area") == "room_area"
    assert SheetsService._normalize_header("Paint Colors") == "paint_colors"
    assert SheetsService._normalize_header("Customer Outcome") == "customer_outcome"
    assert SheetsService._normalize_header("Project Highlights") == "project_highlights"


def test_parse_service_account_json_accepts_literal_json_with_escaped_private_key_newlines() -> None:
    service_account_info = SheetsService._parse_service_account_json(
        '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"}'
    )

    assert service_account_info["type"] == "service_account"
    assert service_account_info["private_key"] == "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"


def test_parse_service_account_json_accepts_base64_encoded_json() -> None:
    encoded_value = base64.b64encode(
        b'{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"}'
    ).decode("ascii")

    service_account_info = SheetsService._parse_service_account_json(encoded_value)

    assert service_account_info["type"] == "service_account"
    assert service_account_info["private_key"] == "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"


def test_rows_to_completed_jobs_maps_sheet_rows_to_models() -> None:
    rows = [
        [
            "Job ID",
            "Customer",
            "Job Type",
            "Location",
            "Date Completed",
            "Photos Uploaded",
            "Notes",
            "Before Photo URL",
            "After Photo URL",
            "Room/Area",
            "Paint Colors",
            "Customer Outcome",
            "Project Highlights",
        ],
        [
            "JOB-1001",
            "Maria R.",
            "Interior Paint",
            "Oak Park",
            "March 2026",
            "TRUE",
            "Living room repaint.",
            "https://example.com/before.jpg",
            "https://example.com/after.jpg",
            "Living room",
            "Alabaster walls, Pure White trim",
            "The room feels brighter and more welcoming.",
            "Trim refresh and wall repair.",
        ],
        [
            "JOB-1002",
            "Sam T.",
            "Exterior Paint",
            "Forest Park",
            "April 2026",
            "no",
            "Garage refresh.",
            "",
            "",
            "",
            "",
            "",
            "",
        ],
    ]

    jobs = SheetsService().rows_to_completed_jobs(rows)

    assert len(jobs) == 2
    assert jobs[0].job_id == "JOB-1001"
    assert jobs[0].customer == "Maria R."
    assert jobs[0].photos_uploaded is True
    assert jobs[0].before_photo_url == "https://example.com/before.jpg"
    assert jobs[0].after_photo_url == "https://example.com/after.jpg"
    assert jobs[0].room_area == "Living room"
    assert jobs[0].paint_colors == "Alabaster walls, Pure White trim"
    assert jobs[0].customer_outcome == "The room feels brighter and more welcoming."
    assert jobs[0].project_highlights == "Trim refresh and wall repair."
    assert jobs[1].job_id == "JOB-1002"
    assert jobs[1].customer == "Sam T."
    assert jobs[1].photos_uploaded is False
    assert jobs[1].before_photo_url is None
    assert jobs[1].after_photo_url is None
    assert jobs[1].room_area is None
    assert jobs[1].paint_colors is None
    assert jobs[1].customer_outcome is None
    assert jobs[1].project_highlights is None


def test_rows_to_completed_jobs_allows_missing_job_id_column() -> None:
    rows = [
        ["Customer", "Job Type", "Location", "Date Completed", "Photos Uploaded", "Notes"],
        ["Maria R.", "Interior Paint", "Oak Park", "March 2026", "TRUE", "Living room repaint."],
    ]

    jobs = SheetsService().rows_to_completed_jobs(rows)

    assert len(jobs) == 1
    assert jobs[0].job_id is None
    assert jobs[0].before_photo_url is None
    assert jobs[0].after_photo_url is None
    assert jobs[0].room_area is None
    assert jobs[0].paint_colors is None
    assert jobs[0].customer_outcome is None
    assert jobs[0].project_highlights is None


def test_get_completed_job_by_id_returns_matching_job() -> None:
    class FakeSheetsService(SheetsService):
        def _fetch_completed_job_rows(self) -> list[list[str]]:
            return [
                ["Job ID", "Customer", "Job Type", "Location", "Date Completed", "Photos Uploaded", "Notes"],
                ["JOB-1001", "Maria R.", "Interior Paint", "Oak Park", "March 2026", "TRUE", "Living room repaint."],
            ]

    job = FakeSheetsService().get_completed_job_by_id("JOB-1001")

    assert job is not None
    assert job.customer == "Maria R."


def test_get_completed_job_by_id_returns_none_for_missing_job() -> None:
    class FakeSheetsService(SheetsService):
        def _fetch_completed_job_rows(self) -> list[list[str]]:
            return [
                ["Job ID", "Customer", "Job Type", "Location", "Date Completed", "Photos Uploaded", "Notes"],
                ["JOB-1001", "Maria R.", "Interior Paint", "Oak Park", "March 2026", "TRUE", "Living room repaint."],
            ]

    assert FakeSheetsService().get_completed_job_by_id("JOB-404") is None


def test_save_content_draft_to_queue_appends_four_review_rows() -> None:
    class FakeSheetsService(SheetsService):
        def __init__(self) -> None:
            super().__init__()
            self.appended_rows: list[list[str]] = []

        def _append_content_queue_rows(self, rows: list[list[str]]) -> None:
            self.appended_rows = rows

    draft = ContentDraft(
        facebook_post="Facebook draft",
        google_business_post="Google Business draft",
        instagram_caption="Instagram draft",
        review_request_text="Review request draft",
        confidence=0.82,
        needs_human_review=True,
    )
    service = FakeSheetsService()

    queue_items = service.save_content_draft_to_queue(job_id="JOB-1001", draft=draft)

    assert len(queue_items) == 4
    assert len(service.appended_rows) == 4
    assert {row[1] for row in service.appended_rows} == {"JOB-1001"}
    assert [row[2] for row in service.appended_rows] == [
        "Facebook",
        "Google Business",
        "Instagram",
        "Review Request",
    ]
    assert {row[4] for row in service.appended_rows} == {"Needs Review"}
    assert {row[5] for row in service.appended_rows} == {"No"}
    assert {row[6] for row in service.appended_rows} == {"No"}
    assert {row[8] for row in service.appended_rows} == {"Generated by ContentAgent"}


def test_rows_to_campaigns_maps_sheet_rows_to_models() -> None:
    rows = [
        [
            "Campaign ID",
            "Campaign Name",
            "Service Focus",
            "Target Location",
            "Target Customer",
            "Offer",
            "CTA",
            "Landing Page URL",
            "Start Date",
            "End Date",
            "Status",
            "Notes",
        ],
        [
            "CAMP-1001",
            "Spring Interior Leads",
            "Interior painting",
            "Oak Park",
            "Homeowners",
            "Free quote request",
            "Request a quote",
            "https://gomezpainting.example/quote",
            "2026-05-01",
            "2026-05-31",
            "Active",
            "Focus on living rooms.",
        ],
        [
            "CAMP-1002",
            "Exterior Leads",
            "Exterior painting",
            "Berwyn",
            "Homeowners",
            "",
            "Get an estimate",
            "https://gomezpainting.example/quote",
            "2026-06-01",
            "2026-06-30",
            "Draft",
            "",
        ],
    ]

    campaigns = SheetsService().rows_to_campaigns(rows)

    assert len(campaigns) == 2
    assert campaigns[0].campaign_id == "CAMP-1001"
    assert campaigns[0].offer == "Free quote request"
    assert campaigns[0].notes == "Focus on living rooms."
    assert campaigns[1].campaign_id == "CAMP-1002"
    assert campaigns[1].offer is None
    assert campaigns[1].notes == ""


def test_save_campaign_draft_set_to_queue_appends_five_review_rows() -> None:
    class FakeSheetsService(SheetsService):
        def __init__(self) -> None:
            super().__init__()
            self.appended_rows: list[list[str]] = []

        def _append_campaign_content_queue_rows(self, rows: list[list[str]]) -> None:
            self.appended_rows = rows

    campaign = SheetsService().rows_to_campaigns(
        [
            [
                "Campaign ID",
                "Campaign Name",
                "Service Focus",
                "Target Location",
                "Target Customer",
                "Offer",
                "CTA",
                "Landing Page URL",
                "Start Date",
                "End Date",
                "Status",
                "Notes",
            ],
            [
                "CAMP-1001",
                "Spring Interior Leads",
                "Interior painting",
                "Oak Park",
                "Homeowners",
                "",
                "Request a quote",
                "https://gomezpainting.example/quote",
                "2026-05-01",
                "2026-05-31",
                "Active",
                "",
            ],
        ]
    )[0]
    draft_set = CampaignDraftSet(
        facebook_post="Facebook draft",
        google_business_post="Google Business draft",
        instagram_caption="Instagram draft",
        craigslist_post="Craigslist draft",
        nextdoor_post="Nextdoor draft",
        confidence=0.82,
        needs_human_review=True,
    )
    service = FakeSheetsService()

    queue_items = service.save_campaign_draft_set_to_queue(
        campaign=campaign,
        draft_set=draft_set,
        image_metadata=CampaignImageMetadata(
            image_filename="01-kitchen.webp",
            image_path="/media/campaigns/01-kitchen.webp",
        ),
    )

    assert len(queue_items) == 5
    assert len(service.appended_rows) == 5
    assert {row[1] for row in service.appended_rows} == {"CAMP-1001"}
    assert [row[2] for row in service.appended_rows] == [
        "Facebook",
        "Google Business",
        "Instagram",
        "Craigslist",
        "Nextdoor",
    ]
    assert {row[4] for row in service.appended_rows} == {"Request a quote"}
    assert {row[5] for row in service.appended_rows} == {"https://gomezpainting.example/quote"}
    assert {row[6] for row in service.appended_rows} == {"01-kitchen.webp"}
    assert {row[7] for row in service.appended_rows} == {"/media/campaigns/01-kitchen.webp"}
    assert {row[8] for row in service.appended_rows} == {"Needs Review"}
    assert {row[9] for row in service.appended_rows} == {"No"}
    assert {row[10] for row in service.appended_rows} == {"No"}
    assert {row[12] for row in service.appended_rows} == {""}
    assert {row[13] for row in service.appended_rows} == {"Generated by CampaignAgent"}


def test_update_content_queue_item_status_updates_matching_row() -> None:
    class FakeSheetsService(SheetsService):
        def __init__(self) -> None:
            super().__init__()
            self.updated_row_number: int | None = None
            self.updated_item: ContentQueueItem | None = None

        def _fetch_content_queue_rows(self) -> list[list[str]]:
            return [
                [
                    "Content ID",
                    "Job ID",
                    "Platform",
                    "Draft Text",
                    "Status",
                    "Approved",
                    "Published",
                    "Created At",
                    "Notes",
                ],
                [
                    "CQ-1001-facebook",
                    "JOB-1001",
                    "Facebook",
                    "Facebook draft",
                    "Needs Review",
                    "No",
                    "No",
                    "2026-04-28T00:00:00Z",
                    "Generated by ContentAgent",
                ],
            ]

        def _update_content_queue_row(self, row_number: int, item: ContentQueueItem) -> None:
            self.updated_row_number = row_number
            self.updated_item = item

    service = FakeSheetsService()

    updated_item = service.approve_content_queue_item("CQ-1001-facebook")

    assert updated_item is not None
    assert updated_item.status == "Approved"
    assert updated_item.approved == "Yes"
    assert updated_item.published == "No"
    assert service.updated_row_number == 2
    assert service.updated_item == updated_item


def test_rows_to_content_queue_items_maps_multiple_rows() -> None:
    rows = [
        [
            "Content ID",
            "Job ID",
            "Platform",
            "Draft Text",
            "Status",
            "Approved",
            "Published",
            "Created At",
            "Notes",
        ],
        [
            "CQ-1001-facebook",
            "JOB-1001",
            "Facebook",
            "Facebook draft",
            "Needs Review",
            "No",
            "No",
            "2026-04-28T00:00:00Z",
            "",
        ],
        [
            "CQ-1001-google-business",
            "JOB-1001",
            "Google Business",
            "Google Business draft",
            "Approved",
            "Yes",
            "No",
            "2026-04-28T00:00:00Z",
            "Reviewed by owner",
        ],
    ]

    queue_items = SheetsService().rows_to_content_queue_items(rows)

    assert len(queue_items) == 2
    assert queue_items[0].content_id == "CQ-1001-facebook"
    assert queue_items[0].notes == ""
    assert queue_items[1].platform == "Google Business"
    assert queue_items[1].status == "Approved"


def test_get_content_queue_items_by_job_id_returns_matching_rows() -> None:
    class FakeSheetsService(SheetsService):
        def _fetch_content_queue_rows(self) -> list[list[str]]:
            return [
                [
                    "Content ID",
                    "Job ID",
                    "Platform",
                    "Draft Text",
                    "Status",
                    "Approved",
                    "Published",
                    "Created At",
                    "Notes",
                ],
                [
                    "CQ-1001-facebook",
                    "JOB-1001",
                    "Facebook",
                    "Facebook draft",
                    "Needs Review",
                    "No",
                    "No",
                    "2026-04-28T00:00:00Z",
                    "",
                ],
                [
                    "CQ-1002-facebook",
                    "JOB-1002",
                    "Facebook",
                    "Facebook draft",
                    "Needs Review",
                    "No",
                    "No",
                    "2026-04-28T00:00:00Z",
                    "",
                ],
            ]

    queue_items = FakeSheetsService().get_content_queue_items_by_job_id("JOB-1001")

    assert len(queue_items) == 1
    assert queue_items[0].content_id == "CQ-1001-facebook"


def test_rows_to_campaign_content_queue_items_maps_multiple_rows() -> None:
    rows = [
        [
            "Content ID",
            "Campaign ID",
            "Platform",
            "Draft Text",
            "CTA",
            "Landing Page URL",
            "Image Filename",
            "Image Path",
            "Status",
            "Approved",
            "Published",
            "Created At",
            "Published At",
            "Notes",
            "Scheduled At",
            "Publish Attempts",
            "Last Publish Error",
            "External Post ID",
            "Published URL",
        ],
        [
            "CCQ-1001-facebook",
            "CAMP-1001",
            "Facebook",
            "Facebook draft",
            "Request a quote",
            "https://gomezpainting.example/quote",
            "01-kitchen.webp",
            "/media/campaigns/01-kitchen.webp",
            "Needs Review",
            "No",
            "No",
            "2026-04-28T00:00:00Z",
            "",
            "Generated by CampaignAgent",
            "2026-04-30T09:00:00Z",
            "2",
            "Previous mock error",
            "mock-facebook-CCQ-1001-facebook",
            "https://mock-publisher.local/posts/mock-facebook-CCQ-1001-facebook",
        ],
        [
            "CCQ-1001-nextdoor",
            "CAMP-1001",
            "Nextdoor",
            "Nextdoor draft",
            "Request a quote",
            "https://gomezpainting.example/quote",
            "",
            "",
            "Published",
            "Yes",
            "Yes",
            "2026-04-28T00:00:00Z",
            "2026-04-28T01:00:00Z",
            "Reviewed",
            "",
            "",
            "",
            "",
            "",
        ],
    ]

    queue_items = SheetsService().rows_to_campaign_content_queue_items(rows)

    assert len(queue_items) == 2
    assert queue_items[0].content_id == "CCQ-1001-facebook"
    assert queue_items[0].image_filename == "01-kitchen.webp"
    assert queue_items[0].image_path == "/media/campaigns/01-kitchen.webp"
    assert queue_items[0].published_at is None
    assert queue_items[0].scheduled_at == "2026-04-30T09:00:00Z"
    assert queue_items[0].publish_attempts == 2
    assert queue_items[0].last_publish_error == "Previous mock error"
    assert queue_items[0].external_post_id == "mock-facebook-CCQ-1001-facebook"
    assert queue_items[0].published_url == "https://mock-publisher.local/posts/mock-facebook-CCQ-1001-facebook"
    assert queue_items[1].platform == "Nextdoor"
    assert queue_items[1].image_filename is None
    assert queue_items[1].image_path is None
    assert queue_items[1].published_at == "2026-04-28T01:00:00Z"
    assert queue_items[1].publish_attempts == 0


def test_rows_to_campaign_content_queue_items_skips_blank_identity_rows_with_stray_cells() -> None:
    rows = [
        [
            "Content ID",
            "Campaign ID",
            "Platform",
            "Draft Text",
            "CTA",
            "Landing Page URL",
            "Image Filename",
            "Image Path",
            "Status",
            "Approved",
            "Published",
            "Created At",
            "Published At",
            "Notes",
            "Scheduled At",
            "Publish Attempts",
            "Last Publish Error",
            "External Post ID",
            "Published URL",
        ],
        [
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "stray formula or note",
            "",
            "",
        ],
        [
            "CCQ-1001-google",
            "CAMP-1001",
            "Google Business",
            "Google draft",
            "Request a quote",
            "https://gomezpainting.example/quote",
            "",
            "",
            "Draft",
            "No",
            "No",
            "2026-04-28T00:00:00Z",
            "",
            "Generated by Weekly Social Queue",
            "2026-04-30T09:00:00Z",
            "",
            "",
            "",
            "",
        ],
    ]

    queue_items = SheetsService().rows_to_campaign_content_queue_items(rows)

    assert len(queue_items) == 1
    assert queue_items[0].content_id == "CCQ-1001-google"


def test_get_campaign_content_queue_items_by_campaign_id_returns_matching_rows() -> None:
    class FakeSheetsService(SheetsService):
        def _fetch_campaign_content_queue_rows(self) -> list[list[str]]:
            return [
                [
                    "Content ID",
                    "Campaign ID",
                    "Platform",
                    "Draft Text",
                    "CTA",
                    "Landing Page URL",
                    "Image Filename",
                    "Image Path",
                    "Status",
                    "Approved",
                    "Published",
                    "Created At",
                    "Published At",
                    "Notes",
                ],
                [
                    "CCQ-1001-facebook",
                    "CAMP-1001",
                    "Facebook",
                    "Facebook draft",
                    "Request a quote",
                    "https://gomezpainting.example/quote",
                    "01-kitchen.webp",
                    "/media/campaigns/01-kitchen.webp",
                    "Needs Review",
                    "No",
                    "No",
                    "2026-04-28T00:00:00Z",
                    "",
                    "",
                ],
                [
                    "CCQ-1002-facebook",
                    "CAMP-1002",
                    "Facebook",
                    "Facebook draft",
                    "Request a quote",
                    "https://gomezpainting.example/quote",
                    "02-exterior.jpg",
                    "/media/campaigns/02-exterior.jpg",
                    "Needs Review",
                    "No",
                    "No",
                    "2026-04-28T00:00:00Z",
                    "",
                    "",
                ],
            ]

    queue_items = FakeSheetsService().get_campaign_content_queue_items_by_campaign_id("CAMP-1001")

    assert len(queue_items) == 1
    assert queue_items[0].content_id == "CCQ-1001-facebook"


def test_rows_to_content_queue_items_returns_empty_list_for_headers_only() -> None:
    rows = [
        [
            "Content ID",
            "Job ID",
            "Platform",
            "Draft Text",
            "Status",
            "Approved",
            "Published",
            "Created At",
            "Notes",
        ]
    ]

    assert SheetsService().rows_to_content_queue_items(rows) == []


def test_rows_to_content_queue_items_raises_for_malformed_row() -> None:
    rows = [
        [
            "Content ID",
            "Job ID",
            "Platform",
            "Draft Text",
            "Status",
            "Approved",
            "Published",
            "Created At",
            "Notes",
        ],
        [
            "",
            "JOB-1001",
            "Facebook",
            "Facebook draft",
            "Needs Review",
            "No",
            "No",
            "2026-04-28T00:00:00Z",
            "",
        ],
    ]

    with pytest.raises(SheetsDataError, match="Content Queue row 2 is invalid"):
        SheetsService().rows_to_content_queue_items(rows)


def test_update_content_queue_item_status_returns_none_when_content_id_is_missing() -> None:
    class FakeSheetsService(SheetsService):
        def _fetch_content_queue_rows(self) -> list[list[str]]:
            return [
                [
                    "Content ID",
                    "Job ID",
                    "Platform",
                    "Draft Text",
                    "Status",
                    "Approved",
                    "Published",
                    "Created At",
                    "Notes",
                ],
                [
                    "CQ-1001-facebook",
                    "JOB-1001",
                    "Facebook",
                    "Facebook draft",
                    "Needs Review",
                    "No",
                    "No",
                    "2026-04-28T00:00:00Z",
                    "Generated by ContentAgent",
                ],
            ]

    assert FakeSheetsService().approve_content_queue_item("CQ-missing") is None


def test_delete_post_deletes_matching_posts_sheet_row() -> None:
    class FakeSheetsService(SheetsService):
        deleted_row_number: int | None = None

        def _fetch_posts_rows(self) -> list[list[str]]:
            return [
                [
                    "Content ID",
                    "Campaign ID",
                    "Platform",
                    "Draft Text",
                    "CTA",
                    "Landing Page URL",
                    "Image Filename",
                    "Image Path",
                    "Status",
                    "Approved",
                    "Published",
                    "Created At",
                    "Published At",
                    "Notes",
                ],
                [
                    "WSQ-1001-meta-dual-1",
                    "CAMP-1001",
                    "Meta Dual",
                    "Weekly post",
                    "Request a quote",
                    "https://marompainting.org",
                    "",
                    "",
                    "Draft",
                    "No",
                    "No",
                    "2026-04-29T12:00:00Z",
                    "",
                    "Generated by Weekly Social Queue",
                ],
            ]

        def _delete_posts_row(self, row_number: int) -> None:
            self.deleted_row_number = row_number

    service = FakeSheetsService()
    deleted_post = service.delete_post("WSQ-1001-meta-dual-1")

    assert deleted_post is not None
    assert deleted_post.content_id == "WSQ-1001-meta-dual-1"
    assert service.deleted_row_number == 2


def test_update_post_scheduled_at_updates_matching_posts_sheet_row() -> None:
    class FakeSheetsService(SheetsService):
        updated_row_number: int | None = None
        updated_item: CampaignContentQueueItem | None = None

        def _fetch_posts_rows(self) -> list[list[str]]:
            return [
                [
                    "Content ID",
                    "Campaign ID",
                    "Platform",
                    "Draft Text",
                    "CTA",
                    "Landing Page URL",
                    "Image Filename",
                    "Image Path",
                    "Status",
                    "Approved",
                    "Published",
                    "Created At",
                    "Published At",
                    "Notes",
                    "Scheduled At",
                ],
                [
                    "WSQ-1001-meta-dual-1",
                    "CAMP-1001",
                    "Meta Dual",
                    "Weekly post",
                    "Request a quote",
                    "https://marompainting.org",
                    "",
                    "",
                    "Draft",
                    "No",
                    "Yes",
                    "2026-04-29T12:00:00Z",
                    "",
                    "Generated by Weekly Social Queue",
                    "2026-04-29T12:00:00Z",
                ],
            ]

        def _update_posts_row(self, row_number: int, item: CampaignContentQueueItem) -> None:
            self.updated_row_number = row_number
            self.updated_item = item

    service = FakeSheetsService()
    updated_post = service.update_post_scheduled_at("WSQ-1001-meta-dual-1", "2026-05-01T12:00:00Z")

    assert updated_post is not None
    assert updated_post.scheduled_at == "2026-05-01T12:00:00Z"
    assert updated_post.published == "No"
    assert service.updated_row_number == 2
    assert service.updated_item == updated_post


def test_delete_post_returns_none_when_content_id_is_missing() -> None:
    class FakeSheetsService(SheetsService):
        def _fetch_posts_rows(self) -> list[list[str]]:
            return [
                [
                    "Content ID",
                    "Campaign ID",
                    "Platform",
                    "Draft Text",
                    "CTA",
                    "Landing Page URL",
                    "Image Filename",
                    "Image Path",
                    "Status",
                    "Approved",
                    "Published",
                    "Created At",
                    "Published At",
                    "Notes",
                ],
                [
                    "WSQ-1001-meta-dual-1",
                    "CAMP-1001",
                    "Meta Dual",
                    "Weekly post",
                    "Request a quote",
                    "https://marompainting.org",
                    "",
                    "",
                    "Draft",
                    "No",
                    "No",
                    "2026-04-29T12:00:00Z",
                    "",
                    "Generated by Weekly Social Queue",
                ],
            ]

    assert FakeSheetsService().delete_post("WSQ-missing") is None


def test_rows_to_completed_jobs_requires_expected_headers() -> None:
    rows = [["Customer", "Job Type"], ["Maria R.", "Interior Paint"]]

    with pytest.raises(SheetsDataError, match="missing required columns"):
        SheetsService().rows_to_completed_jobs(rows)
