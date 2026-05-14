from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from app.config import Settings
from app.models.business import GeneratedPostCreateRequest
from app.services.business_service import BusinessDataService, BusinessNotFoundError
from app.services.supabase_client import SupabaseConfigurationError, create_backend_supabase_client


OWNER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222"
BUSINESS_ID = "33333333-3333-4333-8333-333333333333"
OTHER_BUSINESS_ID = "44444444-4444-4444-8444-444444444444"
POST_ID = "55555555-5555-4555-8555-555555555555"
NOW = "2026-05-14T00:00:00Z"


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
        self.conflict_field: str | None = None

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

    def upsert(self, payload: dict[str, Any], on_conflict: str) -> "FakeQuery":
        self.operation = "upsert"
        self.payload = dict(payload)
        self.conflict_field = on_conflict
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
        if self.operation == "upsert":
            row = self._with_defaults(self.payload or {})
            conflict_field = self.conflict_field or "id"
            existing_row = next((item for item in rows if item.get(conflict_field) == row.get(conflict_field)), None)
            if existing_row:
                existing_row.update(row)
                existing_row["updated_at"] = NOW
                return FakeResponse([dict(existing_row)])
            rows.append(row)
            return FakeResponse([dict(row)])
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
        row.setdefault("id", f"{self.table_name}-generated-id")
        row.setdefault("created_at", NOW)
        row.setdefault("updated_at", NOW)
        return row


def test_create_backend_supabase_client_fails_when_disabled() -> None:
    app_settings = Settings(supabase_enabled=False)

    with pytest.raises(SupabaseConfigurationError, match="Supabase is disabled"):
        create_backend_supabase_client(app_settings)


def test_business_service_lists_only_owned_businesses() -> None:
    service = BusinessDataService(client=_fake_client())

    businesses = service.list_businesses(owner_id=OWNER_ID)

    assert [business.id for business in businesses] == [BUSINESS_ID]


def test_business_scoped_reads_require_owned_business() -> None:
    service = BusinessDataService(client=_fake_client())

    with pytest.raises(BusinessNotFoundError):
        service.list_photo_assets(owner_id=OWNER_ID, business_id=OTHER_BUSINESS_ID)


def test_create_generated_post_inserts_business_id_after_ownership_check() -> None:
    client = _fake_client()
    service = BusinessDataService(client=client)

    generated_post = service.create_generated_post(
        owner_id=OWNER_ID,
        business_id=BUSINESS_ID,
        request=GeneratedPostCreateRequest(
            tool_type="weekly-social",
            platform="Facebook",
            title="Fresh paint",
            content="A finished interior repaint draft.",
            metadata={"source": "test"},
        ),
    )

    assert generated_post.business_id == BUSINESS_ID
    assert client.tables["generated_posts"][0]["business_id"] == BUSINESS_ID
    assert client.tables["generated_posts"][0]["metadata"] == {"source": "test"}


def _fake_client() -> FakeSupabaseClient:
    return FakeSupabaseClient(
        tables={
            "businesses": [
                {
                    "id": BUSINESS_ID,
                    "owner_id": OWNER_ID,
                    "name": "Gomez Painting",
                    "industry": "Painting",
                    "location": "Chicago, IL",
                    "website_url": "https://example.com",
                    "phone": "555-0100",
                    "email": "hello@example.com",
                    "created_at": NOW,
                    "updated_at": NOW,
                },
                {
                    "id": OTHER_BUSINESS_ID,
                    "owner_id": OTHER_OWNER_ID,
                    "name": "Other Painting",
                    "created_at": NOW,
                    "updated_at": NOW,
                },
            ],
            "business_context": [],
            "photo_assets": [],
            "generated_posts": [],
        }
    )
