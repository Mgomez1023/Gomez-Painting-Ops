from fastapi import Depends, HTTPException, status

from app.agents.content_agent import ContentAgent
from app.agents.campaign_agent import CampaignAgent
from app.config import settings
from app.services.campaign_image_service import CampaignImageService
from app.services.business_service import BusinessDataService
from app.services.llm_service import LLMService
from app.services.photo_asset_service import PhotoAssetService
from app.services.publisher_service import PublisherService
from app.services.publishing_workflow_service import PublishingWorkflowService
from app.services.sheets_service import SheetsService
from app.services.social_queue_service import SocialQueueService


async def get_campaign_agent() -> CampaignAgent:
    return CampaignAgent(llm_service=LLMService())


async def get_campaign_image_service() -> CampaignImageService:
    return CampaignImageService()


async def get_photo_asset_service() -> PhotoAssetService:
    return PhotoAssetService()


async def get_business_data_service() -> BusinessDataService:
    return BusinessDataService()


async def get_current_owner_id() -> str:
    # Temporary Step 2 bridge: replace with JWT-derived Supabase user identity
    # once login/signup and request authentication are implemented.
    owner_id = (settings.dev_owner_user_id or "").strip()
    if not owner_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DEV_OWNER_USER_ID is required until authenticated user identity is implemented.",
        )
    return owner_id


async def get_content_agent() -> ContentAgent:
    return ContentAgent(llm_service=LLMService())


async def get_llm_service() -> LLMService:
    return LLMService()


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
    photo_asset_service: PhotoAssetService = Depends(get_photo_asset_service),
) -> SocialQueueService:
    return SocialQueueService(
        sheets_service=sheets_service,
        campaign_agent=campaign_agent,
        campaign_image_service=campaign_image_service,
        photo_asset_service=photo_asset_service,
    )
