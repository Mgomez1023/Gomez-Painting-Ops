from app.models.photo_asset import PhotoAssetCreateRequest, PhotoAssetUpdateRequest
from app.services.photo_asset_service import PhotoAssetService


def _photo_service(tmp_path) -> PhotoAssetService:
    return PhotoAssetService(
        data_file=tmp_path / "photo_assets.json",
        media_dir=tmp_path / "media",
        public_path_prefix="/media/photo-assets",
    )


def test_photo_asset_service_creates_updates_increments_and_deletes_local_asset(tmp_path) -> None:
    service = _photo_service(tmp_path)

    asset = service.create_photo_asset(
        PhotoAssetCreateRequest(
            image_data="data:image/png;base64,aGVsbG8=",
            image_filename="Finished Kitchen.png",
            title="Finished Kitchen",
            description="Fresh cabinet finish.",
            category="Finished Project",
            service_type="Cabinets",
            location="Oak Park",
            tags=["kitchen", "kitchen", " cabinets "],
            quality="hero",
        )
    )

    assert asset.business_id == "marom-painting"
    assert asset.image_path == f"/media/photo-assets/{asset.image_filename}"
    assert (tmp_path / "media" / asset.image_filename).exists()
    assert service.list_photo_assets() == [asset]

    updated_asset = service.update_photo_asset(
        asset.id,
        PhotoAssetUpdateRequest(
            title="Updated Kitchen",
            tags=["updated", "Updated", "cabinet"],
            quality="strong",
        ),
    )

    assert updated_asset is not None
    assert updated_asset.title == "Updated Kitchen"
    assert updated_asset.tags == ["updated", "cabinet"]
    assert updated_asset.quality == "strong"

    used_asset = service.increment_used_count(asset.id)
    assert used_asset is not None
    assert used_asset.used_count == 1

    deleted_asset = service.delete_photo_asset(asset.id)
    assert deleted_asset is not None
    assert deleted_asset.id == asset.id
    assert service.list_photo_assets() == []
    assert not (tmp_path / "media" / asset.image_filename).exists()


def test_photo_asset_service_scopes_assets_by_business_id(tmp_path) -> None:
    service = _photo_service(tmp_path)
    default_asset = service.create_photo_asset(
        PhotoAssetCreateRequest(
            image_data="data:image/jpeg;base64,aGVsbG8=",
            image_filename="default.jpg",
            title="Default Asset",
            category="Exterior",
        )
    )
    other_asset = service.create_photo_asset(
        PhotoAssetCreateRequest(
            business_id="other-business",
            image_url="https://example.com/photo.jpg",
            image_filename="photo.jpg",
            title="Other Asset",
            category="Interior",
        )
    )

    assert service.list_photo_assets() == [default_asset]
    assert service.list_photo_assets("other-business") == [other_asset]
    assert service.delete_photo_asset(other_asset.id) is None
    assert service.delete_photo_asset(other_asset.id, business_id="other-business") == other_asset
