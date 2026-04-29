from pathlib import Path

from app.agents.base_agent import BaseAgent
from app.models.completed_job import CompletedJob
from app.models.content_draft import ContentDraft
from app.services.llm_service import LLMService


class ContentAgent(BaseAgent):
    name = "content_agent"

    def __init__(self, llm_service: LLMService) -> None:
        self.llm_service = llm_service
        self.prompt_template = self._load_prompt_template()

    def generate(self, job: CompletedJob) -> ContentDraft:
        return self.llm_service.generate_content_draft(
            job=job,
            system_prompt=self.prompt_template,
        )

    @staticmethod
    def _load_prompt_template() -> str:
        prompt_path = Path(__file__).resolve().parents[1] / "prompts" / "content_agent.md"
        return prompt_path.read_text(encoding="utf-8")
