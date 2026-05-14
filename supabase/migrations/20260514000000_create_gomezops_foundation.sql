-- GomezOps Supabase database foundation.
--
-- Supabase Auth owns the canonical user records in auth.users. The public.profiles
-- table below is the app-owned extension table: profiles.id is the same UUID as
-- auth.users.id, so app profile data can be joined to the authenticated user
-- without copying passwords, sessions, or provider identities into public tables.
--
-- Business-owned tables are scoped by business_id. This makes one authenticated
-- account capable of owning multiple businesses while keeping photos, business
-- context, and generated posts attached to the correct business.
--
-- Row Level Security is enabled on every app table. Policies only allow a user to
-- read or mutate rows where auth.uid() is the profile id or owns the related
-- business, protecting multi-business data even when tables are queried directly
-- through the Supabase API.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'App-owned profile data keyed by auth.users.id. Supabase Auth remains the source of truth for login identities.';
comment on column public.profiles.id is
  'Matches auth.users.id and auth.uid(); one profile row per authenticated user.';

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  industry text,
  location text,
  website_url text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.businesses is
  'Businesses owned by a Supabase Auth user. owner_id scopes business access for multi-business accounts.';
comment on column public.businesses.owner_id is
  'References auth.users.id. RLS policies compare owner_id to auth.uid().';

create table public.business_context (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  services text[] not null default '{}',
  target_customers text,
  brand_voice text,
  differentiators text[] not null default '{}',
  service_area text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.business_context is
  'One context record per business for generation inputs such as services, customers, voice, differentiators, and service area.';
comment on column public.business_context.business_id is
  'Scopes business context to the owning business so RLS can enforce auth.uid() ownership through public.businesses.';

create table public.photo_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  storage_path text not null,
  public_url text,
  caption text,
  tags text[] not null default '{}',
  job_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.photo_assets is
  'Photo metadata for business-scoped job and marketing assets. File storage will be connected later.';
comment on column public.photo_assets.business_id is
  'Scopes each photo to a business; users can only access photos for businesses they own.';

create table public.generated_posts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  tool_type text not null,
  platform text,
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.generated_posts is
  'Business-scoped generated content drafts. Existing generation workflows are not connected to this table yet.';
comment on column public.generated_posts.business_id is
  'Scopes each generated post to a business; RLS checks ownership through public.businesses.';
comment on column public.generated_posts.metadata is
  'Flexible JSON payload for prompt inputs, source IDs, model details, review notes, or platform-specific fields.';

create index businesses_owner_id_idx on public.businesses(owner_id);
create index photo_assets_business_id_idx on public.photo_assets(business_id);
create index photo_assets_tags_idx on public.photo_assets using gin(tags);
create index generated_posts_business_id_idx on public.generated_posts(business_id);
create index generated_posts_status_idx on public.generated_posts(status);
create index generated_posts_metadata_idx on public.generated_posts using gin(metadata);

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger set_businesses_updated_at
before update on public.businesses
for each row
execute function public.set_updated_at();

create trigger set_business_context_updated_at
before update on public.business_context
for each row
execute function public.set_updated_at();

create trigger set_photo_assets_updated_at
before update on public.photo_assets
for each row
execute function public.set_updated_at();

create trigger set_generated_posts_updated_at
before update on public.generated_posts
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_context enable row level security;
alter table public.photo_assets enable row level security;
alter table public.generated_posts enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

comment on policy "profiles_select_own" on public.profiles is
  'Users can only read the profile whose id matches auth.uid().';
comment on policy "profiles_insert_own" on public.profiles is
  'Users can only create their own profile extension row.';
comment on policy "profiles_update_own" on public.profiles is
  'Users can only update their own profile extension row.';

create policy "businesses_select_owned"
on public.businesses
for select
to authenticated
using (owner_id = auth.uid());

create policy "businesses_insert_owned"
on public.businesses
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "businesses_update_owned"
on public.businesses
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "businesses_delete_owned"
on public.businesses
for delete
to authenticated
using (owner_id = auth.uid());

comment on policy "businesses_select_owned" on public.businesses is
  'Users can only read businesses where owner_id equals auth.uid().';
comment on policy "businesses_insert_owned" on public.businesses is
  'Users can only create businesses owned by their authenticated user id.';
comment on policy "businesses_update_owned" on public.businesses is
  'Users can only update businesses they own and cannot transfer ownership through RLS.';
comment on policy "businesses_delete_owned" on public.businesses is
  'Users can only delete businesses they own.';

create policy "business_context_select_owned_business"
on public.business_context
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = business_context.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "business_context_insert_owned_business"
on public.business_context
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses
    where businesses.id = business_context.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "business_context_update_owned_business"
on public.business_context
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = business_context.business_id
      and businesses.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses
    where businesses.id = business_context.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "business_context_delete_owned_business"
on public.business_context
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = business_context.business_id
      and businesses.owner_id = auth.uid()
  )
);

comment on policy "business_context_select_owned_business" on public.business_context is
  'Users can only read context rows attached to businesses they own.';
comment on policy "business_context_insert_owned_business" on public.business_context is
  'Users can only create context for businesses they own.';
comment on policy "business_context_update_owned_business" on public.business_context is
  'Users can only update context for businesses they own.';
comment on policy "business_context_delete_owned_business" on public.business_context is
  'Users can only delete context for businesses they own.';

create policy "photo_assets_select_owned_business"
on public.photo_assets
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = photo_assets.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "photo_assets_insert_owned_business"
on public.photo_assets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses
    where businesses.id = photo_assets.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "photo_assets_update_owned_business"
on public.photo_assets
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = photo_assets.business_id
      and businesses.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses
    where businesses.id = photo_assets.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "photo_assets_delete_owned_business"
on public.photo_assets
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = photo_assets.business_id
      and businesses.owner_id = auth.uid()
  )
);

comment on policy "photo_assets_select_owned_business" on public.photo_assets is
  'Users can only read photos attached to businesses they own.';
comment on policy "photo_assets_insert_owned_business" on public.photo_assets is
  'Users can only create photo metadata for businesses they own.';
comment on policy "photo_assets_update_owned_business" on public.photo_assets is
  'Users can only update photo metadata for businesses they own.';
comment on policy "photo_assets_delete_owned_business" on public.photo_assets is
  'Users can only delete photo metadata for businesses they own.';

create policy "generated_posts_select_owned_business"
on public.generated_posts
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = generated_posts.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "generated_posts_insert_owned_business"
on public.generated_posts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses
    where businesses.id = generated_posts.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "generated_posts_update_owned_business"
on public.generated_posts
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = generated_posts.business_id
      and businesses.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses
    where businesses.id = generated_posts.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "generated_posts_delete_owned_business"
on public.generated_posts
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = generated_posts.business_id
      and businesses.owner_id = auth.uid()
  )
);

comment on policy "generated_posts_select_owned_business" on public.generated_posts is
  'Users can only read generated posts attached to businesses they own.';
comment on policy "generated_posts_insert_owned_business" on public.generated_posts is
  'Users can only create generated posts for businesses they own.';
comment on policy "generated_posts_update_owned_business" on public.generated_posts is
  'Users can only update generated posts for businesses they own.';
comment on policy "generated_posts_delete_owned_business" on public.generated_posts is
  'Users can only delete generated posts for businesses they own.';
