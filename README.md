# Gomez Ops

Internal lead generation and marketing operations platform for Gomez Painting.

The app uses a FastAPI backend and React dashboard to turn completed jobs and lead generation campaigns into structured, reviewable marketing drafts. Google Sheets is the source of truth, and nothing is published automatically.

## Local Setup

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open the dashboard:

```text
http://127.0.0.1:5173
```

The frontend uses `VITE_API_BASE_URL` from `frontend/.env`:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

LLM configuration:

```text
LLM_PROVIDER=placeholder
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

Use `LLM_PROVIDER=placeholder` for deterministic local output with no API calls. To call OpenAI, set `LLM_PROVIDER=openai`, provide `OPENAI_API_KEY`, and choose an `OPENAI_MODEL`. OpenAI responses are parsed into the relevant draft schema and still return `needs_human_review: true`.

Open:

```text
http://127.0.0.1:8000/health
```

Generate content:

```bash
curl -X POST http://127.0.0.1:8000/content/generate \
  -H "Content-Type: application/json" \
  -d '{
    "customer": "Maria R.",
    "job_type": "Interior Paint",
    "location": "Oak Park",
    "date_completed": "March 2026",
    "photos_uploaded": true,
    "notes": "Living room repaint with trim refresh."
}'
```

Generate content from a completed job in Google Sheets:

```bash
curl -X POST http://127.0.0.1:8000/content/generate-from-job/JOB-1001
```

Generate content from a completed job and save drafts to the Content Queue:

```bash
curl -X POST http://127.0.0.1:8000/content/generate-from-job/JOB-1001/save
```

The save endpoint checks the existing Content Queue before appending. If a job already has saved drafts for Facebook, Google Business, Instagram, and Review Request, the API returns `409 Conflict` with the existing queue items instead of silently creating duplicate rows.

To intentionally generate a new set, pass `force=true`:

```bash
curl -X POST "http://127.0.0.1:8000/content/generate-from-job/JOB-1001/save?force=true"
```

List completed jobs from Google Sheets:

```bash
curl http://127.0.0.1:8000/jobs
```

`/jobs` reads from the `Completed Jobs` tab through `SheetsService`. Set these values in `backend/.env` before calling it against a real spreadsheet:

```text
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_FILE=/absolute/path/to/service-account.json
GOOGLE_COMPLETED_JOBS_SHEET_NAME=Completed Jobs
GOOGLE_CONTENT_QUEUE_SHEET_NAME=Content Queue
GOOGLE_CAMPAIGNS_SHEET_NAME=Campaigns
GOOGLE_CAMPAIGN_CONTENT_QUEUE_SHEET_NAME=Campaign Content Queue
PUBLISHER_MODE=mock
```

Share the spreadsheet with the service account email from the JSON credentials file. Read-only endpoints need viewer access; the save endpoint needs editor access so it can append Content Queue rows.

The `Completed Jobs` tab should include these columns:

```text
Job ID
Customer
Job Type
Location
Date Completed
Photos Uploaded
Notes
Before Photo URL
After Photo URL
Room/Area
Paint Colors
Customer Outcome
Project Highlights
```

`Job ID` is optional for `/jobs`, but required to find a job with `/content/generate-from-job/{job_id}`. The photo URL and project detail columns are optional; when present, they are passed into content generation. Gomez Ops does not perform image analysis.

Prepare a `Content Queue` tab with this header row:

```text
Content ID | Job ID | Platform | Draft Text | Status | Approved | Published | Created At | Notes
```

The save endpoint appends one row each for Facebook, Google Business, Instagram, and Review Request. New rows are saved for human review with `Status` set to `Needs Review`, `Approved` set to `No`, and `Published` set to `No`. Duplicate prevention is handled in the backend workflow so repeated dashboard clicks do not create another full set unless `force=true` is used.

List Content Queue items:

```bash
curl http://127.0.0.1:8000/content-queue
```

Update a Content Queue item after human review:

```bash
curl -X POST http://127.0.0.1:8000/content-queue/CQ-20260428T000000000000Z-facebook/approve
curl -X POST http://127.0.0.1:8000/content-queue/CQ-20260428T000000000000Z-facebook/reject
curl -X POST http://127.0.0.1:8000/content-queue/CQ-20260428T000000000000Z-facebook/mark-published
```

Approval sets `Status` to `Approved`, `Approved` to `Yes`, and `Published` to `No`. Rejection sets `Status` to `Rejected`, `Approved` to `No`, and `Published` to `No`. Marking published sets all publication fields to published state, but it does not post or send anything.

## Campaign Engine

Prepare a `Campaigns` tab with this header row:

```text
Campaign ID | Campaign Name | Service Focus | Target Location | Target Customer | Offer | CTA | Landing Page URL | Start Date | End Date | Status | Notes
```

Prepare a `Campaign Content Queue` tab with this header row:

```text
Content ID | Campaign ID | Platform | Draft Text | CTA | Landing Page URL | Image Filename | Image Path | Status | Approved | Published | Created At | Published At | Notes | Scheduled At | Publish Attempts | Last Publish Error | External Post ID | Published URL
```

Place campaign images in:

```text
backend/media/campaigns/
```

Supported image file extensions:

```text
.jpg, .jpeg, .png, .webp
```

Campaign images rotate deterministically by sorted filename. Each campaign generation selects the next image and writes the same `Image Filename` and `Image Path` to every platform row created in that save operation. Rotation state is stored locally in:

```text
backend/media/campaigns/.rotation_state.json
```

If no supported images exist, campaign generation still succeeds and image fields are left blank.

List campaigns:

```bash
curl http://127.0.0.1:8000/campaigns
```

Preview campaign drafts:

```bash
curl -X POST http://127.0.0.1:8000/campaigns/CAMP-1001/generate-content
```

Generate campaign drafts and save them for review:

```bash
curl -X POST http://127.0.0.1:8000/campaigns/CAMP-1001/generate-content/save
```

The campaign save endpoint appends one row each for Facebook, Google Business, Instagram, Craigslist, and Nextdoor. New rows are saved with `Status` set to `Needs Review`, `Approved` set to `No`, and `Published` set to `No`.

FastAPI serves local campaign images from `/media/campaigns/<filename>`. The dashboard builds the preview URL from `VITE_API_BASE_URL + image_path`. For example, with `VITE_API_BASE_URL=http://127.0.0.1:8001` and `image_path=/media/campaigns/Hero1.png`, the thumbnail URL is:

```text
http://127.0.0.1:8001/media/campaigns/Hero1.png
```

Clicking a campaign thumbnail opens the full image in a new tab.

Each Campaign Content Queue card has a `Copy Package` button for manual posting. It copies the platform, draft text, CTA, landing page URL, image filename, and image path to your clipboard.

Duplicate prevention is enforced in the backend. If a campaign already has saved drafts for all five campaign platforms, the API returns `409 Conflict` with the existing queue items. To intentionally generate a new set, pass `force=true`:

```bash
curl -X POST "http://127.0.0.1:8000/campaigns/CAMP-1001/generate-content/save?force=true"
```

List Campaign Content Queue items:

```bash
curl http://127.0.0.1:8000/campaign-content-queue
```

Update a Campaign Content Queue item after human review:

```bash
curl -X POST http://127.0.0.1:8000/campaign-content-queue/CCQ-20260428T000000000000Z-facebook/approve
curl -X POST http://127.0.0.1:8000/campaign-content-queue/CCQ-20260428T000000000000Z-facebook/reject
curl -X POST http://127.0.0.1:8000/campaign-content-queue/CCQ-20260428T000000000000Z-facebook/mark-published
```

Publish an approved Campaign Content Queue item through the publisher boundary:

```bash
curl -X POST http://127.0.0.1:8000/campaign-content-queue/CCQ-20260428T000000000000Z-facebook/publish
```

Schedule an approved Campaign Content Queue item for future publishing:

```bash
curl -X POST http://127.0.0.1:8000/campaign-content-queue/CCQ-20260428T000000000000Z-facebook/schedule \
  -H "Content-Type: application/json" \
  -d '{"scheduled_at":"2026-04-30T09:00:00Z"}'
```

Run due scheduled publishing locally:

```bash
curl -X POST http://127.0.0.1:8000/publisher/run-due
```

`/publisher/run-due` finds approved, unpublished Campaign Content Queue rows with `Scheduled At` due at or before the current time. In mock mode it updates successful rows with `Status=Published`, `Published=Yes`, `Published At`, `External Post ID`, `Published URL`, increments `Publish Attempts`, and clears `Last Publish Error`. Failed attempts increment `Publish Attempts` and write `Last Publish Error` without marking the row published.

`PublisherService` is the only publishing boundary. `PUBLISHER_MODE=mock` uses a safe mock publisher that returns a fake `external_post_id` and `published_url`, then updates the Google Sheet row to `Status=Published`, `Published=Yes`, `Published At`, `External Post ID`, and `Published URL`. Google Business Profile and Facebook Page publishers are placeholders for future owned or authorized channels only. Gomez Ops does not publish to personal profiles, Facebook Groups, Craigslist, Nextdoor, or any channel without explicit authorization.

The dashboard shows schedule controls for approved campaign queue items and has a `Run Due Publishing` button for local/manual testing.

Campaign drafts are designed to drive quote requests through the campaign landing page URL. Approval and mark-published only update Google Sheets status fields; mark-published is still available for manual posting workflows.

Run tests:

```bash
cd backend
pytest
```

## Architecture Notes

- Agents coordinate business workflows.
- `LLMService` owns all language model calls.
- `SheetsService` is the only intended boundary for Google Sheets access.
- Generated content is always returned as a draft with `needs_human_review: true`.
- There is no authentication, SMS, email, social media posting, or autonomous publishing in this milestone.
