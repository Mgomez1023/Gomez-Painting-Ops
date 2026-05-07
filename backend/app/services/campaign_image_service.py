from dataclasses import dataclass
import json
import os
from pathlib import Path
import tempfile
from typing import Any


SUPPORTED_CAMPAIGN_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass(frozen=True)
class CampaignImageMetadata:
    image_filename: str
    image_path: str


class CampaignImageService:
    """Local deterministic image rotation for campaign content."""

    def __init__(
        self,
        media_dir: Path | None = None,
        state_file: Path | None = None,
        public_path_prefix: str = "/media/campaigns",
    ) -> None:
        default_media_dir = Path(__file__).resolve().parents[2] / "media" / "campaigns"
        self.media_dir = media_dir or default_media_dir
        if state_file is None and os.environ.get("VERCEL"):
            state_file = Path(tempfile.gettempdir()) / "gomez-ops-campaign-rotation-state.json"
        self.state_file = state_file or self.media_dir / ".rotation_state.json"
        self.public_path_prefix = public_path_prefix.rstrip("/")

    def list_campaign_images(self) -> list[Path]:
        if not self.media_dir.exists():
            return []

        return sorted(
            [
                path
                for path in self.media_dir.iterdir()
                if path.is_file() and path.suffix.lower() in SUPPORTED_CAMPAIGN_IMAGE_EXTENSIONS
            ],
            key=lambda path: path.name.lower(),
        )

    def select_next_image(self) -> CampaignImageMetadata | None:
        images = self.list_campaign_images()
        if not images:
            return None

        last_index = self._read_last_index()
        next_index = 0 if last_index is None else (last_index + 1) % len(images)
        selected_image = images[next_index]
        self._write_last_index(next_index)

        return CampaignImageMetadata(
            image_filename=selected_image.name,
            image_path=f"{self.public_path_prefix}/{selected_image.name}",
        )

    def _read_last_index(self) -> int | None:
        if not self.state_file.exists():
            return None

        try:
            data = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

        last_index = data.get("last_index") if isinstance(data, dict) else None
        return last_index if isinstance(last_index, int) else None

    def _write_last_index(self, last_index: int) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        data: dict[str, Any] = {"last_index": last_index}
        self.state_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
