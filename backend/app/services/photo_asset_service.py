from __future__ import annotations

from datetime import datetime, timezone
import base64
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from app.config import Settings, settings
from app.models.photo_asset import PhotoAsset, PhotoAssetCreateRequest, PhotoAssetUpdateRequest


DEFAULT_PHOTO_ASSET_BUSINESS_ID = "marom-painting"
SUPPORTED_PHOTO_ASSET_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
PHOTO_ASSET_MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
PHOTO_ASSET_TEMP_ROOT = "gomez-ops-photo-assets"


class PhotoAssetDataError(RuntimeError):
    """Raised when local photo asset persistence cannot be read or written."""


def get_default_photo_asset_data_file() -> Path:
    if os.environ.get("VERCEL"):
        return Path(tempfile.gettempdir()) / PHOTO_ASSET_TEMP_ROOT / "photo_assets.json"
    return Path(__file__).resolve().parents[2] / "data" / "photo_assets.json"


def get_default_photo_asset_media_dir() -> Path:
    if os.environ.get("VERCEL"):
        return Path(tempfile.gettempdir()) / PHOTO_ASSET_TEMP_ROOT / "media"
    return Path(__file__).resolve().parents[2] / "media" / "photo-assets"


class PhotoAssetService:
    """Local/dev PhotoAsset storage.

    TODO: Replace this JSON-file catalog and local filesystem image store with durable
    object storage plus business/account-owned database rows when auth is introduced.
    Photo assets should belong to business_id; businesses should later belong to user_id/account_id.
    """

    def __init__(
        self,
        settings_override: Settings | None = None,
        data_file: Path | None = None,
        media_dir: Path | None = None,
        public_path_prefix: str = "/media/photo-assets",
    ) -> None:
        self.settings = settings_override or settings
        configured_data_file = Path(self.settings.photo_assets_data_file) if self.settings.photo_assets_data_file else None
        configured_media_dir = Path(self.settings.photo_assets_media_dir) if self.settings.photo_assets_media_dir else None
        self.data_file = data_file or configured_data_file or get_default_photo_asset_data_file()
        self.media_dir = media_dir or configured_media_dir or get_default_photo_asset_media_dir()
        self.public_path_prefix = public_path_prefix.rstrip("/")
        self.default_business_id = self.settings.default_business_id or DEFAULT_PHOTO_ASSET_BUSINESS_ID

    def list_photo_assets(self, business_id: str | None = None) -> list[PhotoAsset]:
        normalized_business_id = self._normalize_business_id(business_id)
        return [
            asset
            for asset in self._read_assets()
            if asset.business_id == normalized_business_id
        ]

    def create_photo_asset(self, request: PhotoAssetCreateRequest) -> PhotoAsset:
        assets = self._read_assets()
        now = self._utc_timestamp()
        asset_id = f"photo-{uuid4().hex[:12]}"
        image_path, image_filename = self._image_fields_for_request(
            asset_id=asset_id,
            image_data=request.image_data,
            image_url=request.image_url,
            image_filename=request.image_filename,
        )
        asset = PhotoAsset(
            id=asset_id,
            business_id=self._normalize_business_id(request.business_id),
            image_url=request.image_url if not image_path else None,
            image_path=image_path,
            image_filename=image_filename,
            title=request.title,
            description=request.description,
            category=request.category,
            service_type=request.service_type,
            location=request.location,
            tags=self._normalize_tags(request.tags),
            quality=request.quality,
            used_count=0,
            created_at=now,
            updated_at=now,
        )
        self._write_assets([asset, *assets])
        return asset

    def update_photo_asset(self, asset_id: str, request: PhotoAssetUpdateRequest) -> PhotoAsset | None:
        assets = self._read_assets()
        existing_asset = next((asset for asset in assets if asset.id == asset_id), None)
        if existing_asset is None:
            return None

        image_path = existing_asset.image_path
        image_url = existing_asset.image_url
        image_filename = existing_asset.image_filename
        if request.image_data:
            image_path, image_filename = self._image_fields_for_request(
                asset_id=existing_asset.id,
                image_data=request.image_data,
                image_url=None,
                image_filename=request.image_filename or existing_asset.image_filename,
            )
            image_url = None
            self._delete_local_image(existing_asset.image_path, skip_path=image_path)
        elif request.image_url is not None:
            image_url = request.image_url or None
            if image_url:
                self._delete_local_image(existing_asset.image_path)
                image_path = None
                image_filename = request.image_filename

        updated_asset = existing_asset.model_copy(
            update={
                "business_id": self._normalize_business_id(request.business_id or existing_asset.business_id),
                "image_url": image_url,
                "image_path": image_path,
                "image_filename": image_filename,
                "title": request.title if request.title is not None else existing_asset.title,
                "description": request.description if request.description is not None else existing_asset.description,
                "category": request.category if request.category is not None else existing_asset.category,
                "service_type": request.service_type if request.service_type is not None else existing_asset.service_type,
                "location": request.location if request.location is not None else existing_asset.location,
                "tags": self._normalize_tags(request.tags) if request.tags is not None else existing_asset.tags,
                "quality": request.quality if request.quality is not None else existing_asset.quality,
                "updated_at": self._utc_timestamp(),
            }
        )
        self._write_assets([updated_asset if asset.id == asset_id else asset for asset in assets])
        return updated_asset

    def delete_photo_asset(self, asset_id: str, business_id: str | None = None) -> PhotoAsset | None:
        normalized_business_id = self._normalize_business_id(business_id)
        assets = self._read_assets()
        deleted_asset = next(
            (asset for asset in assets if asset.id == asset_id and asset.business_id == normalized_business_id),
            None,
        )
        if deleted_asset is None:
            return None

        self._write_assets([asset for asset in assets if asset.id != deleted_asset.id])
        self._delete_local_image(deleted_asset.image_path)
        return deleted_asset

    def increment_used_count(self, asset_id: str) -> PhotoAsset | None:
        assets = self._read_assets()
        existing_asset = next((asset for asset in assets if asset.id == asset_id), None)
        if existing_asset is None:
            return None

        updated_asset = existing_asset.model_copy(
            update={
                "used_count": existing_asset.used_count + 1,
                "updated_at": self._utc_timestamp(),
            }
        )
        self._write_assets([updated_asset if asset.id == asset_id else asset for asset in assets])
        return updated_asset

    def _image_fields_for_request(
        self,
        asset_id: str,
        image_data: str | None,
        image_url: str | None,
        image_filename: str | None,
    ) -> tuple[str | None, str | None]:
        if image_data:
            return self._save_image_data(asset_id=asset_id, image_data=image_data, image_filename=image_filename)
        if image_url:
            return None, image_filename
        raise PhotoAssetDataError("Photo asset requires image_data or image_url.")

    def _save_image_data(self, asset_id: str, image_data: str, image_filename: str | None) -> tuple[str, str]:
        mime_type, encoded_data = self._parse_image_data(image_data)
        extension = self._image_extension(mime_type=mime_type, image_filename=image_filename)
        safe_filename = f"{self._safe_filename_stem(image_filename) or asset_id}-{asset_id}{extension}"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        image_path = self.media_dir / safe_filename
        try:
            image_path.write_bytes(base64.b64decode(encoded_data, validate=True))
        except (OSError, ValueError) as exc:
            raise PhotoAssetDataError("Unable to save uploaded photo asset image.") from exc
        return f"{self.public_path_prefix}/{safe_filename}", safe_filename

    @staticmethod
    def _parse_image_data(image_data: str) -> tuple[str | None, str]:
        match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(?P<data>.+)$", image_data, flags=re.DOTALL)
        if match:
            return match.group(1).lower(), re.sub(r"\s+", "", match.group("data"))
        return None, re.sub(r"\s+", "", image_data)

    @staticmethod
    def _image_extension(mime_type: str | None, image_filename: str | None) -> str:
        filename_extension = Path(image_filename or "").suffix.lower()
        if filename_extension in SUPPORTED_PHOTO_ASSET_EXTENSIONS:
            return filename_extension
        if mime_type in PHOTO_ASSET_MIME_EXTENSIONS:
            return PHOTO_ASSET_MIME_EXTENSIONS[mime_type]
        return ".jpg"

    @staticmethod
    def _safe_filename_stem(image_filename: str | None) -> str:
        stem = Path(image_filename or "").stem.lower()
        return re.sub(r"[^a-z0-9]+", "-", stem).strip("-")

    def _delete_local_image(self, image_path: str | None, skip_path: str | None = None) -> None:
        if not image_path or image_path == skip_path:
            return
        if not image_path.startswith(f"{self.public_path_prefix}/"):
            return
        filename = image_path.rsplit("/", 1)[-1]
        target_path = (self.media_dir / filename).resolve()
        media_dir = self.media_dir.resolve()
        if media_dir not in target_path.parents:
            return
        try:
            target_path.unlink(missing_ok=True)
        except OSError:
            return

    def _read_assets(self) -> list[PhotoAsset]:
        if not self.data_file.exists():
            return []

        try:
            raw_assets = json.loads(self.data_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PhotoAssetDataError("Unable to read photo asset storage.") from exc
        if not isinstance(raw_assets, list):
            raise PhotoAssetDataError("Photo asset storage must contain a list.")

        assets: list[PhotoAsset] = []
        for raw_asset in raw_assets:
            try:
                assets.append(PhotoAsset.model_validate(raw_asset))
            except ValidationError as exc:
                raise PhotoAssetDataError("Photo asset storage contains invalid data.") from exc
        return assets

    def _write_assets(self, assets: list[PhotoAsset]) -> None:
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        temporary_file = self.data_file.with_suffix(f"{self.data_file.suffix}.tmp")
        payload = [asset.model_dump(mode="json") for asset in assets]
        try:
            temporary_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            shutil.move(str(temporary_file), str(self.data_file))
        except OSError as exc:
            raise PhotoAssetDataError("Unable to write photo asset storage.") from exc

    def _normalize_business_id(self, business_id: str | None) -> str:
        # TODO: Business IDs should come from authenticated account/business records once auth exists.
        normalized_business_id = (business_id or self.default_business_id).strip()
        return normalized_business_id or self.default_business_id

    @staticmethod
    def _normalize_tags(tags: list[str]) -> list[str]:
        normalized_tags: list[str] = []
        seen_tags: set[str] = set()
        for tag in tags:
            normalized_tag = tag.strip()
            normalized_key = normalized_tag.lower()
            if not normalized_tag or normalized_key in seen_tags:
                continue
            normalized_tags.append(normalized_tag)
            seen_tags.add(normalized_key)
        return normalized_tags

    @staticmethod
    def _utc_timestamp() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
