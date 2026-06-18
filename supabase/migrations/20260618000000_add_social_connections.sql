-- Social connection foundation for Settings publishing integrations.
--
-- These tables store provider connection metadata, discoverable publish targets,
-- and per-business target choices. They do not store frontend-visible tokens.
-- Fake/dev connections use token_metadata = '{}' and are only a foundation for
-- later OAuth-backed integrations.

create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('meta', 'google_business')),
  account_label text not null,
  external_account_id text not null,
  connection_kind text not null default 'fake',
  status text not null default 'connected',
  token_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_connections_owner_provider_external_unique unique (owner_id, provider, external_account_id)
);

comment on table public.social_connections is
  'Provider account connections owned by a Gomez Ops user. Token metadata is backend-only and must not be returned to the frontend.';
comment on column public.social_connections.owner_id is
  'References auth.users.id. RLS policies compare owner_id to auth.uid().';
comment on column public.social_connections.token_metadata is
  'Backend-only token metadata placeholder. Fake connections use an empty object and never store real OAuth tokens.';

create table public.social_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.social_connections(id) on delete cascade,
  provider text not null check (provider in ('meta', 'google_business')),
  platform text not null check (platform in ('Facebook', 'Instagram', 'Google Business')),
  target_type text not null,
  display_name text not null,
  external_target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_targets_connection_platform_external_unique unique (connection_id, platform, external_target_id)
);

comment on table public.social_targets is
  'Publishable pages, accounts, and locations discovered from a provider connection. Facebook Groups are intentionally excluded.';
comment on column public.social_targets.connection_id is
  'Targets are globally available to the owner through the connection; businesses select targets through business_publish_targets.';

create table public.business_publish_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  platform text not null check (platform in ('Facebook', 'Instagram', 'Google Business')),
  social_target_id uuid not null references public.social_targets(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_publish_targets_business_platform_unique unique (business_id, platform)
);

comment on table public.business_publish_targets is
  'Per-business mapping from Gomez Ops businesses to selected provider targets. One selected target per supported platform.';
comment on column public.business_publish_targets.business_id is
  'Keeps publish target selection separate for each business owned by the same user.';

create index social_connections_owner_id_idx on public.social_connections(owner_id);
create index social_targets_owner_id_idx on public.social_targets(owner_id);
create index social_targets_connection_id_idx on public.social_targets(connection_id);
create index social_targets_platform_idx on public.social_targets(platform);
create index business_publish_targets_owner_id_idx on public.business_publish_targets(owner_id);
create index business_publish_targets_business_id_idx on public.business_publish_targets(business_id);
create index business_publish_targets_social_target_id_idx on public.business_publish_targets(social_target_id);

create trigger set_social_connections_updated_at
before update on public.social_connections
for each row
execute function public.set_updated_at();

create trigger set_social_targets_updated_at
before update on public.social_targets
for each row
execute function public.set_updated_at();

create trigger set_business_publish_targets_updated_at
before update on public.business_publish_targets
for each row
execute function public.set_updated_at();

alter table public.social_connections enable row level security;
alter table public.social_targets enable row level security;
alter table public.business_publish_targets enable row level security;

create policy "social_connections_select_owned"
on public.social_connections
for select
to authenticated
using (owner_id = auth.uid());

create policy "social_connections_insert_owned"
on public.social_connections
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "social_connections_update_owned"
on public.social_connections
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "social_connections_delete_owned"
on public.social_connections
for delete
to authenticated
using (owner_id = auth.uid());

create policy "social_targets_select_owned"
on public.social_targets
for select
to authenticated
using (owner_id = auth.uid());

create policy "social_targets_insert_owned_connection"
on public.social_targets
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.social_connections
    where social_connections.id = social_targets.connection_id
      and social_connections.owner_id = auth.uid()
  )
);

create policy "social_targets_update_owned_connection"
on public.social_targets
for update
to authenticated
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.social_connections
    where social_connections.id = social_targets.connection_id
      and social_connections.owner_id = auth.uid()
  )
);

create policy "social_targets_delete_owned"
on public.social_targets
for delete
to authenticated
using (owner_id = auth.uid());

create policy "business_publish_targets_select_owned_business"
on public.business_publish_targets
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = business_publish_targets.business_id
      and businesses.owner_id = auth.uid()
  )
);

create policy "business_publish_targets_insert_owned_business_and_target"
on public.business_publish_targets
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.businesses
    where businesses.id = business_publish_targets.business_id
      and businesses.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.social_targets
    where social_targets.id = business_publish_targets.social_target_id
      and social_targets.owner_id = auth.uid()
      and social_targets.platform = business_publish_targets.platform
  )
);

create policy "business_publish_targets_update_owned_business_and_target"
on public.business_publish_targets
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = business_publish_targets.business_id
      and businesses.owner_id = auth.uid()
  )
)
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.businesses
    where businesses.id = business_publish_targets.business_id
      and businesses.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.social_targets
    where social_targets.id = business_publish_targets.social_target_id
      and social_targets.owner_id = auth.uid()
      and social_targets.platform = business_publish_targets.platform
  )
);

create policy "business_publish_targets_delete_owned_business"
on public.business_publish_targets
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = business_publish_targets.business_id
      and businesses.owner_id = auth.uid()
  )
);
