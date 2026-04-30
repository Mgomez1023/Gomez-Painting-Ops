from fastapi import Depends

from app.agents.content_agent import ContentAgent
from app.agents.campaign_agent import CampaignAgent
from app.services.campaign_image_service import CampaignImageService
from app.services.llm_service import LLMService
from app.services.publisher_service import PublisherService
from app.services.publishing_workflow_service import PublishingWorkflowService
from app.services.sheets_service import SheetsService
from app.services.social_queue_service import SocialQueueService


async def get_campaign_agent() -> CampaignAgent:
    return CampaignAgent(llm_service=LLMService())


async def get_campaign_image_service() -> CampaignImageService:
    return CampaignImageService()


async def get_content_agent() -> ContentAgent:
    return ContentAgent(llm_service=LLMService())


async def get_sheets_service() -> SheetsService:
    return SheetsService()


async def get_publisher_service() -> PublisherService:
    return PublisherService()


async def get_publishing_workflow_service(
    sheets_service: SheetsService = Depends(get_sheets_service),
    publisher_service: PublisherService = Depends(get_publisher_service),
) -> PublishingWorkflowService:
    return PublishingWorkflowService(
        sheets_service=sheets_service,
        publisher_service=publisher_service,
    )


async def get_social_queue_service(
    sheets_service: SheetsService = Depends(get_sheets_service),
    campaign_agent: CampaignAgent = Depends(get_campaign_agent),
    campaign_image_service: CampaignImageService = Depends(get_campaign_image_service),
) -> SocialQueueService:
    return SocialQueueService(
        sheets_service=sheets_service,
        campaign_agent=campaign_agent,
        campaign_image_service=campaign_image_service,
    )
