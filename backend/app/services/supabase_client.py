from __future__ import annotations

from typing import Any

from app.config import Settings, settings


class SupabaseConfigurationError(RuntimeError):
    """Raised when Supabase is disabled, unavailable, or missing credentials."""


def create_backend_supabase_client(app_settings: Settings = settings) -> Any:
    """Create a backend-only Supabase client.

    This uses SUPABASE_SERVICE_ROLE_KEY so the trusted FastAPI backend can perform
    business-scoped operations. Never expose this client or key to frontend code.
    """

    if not app_settings.supabase_enabled:
        raise SupabaseConfigurationError(
            "Supabase is disabled. Set SUPABASE_ENABLED=true and configure backend Supabase credentials."
        )
    if not app_settings.supabase_url:
        raise SupabaseConfigurationError("SUPABASE_URL is required when SUPABASE_ENABLED=true.")
    if not app_settings.supabase_service_role_key:
        raise SupabaseConfigurationError("SUPABASE_SERVICE_ROLE_KEY is required for backend Supabase operations.")

    try:
        from supabase import create_client
    except ModuleNotFoundError as exc:
        raise SupabaseConfigurationError(
            "The supabase Python package is not installed. Install backend requirements before enabling Supabase."
        ) from exc

    try:
        return create_client(app_settings.supabase_url, app_settings.supabase_service_role_key)
    except Exception as exc:  # pragma: no cover - depends on third-party client internals
        raise SupabaseConfigurationError("Unable to create Supabase backend client.") from exc
