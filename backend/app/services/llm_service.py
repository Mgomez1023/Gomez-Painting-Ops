import json
from typing import Any

from pydantic import ValidationError

from app.config import Settings, settings
from app.models.campaign import Campaign
from app.models.campaign_content import CampaignDraftSet
from app.models.completed_job import CompletedJob
from app.models.content_draft import ContentDraft
from app.models.visibility import VisibilityGenerationRequest, VisibilityGenerationResponse


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

    def generate_visibility_output(
        self,
        request: VisibilityGenerationRequest,
        system_prompt: str,
    ) -> VisibilityGenerationResponse:
        provider = self.settings.llm_provider.strip().lower()
        if provider == "placeholder":
            return self.generate_visibility_fallback(request)
        if provider == "openai":
            return self._generate_openai_visibility_output(request=request, system_prompt=system_prompt)

        raise LLMServiceError(f"Unsupported LLM_PROVIDER: {self.settings.llm_provider}")

    def generate_visibility_fallback(self, request: VisibilityGenerationRequest) -> VisibilityGenerationResponse:
        profile = request.business_profile
        business_name = (profile.business_name if profile else "Marom Painting").strip() or "Marom Painting"
        website = (profile.website_url if profile and profile.website_url else "").strip()
        primary_cta = (profile.primary_cta if profile and profile.primary_cta else "Request a free estimate").strip()
        service = request.service_focus or self._first_non_empty(profile.services_offered if profile else [], "painting services")
        location = request.location or self._first_non_empty(profile.service_area_cities if profile else [], "the local area")
        cta_line = self._visibility_cta_line(request.cta or primary_cta, website, request.contact)

        if request.tool_type == "craigslist_service_ad":
            return self._generate_visibility_craigslist_fallback(
                request=request,
                business_name=business_name,
                service=service,
                location=location,
                cta_line=cta_line,
            )

        if request.tool_type == "review_request":
            customer_name = request.customer_name or "there"
            job_completed = request.job_completed or service
            review_link = request.review_link or website
            primary = (
                f"Hi {customer_name}, thank you again for choosing {business_name} for {job_completed}. "
                "If you have a minute, would you be willing to leave us a Google review? "
                "It helps local homeowners feel confident reaching out."
            )
            if review_link:
                primary = f"{primary} {review_link}"
            return VisibilityGenerationResponse(
                primary=primary,
                shortVersion=f"Hi {customer_name}, thanks again for choosing {business_name}. A quick Google review would mean a lot. {review_link}".strip(),
                ctaLine=review_link or cta_line,
                titles=["Review request message"],
                hashtagsOrKeywords=["Google review", business_name, location],
                generationMode="fallback",
            )

        if request.tool_type == "business_intro_post":
            services = request.services_to_mention or ", ".join((profile.services_offered if profile else [])[:3]) or service
            background = request.business_background or (profile.brand_tone if profile and profile.brand_tone else "Local, reliable, and focused on clean work")
            primary = (
                f"Hey neighbors - we are {business_name}, a local {profile.industry.lower() if profile and profile.industry else 'home services'} "
                f"business serving {location}. We help with {services}. {background}. "
                f"If you are planning a project nearby, {cta_line}."
            )
            return VisibilityGenerationResponse(
                primary=primary,
                shortVersion=f"Hey neighbors - {business_name} helps with {services} around {location}. {cta_line}.",
                ctaLine=cta_line,
                titles=[f"{business_name} in {location}", f"Local help for {services}"],
                hashtagsOrKeywords=[business_name, location, service],
                generationMode="fallback",
            )

        return self._generate_visibility_local_reach_fallback(
            request=request,
            business_name=business_name,
            service=service,
            location=location,
            cta_line=cta_line,
        )

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

    def _generate_visibility_local_reach_fallback(
        self,
        request: VisibilityGenerationRequest,
        business_name: str,
        service: str,
        location: str,
        cta_line: str,
    ) -> VisibilityGenerationResponse:
        destination = request.destination or "General Social Post"
        post_type = request.post_type or "Service promotion"
        goal = request.goal or "Get estimate requests"
        tone = request.tone or "Friendly neighbor"
        photo_line = self._visibility_photo_line(request.photo_asset)
        note_line = f" {request.notes.rstrip('.')}." if request.notes else ""
        hook = self._visibility_hook(destination, post_type, tone, service, location)

        if destination == "Google Business Profile":
            body = (
                f"{business_name} helps homeowners in {location} with {service.lower()} and related painting needs. "
                "Expect clear estimates, careful prep, and clean work."
            )
        elif destination in {"Facebook Group", "Neighborhood Group"}:
            body = (
                f"No hard sell - just local help from {business_name} if anyone nearby is thinking about "
                f"{service.lower()}. Happy to answer questions or take a look."
            )
        elif destination == "Craigslist":
            body = (
                f"{business_name} offers reliable {service.lower()} in {location}. Clear estimates, clean work areas, "
                "and service for local homeowners."
            )
        else:
            body = (
                f"{business_name} works with local homeowners around {location} on {service.lower()}. "
                "The focus is simple communication, careful prep, and a finish that fits the home."
            )

        if goal == "Improve local search visibility" and destination == "Google Business Profile":
            body = f"{body} Serving {location} and nearby communities."
        if photo_line:
            body = f"{body} {photo_line}"
        body = f"{body}{note_line}"

        primary = f"{hook} {body}\n\n{cta_line}"
        short_version = f"{business_name} can help with {service.lower()} in {location}. {cta_line}"
        if destination in {"Facebook Group", "Neighborhood Group"}:
            short_version = f"Hey neighbors - {business_name} helps with {service.lower()} around {location}. Happy to take a look."

        return VisibilityGenerationResponse(
            primary=primary,
            shortVersion=short_version,
            ctaLine=cta_line,
            titles=[
                f"{service} in {location}",
                f"Local {service.lower()} help",
                f"{business_name} - {location}",
            ],
            hashtagsOrKeywords=self._visibility_keywords(destination, business_name, service, location),
            imageSuggestions=self._visibility_image_suggestions([request.photo_asset] if request.photo_asset else []),
            generationMode="fallback",
        )

    def _generate_visibility_craigslist_fallback(
        self,
        request: VisibilityGenerationRequest,
        business_name: str,
        service: str,
        location: str,
        cta_line: str,
    ) -> VisibilityGenerationResponse:
        pain_point = request.customer_pain_point or "walls, trim, cabinets, or exterior areas that need a cleaner finish"
        trust_signals = request.trust_signals or "clear estimates, careful prep, clean work areas, and local service"
        offer = f"\n\nOffer/details: {request.offer_details}" if request.offer_details else ""
        notes = f"\n\nAdditional context: {request.notes}" if request.notes else ""
        services = [service, "Interior painting", "Exterior painting", "Cabinet painting", "Drywall repair"]
        unique_services = list(dict.fromkeys(item for item in services if item))
        image_suggestions = self._visibility_image_suggestions(request.photo_assets)

        primary = (
            f"{business_name} - {service} in {location}\n\n"
            f"If you are dealing with {pain_point}, {business_name} can help with reliable {service.lower()} "
            f"for homeowners in {location} and nearby areas.\n\n"
            f"Services:\n- " + "\n- ".join(unique_services) + "\n\n"
            f"Why choose us:\n{trust_signals}\n\n"
            f"CTA:\n{cta_line}"
            f"{offer}{notes}"
        )
        if image_suggestions:
            primary = f"{primary}\n\nRecommended image order:\n- " + "\n- ".join(image_suggestions)

        return VisibilityGenerationResponse(
            primary=primary,
            shortVersion=f"{service} in {location}. {business_name} offers clear estimates and clean local painting work. {cta_line}",
            ctaLine=cta_line,
            titles=[
                f"{service} in {location} - Free Estimate",
                f"Local {service} by {business_name}",
                f"Reliable Painting Help in {location}",
                f"{location} Home Painting Services",
            ],
            hashtagsOrKeywords=[
                f"{service} {location}",
                f"{location} painting services",
                "residential painting",
                "free painting estimate",
                business_name,
            ],
            imageSuggestions=image_suggestions,
            generationMode="fallback",
        )

    @staticmethod
    def _first_non_empty(values: list[str], fallback: str) -> str:
        for value in values:
            if value.strip():
                return value.strip()
        return fallback

    @staticmethod
    def _visibility_cta_line(cta: str, website: str, contact: str = "") -> str:
        contact_value = contact.strip() or website.strip()
        return f"{cta.strip()}: {contact_value}" if contact_value else cta.strip()

    @staticmethod
    def _visibility_hook(destination: str, post_type: str, tone: str, service: str, location: str) -> str:
        if destination in {"Facebook Group", "Neighborhood Group"}:
            if post_type == "Recent project":
                return f"Hey neighbors - we recently wrapped up a {service.lower()} project near {location}."
            if post_type == "Educational tip":
                return f"Hey neighbors - quick tip for anyone in {location} thinking about {service.lower()}."
            return f"Hey neighbors - if {service.lower()} is on your list, we are helping homeowners around {location}."
        if destination == "Craigslist":
            return f"{service} available in {location}."
        if destination == "Google Business Profile":
            return f"{service} for homeowners in {location}."
        if tone == "Premium":
            return f"A clean, polished {service.lower()} project can change how a home feels in {location}."
        return f"Thinking about {service.lower()} in {location}?"

    @staticmethod
    def _visibility_photo_line(photo_asset: object | None) -> str:
        if photo_asset is None:
            return ""
        title = getattr(photo_asset, "title", "")
        service_type = getattr(photo_asset, "service_type", "")
        location = getattr(photo_asset, "location", "")
        details = ", ".join(item for item in [service_type, location] if item)
        if title and details:
            return f"Selected photo context: {title} ({details})."
        if title:
            return f"Selected photo context: {title}."
        return ""

    @staticmethod
    def _visibility_keywords(destination: str, business_name: str, service: str, location: str) -> list[str]:
        keywords = [f"{service} {location}", business_name, f"{location} painting contractor"]
        if destination in {"Facebook Group", "Neighborhood Group", "General Social Post"}:
            keywords.extend([f"#{service.replace(' ', '')}", f"#{location.replace(' ', '')}", "#LocalBusiness"])
        return keywords

    @staticmethod
    def _visibility_image_suggestions(photo_assets: list[object | None]) -> list[str]:
        suggestions: list[str] = []
        for index, asset in enumerate([asset for asset in photo_assets if asset is not None][:6], start=1):
            title = getattr(asset, "title", "")
            category = getattr(asset, "category", "")
            service_type = getattr(asset, "service_type", "")
            caption_parts = [part for part in [title, category, service_type] if part]
            suggestions.append(f"{index}. {' - '.join(caption_parts) if caption_parts else 'Project photo'}")
        return suggestions

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

    def _generate_openai_visibility_output(
        self,
        request: VisibilityGenerationRequest,
        system_prompt: str,
    ) -> VisibilityGenerationResponse:
        generation_context = request.model_dump(by_alias=True, exclude_none=True)

        try:
            response = self._get_openai_client().responses.parse(
                model=self.settings.openai_model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            f"{system_prompt}\n\n"
                            "Return only a VisibilityGenerationResponse JSON object. "
                            "Use generationMode=\"llm\". "
                            "Do not include fake claims, guarantees, or unsupported urgency."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(generation_context),
                    },
                ],
                text_format=VisibilityGenerationResponse,
            )
        except LLMServiceError:
            raise
        except Exception as exc:
            raise LLMServiceError("OpenAI visibility generation failed.") from exc

        parsed = getattr(response, "output_parsed", None)
        if parsed is None:
            raise LLMServiceError("OpenAI response did not include parsed VisibilityGenerationResponse output.")

        try:
            generated = VisibilityGenerationResponse.model_validate(parsed)
        except ValidationError as exc:
            raise LLMServiceError("OpenAI response could not be parsed into VisibilityGenerationResponse.") from exc

        return generated.model_copy(update={"generation_mode": "llm"})

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
