from pydantic import BaseModel, ConfigDict, Field


class ContentDraft(BaseModel):
    facebook_post: str = Field(..., min_length=1)
    google_business_post: str = Field(..., min_length=1)
    instagram_caption: str = Field(..., min_length=1)
    review_request_text: str = Field(..., min_length=1)
    confidence: float = Field(..., ge=0.0, le=1.0)
    needs_human_review: bool = True

    model_config = ConfigDict(
        str_strip_whitespace=True,
        json_schema_extra={
            "example": {
                "facebook_post": "Recent interior paint project completed in Oak Park.",
                "google_business_post": "Gomez Painting completed an interior paint project in Oak Park.",
                "instagram_caption": "Fresh interior paint in Oak Park.",
                "review_request_text": "Thanks for choosing Gomez Painting.",
                "confidence": 0.82,
                "needs_human_review": True,
            }
        }
    )
