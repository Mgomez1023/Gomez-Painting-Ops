import json

import pytest

from app.config import Settings
from app.models.campaign import Campaign
from app.models.campaign_content import CampaignDraftSet
from app.models.completed_job import CompletedJob
from app.models.content_draft import ContentDraft
from app.services.llm_service import LLMService, LLMServiceError


class FakeOpenAIResponse:
    def __init__(self, output_parsed: object | None) -> None:
        self.output_parsed = output_parsed


class FakeResponsesClient:
    def __init__(self, output_parsed: object | None) -> None:
        self.output_parsed = output_parsed
        self.called_with: dict | None = None

    def parse(self, **kwargs) -> FakeOpenAIResponse:
        self.called_with = kwargs
        return FakeOpenAIResponse(output_parsed=self.output_parsed)


class FakeOpenAIClient:
    def __init__(self, output_parsed: object | None) -> None:
        self.responses = FakeResponsesClient(output_parsed=output_parsed)


def _job() -> CompletedJob:
    return CompletedJob(
        job_id="JOB-1001",
        customer="Maria R.",
        job_type="Interior Paint",
        location="Oak Park",
        date_completed="March 2026",
        photos_uploaded=True,
        notes="Living room repaint with trim refresh.",
    )


def _draft(needs_human_review: bool = True) -> ContentDraft:
    return ContentDraft(
        facebook_post="Facebook draft",
        google_business_post="Google Business draft",
        instagram_caption="Instagram draft",
        review_request_text="Review request draft",
        confidence=0.91,
        needs_human_review=needs_human_review,
    )


def _campaign() -> Campaign:
    return Campaign(
        campaign_id="CAMP-1001",
        campaign_name="Spring Interior Leads",
        service_focus="Interior painting",
        target_location="Oak Park",
        target_customer="homeowners",
        offer="Free quote request",
        cta="Request a quote",
        landing_page_url="https://gomezpainting.example/quote",
        start_date="2026-05-01",
        end_date="2026-05-31",
        status="Active",
        notes="Focus on living rooms.",
    )


def _campaign_draft_set(needs_human_review: bool = True) -> CampaignDraftSet:
    return CampaignDraftSet(
        facebook_post="Facebook campaign draft",
        facebook_group_post="Facebook Groups campaign draft",
        google_business_post="Google Business campaign draft",
        instagram_caption="Instagram campaign draft",
        craigslist_post="Craigslist campaign draft",
        nextdoor_post="Nextdoor campaign draft",
        confidence=0.91,
        needs_human_review=needs_human_review,
    )


def test_placeholder_provider_returns_deterministic_content_draft() -> None:
    service = LLMService(app_settings=Settings(llm_provider="placeholder"))

    draft = service.generate_content_draft(job=_job(), system_prompt="Prompt")

    assert "Oak Park" in draft.facebook_post
    assert "Maria R." in draft.review_request_text
    assert draft.needs_human_review is True


def test_openai_provider_parses_structured_content_draft_without_real_api_call() -> None:
    fake_client = FakeOpenAIClient(output_parsed=_draft(needs_human_review=False))
    service = LLMService(
        app_settings=Settings(
            llm_provider="openai",
            openai_api_key="test-key",
            openai_model="gpt-4.1-mini",
        ),
        client=fake_client,
    )

    draft = service.generate_content_draft(job=_job(), system_prompt="Prompt")

    assert draft.facebook_post == "Facebook draft"
    assert draft.needs_human_review is True
    assert fake_client.responses.called_with is not None
    assert fake_client.responses.called_with["model"] == "gpt-4.1-mini"
    assert fake_client.responses.called_with["text_format"] is ContentDraft


def test_openai_provider_requires_api_key_when_client_is_not_injected() -> None:
    service = LLMService(app_settings=Settings(llm_provider="openai", openai_api_key=None))

    with pytest.raises(LLMServiceError, match="OPENAI_API_KEY is required"):
        service.generate_content_draft(job=_job(), system_prompt="Prompt")


def test_openai_provider_raises_clear_error_when_structured_parse_is_missing() -> None:
    service = LLMService(
        app_settings=Settings(
            llm_provider="openai",
            openai_api_key="test-key",
            openai_model="gpt-4.1-mini",
        ),
        client=FakeOpenAIClient(output_parsed=None),
    )

    with pytest.raises(LLMServiceError, match="parsed ContentDraft"):
        service.generate_content_draft(job=_job(), system_prompt="Prompt")


def test_placeholder_provider_returns_deterministic_campaign_draft_set() -> None:
    service = LLMService(app_settings=Settings(llm_provider="placeholder"))

    draft_set = service.generate_campaign_draft_set(campaign=_campaign(), system_prompt="Prompt")

    assert "Oak Park" in draft_set.facebook_post
    assert "Hey neighbors" in draft_set.facebook_group_post
    assert "happy to take a look" in draft_set.facebook_group_post
    assert "provides" in draft_set.google_business_post
    assert "https://gomezpainting.example/quote" in draft_set.nextdoor_post
    assert draft_set.needs_human_review is True


@pytest.mark.parametrize(
    ("post_type", "expected_phrase"),
    [
        ("Offer / CTA", "straightforward quote request"),
        ("Problem Solution", "Scuffed walls"),
        ("FAQ / Education", "surface condition"),
        ("Trust / Local Proof", "keeps quoting simple"),
        ("Preparation Tip", "note the rooms"),
    ],
)
def test_placeholder_campaign_draft_set_reflects_assigned_post_type(
    post_type: str,
    expected_phrase: str,
) -> None:
    service = LLMService(app_settings=Settings(llm_provider="placeholder"))

    draft_set = service.generate_campaign_draft_set(
        campaign=_campaign(),
        system_prompt="Prompt",
        post_type=post_type,
    )

    assert post_type in draft_set.facebook_post
    assert expected_phrase in draft_set.google_business_post
    assert draft_set.needs_human_review is True


def test_openai_provider_parses_structured_campaign_draft_set_without_real_api_call() -> None:
    fake_client = FakeOpenAIClient(output_parsed=_campaign_draft_set(needs_human_review=False))
    service = LLMService(
        app_settings=Settings(
            llm_provider="openai",
            openai_api_key="test-key",
            openai_model="gpt-4.1-mini",
        ),
        client=fake_client,
    )

    draft_set = service.generate_campaign_draft_set(campaign=_campaign(), system_prompt="Prompt")

    assert draft_set.facebook_post == "Facebook campaign draft"
    assert draft_set.needs_human_review is True
    assert fake_client.responses.called_with is not None
    assert fake_client.responses.called_with["model"] == "gpt-4.1-mini"
    assert fake_client.responses.called_with["text_format"] is CampaignDraftSet


def test_openai_campaign_generation_sends_post_type_context() -> None:
    fake_client = FakeOpenAIClient(output_parsed=_campaign_draft_set(needs_human_review=False))
    service = LLMService(
        app_settings=Settings(
            llm_provider="openai",
            openai_api_key="test-key",
            openai_model="gpt-4.1-mini",
        ),
        client=fake_client,
    )

    service.generate_campaign_draft_set(
        campaign=_campaign(),
        system_prompt="Prompt",
        post_type="Problem Solution",
        platform="Meta Dual",
        avoid_phrases=["Spring is the perfect time"],
    )

    assert fake_client.responses.called_with is not None
    user_content = fake_client.responses.called_with["input"][1]["content"]
    context = json.loads(user_content)
    assert context["post_type"] == "Problem Solution"
    assert context["platform"] == "Meta Dual"
    assert context["avoid_phrases"] == ["Spring is the perfect time"]
    assert context["campaign"]["campaign_id"] == "CAMP-1001"
