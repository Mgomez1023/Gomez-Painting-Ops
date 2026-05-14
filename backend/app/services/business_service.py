from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

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
from app.services.supabase_client import SupabaseConfigurationError, create_backend_supabase_client


ModelT = TypeVar("ModelT", bound=BaseModel)


class SupabaseDataError(RuntimeError):
    """Raised when Supabase returns invalid data or rejects a data operation."""


class SupabaseValidationError(ValueError):
    """Raised when a business-scoped service request is invalid."""


class BusinessNotFoundError(RuntimeError):
    """Raised when the requested business is missing or not owned by the caller."""


class BusinessDataService:
    """Supabase-backed business persistence.

    The backend uses a service role key, which can bypass Supabase RLS. Every method
    therefore receives owner_id and filters or verifies ownership before reading or
    mutating business-scoped rows.
    """

    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            self._client = create_backend_supabase_client()
        return self._client

    def list_businesses(self, owner_id: str) -> list[Business]:
        response = self._execute(
            self.client.table("businesses")
            .select("*")
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .order("created_at", desc=True),
            "Unable to list businesses.",
        )
        return self._models_from_response(response, Business)

    def create_business(self, owner_id: str, request: BusinessCreateRequest) -> Business:
        payload = request.model_dump(mode="json", exclude_none=True)
        payload["owner_id"] = self._require_id(owner_id, "owner_id")
        response = self._execute(
            self.client.table("businesses").insert(payload),
            "Unable to create business.",
        )
        return self._single_model_from_response(response, Business, "Unable to create business.")

    def update_business(self, owner_id: str, business_id: str, request: BusinessUpdateRequest) -> Business | None:
        payload = request.model_dump(mode="json", exclude_unset=True)
        if not payload:
            raise SupabaseValidationError("At least one business field must be provided.")
        response = self._execute(
            self.client.table("businesses")
            .update(payload)
            .eq("id", self._require_id(business_id, "business_id"))
            .eq("owner_id", self._require_id(owner_id, "owner_id")),
            "Unable to update business.",
        )
        return self._optional_single_model_from_response(response, Business)

    def get_business_context(self, owner_id: str, business_id: str) -> BusinessContext | None:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        response = self._execute(
            self.client.table("business_context")
            .select("*")
            .eq("business_id", self._require_id(business_id, "business_id"))
            .limit(1),
            "Unable to get business context.",
        )
        return self._optional_single_model_from_response(response, BusinessContext)

    def upsert_business_context(
        self,
        owner_id: str,
        business_id: str,
        request: BusinessContextUpsertRequest,
    ) -> BusinessContext:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        payload = request.model_dump(mode="json", exclude_none=True)
        payload["business_id"] = self._require_id(business_id, "business_id")
        response = self._execute(
            self.client.table("business_context").upsert(payload, on_conflict="business_id"),
            "Unable to upsert business context.",
        )
        return self._single_model_from_response(response, BusinessContext, "Unable to upsert business context.")

    def list_photo_assets(self, owner_id: str, business_id: str) -> list[PhotoAsset]:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        response = self._execute(
            self.client.table("photo_assets")
            .select("*")
            .eq("business_id", self._require_id(business_id, "business_id"))
            .order("created_at", desc=True),
            "Unable to list photo assets.",
        )
        return self._models_from_response(response, PhotoAsset)

    def create_photo_asset(self, owner_id: str, business_id: str, request: PhotoAssetCreateRequest) -> PhotoAsset:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        payload = request.model_dump(mode="json", exclude_none=True)
        payload["business_id"] = self._require_id(business_id, "business_id")
        response = self._execute(
            self.client.table("photo_assets").insert(payload),
            "Unable to create photo asset.",
        )
        return self._single_model_from_response(response, PhotoAsset, "Unable to create photo asset.")

    def delete_photo_asset(self, owner_id: str, business_id: str, photo_asset_id: str) -> PhotoAsset | None:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        response = self._execute(
            self.client.table("photo_assets")
            .delete()
            .eq("id", self._require_id(photo_asset_id, "photo_asset_id"))
            .eq("business_id", self._require_id(business_id, "business_id")),
            "Unable to delete photo asset.",
        )
        return self._optional_single_model_from_response(response, PhotoAsset)

    def list_generated_posts(self, owner_id: str, business_id: str) -> list[GeneratedPost]:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        response = self._execute(
            self.client.table("generated_posts")
            .select("*")
            .eq("business_id", self._require_id(business_id, "business_id"))
            .order("created_at", desc=True),
            "Unable to list generated posts.",
        )
        return self._models_from_response(response, GeneratedPost)

    def create_generated_post(
        self,
        owner_id: str,
        business_id: str,
        request: GeneratedPostCreateRequest,
    ) -> GeneratedPost:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        payload = request.model_dump(mode="json", exclude_none=True)
        payload["business_id"] = self._require_id(business_id, "business_id")
        response = self._execute(
            self.client.table("generated_posts").insert(payload),
            "Unable to create generated post.",
        )
        return self._single_model_from_response(response, GeneratedPost, "Unable to create generated post.")

    def update_generated_post(
        self,
        owner_id: str,
        business_id: str,
        generated_post_id: str,
        request: GeneratedPostUpdateRequest,
    ) -> GeneratedPost | None:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        payload = request.model_dump(mode="json", exclude_unset=True)
        if not payload:
            raise SupabaseValidationError("At least one generated post field must be provided.")
        response = self._execute(
            self.client.table("generated_posts")
            .update(payload)
            .eq("id", self._require_id(generated_post_id, "generated_post_id"))
            .eq("business_id", self._require_id(business_id, "business_id")),
            "Unable to update generated post.",
        )
        return self._optional_single_model_from_response(response, GeneratedPost)

    def _require_owned_business(self, owner_id: str, business_id: str) -> Business:
        response = self._execute(
            self.client.table("businesses")
            .select("*")
            .eq("id", self._require_id(business_id, "business_id"))
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .limit(1),
            "Unable to verify business ownership.",
        )
        business = self._optional_single_model_from_response(response, Business)
        if business is None:
            raise BusinessNotFoundError(f"Business not found: {business_id}")
        return business

    @staticmethod
    def _execute(query: Any, message: str) -> Any:
        try:
            return query.execute()
        except (SupabaseConfigurationError, SupabaseValidationError, BusinessNotFoundError):
            raise
        except Exception as exc:
            detail = BusinessDataService._format_supabase_exception(exc)
            raise SupabaseDataError(f"{message} {detail}" if detail else message) from exc

    @staticmethod
    def _format_supabase_exception(exc: Exception) -> str:
        code = getattr(exc, "code", None)
        error_message = getattr(exc, "message", None)
        details = getattr(exc, "details", None)
        hint = getattr(exc, "hint", None)

        if not any([code, error_message, details, hint]):
            raw_message = str(exc).strip()
            if raw_message.startswith("{") and raw_message.endswith("}"):
                return raw_message
            return raw_message[:300]

        parts = [
            f"Supabase code: {code}." if code else "",
            str(error_message).strip() if error_message else "",
            f"Details: {details}" if details else "",
            f"Hint: {hint}" if hint else "",
        ]
        return " ".join(part for part in parts if part).strip()

    @staticmethod
    def _response_data(response: Any) -> Any:
        return getattr(response, "data", None)

    @classmethod
    def _models_from_response(cls, response: Any, model_type: type[ModelT]) -> list[ModelT]:
        data = cls._response_data(response)
        if data is None:
            return []
        if not isinstance(data, list):
            raise SupabaseDataError("Supabase response data must be a list.")
        try:
            return [model_type.model_validate(row) for row in data]
        except ValidationError as exc:
            raise SupabaseDataError("Supabase returned invalid business data.") from exc

    @classmethod
    def _optional_single_model_from_response(cls, response: Any, model_type: type[ModelT]) -> ModelT | None:
        models = cls._models_from_response(response, model_type)
        return models[0] if models else None

    @classmethod
    def _single_model_from_response(cls, response: Any, model_type: type[ModelT], message: str) -> ModelT:
        model = cls._optional_single_model_from_response(response, model_type)
        if model is None:
            raise SupabaseDataError(message)
        return model

    @staticmethod
    def _require_id(value: str, field_name: str) -> str:
        normalized_value = value.strip() if value else ""
        if not normalized_value:
            raise SupabaseValidationError(f"{field_name} is required.")
        return normalized_value


__all__ = [
    "BusinessDataService",
    "BusinessNotFoundError",
    "SupabaseConfigurationError",
    "SupabaseDataError",
    "SupabaseValidationError",
]
