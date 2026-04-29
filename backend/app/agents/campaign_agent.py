from pathlib import Path

from app.agents.base_agent import BaseAgent
from app.models.campaign import Campaign
from app.models.campaign_content import CampaignDraftSet
from app.services.llm_service import LLMService


class CampaignAgent(BaseAgent):
    name = "campaign_agent"

    def __init__(self, llm_service: LLMService) -> None:
        self.llm_service = llm_service
        self.prompt_template = self._load_prompt_template()

    def generate(self, campaign: Campaign) -> CampaignDraftSet:
        return self.llm_service.generate_campaign_draft_set(
            campaign=campaign,
            system_prompt=self.prompt_template,
        )

    @staticmethod
    def _load_prompt_template() -> str:
        prompt_path = Path(__file__).resolve().parents[1] / "prompts" / "campaign_agent.md"
        return prompt_path.read_text(encoding="utf-8")
