# Supabase Foundation

This folder contains the first GomezOps Supabase database migration:

```text
supabase/migrations/20260514000000_create_gomezops_foundation.sql
```

It creates the app-owned tables for future account creation and multi-business support:

- `profiles`
- `businesses`
- `business_context`
- `photo_assets`
- `generated_posts`

## Model Notes

Supabase Auth stores users in `auth.users`. GomezOps profile records live in `public.profiles`, where `profiles.id` references `auth.users.id`; this keeps authentication data in Supabase Auth while giving the app a place for profile fields.

`businesses.owner_id` also references `auth.users.id`. Tables that belong to a business use `business_id`, so context, photos, and generated posts stay attached to the correct business when one user owns multiple businesses.

Row Level Security is enabled on every app table. Profile policies allow access only when `profiles.id = auth.uid()`. Business policies allow access only when `businesses.owner_id = auth.uid()`. Business-scoped table policies check the related `businesses` row before allowing reads or writes.

## Apply The Migration

With the Supabase CLI:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

Or apply the SQL manually in the Supabase SQL editor by running the migration file.

## Environment Variables

Backend Supabase access now uses:

```text
SUPABASE_ENABLED=true
SUPABASE_URL=your-project-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
DEV_OWNER_USER_ID=temporary-auth-user-uuid
```

Keep `SUPABASE_SERVICE_ROLE_KEY` backend-only. Never expose it through Vite or frontend code.

Future frontend auth work may also need Vite-exposed Supabase values such as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, but this step does not add frontend login/signup.

## Backend Step 2 Notes

The FastAPI backend now has a Supabase client and business data service layer. Enable it with the backend environment variables above.

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS, so the backend service enforces owner scoping on every operation. `DEV_OWNER_USER_ID` is temporary and is only used because full auth/JWT handling is not implemented yet. Replace it with identity derived from the authenticated Supabase JWT in a later step.

Business-scoped API routes:

```text
GET    /businesses
POST   /businesses
PATCH  /businesses/{business_id}
GET    /businesses/{business_id}/context
PUT    /businesses/{business_id}/context
GET    /businesses/{business_id}/photos
POST   /businesses/{business_id}/photos
DELETE /businesses/{business_id}/photos/{photo_asset_id}
GET    /businesses/{business_id}/generated-posts
POST   /businesses/{business_id}/generated-posts
PATCH  /businesses/{business_id}/generated-posts/{generated_post_id}
```

## Photo Library Scope

The frontend Photo Library is business-scoped through `/businesses/{business_id}/photos`. Step 4 stores photo metadata in the database row only: `storage_path`, optional `public_url`, caption, tags, and job type. Actual Supabase Storage binary upload is not implemented yet.

Until storage upload is added, the UI can save public image URLs or local preview data as metadata so existing generation and selected-photo flows keep working. For production durability, prefer public image URLs or add Supabase Storage in a later step.
