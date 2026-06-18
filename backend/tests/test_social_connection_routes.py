from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_owner_id, get_social_connection_service
from app.main import app
from app.models.social_connection import BusinessPublishTarget, SocialConnection, SocialTarget


OWNER_ID = "11111111-1111-4111-8111-111111111111"
BUSINESS_ID = "33333333-3333-4333-8333-333333333333"
CONNECTION_ID = "44444444-4444-4444-8444-444444444444"
TARGET_ID = "55555555-5555-4555-8555-555555555555"
MAPPING_ID = "66666666-6666-4666-8666-666666666666"
NOW = "2026-06-18T00:00:00Z"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeSocialConnectionService:
    def __init__(self) -> None:
        self.owner_ids: list[str] = []
        self.business_ids: list[str] = []
        self.platforms: list[str] = []

    def list_connections(self, owner_id: str) -> list[SocialConnection]:
        self.owner_ids.append(owner_id)
        return [_connection()]

    def list_targets(self, owner_id: str) -> list[SocialTarget]:
        self.owner_ids.append(owner_id)
        return [_target()]

    def list_business_publish_targets(self, owner_id: str, business_id: str) -> list[BusinessPublishTarget]:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        return [_mapping()]

    def create_fake_meta_connection(self, owner_id: str) -> SocialConnection:
        self.owner_ids.append(owner_id)
        return _connection(provider="meta", account_label="Fake Meta Business")

    def create_fake_google_connection(self, owner_id: str) -> SocialConnection:
        self.owner_ids.append(owner_id)
        return _connection(provider="google_business", account_label="Fake Google Business Profile")

    def disconnect_connection(self, owner_id: str, connection_id: str) -> SocialConnection:
        self.owner_ids.append(owner_id)
        return _connection(connection_id=connection_id)

    def assign_business_target(
        self,
        owner_id: str,
        business_id: str,
        platform: str,
        social_target_id: str,
    ) -> BusinessPublishTarget:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        self.platforms.append(platform)
        return _mapping(platform=platform, social_target_id=social_target_id)

    def unassign_business_target(self, owner_id: str, business_id: str, platform: str) -> BusinessPublishTarget:
        self.owner_ids.append(owner_id)
        self.business_ids.append(business_id)
        self.platforms.append(platform)
        return _mapping(platform=platform)


@pytest.mark.anyio
async def test_social_connection_routes_use_owner_and_business_scoped_paths() -> None:
    fake_service = FakeSocialConnectionService()

    async def override_owner_id() -> str:
        return OWNER_ID

    async def override_social_connection_service() -> FakeSocialConnectionService:
        return fake_service

    app.dependency_overrides[get_current_owner_id] = override_owner_id
    app.dependency_overrides[get_social_connection_service] = override_social_connection_service
    transport = ASGITransport(app=app)

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            connections_response = await client.get("/social-connections")
            targets_response = await client.get("/social-targets")
            mappings_response = await client.get(f"/businesses/{BUSINESS_ID}/publish-targets")
            fake_meta_response = await client.post("/social-connections/fake-meta")
            fake_google_response = await client.post("/social-connections/fake-google")
            assign_response = await client.put(
                f"/businesses/{BUSINESS_ID}/publish-targets/Facebook",
                json={"social_target_id": TARGET_ID},
            )
            unassign_response = await client.delete(f"/businesses/{BUSINESS_ID}/publish-targets/Facebook")
            disconnect_response = await client.delete(f"/social-connections/{CONNECTION_ID}")
    finally:
        app.dependency_overrides.clear()

    assert connections_response.status_code == 200
    assert targets_response.status_code == 200
    assert mappings_response.status_code == 200
    assert fake_meta_response.status_code == 201
    assert fake_google_response.status_code == 201
    assert assign_response.status_code == 200
    assert unassign_response.status_code == 200
    assert disconnect_response.status_code == 200
    assert set(fake_service.owner_ids) == {OWNER_ID}
    assert fake_service.business_ids == [BUSINESS_ID, BUSINESS_ID, BUSINESS_ID]
    assert fake_service.platforms == ["Facebook", "Facebook"]


def _connection(
    connection_id: str = CONNECTION_ID,
    provider: str = "meta",
    account_label: str = "Fake Meta Business",
) -> SocialConnection:
    return SocialConnection(
        id=connection_id,
        owner_id=OWNER_ID,
        provider=provider,  # type: ignore[arg-type]
        account_label=account_label,
        external_account_id="fake-account",
        connection_kind="fake",
        status="connected",
        created_at=NOW,
        updated_at=NOW,
    )


def _target() -> SocialTarget:
    return SocialTarget(
        id=TARGET_ID,
        owner_id=OWNER_ID,
        connection_id=CONNECTION_ID,
        provider="meta",
        platform="Facebook",
        target_type="facebook_page",
        display_name="Fake Facebook Page",
        external_target_id="fake-facebook-page",
        metadata={"fake": True},
        created_at=NOW,
        updated_at=NOW,
    )


def _mapping(platform: str = "Facebook", social_target_id: str = TARGET_ID) -> BusinessPublishTarget:
    return BusinessPublishTarget(
        id=MAPPING_ID,
        owner_id=OWNER_ID,
        business_id=BUSINESS_ID,
        platform=platform,  # type: ignore[arg-type]
        social_target_id=social_target_id,
        created_at=NOW,
        updated_at=NOW,
    )
