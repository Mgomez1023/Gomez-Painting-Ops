import json
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

    def generate_campaign_draft_set(
        self,
        campaign: Campaign,
        system_prompt: str,
        post_type: str | None = None,
        platform: str | None = None,
        avoid_phrases: list[str] | None = None,
    ) -> CampaignDraftSet:
        provider = self.settings.llm_provider.strip().lower()
        if provider == "placeholder":
            return self._generate_placeholder_campaign_draft_set(campaign, post_type=post_type)
        if provider == "openai":
            return self._generate_openai_campaign_draft_set(
                campaign=campaign,
                system_prompt=system_prompt,
                post_type=post_type,
                platform=platform,
                avoid_phrases=avoid_phrases,
            )

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

    def _generate_placeholder_campaign_draft_set(
        self,
        campaign: Campaign,
        post_type: str | None = None,
    ) -> CampaignDraftSet:
        offer_line = f" {campaign.offer}" if campaign.offer else ""
        local_focus = f"{campaign.service_focus} in {campaign.target_location}"
        quote_line = f"{campaign.cta}: {campaign.landing_page_url}"
        angle_line = self._placeholder_campaign_angle_line(campaign, post_type)
        business_name = campaign.campaign_name
        business_hashtag = self._business_hashtag(business_name)

        return CampaignDraftSet(
            facebook_post=(
                f"{angle_line} {business_name} is helping {campaign.target_customer.lower()} with {local_focus}.{offer_line} "
                f"If you are planning a project, request a quote online. {quote_line}"
            ),
            facebook_group_post=(
                f"Hey neighbors - we recently worked on {campaign.service_focus.lower()} around {campaign.target_location} "
                f"and wanted to share it with local homeowners. If anyone nearby needs help with "
                f"{campaign.service_focus.lower()}, {business_name} is happy to take a look and give a free estimate. "
                f"{campaign.landing_page_url}"
            ),
            google_business_post=(
                f"{business_name} provides {campaign.service_focus.lower()} for {campaign.target_customer.lower()} "
                f"in {campaign.target_location}. {angle_line} {campaign.cta}: {campaign.landing_page_url}"
            ),
            instagram_caption=(
                f"{angle_line} {business_name} can help with "
                f"{campaign.service_focus.lower()}. {campaign.cta}: {campaign.landing_page_url} {business_hashtag}"
            ),
            craigslist_post=(
                f"{campaign.campaign_name}\n\n"
                f"{angle_line} {business_name} is available for {local_focus}. "
                f"Ideal for {campaign.target_customer.lower()}. {offer_line.strip()}\n\n"
                f"{quote_line}"
            ),
            nextdoor_post=(
                f"{angle_line} {business_name} is booking {campaign.service_focus.lower()} "
                f"projects for {campaign.target_customer.lower()}.{offer_line} {quote_line}"
            ),
            confidence=0.82,
            needs_human_review=True,
        )

    @staticmethod
    def _business_hashtag(business_name: str) -> str:
        normalized_name = "".join(character for character in business_name.title() if character.isalnum())
        return f"#{normalized_name}" if normalized_name else "#LocalBusiness"

    @staticmethod
    def _placeholder_campaign_angle_line(campaign: Campaign, post_type: str | None) -> str:
        target = campaign.target_customer.lower()
        service = campaign.service_focus.lower()
        location = campaign.target_location
        angle_lines = {
            "General": (
                f"General: {location} {target} can plan {service} with a local painting team."
            ),
            "Project Highlight": (
                f"Project Highlight: A finished {service} project can make a home feel more cared for."
            ),
            "Before and After": (
                f"Before and After: A careful paint refresh can change how a room looks and feels."
            ),
            "Seasonal Reminder": (
                f"Seasonal Reminder: {location} homeowners can plan painting before schedules fill up."
            ),
            "Problem Solution": (
                f"Problem Solution: Scuffed walls and tired color can make a home feel unfinished."
            ),
            "Trust Local Proof": (
                f"Trust Local Proof: Local {target} can work with a painting team that keeps quoting simple."
            ),
            "Trust / Local Proof": (
                f"Trust / Local Proof: Local {target} can work with a painting team that keeps quoting simple."
            ),
            "FAQ Education": (
                f"FAQ Education: A good paint plan starts with the room, surface condition, and finish."
            ),
            "FAQ / Education": (
                f"FAQ / Education: A good paint plan starts with the room, surface condition, and finish."
            ),
            "Offer CTA": (
                f"Offer CTA: The next step for {target} is a straightforward quote request."
            ),
            "Offer / CTA": (
                f"Offer / CTA: The next step for {target} is a straightforward quote request."
            ),
            "Offer": (
                f"Offer: The next step for {target} is a straightforward quote request."
            ),
            "Neighborhood Focus": (
                f"Neighborhood Focus: {location} homes each have their own style, light, and paint needs."
            ),
            "Preparation Tip": (
                f"Preparation Tip: Before a quote, note the rooms, trim, and surfaces that need attention."
            ),
            "Review Request": (
                f"Review Request: Happy customers and finished work help neighbors choose a painter."
            ),
        }
        return angle_lines.get(
            post_type or "",
            f"General: {location} {target} can plan {service} with a local painting team.",
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

    def _generate_openai_campaign_draft_set(
        self,
        campaign: Campaign,
        system_prompt: str,
        post_type: str | None = None,
        platform: str | None = None,
        avoid_phrases: list[str] | None = None,
    ) -> CampaignDraftSet:
        generation_context: dict[str, object] = {
            "campaign": campaign.model_dump(exclude_none=True),
        }
        if post_type:
            generation_context["post_type"] = post_type
        if platform:
            generation_context["platform"] = platform
        if avoid_phrases:
            generation_context["avoid_phrases"] = avoid_phrases

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
                        "content": json.dumps(generation_context),
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
