from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_current_owner_id, get_social_connection_service
from app.models.social_connection import AssignBusinessPublishTargetRequest, BusinessPublishTarget, SocialConnection, SocialTarget
from app.services.social_connection_service import (
    SocialConnectionDataError,
    SocialConnectionNotFoundError,
    SocialConnectionService,
    SocialConnectionValidationError,
)
from app.services.supabase_client import SupabaseConfigurationError


router = APIRouter(tags=["social-connections"])


@router.get("/social-connections", response_model=list[SocialConnection])
async def list_connections(
    owner_id: str = Depends(get_current_owner_id),
    social_connection_service: SocialConnectionService = Depends(get_social_connection_service),
) -> list[SocialConnection]:
    try:
        return social_connection_service.list_connections(owner_id=owner_id)
    except SocialConnectionErrors as exc:
        _raise_social_connection_http_error(exc)


@router.get("/social-targets", response_model=list[SocialTarget])
async def list_targets(
    owner_id: str = Depends(get_current_owner_id),
    social_connection_service: SocialConnectionService = Depends(get_social_connection_service),
) -> list[SocialTarget]:
    try:
        return social_connection_service.list_targets(owner_id=owner_id)
    except SocialConnectionErrors as exc:
        _raise_social_connection_http_error(exc)


@router.get("/businesses/{business_id}/publish-targets", response_model=list[BusinessPublishTarget])
async def list_business_publish_targets(
    business_id: str,
    owner_id: str = Depends(get_current_owner_id),
    social_connection_service: SocialConnectionService = Depends(get_social_connection_service),
) -> list[BusinessPublishTarget]:
    try:
        return social_connection_service.list_business_publish_targets(owner_id=owner_id, business_id=business_id)
    except SocialConnectionErrors as exc:
        _raise_social_connection_http_error(exc)


@router.post("/social-connections/fake-meta", response_model=SocialConnection, status_code=status.HTTP_201_CREATED)
async def create_fake_meta_connection(
    owner_id: str = Depends(get_current_owner_id),
    social_connection_service: SocialConnectionService = Depends(get_social_connection_service),
) -> SocialConnection:
    try:
        return social_connection_service.create_fake_meta_connection(owner_id=owner_id)
    except SocialConnectionErrors as exc:
        _raise_social_connection_http_error(exc)


@router.post("/social-connections/fake-google", response_model=SocialConnection, status_code=status.HTTP_201_CREATED)
async def create_fake_google_connection(
    owner_id: str = Depends(get_current_owner_id),
    social_connection_service: SocialConnectionService = Depends(get_social_connection_service),
) -> SocialConnection:
    try:
        return social_connection_service.create_fake_google_connection(owner_id=owner_id)
    except SocialConnectionErrors as exc:
        _raise_social_connection_http_error(exc)


@router.delete("/social-connections/{connection_id}", response_model=SocialConnection)
async def disconnect_connection(
    connection_id: str,
    owner_id: str = Depends(get_current_owner_id),
    social_connection_service: SocialConnectionService = Depends(get_social_connection_service),
) -> SocialConnection:
    try:
        connection = social_connection_service.disconnect_connection(owner_id=owner_id, connection_id=connection_id)
    except SocialConnectionErrors as exc:
        _raise_social_connection_http_error(exc)
    if connection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Social connection not found: {connection_id}")
    return connection


@router.put("/businesses/{business_id}/publish-targets/{platform}", response_model=BusinessPublishTarget)
async def assign_business_publish_target(
    business_id: str,
    platform: str,
    request: AssignBusinessPublishTargetRequest,
    owner_id: str = Depends(get_current_owner_id),
    social_connection_service: SocialConnectionService = Depends(get_social_connection_service),
) -> BusinessPublishTarget:
    try:
        return social_connection_service.assign_business_target(
            owner_id=owner_id,
            business_id=business_id,
            platform=platform,
            social_target_id=request.social_target_id,
        )
    except SocialConnectionErrors as exc:
        _raise_social_connection_http_error(exc)


@router.delete("/businesses/{business_id}/publish-targets/{platform}", response_model=BusinessPublishTarget)
async def unassign_business_publish_target(
    business_id: str,
    platform: str,
    owner_id: str = Depends(get_current_owner_id),
    social_connection_service: SocialConnectionService = Depends(get_social_connection_service),
) -> BusinessPublishTarget:
    try:
        business_publish_target = social_connection_service.unassign_business_target(
            owner_id=owner_id,
            business_id=business_id,
            platform=platform,
        )
    except SocialConnectionErrors as exc:
        _raise_social_connection_http_error(exc)
    if business_publish_target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Publish target mapping not found for {platform}.",
        )
    return business_publish_target


SocialConnectionErrors = (
    SupabaseConfigurationError,
    SocialConnectionDataError,
    SocialConnectionNotFoundError,
    SocialConnectionValidationError,
)


def _raise_social_connection_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, SupabaseConfigurationError):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if isinstance(exc, SocialConnectionNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, SocialConnectionValidationError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
