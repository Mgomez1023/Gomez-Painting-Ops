import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_llm_service
from app.main import app
from app.models.visibility import VisibilityGenerationRequest, VisibilityGenerationResponse
from app.services.llm_service import LLMService, LLMServiceError


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FailingVisibilityLLMService:
    def generate_visibility_output(
        self,
        request: VisibilityGenerationRequest,
        system_prompt: str,
    ) -> VisibilityGenerationResponse:
        raise LLMServiceError("LLM unavailable")

    def generate_visibility_fallback(self, request: VisibilityGenerationRequest) -> VisibilityGenerationResponse:
        return LLMService().generate_visibility_fallback(request)


@pytest.mark.anyio
async def test_generate_visibility_local_reach_returns_fallback_output() -> None:
    payload = {
        "toolType": "local_reach_post",
        "destination": "Google Business Profile",
        "postType": "Service promotion",
        "serviceFocus": "Interior painting",
        "location": "Oak Park",
        "goal": "Get estimate requests",
        "tone": "Professional",
        "cta": "Request a free estimate",
        "businessProfile": {
            "business_name": "Marom Painting",
            "industry": "Residential painting",
            "service_area_cities": ["Oak Park"],
            "services_offered": ["Interior painting"],
            "website_url": "https://marompainting.org",
            "primary_cta": "Request a free estimate",
        },
    }
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/visibility/generate", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["generationMode"] == "fallback"
    assert "Interior painting" in data["primary"]
    assert data["shortVersion"]
    assert data["ctaLine"]
    assert data["hashtagsOrKeywords"]


@pytest.mark.anyio
async def test_generate_visibility_falls_back_when_llm_service_fails() -> None:
    async def override_llm_service() -> FailingVisibilityLLMService:
        return FailingVisibilityLLMService()

    app.dependency_overrides[get_llm_service] = override_llm_service
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/visibility/generate",
            json={
                "toolType": "review_request",
                "customerName": "Maria",
                "jobCompleted": "cabinet painting",
                "businessProfile": {"business_name": "Marom Painting"},
            },
        )

    app.dependency_overrides.pop(get_llm_service, None)

    assert response.status_code == 200
    data = response.json()
    assert data["generationMode"] == "fallback"
    assert "Maria" in data["primary"]


@pytest.mark.anyio
async def test_generate_visibility_craigslist_service_ad_returns_titles_and_images() -> None:
    payload = {
        "toolType": "craigslist_service_ad",
        "serviceFocus": "Exterior painting",
        "location": "River Forest",
        "customerPainPoint": "peeling trim and faded siding",
        "trustSignals": "insured, local references, clean prep",
        "cta": "Call for a free estimate",
        "contact": "708-555-0100",
        "photoAssets": [
            {"title": "Finished exterior", "category": "Exterior", "service_type": "Exterior painting"},
            {"title": "Trim detail", "category": "Trim", "service_type": "Exterior painting"},
        ],
        "businessProfile": {"business_name": "Marom Painting"},
    }
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/visibility/generate", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["generationMode"] == "fallback"
    assert len(data["titles"]) >= 3
    assert "Services:" in data["primary"]
    assert len(data["imageSuggestions"]) == 2
