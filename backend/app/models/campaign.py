from pydantic import BaseModel, ConfigDict, Field


class Campaign(BaseModel):
    campaign_id: str = Field(..., min_length=1)
    campaign_name: str = Field(..., min_length=1)
    service_focus: str = Field(..., min_length=1)
    target_location: str = Field(..., min_length=1)
    target_customer: str = Field(..., min_length=1)
    offer: str | None = None
    cta: str = Field(..., min_length=1)
    landing_page_url: str = Field(..., min_length=1)
    start_date: str = Field(..., min_length=1)
    end_date: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)
    notes: str = ""

    model_config = ConfigDict(str_strip_whitespace=True)
