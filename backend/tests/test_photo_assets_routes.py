import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_photo_asset_service
from app.main import app
from app.models.photo_asset import PhotoAsset
from app.services.photo_asset_service import PhotoAssetService


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_photo_asset_routes_create_list_update_and_delete(tmp_path) -> None:
    photo_asset_service = PhotoAssetService(
        data_file=tmp_path / "photo_assets.json",
        media_dir=tmp_path / "media",
        public_path_prefix="/media/photo-assets",
    )

    async def override_photo_asset_service() -> PhotoAssetService:
        return photo_asset_service

    app.dependency_overrides[get_photo_asset_service] = override_photo_asset_service
    transport = ASGITransport(app=app)

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            create_response = await client.post(
                "/photo-assets",
                json={
                    "business_id": "marom-painting",
                    "image_data": "data:image/png;base64,aGVsbG8=",
                    "image_filename": "interior.png",
                    "title": "Interior Refresh",
                    "description": "Fresh wall color.",
                    "category": "Interior",
                    "service_type": "Interior painting",
                    "location": "Oak Park",
                    "tags": ["walls", "oak park"],
                    "quality": "strong",
                },
            )
            assert create_response.status_code == 201
            created_asset = PhotoAsset.model_validate(create_response.json())

            list_response = await client.get("/photo-assets", params={"business_id": "marom-painting"})
            assert list_response.status_code == 200
            assert [asset["id"] for asset in list_response.json()] == [created_asset.id]

            update_response = await client.put(
                f"/photo-assets/{created_asset.id}",
                json={"title": "Updated Interior Refresh", "quality": "hero"},
            )
            assert update_response.status_code == 200
            updated_asset = PhotoAsset.model_validate(update_response.json())
            assert updated_asset.title == "Updated Interior Refresh"
            assert updated_asset.quality == "hero"

            delete_response = await client.delete(
                f"/photo-assets/{created_asset.id}",
                params={"business_id": "marom-painting"},
            )
            assert delete_response.status_code == 200
            assert PhotoAsset.model_validate(delete_response.json()).id == created_asset.id

            empty_list_response = await client.get("/photo-assets", params={"business_id": "marom-painting"})
            assert empty_list_response.status_code == 200
            assert empty_list_response.json() == []
    finally:
        app.dependency_overrides.clear()
