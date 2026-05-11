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
uvicorn app.main:app --reload
```

'''Activate Virtual Environment
Remove-Item -Recurse -Force .venv
py -m venv .venv
.\.venv\Scripts\Activate.ps1
'''

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

## Vercel Deployment

This repository is ready to deploy from the repository root as one Vercel project:

- Vite builds the dashboard from `frontend/` into `frontend/dist`.
- FastAPI runs through `api/index.py` as a Vercel Python Function.
- API routes keep their current paths, such as `/jobs`, `/campaigns`, `/posts`, and `/media/campaigns/...`.
- In production, the frontend defaults to same-origin API calls, so `VITE_API_BASE_URL` can be left unset on Vercel.

Recommended Vercel project settings:

```text
Framework Preset: Vite
Root Directory: .
Install Command: cd frontend && npm ci
Build Command: cd frontend && npm run build
Output Directory: frontend/dist
```

These settings are already encoded in `vercel.json`, so the Vercel dashboard should pick them up automatically.

Set these Vercel environment variables for Production and Preview:

```text
APP_NAME=Gomez Ops
ENVIRONMENT=production
LLM_PROVIDER=placeholder
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
PUBLISHER_MODE=mock

GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_COMPLETED_JOBS_SHEET_NAME=Completed Jobs
GOOGLE_CONTENT_QUEUE_SHEET_NAME=Content Queue
GOOGLE_CAMPAIGNS_SHEET_NAME=Campaigns
GOOGLE_CAMPAIGN_CONTENT_QUEUE_SHEET_NAME=Campaign Content Queue
GOOGLE_POSTS_SHEET_NAME=Posts

PUBLIC_SITE_BASE_URL=https://your-vercel-domain.example
API_PUBLIC_BASE_URL=https://your-vercel-domain.example
```

Use `GOOGLE_SERVICE_ACCOUNT_JSON` on Vercel instead of `GOOGLE_SERVICE_ACCOUNT_FILE`; paste the service account JSON as the environment variable value and keep the JSON file out of git. Share the Google Sheet with the service account email.

If you want live publishing instead of mock/manual workflows, set the relevant publisher values too:

```text
PUBLISHER_MODE=meta_export
# or PUBLISHER_MODE=meta for real Meta Graph API publishing

GOOGLE_BUSINESS_CLIENT_ID=
GOOGLE_BUSINESS_CLIENT_SECRET=
GOOGLE_BUSINESS_REFRESH_TOKEN=
GOOGLE_BUSINESS_ACCOUNT_ID=
GOOGLE_BUSINESS_LOCATION_ID=
GOOGLE_BUSINESS_REDIRECT_URI=
GOOGLE_BUSINESS_API_BASE=https://mybusiness.googleapis.com/v4

META_GRAPH_API_VERSION=v21.0
META_APP_ID=
META_APP_SECRET=
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
```

Deployment flow:

```bash
# Option 1: Git deployment
git push
# Import the repo in Vercel, add env vars, deploy Preview, then promote to Production.

# Option 2: CLI deployment
npm i -g vercel
vercel login
vercel link
vercel --prod
```

After the first deployment, verify:

```text
https://your-vercel-domain.example/health
https://your-vercel-domain.example/docs
https://your-vercel-domain.example/
```

Then open the dashboard and test the current workflows: list jobs, list campaigns, generate/save a draft, copy a weekly post package, and open a campaign image thumbnail. If publishing to Meta or Google Business, set `PUBLIC_SITE_BASE_URL` and `API_PUBLIC_BASE_URL` to the final public production URL so external platforms can fetch media URLs.

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
GOOGLE_POSTS_SHEET_NAME=Posts
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

`Image URL` is optional. When present, Google Business publishing prefers it over `Image Path` for media.

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

On Vercel, the app stores this rotation pointer in the function temp directory because deployed source files are immutable. Rotation still works within warm function instances, but the pointer can reset after a cold start or redeploy. The generated queue rows remain persisted in Google Sheets.

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

## Weekly Social Queue

The dashboard is organized around `Posts to Publish This Week`. The intended operator workflow is:

```text
Open dashboard -> review this week's posts -> copy/post in the platform -> mark posted
```

Weekly generation creates queue items in the `Posts` sheet. The `Posts` tab should use the same columns as `Campaign Content Queue`:

```text
Content ID | Campaign ID | Platform | Draft Text | CTA | Landing Page URL | Image Filename | Image Path | Status | Approved | Published | Created At | Published At | Notes | Scheduled At | Publish Attempts | Last Publish Error | External Post ID | Published URL
```

Each post includes platform, business, scheduled date, caption, image path or URL, status, and created timestamp. Status values for this workflow are:

```text
Draft
Copied
Posted
Skipped
```

Generate this week's queue:

```bash
curl -X POST http://127.0.0.1:8000/posts/generate-weekly \
  -H "Content-Type: application/json" \
  -d '{"posts_per_platform":3}'
```

By default, weekly generation creates three posts per platform for:

```text
Google Business
Facebook + Instagram
```

Facebook and Instagram are generated as one combined `Meta Dual` row so the same post can be copied into Meta Business Suite for both channels together.

Optional Facebook Groups rows can be included explicitly:

```bash
curl -X POST http://127.0.0.1:8000/posts/generate-weekly \
  -H "Content-Type: application/json" \
  -d '{"posts_per_platform":3,"include_facebook_groups":true}'
```

If the selected campaign already has posts for the current ISO week, the endpoint returns the existing items instead of creating duplicates.

Generate one additional post:

```bash
curl -X POST http://127.0.0.1:8000/posts/generate-post \
  -H "Content-Type: application/json" \
  -d '{"platform":"Google Business","post_type":"General"}'
```

List this week's posts:

```bash
curl http://127.0.0.1:8000/posts/weekly
```

Update manual workflow status:

```bash
curl -X POST http://127.0.0.1:8000/posts/CONTENT-ID/copy
curl -X POST http://127.0.0.1:8000/posts/CONTENT-ID/posted
curl -X POST http://127.0.0.1:8000/posts/CONTENT-ID/skip
```

`copy` sets `Status=Copied` without granting automated publishing approval. `posted` sets `Status=Posted`, `Published=Yes`, and `Published At`. `skip` sets `Status=Skipped`. The separate approval controls remain available for real automated publisher workflows in `Campaign Content Queue`.

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

Set a `Scheduled At` timestamp on an approved Campaign Content Queue item before using `/publisher/run-due`:

```bash
curl -X POST http://127.0.0.1:8000/campaign-content-queue/CCQ-20260428T000000000000Z-facebook/schedule \
  -H "Content-Type: application/json" \
  -d '{"scheduled_at":"2026-04-30T09:00:00Z"}'
```

Run publisher processing locally:

```bash
curl -X POST http://127.0.0.1:8000/publisher/run-due
```

`/publisher/run-due` finds approved, unpublished Campaign Content Queue rows where `Scheduled At` is due at or before the current time. In mock mode it updates successful rows with `Status=Published`, `Published=Yes`, `Published At`, `External Post ID`, `Published URL`, increments `Publish Attempts`, and clears `Last Publish Error`. Failed attempts increment `Publish Attempts` and write `Last Publish Error` without marking the row published.

`PublisherService` is the only publishing boundary. `PUBLISHER_MODE=mock` uses a safe mock publisher that returns a fake `external_post_id` and `published_url`, then updates the Google Sheet row to `Status=Published`, `Published=Yes`, `Published At`, `External Post ID`, and `Published URL`. `PUBLISHER_MODE=google_business` publishes only owned Google Business Profile rows. `PUBLISHER_MODE=meta` publishes only owned/authorized Facebook Page, Instagram, or Meta Dual rows through Meta Graph API. Gomez Ops does not publish to personal profiles, Facebook Groups, Craigslist, Nextdoor, or any channel without explicit authorization.

The dashboard shows schedule controls for approved campaign queue items and has a `Run Publishing` button for local/manual testing.

Campaign drafts are designed to drive quote requests through the campaign landing page URL. Approval and mark-published only update Google Sheets status fields; mark-published is still available for manual posting workflows.

## Google Business Profile Publishing

Google Business Profile is the first real automated publisher. It only publishes owned Google Business Profile Local Posts for rows where `Platform` is `Google Business`. It does not publish to Facebook, Instagram, personal profiles, Facebook Groups, Craigslist, Nextdoor, or unauthorized channels.

Human approval remains required. `/publisher/run-due` only processes Campaign Content Queue rows where `Approved=Yes`, `Published=No`, and `Scheduled At` is due.

Required backend environment:

```text
PUBLISHER_MODE=google_business
GOOGLE_BUSINESS_CLIENT_ID=your-oauth-client-id
GOOGLE_BUSINESS_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_BUSINESS_REFRESH_TOKEN=your-refresh-token
GOOGLE_BUSINESS_ACCOUNT_ID=your-business-account-id
GOOGLE_BUSINESS_LOCATION_ID=your-location-id
GOOGLE_BUSINESS_REDIRECT_URI=optional-oauth-redirect-uri
GOOGLE_BUSINESS_API_BASE=https://mybusiness.googleapis.com/v4
```

Credential verification uses the newer Google Business Profile APIs:

```text
Accounts:  https://mybusinessaccountmanagement.googleapis.com/v1/accounts
Locations: https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{account_id}/locations
```

Local Posts publishing still uses the legacy Google My Business v4 endpoint:

```text
POST https://mybusiness.googleapis.com/v4/accounts/{account_id}/locations/{location_id}/localPosts
```

This split is expected. A project can successfully verify accounts and locations through the newer APIs while Local Posts publishing fails with an API-disabled error for `mybusiness.googleapis.com`. If publishing returns an API-disabled response for `mybusiness.googleapis.com`, the Google Cloud project likely lacks access to the legacy Google My Business API, which may not appear in normal Cloud API Library search.

OAuth must include this scope:

```text
https://www.googleapis.com/auth/business.manage
```

To get a refresh token, create an OAuth client in Google Cloud for an account that has access to the target Business Profile location, complete the OAuth consent flow with the `business.manage` scope, and exchange the authorization code for tokens. Store only the refresh token in `GOOGLE_BUSINESS_REFRESH_TOKEN`; do not put OAuth credentials in the frontend.

Verify credentials without publishing:

```bash
curl http://127.0.0.1:8000/publisher/google-business/verify
```

This verifies OAuth plus account/location access through `mybusinessaccountmanagement.googleapis.com` and `mybusinessbusinessinformation.googleapis.com`. It does not prove the project can publish Local Posts through `mybusiness.googleapis.com/v4`.

Test safely in mock mode:

```text
PUBLISHER_MODE=mock
```

Then approve and schedule a Campaign Content Queue row and run:

```bash
curl -X POST http://127.0.0.1:8000/publisher/run-due
```

Run one Google Business publish job by setting `PUBLISHER_MODE=google_business`, approving only the intended Google Business row, setting `Published=No`, setting `Scheduled At` to a due time, and calling:

```bash
curl -X POST http://127.0.0.1:8000/publisher/run-due
```

On success, the queue row is updated with `Published=Yes`, `Published At`, `External Post ID`, `Published URL` when Google returns `searchUrl`, increments `Publish Attempts`, and clears `Last Publish Error`. On failure, it stays unpublished, increments `Publish Attempts`, and saves `Last Publish Error`.

Manual fallback for legacy API-disabled projects:

If Local Posts publishing fails because `mybusiness.googleapis.com` is disabled or unavailable to the project, Gomez Ops does not mark the row published. Instead it updates the row to:

```text
Status=Ready for Manual Post
Published=No
Publish Attempts=incremented
Last Publish Error=legacy API access explanation
Notes=copy-ready Google Business post package
```

Use the generated package in `Notes`, or the dashboard `Copy Package` button, to publish manually in Google Business Profile Manager. After manual posting, use `Mark Published` to close the row.

Google media posts require public image URLs. Local dashboard image paths like `/media/campaigns/example.jpg` are useful for previewing, but they are not sent to Google unless the value is already an `http://` or `https://` URL that Google can fetch.

## Meta Publishing

Meta publishing uses Meta Graph API directly. It does not automate Meta Business Suite and does not rely on Business Suite crossposting. The Meta Business Suite connection is still useful because the Facebook Page and Instagram account must be linked, but API publishing requires valid Graph API tokens and permissions.

Supported Campaign Content Queue platforms:

```text
Facebook Page
Instagram
Meta Dual
```

Existing `Facebook` rows are also treated as Facebook Page rows for backward compatibility. `Meta Dual` expands internally into two independently tracked targets:

```text
Facebook
Instagram
```

Each target is independently publishable and retryable. If Facebook succeeds and Instagram fails, the row is saved as `Status=Partially Published`, `Published=Partial`, and `Notes` list target-level results. Retry skips any target whose external ID is already recorded.

Required backend environment:

```text
PUBLISHER_MODE=meta
META_GRAPH_API_VERSION=v21.0
META_APP_ID=your-meta-app-id
META_APP_SECRET=your-meta-app-secret
FACEBOOK_PAGE_ID=your-page-id
FACEBOOK_PAGE_ACCESS_TOKEN=your-page-access-token
INSTAGRAM_BUSINESS_ACCOUNT_ID=your-instagram-business-or-creator-id
PUBLIC_SITE_BASE_URL=https://your-public-site.example
API_PUBLIC_BASE_URL=https://your-public-api.example
```

Tokens are backend-only and are never exposed to the frontend.

When Meta token access is blocked, use export mode:

```text
PUBLISHER_MODE=meta_export
```

`meta_export` does not call Meta APIs. For `Facebook Page`, `Instagram`, or `Meta Dual` rows, it generates a copy-ready Meta Business Suite package with Facebook caption, Instagram caption, image URL/path, CTA, landing page, and suggested schedule time. The row is updated to:

```text
Status=Ready for Meta Business Suite
Published=No
Notes=copy-ready Meta Business Suite package
```

The dashboard shows a `Copy Meta Package` button for Meta rows. `PUBLISHER_MODE=meta` remains available for real Graph API publishing once `FACEBOOK_PAGE_ACCESS_TOKEN` and the required permissions are available.

Facebook Page publishing:

```text
With public image_url: POST /{page_id}/photos with url + caption
Without image_url:    POST /{page_id}/feed with message + link
```

Instagram publishing:

```text
POST /{ig_user_id}/media with image_url + caption
POST /{ig_user_id}/media_publish with creation_id
GET  /{media_id}?fields=id,permalink
```

Instagram requires a public `image_url` in this phase. If no public image URL exists, the target is marked `Publish Blocked` with:

```text
Instagram publishing requires a public image URL.
```

Run Meta diagnostics without publishing:

```bash
curl http://127.0.0.1:8000/publisher/meta/diagnostics
```

The diagnostics check the Page token, linked Instagram account, configured Instagram account ID, and token permissions when `META_APP_ID` and `META_APP_SECRET` are available. Typical required permissions include `pages_manage_posts`, `pages_read_engagement`, and `instagram_content_publish`.

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
- Publishing is restricted to approved, scheduled Campaign Content Queue rows and configured owned/authorized publisher modes.
