from app.agents.campaign_agent import CampaignAgent
from app.models.campaign_content import CampaignContentQueueItem, CampaignContentQueueSaveResponse, CampaignDraftSet
from app.services.campaign_image_service import CampaignImageService
from app.services.sheets_service import SheetsService


REQUIRED_CAMPAIGN_CONTENT_PLATFORMS = {
    "Facebook",
    "Google Business",
    "Instagram",
    "Craigslist",
    "Nextdoor",
}


class DuplicateCampaignContentQueueItemsError(RuntimeError):
    """Raised when a campaign already has a full set of saved drafts."""

    def __init__(self, existing_queue_items: list[CampaignContentQueueItem]) -> None:
        super().__init__("Campaign drafts already exist.")
        self.existing_queue_items = existing_queue_items


class CampaignWorkflowService:
    """Coordinates campaign workflows that need external campaign data."""

    def __init__(
        self,
        sheets_service: SheetsService,
        campaign_agent: CampaignAgent,
        campaign_image_service: CampaignImageService,
    ) -> None:
        self.sheets_service = sheets_service
        self.campaign_agent = campaign_agent
        self.campaign_image_service = campaign_image_service

    def generate_content(self, campaign_id: str) -> CampaignDraftSet | None:
        campaign = self.sheets_service.get_campaign_by_id(campaign_id)
        if campaign is None:
            return None

        return self.campaign_agent.generate(campaign)

    def generate_content_and_save(
        self,
        campaign_id: str,
        force: bool = False,
    ) -> CampaignContentQueueSaveResponse | None:
        campaign = self.sheets_service.get_campaign_by_id(campaign_id)
        if campaign is None:
            return None

        existing_queue_items = self.sheets_service.get_campaign_content_queue_items_by_campaign_id(campaign_id)
        existing_platforms = {item.platform for item in existing_queue_items}
        if not force and REQUIRED_CAMPAIGN_CONTENT_PLATFORMS.issubset(existing_platforms):
            raise DuplicateCampaignContentQueueItemsError(existing_queue_items=existing_queue_items)

        draft_set = self.campaign_agent.generate(campaign)
        image_metadata = self.campaign_image_service.select_next_image()
        queue_items = self.sheets_service.save_campaign_draft_set_to_queue(
            campaign=campaign,
            draft_set=draft_set,
            image_metadata=image_metadata,
        )
        return CampaignContentQueueSaveResponse(campaign_draft_set=draft_set, queue_items=queue_items)
