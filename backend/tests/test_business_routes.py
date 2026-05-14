from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_business_data_service, get_current_owner_id
from app.main import app
from app.models.business import (
    Business,
    BusinessContext,
    BusinessContextUpsertRequest,
    BusinessCreateRequest,
    BusinessUpdateRequest,
    GeneratedPost,
    GeneratedPostCreateRequest,
    GeneratedPostUpdateRequest,
    PhotoAsset,
    PhotoAssetCreateRequest,
)


OWNER_ID = "11111111-1111-4111-8111-111111111111"
BUSINESS_ID = "33333333-3333-4333-8333-333333333333"
POST_ID = "55555555-5555-4555-8555-555555555555"
PHOTO_ID = "66666666-6666-4666-8666-666666666666"
NOW = "2026-05-14T00:00:00Z"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeBusinessDataService:
    def __init__(self) -> None:
        self.owner_ids: list[str] = []
        self.business_ids: list[str] = []

    def list_businesses(self, owner_id: str) -> list[Business]:
        self.owner_ids.append(owner_id)
        return [_business()]

    def create_business(self, owner_id: str, request: BusinessCreateRequest) -> Business:
        self.owner_ids.append(owner_id)
        return _business(name=request.name)

    def update_business(self, owner_id: str, business_id: str, request: BusinessUpdateRequest) -> Business:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return _business(name=request.name or "Gomez Painting")

    def get_business_context(self, owner_id: str, business_id: str) -> BusinessContext:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return _context()

    def upsert_business_context(
        self,
        owner_id: str,
        business_id: str,
        request: BusinessContextUpsertRequest,
    ) -> BusinessContext:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return _context(services=request.services)

    def list_photo_assets(self, owner_id: str, business_id: str) -> list[PhotoAsset]:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return [_photo_asset()]

    def create_photo_asset(self, owner_id: str, business_id: str, request: PhotoAssetCreateRequest) -> PhotoAsset:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return _photo_asset(storage_path=request.storage_path)

    def delete_photo_asset(self, owner_id: str, business_id: str, photo_asset_id: str) -> PhotoAsset:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return _photo_asset(photo_asset_id=photo_asset_id)

    def list_generated_posts(self, owner_id: str, business_id: str) -> list[GeneratedPost]:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return [_generated_post()]

    def create_generated_post(
        self,
        owner_id: str,
        business_id: str,
        request: GeneratedPostCreateRequest,
    ) -> GeneratedPost:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return _generated_post(content=request.content)

    def update_generated_post(
        self,
        owner_id: str,
        business_id: str,
        generated_post_id: str,
        request: GeneratedPostUpdateRequest,
    ) -> GeneratedPost:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return _generated_post(generated_post_id=generated_post_id, content=request.content or "Draft")


@pytest.mark.anyio
async def test_business_routes_use_dev_owner_and_business_scoped_paths() -> None:
    fake_service = FakeBusinessDataService()

    async def override_owner_id() -> str:
        return OWNER_ID

    async def override_business_data_service() -> FakeBusinessDataService:
        return fake_service

    app.dependency_overrides[get_current_owner_id] = override_owner_id
    app.dependency_overrides[get_business_data_service] = override_business_data_service
    transport = ASGITransport(app=app)

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            list_response = await client.get("/businesses")
            create_response = await client.post("/businesses", json={"name": "Gomez Painting"})
            update_response = await client.patch(f"/businesses/{BUSINESS_ID}", json={"name": "Gomez Painting Co."})
            context_response = await client.put(
                f"/businesses/{BUSINESS_ID}/context",
                json={"services": ["Interior painting"], "brand_voice": "Clear and helpful"},
            )
            photos_response = await client.get(f"/businesses/{BUSINESS_ID}/photos")
            generated_post_response = await client.post(
                f"/businesses/{BUSINESS_ID}/generated-posts",
                json={"tool_type": "manual", "content": "Draft content"},
            )
            generated_post_update_response = await client.patch(
                f"/businesses/{BUSINESS_ID}/generated-posts/{POST_ID}",
                json={"content": "Updated draft"},
            )
    finally:
        app.dependency_overrides.clear()

    assert list_response.status_code == 200
    assert create_response.status_code == 201
    assert update_response.status_code == 200
    assert context_response.status_code == 200
    assert photos_response.status_code == 200
    assert generated_post_response.status_code == 201
    assert generated_post_update_response.status_code == 200
    assert set(fake_service.owner_ids) == {OWNER_ID}
    assert fake_service.business_ids == [BUSINESS_ID, BUSINESS_ID, BUSINESS_ID, BUSINESS_ID, BUSINESS_ID]


def _business(name: str = "Gomez Painting") -> Business:
    return Business(
        id=BUSINESS_ID,
        owner_id=OWNER_ID,
        name=name,
        industry="Painting",
        location="Chicago, IL",
        website_url="https://example.com",
        phone="555-0100",
        email="hello@example.com",
        created_at=NOW,
        updated_at=NOW,
    )


def _context(services: list[str] | None = None) -> BusinessContext:
    return BusinessContext(
        business_id=BUSINESS_ID,
        services=services or ["Interior painting"],
        target_customers="Homeowners",
        brand_voice="Clear and helpful",
        differentiators=["Clean prep"],
        service_area="Chicago",
        notes="",
        created_at=NOW,
        updated_at=NOW,
    )


def _photo_asset(photo_asset_id: str = PHOTO_ID, storage_path: str = "business/photos/interior.jpg") -> PhotoAsset:
    return PhotoAsset(
        id=photo_asset_id,
        business_id=BUSINESS_ID,
        storage_path=storage_path,
        public_url="https://example.com/interior.jpg",
        caption="Interior repaint",
        tags=["interior"],
        job_type="Interior painting",
        created_at=NOW,
        updated_at=NOW,
    )


def _generated_post(generated_post_id: str = POST_ID, content: str = "Draft") -> GeneratedPost:
    return GeneratedPost(
        id=generated_post_id,
        business_id=BUSINESS_ID,
        tool_type="manual",
        platform="Facebook",
        title="Interior refresh",
        content=content,
        metadata={},
        status="draft",
        created_at=NOW,
        updated_at=NOW,
    )
