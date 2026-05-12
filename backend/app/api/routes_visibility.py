from fastapi import APIRouter, Depends

from app.api.dependencies import get_llm_service
from app.models.visibility import VisibilityGenerationRequest, VisibilityGenerationResponse
from app.services.llm_service import LLMService, LLMServiceError


router = APIRouter(prefix="/visibility", tags=["visibility"])


VISIBILITY_SYSTEM_PROMPT = """
You generate practical local visibility copy for a local service business.
Use the business profile, service area, service focus, selected channel, tone, notes,
and photo metadata as grounding context. Write natural, specific copy that sounds like
a real local business, not a generic template.

Rules:
- Avoid awkward partial phrases such as "provides interior for homeowners".
- Include a clear CTA when appropriate.
- Respect the destination/channel conventions.
- Google Business Profile: concise, professional, service + location + CTA, usually no hashtags.
- Facebook Group: casual, neighborly, soft CTA, manual posting tone.
- Craigslist Service Ad: longer form, direct, service-focused, clear offer and contact CTA.
- Neighborhood Group: friendly and trust-building.
- General Social Post: polished and flexible.
- Use selected photo metadata only when it helps.
- Return structured fields. Leave fields empty only when they are not useful.
""".strip()


@router.post("/generate", response_model=VisibilityGenerationResponse)
async def generate_visibility_content(
    request: VisibilityGenerationRequest,
    llm_service: LLMService = Depends(get_llm_service),
) -> VisibilityGenerationResponse:
    try:
        return llm_service.generate_visibility_output(
            request=request,
            system_prompt=VISIBILITY_SYSTEM_PROMPT,
        )
    except LLMServiceError:
        return llm_service.generate_visibility_fallback(request)
