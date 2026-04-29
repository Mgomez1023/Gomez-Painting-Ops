from typing import Any

from pydantic import ValidationError

from app.config import Settings, settings
from app.models.campaign import Campaign
from app.models.campaign_content import CampaignDraftSet
from app.models.completed_job import CompletedJob
from app.models.content_draft import ContentDraft


class LLMServiceError(RuntimeError):
    """Raised when content generation fails at the LLM boundary."""


class LLMService:
    """Language model boundary.

    Placeholder mode is deterministic and local-only. OpenAI mode is the only
    place where a real LLM provider is called.
    """

    def __init__(self, app_settings: Settings = settings, client: Any | None = None) -> None:
        self.settings = app_settings
        self._client = client

    def generate_content_draft(self, job: CompletedJob, system_prompt: str) -> ContentDraft:
        provider = self.settings.llm_provider.strip().lower()
        if provider == "placeholder":
            return self._generate_placeholder_content_draft(job)
        if provider == "openai":
            return self._generate_openai_content_draft(job=job, system_prompt=system_prompt)

        raise LLMServiceError(f"Unsupported LLM_PROVIDER: {self.settings.llm_provider}")

    def generate_campaign_draft_set(self, campaign: Campaign, system_prompt: str) -> CampaignDraftSet:
        provider = self.settings.llm_provider.strip().lower()
        if provider == "placeholder":
            return self._generate_placeholder_campaign_draft_set(campaign)
        if provider == "openai":
            return self._generate_openai_campaign_draft_set(campaign=campaign, system_prompt=system_prompt)

        raise LLMServiceError(f"Unsupported LLM_PROVIDER: {self.settings.llm_provider}")

    def _generate_placeholder_content_draft(self, job: CompletedJob) -> ContentDraft:
        photo_line = "Photos are available for the team to review." if job.photos_uploaded else "No photos are attached yet."
        project_summary = f"{job.job_type.lower()} project in {job.location}"
        detail_line = self._format_optional_job_details(job)

        return ContentDraft(
            facebook_post=(
                f"Another Gomez Painting project is complete: a {project_summary}. "
                f"The work wrapped up in {job.date_completed}. {job.notes} {detail_line} {photo_line} "
                "Draft for human review before posting."
            ),
            google_business_post=(
                f"Gomez Painting completed a {job.job_type} job in {job.location}. "
                f"Project notes: {job.notes} {detail_line} Completed: {job.date_completed}. "
                "This draft should be reviewed before publication."
            ),
            instagram_caption=(
                f"Fresh finish in {job.location}. {job.job_type} by Gomez Painting. "
                f"{job.notes} {detail_line} #GomezPainting #LocalPainting"
            ),
            review_request_text=(
                f"Hi {job.customer}, thank you for choosing Gomez Painting for your "
                f"{job.job_type.lower()} project. If you are happy with the finished work, "
                "we would appreciate a quick Google review. Draft for approval before sending."
            ),
            confidence=0.82,
            needs_human_review=True,
        )

    def _generate_placeholder_campaign_draft_set(self, campaign: Campaign) -> CampaignDraftSet:
        offer_line = f" {campaign.offer}" if campaign.offer else ""
        local_focus = f"{campaign.service_focus} in {campaign.target_location}"
        quote_line = f"{campaign.cta}: {campaign.landing_page_url}"

        return CampaignDraftSet(
            facebook_post=(
                f"Gomez Painting is helping {campaign.target_customer.lower()} with {local_focus}.{offer_line} "
                f"If you are planning a project, request a quote online. {quote_line}"
            ),
            google_business_post=(
                f"Planning {campaign.service_focus.lower()} near {campaign.target_location}? "
                f"Gomez Painting offers local, professional painting services for {campaign.target_customer.lower()}. "
                f"{offer_line.strip()} {quote_line}".strip()
            ),
            instagram_caption=(
                f"Fresh paint plans in {campaign.target_location}? Gomez Painting can help with "
                f"{campaign.service_focus.lower()}. {campaign.cta}: {campaign.landing_page_url} #GomezPainting"
            ),
            craigslist_post=(
                f"{campaign.campaign_name}\n\n"
                f"Gomez Painting is available for {local_focus}. "
                f"Ideal for {campaign.target_customer.lower()}. {offer_line.strip()}\n\n"
                f"{quote_line}"
            ),
            nextdoor_post=(
                f"Neighbors in {campaign.target_location}: Gomez Painting is booking {campaign.service_focus.lower()} "
                f"projects for {campaign.target_customer.lower()}.{offer_line} {quote_line}"
            ),
            confidence=0.82,
            needs_human_review=True,
        )

    @staticmethod
    def _format_optional_job_details(job: CompletedJob) -> str:
        details = [
            f"Area: {job.room_area}" if job.room_area else None,
            f"Colors: {job.paint_colors}" if job.paint_colors else None,
            f"Outcome: {job.customer_outcome}" if job.customer_outcome else None,
            f"Highlights: {job.project_highlights}" if job.project_highlights else None,
        ]
        available_details = [detail for detail in details if detail]
        if not available_details:
            return ""

        return " ".join(available_details)

    def _generate_openai_content_draft(self, job: CompletedJob, system_prompt: str) -> ContentDraft:
        try:
            response = self._get_openai_client().responses.parse(
                model=self.settings.openai_model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            f"{system_prompt}\n\n"
                            "Return only a ContentDraft JSON object. "
                            "Set needs_human_review to true."
                        ),
                    },
                    {
                        "role": "user",
                        "content": job.model_dump_json(exclude_none=True),
                    },
                ],
                text_format=ContentDraft,
            )
        except LLMServiceError:
            raise
        except Exception as exc:
            raise LLMServiceError("OpenAI content generation failed.") from exc

        parsed = getattr(response, "output_parsed", None)
        if parsed is None:
            raise LLMServiceError("OpenAI response did not include parsed ContentDraft output.")

        try:
            draft = ContentDraft.model_validate(parsed)
        except ValidationError as exc:
            raise LLMServiceError("OpenAI response could not be parsed into ContentDraft.") from exc

        return draft.model_copy(update={"needs_human_review": True})

    def _generate_openai_campaign_draft_set(self, campaign: Campaign, system_prompt: str) -> CampaignDraftSet:
        try:
            response = self._get_openai_client().responses.parse(
                model=self.settings.openai_model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            f"{system_prompt}\n\n"
                            "Return only a CampaignDraftSet JSON object. "
                            "Set needs_human_review to true."
                        ),
                    },
                    {
                        "role": "user",
                        "content": campaign.model_dump_json(exclude_none=True),
                    },
                ],
                text_format=CampaignDraftSet,
            )
        except LLMServiceError:
            raise
        except Exception as exc:
            raise LLMServiceError("OpenAI campaign content generation failed.") from exc

        parsed = getattr(response, "output_parsed", None)
        if parsed is None:
            raise LLMServiceError("OpenAI response did not include parsed CampaignDraftSet output.")

        try:
            draft_set = CampaignDraftSet.model_validate(parsed)
        except ValidationError as exc:
            raise LLMServiceError("OpenAI response could not be parsed into CampaignDraftSet.") from exc

        return draft_set.model_copy(update={"needs_human_review": True})

    def _get_openai_client(self) -> Any:
        if self._client is not None:
            return self._client

        if not self.settings.openai_api_key:
            raise LLMServiceError("OPENAI_API_KEY is required when LLM_PROVIDER=openai.")

        try:
            from openai import OpenAI
        except ImportError as exc:
            raise LLMServiceError("OpenAI dependency is not installed. Run pip install -r requirements.txt.") from exc

        self._client = OpenAI(api_key=self.settings.openai_api_key)
        return self._client
