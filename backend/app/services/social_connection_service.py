from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.models.business import Business
from app.models.social_connection import BusinessPublishTarget, PublishPlatform, SocialConnection, SocialTarget
from app.services.supabase_client import SupabaseConfigurationError, create_backend_supabase_client


ModelT = TypeVar("ModelT", bound=BaseModel)


class SocialConnectionDataError(RuntimeError):
    """Raised when Supabase returns invalid data or rejects a social connection operation."""


class SocialConnectionValidationError(ValueError):
    """Raised when a social connection request is invalid."""


class SocialConnectionNotFoundError(RuntimeError):
    """Raised when a requested connection, target, or mapping is not found for the owner."""


class SocialConnectionService:
    """Supabase-backed fake connection and publish-target management.

    This service only prepares connection and target metadata for Settings. It does
    not publish content and does not store or expose real provider tokens.
    """

    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            self._client = create_backend_supabase_client()
        return self._client

    def list_connections(self, owner_id: str) -> list[SocialConnection]:
        response = self._execute(
            self.client.table("social_connections")
            .select("*")
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .order("created_at", desc=True),
            "Unable to list social connections.",
        )
        return self._models_from_response(response, SocialConnection)

    def list_targets(self, owner_id: str) -> list[SocialTarget]:
        response = self._execute(
            self.client.table("social_targets")
            .select("*")
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .order("created_at", desc=True),
            "Unable to list social targets.",
        )
        return self._models_from_response(response, SocialTarget)

    def list_business_publish_targets(self, owner_id: str, business_id: str) -> list[BusinessPublishTarget]:
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        response = self._execute(
            self.client.table("business_publish_targets")
            .select("*")
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .eq("business_id", self._require_id(business_id, "business_id"))
            .order("platform"),
            "Unable to list business publish targets.",
        )
        return self._models_from_response(response, BusinessPublishTarget)

    def create_fake_meta_connection(self, owner_id: str) -> SocialConnection:
        connection = self._ensure_fake_connection(
            owner_id=owner_id,
            provider="meta",
            account_label="Fake Meta Business",
            external_account_id="fake-meta-business",
        )
        self._ensure_fake_target(
            connection=connection,
            platform="Facebook",
            target_type="facebook_page",
            display_name="Fake Facebook Page",
            external_target_id="fake-facebook-page",
        )
        self._ensure_fake_target(
            connection=connection,
            platform="Instagram",
            target_type="instagram_professional_account",
            display_name="Fake Instagram Account",
            external_target_id="fake-instagram-account",
        )
        return connection

    def create_fake_google_connection(self, owner_id: str) -> SocialConnection:
        connection = self._ensure_fake_connection(
            owner_id=owner_id,
            provider="google_business",
            account_label="Fake Google Business Profile",
            external_account_id="fake-google-business-profile",
        )
        self._ensure_fake_target(
            connection=connection,
            platform="Google Business",
            target_type="google_business_location",
            display_name="Fake Google Business Location",
            external_target_id="fake-google-business-location",
        )
        return connection

    def disconnect_connection(self, owner_id: str, connection_id: str) -> SocialConnection | None:
        response = self._execute(
            self.client.table("social_connections")
            .delete()
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .eq("id", self._require_id(connection_id, "connection_id")),
            "Unable to disconnect social connection.",
        )
        return self._optional_single_model_from_response(response, SocialConnection)

    def assign_business_target(
        self,
        owner_id: str,
        business_id: str,
        platform: str,
        social_target_id: str,
    ) -> BusinessPublishTarget:
        normalized_platform = self.normalize_platform(platform)
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        target = self._require_owned_target(owner_id=owner_id, social_target_id=social_target_id)
        if target.platform != normalized_platform:
            raise SocialConnectionValidationError(
                f"Target '{target.display_name}' is for {target.platform}, not {normalized_platform}."
            )

        existing = self._get_business_publish_target(
            owner_id=owner_id,
            business_id=business_id,
            platform=normalized_platform,
        )
        payload = {
            "owner_id": self._require_id(owner_id, "owner_id"),
            "business_id": self._require_id(business_id, "business_id"),
            "platform": normalized_platform,
            "social_target_id": self._require_id(social_target_id, "social_target_id"),
        }
        if existing is not None:
            response = self._execute(
                self.client.table("business_publish_targets")
                .update(payload)
                .eq("owner_id", owner_id)
                .eq("id", existing.id),
                "Unable to update business publish target.",
            )
        else:
            response = self._execute(
                self.client.table("business_publish_targets").insert(payload),
                "Unable to assign business publish target.",
            )
        return self._single_model_from_response(
            response,
            BusinessPublishTarget,
            "Unable to assign business publish target.",
        )

    def unassign_business_target(
        self,
        owner_id: str,
        business_id: str,
        platform: str,
    ) -> BusinessPublishTarget | None:
        normalized_platform = self.normalize_platform(platform)
        self._require_owned_business(owner_id=owner_id, business_id=business_id)
        response = self._execute(
            self.client.table("business_publish_targets")
            .delete()
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .eq("business_id", self._require_id(business_id, "business_id"))
            .eq("platform", normalized_platform),
            "Unable to unassign business publish target.",
        )
        return self._optional_single_model_from_response(response, BusinessPublishTarget)

    @staticmethod
    def normalize_platform(platform: str) -> PublishPlatform:
        normalized = " ".join(platform.strip().replace("_", " ").replace("-", " ").split()).lower()
        if normalized in {"facebook groups", "facebook group", "groups"}:
            raise SocialConnectionValidationError("Facebook Groups are manual-only and cannot be assigned a publish target.")
        if normalized in {"facebook", "facebook page"}:
            return "Facebook"
        if normalized == "instagram":
            return "Instagram"
        if normalized in {"google business", "google business profile", "gbp"}:
            return "Google Business"
        raise SocialConnectionValidationError(f"Unsupported publish platform: {platform}")

    def _ensure_fake_connection(
        self,
        owner_id: str,
        provider: str,
        account_label: str,
        external_account_id: str,
    ) -> SocialConnection:
        existing = self._get_fake_connection(
            owner_id=owner_id,
            provider=provider,
            external_account_id=external_account_id,
        )
        payload = {
            "owner_id": self._require_id(owner_id, "owner_id"),
            "provider": provider,
            "account_label": account_label,
            "external_account_id": external_account_id,
            "connection_kind": "fake",
            "status": "connected",
            "token_metadata": {},
        }
        if existing is not None:
            response = self._execute(
                self.client.table("social_connections")
                .update(payload)
                .eq("owner_id", owner_id)
                .eq("id", existing.id),
                "Unable to refresh fake social connection.",
            )
        else:
            response = self._execute(
                self.client.table("social_connections").insert(payload),
                "Unable to create fake social connection.",
            )
        return self._single_model_from_response(response, SocialConnection, "Unable to create fake social connection.")

    def _ensure_fake_target(
        self,
        connection: SocialConnection,
        platform: PublishPlatform,
        target_type: str,
        display_name: str,
        external_target_id: str,
    ) -> SocialTarget:
        existing = self._get_fake_target(
            owner_id=connection.owner_id,
            connection_id=connection.id,
            platform=platform,
            external_target_id=external_target_id,
        )
        payload = {
            "owner_id": connection.owner_id,
            "connection_id": connection.id,
            "provider": connection.provider,
            "platform": platform,
            "target_type": target_type,
            "display_name": display_name,
            "external_target_id": external_target_id,
            "metadata": {"fake": True},
        }
        if existing is not None:
            response = self._execute(
                self.client.table("social_targets")
                .update(payload)
                .eq("owner_id", connection.owner_id)
                .eq("id", existing.id),
                "Unable to refresh fake social target.",
            )
        else:
            response = self._execute(
                self.client.table("social_targets").insert(payload),
                "Unable to create fake social target.",
            )
        return self._single_model_from_response(response, SocialTarget, "Unable to create fake social target.")

    def _get_fake_connection(
        self,
        owner_id: str,
        provider: str,
        external_account_id: str,
    ) -> SocialConnection | None:
        response = self._execute(
            self.client.table("social_connections")
            .select("*")
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .eq("provider", provider)
            .eq("external_account_id", external_account_id)
            .limit(1),
            "Unable to get fake social connection.",
        )
        return self._optional_single_model_from_response(response, SocialConnection)

    def _get_fake_target(
        self,
        owner_id: str,
        connection_id: str,
        platform: PublishPlatform,
        external_target_id: str,
    ) -> SocialTarget | None:
        response = self._execute(
            self.client.table("social_targets")
            .select("*")
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .eq("connection_id", self._require_id(connection_id, "connection_id"))
            .eq("platform", platform)
            .eq("external_target_id", external_target_id)
            .limit(1),
            "Unable to get fake social target.",
        )
        return self._optional_single_model_from_response(response, SocialTarget)

    def _get_business_publish_target(
        self,
        owner_id: str,
        business_id: str,
        platform: PublishPlatform,
    ) -> BusinessPublishTarget | None:
        response = self._execute(
            self.client.table("business_publish_targets")
            .select("*")
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .eq("business_id", self._require_id(business_id, "business_id"))
            .eq("platform", platform)
            .limit(1),
            "Unable to get business publish target.",
        )
        return self._optional_single_model_from_response(response, BusinessPublishTarget)

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
            raise SocialConnectionNotFoundError(f"Business not found: {business_id}")
        return business

    def _require_owned_target(self, owner_id: str, social_target_id: str) -> SocialTarget:
        response = self._execute(
            self.client.table("social_targets")
            .select("*")
            .eq("owner_id", self._require_id(owner_id, "owner_id"))
            .eq("id", self._require_id(social_target_id, "social_target_id"))
            .limit(1),
            "Unable to verify social target ownership.",
        )
        target = self._optional_single_model_from_response(response, SocialTarget)
        if target is None:
            raise SocialConnectionNotFoundError(f"Social target not found: {social_target_id}")
        return target

    @staticmethod
    def _execute(query: Any, message: str) -> Any:
        try:
            return query.execute()
        except (SupabaseConfigurationError, SocialConnectionValidationError, SocialConnectionNotFoundError):
            raise
        except Exception as exc:
            detail = SocialConnectionService._format_supabase_exception(exc)
            raise SocialConnectionDataError(f"{message} {detail}" if detail else message) from exc

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
            raise SocialConnectionDataError("Supabase response data must be a list.")
        try:
            return [model_type.model_validate(row) for row in data]
        except ValidationError as exc:
            raise SocialConnectionDataError("Supabase returned invalid social connection data.") from exc

    @classmethod
    def _optional_single_model_from_response(cls, response: Any, model_type: type[ModelT]) -> ModelT | None:
        models = cls._models_from_response(response, model_type)
        return models[0] if models else None

    @classmethod
    def _single_model_from_response(cls, response: Any, model_type: type[ModelT], message: str) -> ModelT:
        model = cls._optional_single_model_from_response(response, model_type)
        if model is None:
            raise SocialConnectionDataError(message)
        return model

    @staticmethod
    def _require_id(value: str, field_name: str) -> str:
        normalized_value = value.strip() if value else ""
        if not normalized_value:
            raise SocialConnectionValidationError(f"{field_name} is required.")
        return normalized_value


__all__ = [
    "SocialConnectionDataError",
    "SocialConnectionNotFoundError",
    "SocialConnectionService",
    "SocialConnectionValidationError",
]
