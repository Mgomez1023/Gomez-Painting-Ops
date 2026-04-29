import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_sheets_service
from app.main import app
from app.models.completed_job import CompletedJob
from app.services.sheets_service import SheetsConfigurationError


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeSheetsService:
    def list_completed_jobs(self) -> list[CompletedJob]:
        return [
            CompletedJob(
                job_id="JOB-1001",
                customer="Maria R.",
                job_type="Interior Paint",
                location="Oak Park",
                date_completed="March 2026",
                photos_uploaded=True,
                notes="Living room repaint with trim refresh.",
            )
        ]


class MissingCredentialsSheetsService:
    def list_completed_jobs(self) -> list[CompletedJob]:
        raise SheetsConfigurationError("Google Sheets is not configured.")


@pytest.mark.anyio
async def test_jobs_endpoint_returns_completed_jobs_from_sheets_service() -> None:
    async def override_sheets_service() -> FakeSheetsService:
        return FakeSheetsService()

    app.dependency_overrides[get_sheets_service] = override_sheets_service
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/jobs")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == [
        {
            "customer": "Maria R.",
            "job_id": "JOB-1001",
            "job_type": "Interior Paint",
            "location": "Oak Park",
            "date_completed": "March 2026",
            "photos_uploaded": True,
            "notes": "Living room repaint with trim refresh.",
            "before_photo_url": None,
            "after_photo_url": None,
            "room_area": None,
            "paint_colors": None,
            "customer_outcome": None,
            "project_highlights": None,
        }
    ]


@pytest.mark.anyio
async def test_jobs_endpoint_returns_503_when_sheets_credentials_are_missing() -> None:
    async def override_sheets_service() -> MissingCredentialsSheetsService:
        return MissingCredentialsSheetsService()

    app.dependency_overrides[get_sheets_service] = override_sheets_service
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/jobs")

    app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "Google Sheets is not configured."}
