from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes_campaign_content_queue import router as campaign_content_queue_router
from app.api.routes_campaigns import router as campaigns_router
from app.api.routes_content import router as content_router
from app.api.routes_content_queue import router as content_queue_router
from app.api.routes_health import router as health_router
from app.api.routes_jobs import router as jobs_router
from app.api.routes_photo_assets import router as photo_assets_router
from app.api.routes_publisher import router as publisher_router
from app.api.routes_posts import router as posts_router
from app.api.routes_visibility import router as visibility_router
from app.config import settings
from app.services.photo_asset_service import get_default_photo_asset_media_dir


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Internal lead generation and marketing operations API for Gomez Painting.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ],
        allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):\d+$",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(campaigns_router)
    app.include_router(campaign_content_queue_router)
    app.include_router(health_router)
    app.include_router(jobs_router)
    app.include_router(content_router)
    app.include_router(content_queue_router)
    app.include_router(photo_assets_router)
    app.include_router(posts_router)
    app.include_router(publisher_router)
    app.include_router(visibility_router)
    media_campaigns_dir = Path(__file__).resolve().parents[1] / "media" / "campaigns"
    media_campaigns_dir.mkdir(parents=True, exist_ok=True)
    media_photo_assets_dir = (
        Path(settings.photo_assets_media_dir) if settings.photo_assets_media_dir else get_default_photo_asset_media_dir()
    )
    media_photo_assets_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/media/campaigns",
        StaticFiles(directory=media_campaigns_dir),
        name="campaign-media",
    )
    app.mount(
        "/media/photo-assets",
        StaticFiles(directory=media_photo_assets_dir),
        name="photo-asset-media",
    )
    return app


app = create_app()
