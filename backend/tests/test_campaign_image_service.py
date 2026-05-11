from pathlib import Path

from app.services.campaign_image_service import CampaignImageService


def test_select_next_image_returns_none_when_no_images_exist(tmp_path: Path) -> None:
    service = CampaignImageService(media_dir=tmp_path, state_file=tmp_path / ".rotation_state.json")

    assert service.select_next_image() is None
    assert not (tmp_path / ".rotation_state.json").exists()


def test_select_next_image_selects_first_image_on_first_call(tmp_path: Path) -> None:
    (tmp_path / "b-room.png").write_text("image", encoding="utf-8")
    (tmp_path / "a-room.jpg").write_text("image", encoding="utf-8")
    service = CampaignImageService(media_dir=tmp_path, state_file=tmp_path / ".rotation_state.json")

    selected = service.select_next_image()

    assert selected is not None
    assert selected.image_filename == "a-room.jpg"
    assert selected.image_path == "/media/campaigns/a-room.jpg"
    assert '"last_index": 0' in (tmp_path / ".rotation_state.json").read_text(encoding="utf-8")


def test_select_next_image_selects_second_image_on_second_call(tmp_path: Path) -> None:
    (tmp_path / "a-room.jpg").write_text("image", encoding="utf-8")
    (tmp_path / "b-room.png").write_text("image", encoding="utf-8")
    service = CampaignImageService(media_dir=tmp_path, state_file=tmp_path / ".rotation_state.json")

    first = service.select_next_image()
    second = service.select_next_image()

    assert first is not None
    assert second is not None
    assert first.image_filename == "a-room.jpg"
    assert second.image_filename == "b-room.png"
    assert '"last_index": 1' in (tmp_path / ".rotation_state.json").read_text(encoding="utf-8")


def test_select_next_image_cycles_to_first_after_last_image(tmp_path: Path) -> None:
    (tmp_path / "a-room.jpg").write_text("image", encoding="utf-8")
    (tmp_path / "b-room.webp").write_text("image", encoding="utf-8")
    service = CampaignImageService(media_dir=tmp_path, state_file=tmp_path / ".rotation_state.json")

    service.select_next_image()
    service.select_next_image()
    selected = service.select_next_image()

    assert selected is not None
    assert selected.image_filename == "a-room.jpg"
    assert '"last_index": 0' in (tmp_path / ".rotation_state.json").read_text(encoding="utf-8")


def test_select_next_unique_image_skips_excluded_images(tmp_path: Path) -> None:
    (tmp_path / "a-room.jpg").write_text("image", encoding="utf-8")
    (tmp_path / "b-room.webp").write_text("image", encoding="utf-8")
    service = CampaignImageService(media_dir=tmp_path, state_file=tmp_path / ".rotation_state.json")

    selected = service.select_next_unique_image({"a-room.jpg"})

    assert selected is not None
    assert selected.image_filename == "b-room.webp"
    assert '"last_index": 1' in (tmp_path / ".rotation_state.json").read_text(encoding="utf-8")


def test_select_next_unique_image_returns_none_when_all_images_are_excluded(tmp_path: Path) -> None:
    (tmp_path / "a-room.jpg").write_text("image", encoding="utf-8")
    service = CampaignImageService(media_dir=tmp_path, state_file=tmp_path / ".rotation_state.json")

    selected = service.select_next_unique_image({"a-room.jpg"})

    assert selected is None
    assert not (tmp_path / ".rotation_state.json").exists()


def test_list_campaign_images_ignores_unsupported_files(tmp_path: Path) -> None:
    (tmp_path / "a-room.gif").write_text("image", encoding="utf-8")
    (tmp_path / "b-room.jpeg").write_text("image", encoding="utf-8")
    (tmp_path / "c-room.txt").write_text("notes", encoding="utf-8")
    service = CampaignImageService(media_dir=tmp_path, state_file=tmp_path / ".rotation_state.json")

    images = service.list_campaign_images()

    assert [image.name for image in images] == ["b-room.jpeg"]
