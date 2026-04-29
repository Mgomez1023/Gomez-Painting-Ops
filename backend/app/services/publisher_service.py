from typing import Protocol

from pydantic import BaseModel, Field

from app.config import Settings, settings
from app.models.campaign_content import CampaignContentQueueItem


class PublishingError(RuntimeError):
    """Raised when publishing cannot be completed."""


class PublisherResult(BaseModel):
    external_post_id: str = Field(..., min_length=1)
    published_url: str = Field(..., min_length=1)


class PlatformPublisher(Protocol):
    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        """Publish a campaign content item through one platform boundary."""


class MockPublisher:
    """Safe local publisher used until real platform APIs are wired in."""

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        platform_slug = item.platform.lower().replace(" ", "-")
        external_post_id = f"mock-{platform_slug}-{item.content_id}"
        return PublisherResult(
            external_post_id=external_post_id,
            published_url=f"https://mock-publisher.local/posts/{external_post_id}",
        )


class GoogleBusinessPublisher:
    """Placeholder for a future Google Business Profile publisher."""

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        raise PublishingError("Google Business publishing is not configured yet.")


class FacebookPagePublisher:
    """Placeholder for a future Facebook Page publisher."""

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        raise PublishingError("Facebook Page publishing is not configured yet.")


class PublisherService:
    """Publishing boundary for campaign content.

    Routes and agents should not call platform APIs directly. Real platform
    integrations should be added behind this service.
    """

    def __init__(self, app_settings: Settings = settings) -> None:
        self.settings = app_settings

    def publish_campaign_content(self, item: CampaignContentQueueItem) -> PublisherResult:
        return self._publisher_for(item.platform).publish(item)

    def _publisher_for(self, platform: str) -> PlatformPublisher:
        mode = self.settings.publisher_mode.strip().lower()
        if mode == "mock":
            return MockPublisher()
        if mode == "google_business" and platform == "Google Business":
            return GoogleBusinessPublisher()
        if mode == "facebook_page" and platform == "Facebook":
            return FacebookPagePublisher()

        raise PublishingError(
            f"Publisher mode '{self.settings.publisher_mode}' is not configured for platform '{platform}'."
        )
