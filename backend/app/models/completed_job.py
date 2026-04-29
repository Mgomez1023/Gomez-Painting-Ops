from pydantic import BaseModel, ConfigDict, Field


class CompletedJob(BaseModel):
    job_id: str | None = Field(default=None, min_length=1, examples=["JOB-1001"])
    customer: str = Field(..., min_length=1, examples=["Maria R."])
    job_type: str = Field(..., min_length=1, examples=["Interior Paint"])
    location: str = Field(..., min_length=1, examples=["Oak Park"])
    date_completed: str = Field(..., min_length=1, examples=["March 2026"])
    photos_uploaded: bool = Field(..., examples=[True])
    notes: str = Field(..., min_length=1, examples=["Living room repaint with trim refresh."])
    before_photo_url: str | None = None
    after_photo_url: str | None = None
    room_area: str | None = None
    paint_colors: str | None = None
    customer_outcome: str | None = None
    project_highlights: str | None = None

    model_config = ConfigDict(
        str_strip_whitespace=True,
        json_schema_extra={
            "example": {
                "job_id": "JOB-1001",
                "customer": "Maria R.",
                "job_type": "Interior Paint",
                "location": "Oak Park",
                "date_completed": "March 2026",
                "photos_uploaded": True,
                "notes": "Living room repaint with trim refresh.",
                "before_photo_url": "https://example.com/before.jpg",
                "after_photo_url": "https://example.com/after.jpg",
                "room_area": "Living room",
                "paint_colors": "Alabaster walls, Pure White trim",
                "customer_outcome": "The room feels brighter and more welcoming.",
                "project_highlights": "Trim refresh, wall repair, clean lines.",
            }
        }
    )
