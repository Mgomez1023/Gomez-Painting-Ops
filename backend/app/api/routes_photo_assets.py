from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies import get_photo_asset_service
from app.models.photo_asset import PhotoAsset, PhotoAssetCreateRequest, PhotoAssetUpdateRequest
from app.services.photo_asset_service import (
    DEFAULT_PHOTO_ASSET_BUSINESS_ID,
    PhotoAssetDataError,
    PhotoAssetService,
)

router = APIRouter(prefix="/photo-assets", tags=["photo-assets"])


@router.get("", response_model=list[PhotoAsset])
async def list_photo_assets(
    business_id: str = Query(DEFAULT_PHOTO_ASSET_BUSINESS_ID),
    photo_asset_service: PhotoAssetService = Depends(get_photo_asset_service),
) -> list[PhotoAsset]:
    try:
        return photo_asset_service.list_photo_assets(business_id=business_id)
    except PhotoAssetDataError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.post("", response_model=PhotoAsset, status_code=status.HTTP_201_CREATED)
async def create_photo_asset(
    request: PhotoAssetCreateRequest,
    photo_asset_service: PhotoAssetService = Depends(get_photo_asset_service),
) -> PhotoAsset:
    try:
        return photo_asset_service.create_photo_asset(request)
    except PhotoAssetDataError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/{asset_id}", response_model=PhotoAsset)
async def update_photo_asset(
    asset_id: str,
    request: PhotoAssetUpdateRequest,
    photo_asset_service: PhotoAssetService = Depends(get_photo_asset_service),
) -> PhotoAsset:
    try:
        updated_asset = photo_asset_service.update_photo_asset(asset_id=asset_id, request=request)
    except PhotoAssetDataError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if updated_asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Photo asset not found: {asset_id}")
    return updated_asset


@router.delete("/{asset_id}", response_model=PhotoAsset)
async def delete_photo_asset(
    asset_id: str,
    business_id: str = Query(DEFAULT_PHOTO_ASSET_BUSINESS_ID),
    photo_asset_service: PhotoAssetService = Depends(get_photo_asset_service),
) -> PhotoAsset:
    try:
        deleted_asset = photo_asset_service.delete_photo_asset(asset_id=asset_id, business_id=business_id)
    except PhotoAssetDataError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    if deleted_asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Photo asset not found: {asset_id}")
    return deleted_asset
