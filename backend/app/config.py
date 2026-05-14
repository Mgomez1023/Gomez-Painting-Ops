from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Gomez Ops"
    environment: str = "local"
    llm_provider: str = "placeholder"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    publisher_mode: str = "mock"
    google_sheets_spreadsheet_id: str | None = None
    google_service_account_file: str | None = None
    google_service_account_json: str | None = None
    google_completed_jobs_sheet_name: str = "Completed Jobs"
    google_content_queue_sheet_name: str = "Content Queue"
    google_campaigns_sheet_name: str = "Campaigns"
    google_campaign_content_queue_sheet_name: str = "Campaign Content Queue"
    google_posts_sheet_name: str = "Posts"
    google_business_client_id: str | None = None
    google_business_client_secret: str | None = None
    google_business_refresh_token: str | None = None
    google_business_account_id: str | None = None
    google_business_location_id: str | None = None
    google_business_redirect_uri: str | None = None
    google_business_api_base: str = "https://mybusiness.googleapis.com/v4"
    meta_graph_api_version: str = "v21.0"
    meta_app_id: str | None = None
    meta_app_secret: str | None = None
    facebook_page_id: str | None = None
    facebook_page_access_token: str | None = None
    instagram_business_account_id: str | None = None
    public_site_base_url: str | None = None
    api_public_base_url: str | None = None
    default_business_id: str = "marom-painting"
    photo_assets_data_file: str | None = None
    photo_assets_media_dir: str | None = None
    supabase_enabled: bool = False
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_service_role_key: str | None = None
    dev_owner_user_id: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
