from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from app.services.social_connection_service import SocialConnectionService, SocialConnectionValidationError


OWNER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222"
BUSINESS_ID = "33333333-3333-4333-8333-333333333333"
SECOND_BUSINESS_ID = "44444444-4444-4444-8444-444444444444"
OTHER_BUSINESS_ID = "55555555-5555-4555-8555-555555555555"
NOW = "2026-06-18T00:00:00Z"


@dataclass
class FakeResponse:
    data: Any


class FakeSupabaseClient:
    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self.tables = tables

    def table(self, table_name: str) -> "FakeQuery":
        return FakeQuery(client=self, table_name=table_name)


class FakeQuery:
    def __init__(self, client: FakeSupabaseClient, table_name: str) -> None:
        self.client = client
        self.table_name = table_name
        self.operation = "select"
        self.payload: dict[str, Any] | None = None
        self.filters: list[tuple[str, Any]] = []
        self.order_field: str | None = None
        self.order_desc = False
        self.limit_count: int | None = None

    def select(self, _: str) -> "FakeQuery":
        self.operation = "select"
        return self

    def insert(self, payload: dict[str, Any]) -> "FakeQuery":
        self.operation = "insert"
        self.payload = dict(payload)
        return self

    def update(self, payload: dict[str, Any]) -> "FakeQuery":
        self.operation = "update"
        self.payload = dict(payload)
        return self

    def delete(self) -> "FakeQuery":
        self.operation = "delete"
        return self

    def eq(self, field: str, value: Any) -> "FakeQuery":
        self.filters.append((field, value))
        return self

    def order(self, field: str, desc: bool = False) -> "FakeQuery":
        self.order_field = field
        self.order_desc = desc
        return self

    def limit(self, count: int) -> "FakeQuery":
        self.limit_count = count
        return self

    def execute(self) -> FakeResponse:
        rows = self.client.tables.setdefault(self.table_name, [])
        if self.operation == "insert":
            row = self._with_defaults(self.payload or {})
            rows.append(row)
            return FakeResponse([dict(row)])
        if self.operation == "update":
            updated_rows = []
            for row in rows:
                if self._matches(row):
                    row.update(self.payload or {})
                    row["updated_at"] = NOW
                    updated_rows.append(dict(row))
            return FakeResponse(updated_rows)
        if self.operation == "delete":
            deleted_rows = [dict(row) for row in rows if self._matches(row)]
            self.client.tables[self.table_name] = [row for row in rows if not self._matches(row)]
            return FakeResponse(deleted_rows)

        selected_rows = [dict(row) for row in rows if self._matches(row)]
        if self.order_field:
            selected_rows.sort(key=lambda row: row.get(self.order_field) or "", reverse=self.order_desc)
        if self.limit_count is not None:
            selected_rows = selected_rows[: self.limit_count]
        return FakeResponse(selected_rows)

    def _matches(self, row: dict[str, Any]) -> bool:
        return all(row.get(field) == value for field, value in self.filters)

    def _with_defaults(self, payload: dict[str, Any]) -> dict[str, Any]:
        row = dict(payload)
        row.setdefault("id", f"{self.table_name}-{len(self.client.tables.setdefault(self.table_name, [])) + 1}")
        row.setdefault("created_at", NOW)
        row.setdefault("updated_at", NOW)
        return row


def test_fake_connections_create_expected_targets_without_facebook_groups() -> None:
    service = SocialConnectionService(client=_fake_client())

    meta_connection = service.create_fake_meta_connection(OWNER_ID)
    google_connection = service.create_fake_google_connection(OWNER_ID)
    targets = service.list_targets(OWNER_ID)

    assert meta_connection.provider == "meta"
    assert google_connection.provider == "google_business"
    assert {target.display_name for target in targets} == {
        "Fake Facebook Page",
        "Fake Instagram Account",
        "Fake Google Business Location",
    }
    assert "Facebook Groups" not in {target.platform for target in targets}


def test_business_target_assignments_are_scoped_per_business() -> None:
    service = SocialConnectionService(client=_fake_client())
    service.create_fake_meta_connection(OWNER_ID)
    facebook_target = next(target for target in service.list_targets(OWNER_ID) if target.platform == "Facebook")

    first_mapping = service.assign_business_target(OWNER_ID, BUSINESS_ID, "Facebook", facebook_target.id)
    second_mapping = service.assign_business_target(OWNER_ID, SECOND_BUSINESS_ID, "Facebook", facebook_target.id)

    assert first_mapping.business_id == BUSINESS_ID
    assert second_mapping.business_id == SECOND_BUSINESS_ID
    assert service.list_business_publish_targets(OWNER_ID, BUSINESS_ID)[0].social_target_id == facebook_target.id
    assert service.list_business_publish_targets(OWNER_ID, SECOND_BUSINESS_ID)[0].social_target_id == facebook_target.id

    removed = service.unassign_business_target(OWNER_ID, BUSINESS_ID, "Facebook")

    assert removed is not None
    assert service.list_business_publish_targets(OWNER_ID, BUSINESS_ID) == []
    assert len(service.list_business_publish_targets(OWNER_ID, SECOND_BUSINESS_ID)) == 1


def test_facebook_groups_cannot_be_assigned_as_publish_target() -> None:
    service = SocialConnectionService(client=_fake_client())

    with pytest.raises(SocialConnectionValidationError, match="manual-only"):
        service.assign_business_target(OWNER_ID, BUSINESS_ID, "Facebook Groups", "target-id")


def _fake_client() -> FakeSupabaseClient:
    return FakeSupabaseClient(
        tables={
            "businesses": [
                _business(BUSINESS_ID, OWNER_ID, "Gomez Painting"),
                _business(SECOND_BUSINESS_ID, OWNER_ID, "Gomez Painting North"),
                _business(OTHER_BUSINESS_ID, OTHER_OWNER_ID, "Other Painting"),
            ],
            "social_connections": [],
            "social_targets": [],
            "business_publish_targets": [],
        }
    )


def _business(business_id: str, owner_id: str, name: str) -> dict[str, Any]:
    return {
        "id": business_id,
        "owner_id": owner_id,
        "name": name,
        "industry": "Painting",
        "location": "Chicago, IL",
        "website_url": "https://example.com",
        "phone": "555-0100",
        "email": "hello@example.com",
        "created_at": NOW,
        "updated_at": NOW,
    }
