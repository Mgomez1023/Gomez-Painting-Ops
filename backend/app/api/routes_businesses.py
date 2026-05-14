from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_business_data_service, get_current_owner_id
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
from app.services.business_service import (
    BusinessDataService,
    BusinessNotFoundError,
    SupabaseConfigurationError,
    SupabaseDataError,
    SupabaseValidationError,
)

router = APIRouter(prefix="/businesses", tags=["businesses"])


@router.get("", response_model=list[Business])
async def list_businesses(
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> list[Business]:
    try:
        return business_service.list_businesses(owner_id=owner_id)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)


@router.post("", response_model=Business, status_code=status.HTTP_201_CREATED)
async def create_business(
    request: BusinessCreateRequest,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> Business:
    try:
        return business_service.create_business(owner_id=owner_id, request=request)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)


@router.patch("/{business_id}", response_model=Business)
async def update_business(
    business_id: str,
    request: BusinessUpdateRequest,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> Business:
    try:
        business = business_service.update_business(owner_id=owner_id, business_id=business_id, request=request)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)
    if business is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Business not found: {business_id}")
    return business


@router.get("/{business_id}/context", response_model=BusinessContext)
async def get_business_context(
    business_id: str,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> BusinessContext:
    try:
        context = business_service.get_business_context(owner_id=owner_id, business_id=business_id)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)
    if context is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Business context not found: {business_id}")
    return context


@router.put("/{business_id}/context", response_model=BusinessContext)
async def upsert_business_context(
    business_id: str,
    request: BusinessContextUpsertRequest,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> BusinessContext:
    try:
        return business_service.upsert_business_context(owner_id=owner_id, business_id=business_id, request=request)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)


@router.get("/{business_id}/photos", response_model=list[PhotoAsset])
async def list_business_photo_assets(
    business_id: str,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> list[PhotoAsset]:
    try:
        return business_service.list_photo_assets(owner_id=owner_id, business_id=business_id)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)


@router.post("/{business_id}/photos", response_model=PhotoAsset, status_code=status.HTTP_201_CREATED)
async def create_business_photo_asset(
    business_id: str,
    request: PhotoAssetCreateRequest,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> PhotoAsset:
    try:
        return business_service.create_photo_asset(owner_id=owner_id, business_id=business_id, request=request)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)


@router.delete("/{business_id}/photos/{photo_asset_id}", response_model=PhotoAsset)
async def delete_business_photo_asset(
    business_id: str,
    photo_asset_id: str,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> PhotoAsset:
    try:
        photo_asset = business_service.delete_photo_asset(
            owner_id=owner_id,
            business_id=business_id,
            photo_asset_id=photo_asset_id,
        )
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)
    if photo_asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Photo asset not found: {photo_asset_id}")
    return photo_asset


@router.get("/{business_id}/generated-posts", response_model=list[GeneratedPost])
async def list_business_generated_posts(
    business_id: str,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> list[GeneratedPost]:
    try:
        return business_service.list_generated_posts(owner_id=owner_id, business_id=business_id)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)


@router.post("/{business_id}/generated-posts", response_model=GeneratedPost, status_code=status.HTTP_201_CREATED)
async def create_business_generated_post(
    business_id: str,
    request: GeneratedPostCreateRequest,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> GeneratedPost:
    try:
        return business_service.create_generated_post(owner_id=owner_id, business_id=business_id, request=request)
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)


@router.patch("/{business_id}/generated-posts/{generated_post_id}", response_model=GeneratedPost)
async def update_business_generated_post(
    business_id: str,
    generated_post_id: str,
    request: GeneratedPostUpdateRequest,
    owner_id: str = Depends(get_current_owner_id),
    business_service: BusinessDataService = Depends(get_business_data_service),
) -> GeneratedPost:
    try:
        generated_post = business_service.update_generated_post(
            owner_id=owner_id,
            business_id=business_id,
            generated_post_id=generated_post_id,
            request=request,
        )
    except (SupabaseConfigurationError, SupabaseDataError, SupabaseValidationError, BusinessNotFoundError) as exc:
        _raise_business_http_error(exc)
    if generated_post is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Generated post not found: {generated_post_id}",
        )
    return generated_post


def _raise_business_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, SupabaseConfigurationError):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if isinstance(exc, BusinessNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, SupabaseValidationError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
