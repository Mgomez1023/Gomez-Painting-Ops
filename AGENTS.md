# Gomez Ops Agent Instructions

These instructions apply to the whole repository. Use them when making future Codex changes, especially around Settings, connected accounts, queueing, and publishing.

## Project Purpose

Gomez Ops is a local-business social media operations app for generating, reviewing, scheduling, manually posting, and eventually automatically publishing business social content.

## Architecture Facts

- FastAPI backend code lives in `backend/app`.
- React/Vite frontend code lives in `frontend/src`.
- Business, business profile/context, photo asset, and generated post data use Supabase through `BusinessDataService`.
- Businesses are scoped by `owner_id` and `business_id`. Until authentication is implemented, `get_current_owner_id()` reads `DEV_OWNER_USER_ID`.
- Queue, post, campaign, and weekly content workflow data currently uses Google Sheets through `SheetsService`.
- Do not remove Google Sheets queue behavior. The Posts, Content Queue, Campaigns, and Campaign Content Queue flows still depend on Sheets.
- LLM content generation goes through `LLMService` and agent classes in `backend/app/agents`.
- Publishing execution must go through `PublisherService` and `PublishingWorkflowService`.
- `/publisher/run-due` is the execution boundary for due publishing jobs.
- The app already includes Settings, active business selection, business profile, photo library, weekly content calendar, post modals, Jobs + Queues, and publisher routes.
- Publisher implementations already include `MockPublisher`, `GoogleBusinessPublisher`, Meta Graph publishing classes, and Meta export/manual workflow support.

## Safety Rules

- Do not let frontend code store OAuth access tokens, refresh tokens, service role keys, page tokens, app secrets, or Google service account material.
- Do not expose provider tokens through API responses intended for the frontend.
- Do not let LLM logic publish directly. LLMs may create drafts only.
- Do not bypass `PublisherService` for publishing.
- Do not bypass `PublishingWorkflowService` for due-job execution.
- Do not bypass `SheetsService` for Google Sheets queue data.
- Do not remove multiple-business support.
- Do not bind one OAuth login directly to one Gomez Ops business. Model `connection -> targets -> business target mapping`.
- Facebook Groups, Craigslist, and Nextdoor are manual/export workflows only unless official authorized APIs are added later.
- Preserve human review and approval gates. Generated content should remain drafts until explicitly reviewed or scheduled.
- Keep `SUPABASE_SERVICE_ROLE_KEY` backend-only. Frontend/Vite env vars must not contain backend secrets.

## Recommended Integration Model

When preparing Settings connected-account work, prefer this storage model:

- `social_connections`: provider account connection records and backend-only token metadata.
- `social_targets`: pages, accounts, locations, or other publishable targets discovered from a connection.
- `business_publish_targets`: mapping from a Gomez Ops business to one selected target per platform.
- Queue rows and posts should only reference publish targets indirectly, or through notes/metadata, until the storage model is cleanly updated.

Do not implement real OAuth unless the task explicitly asks for it. For early Settings UI work, use backend-owned placeholder connection state or mock provider status without persisting real provider tokens.

## Commands

Backend setup and local run from the README:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
uvicorn app.main:app --reload
```

PowerShell variant from the README:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend tests:

```bash
cd backend
pytest
```

Frontend setup and dev server:

```bash
cd frontend
npm install
npm run dev
```

Frontend production build, from `frontend/package.json`:

```bash
cd frontend
npm run build
```

Known local env requirements:

- Frontend uses `VITE_API_BASE_URL`, commonly `http://127.0.0.1:8000`.
- Backend can use `LLM_PROVIDER=placeholder` for deterministic local output without API calls.
- For OpenAI generation, set `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL`.
- Google Sheets workflows need `GOOGLE_SHEETS_SPREADSHEET_ID` plus either `GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_SERVICE_ACCOUNT_JSON`, and the configured sheet names.
- Supabase-backed business data needs `SUPABASE_ENABLED=true`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `DEV_OWNER_USER_ID` until real auth exists.
- Publishing defaults to `PUBLISHER_MODE=mock`. Real provider modes require backend-only provider credentials.
- Public media publishing may require `PUBLIC_SITE_BASE_URL` and `API_PUBLIC_BASE_URL` so providers can fetch images.

## Codex Workflow

- Inspect the relevant backend, frontend, README, env example, and tests before editing.
- Make small, focused changes that preserve current behavior.
- Preserve multiple-business support and active business selection.
- Preserve the current Google Sheets queue workflows.
- Preserve `PublisherService` and route publishing through it instead of rewriting the publisher boundary.
- Run focused tests or builds where available. At minimum, consider `cd backend && pytest` for backend changes and `cd frontend && npm run build` for frontend changes.
- Summarize changed files, commands run, and residual risks at the end of the task.
