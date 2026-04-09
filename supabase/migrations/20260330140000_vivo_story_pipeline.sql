begin;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'vivo_story_status'
      and n.nspname = 'public'
  ) then
    create type public.vivo_story_status as enum (
      'new',
      'classifying',
      'classified',
      'media_decided',
      'asset_generating',
      'ready_to_publish',
      'published',
      'failed',
      'archived'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'vivo_asset_decision'
      and n.nspname = 'public'
  ) then
    create type public.vivo_asset_decision as enum (
      'take_existing',
      'generate',
      'edit_image'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'vivo_asset_status'
      and n.nspname = 'public'
  ) then
    create type public.vivo_asset_status as enum (
      'pending',
      'queued',
      'processing',
      'ready',
      'failed',
      'skipped'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'vivo_job_status'
      and n.nspname = 'public'
  ) then
    create type public.vivo_job_status as enum (
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'vivo_publication_status'
      and n.nspname = 'public'
  ) then
    create type public.vivo_publication_status as enum (
      'queued',
      'published',
      'failed',
      'deleted'
    );
  end if;
end
$$;

create or replace function public.vivo_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.vivo_factories (
  id uuid primary key default gen_random_uuid(),
  factory_key text not null unique,
  name text not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vivo_audiences (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.vivo_factories(id) on delete restrict,
  audience_key text not null unique,
  label text not null,
  language text not null default 'en',
  location text not null default '',
  family_context text not null default '',
  interests text[] not null default '{}'::text[],
  content_pillars text[] not null default '{}'::text[],
  excluded_topics text[] not null default '{}'::text[],
  tone text not null default 'helpful',
  profile_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vivo_instances (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.vivo_factories(id) on delete restrict,
  audience_id uuid not null references public.vivo_audiences(id) on delete restrict,
  instance_key text not null unique,
  service_name text not null,
  openclaw_admin_url text not null,
  profile_base_url text,
  runtime_config jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint vivo_instances_audience_id_key unique (audience_id)
);

create table if not exists public.vivo_stories (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.vivo_factories(id) on delete restrict,
  audience_id uuid not null references public.vivo_audiences(id) on delete restrict,
  instance_id uuid references public.vivo_instances(id) on delete restrict,
  story_key text not null unique,
  title text not null,
  story_text text not null,
  summary text not null default '',
  source_kind text not null default 'curated',
  primary_source_url text,
  status public.vivo_story_status not null default 'new',
  latest_classification_id uuid,
  current_category text,
  current_subcategory text,
  current_sentiment text,
  is_local boolean not null default false,
  is_event boolean not null default false,
  is_deal boolean not null default false,
  is_time_sensitive boolean not null default false,
  one_liner text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vivo_story_sources (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  source_type text not null,
  source_url text not null,
  source_title text,
  source_publisher text,
  rank_order integer not null default 0,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vivo_story_classifications (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  classifier_name text not null,
  classifier_version text,
  category text not null,
  subcategory text,
  is_local boolean not null default false,
  is_event boolean not null default false,
  is_deal boolean not null default false,
  is_time_sensitive boolean not null default false,
  sentiment text,
  tags text[] not null default '{}'::text[],
  confidence numeric(5,4),
  one_liner text,
  reasoning text,
  raw_output jsonb not null default '{}'::jsonb,
  classified_at timestamptz not null default timezone('utc', now())
);

alter table public.vivo_stories
  add constraint vivo_stories_latest_classification_fk
  foreign key (latest_classification_id)
  references public.vivo_story_classifications(id)
  on delete set null;

create table if not exists public.vivo_storage_objects (
  id uuid primary key default gen_random_uuid(),
  bucket_name text not null,
  object_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  duration_seconds numeric(12,3),
  checksum text,
  storage_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint vivo_storage_objects_bucket_path_key unique (bucket_name, object_path)
);

create table if not exists public.vivo_story_assets (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  asset_slot text not null,
  asset_type text not null,
  decision public.vivo_asset_decision not null,
  status public.vivo_asset_status not null default 'pending',
  is_required boolean not null default true,
  personalization_angle text,
  scene_description text,
  source_asset_url text,
  storage_object_id uuid references public.vivo_storage_objects(id) on delete set null,
  mime_type text,
  width integer,
  height integer,
  duration_seconds numeric(12,3),
  checksum text,
  error_message text,
  ready_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint vivo_story_assets_story_slot_key unique (story_id, asset_slot),
  constraint vivo_story_assets_asset_type_check check (asset_type in ('image', 'video'))
);

create table if not exists public.vivo_story_asset_decisions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.vivo_story_assets(id) on delete cascade,
  decision public.vivo_asset_decision not null,
  content_type text not null,
  personalization_angle text,
  scene_description text,
  reasoning text,
  confidence numeric(5,4),
  raw_output jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default timezone('utc', now()),
  constraint vivo_story_asset_decisions_content_type_check check (content_type in ('image', 'video'))
);

create table if not exists public.vivo_pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  asset_id uuid references public.vivo_story_assets(id) on delete cascade,
  job_type text not null,
  trigger_status public.vivo_story_status,
  status public.vivo_job_status not null default 'queued',
  endpoint_name text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  error_message text,
  queued_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint vivo_pipeline_jobs_attempt_count_check check (attempt_count >= 0)
);

create table if not exists public.vivo_story_publications (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  asset_id uuid references public.vivo_story_assets(id) on delete set null,
  channel text not null,
  target_identifier text not null,
  external_message_id text,
  status public.vivo_publication_status not null default 'queued',
  publish_payload jsonb not null default '{}'::jsonb,
  publish_response jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vivo_feedback_events (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.vivo_story_publications(id) on delete cascade,
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  audience_id uuid not null references public.vivo_audiences(id) on delete restrict,
  event_source text not null,
  snapshot_time timestamptz not null,
  impression_count integer not null default 0,
  reply_count integer not null default 0,
  reaction_count integer not null default 0,
  button_click_count integer not null default 0,
  share_count integer not null default 0,
  save_count integer not null default 0,
  moderator_score numeric(10,4),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint vivo_feedback_events_non_negative_counts_check check (
    impression_count >= 0
    and reply_count >= 0
    and reaction_count >= 0
    and button_click_count >= 0
    and share_count >= 0
    and save_count >= 0
  )
);

create table if not exists public.vivo_audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  actor_type text,
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.vivo_validate_story_latest_classification()
returns trigger
language plpgsql
as $$
declare
  classification_story_id uuid;
begin
  if new.latest_classification_id is null then
    return new;
  end if;

  select story_id
    into classification_story_id
  from public.vivo_story_classifications
  where id = new.latest_classification_id;

  if classification_story_id is null then
    raise exception 'Latest classification % does not exist', new.latest_classification_id;
  end if;

  if classification_story_id <> new.id then
    raise exception 'Latest classification % belongs to story %, not %',
      new.latest_classification_id,
      classification_story_id,
      new.id;
  end if;

  return new;
end;
$$;

create or replace function public.vivo_validate_story_ready_to_publish()
returns trigger
language plpgsql
as $$
declare
  has_publishable_asset boolean;
  has_unready_required_asset boolean;
begin
  if new.status = 'ready_to_publish' then
    select exists (
      select 1
      from public.vivo_story_assets
      where story_id = new.id
        and asset_type in ('image', 'video')
    )
    into has_publishable_asset;

    if not has_publishable_asset then
      raise exception 'Story % cannot be ready_to_publish without at least one image or video asset', new.id;
    end if;

    select exists (
      select 1
      from public.vivo_story_assets
      where story_id = new.id
        and is_required = true
        and status <> 'ready'
    )
    into has_unready_required_asset;

    if has_unready_required_asset then
      raise exception 'Story % cannot be ready_to_publish while required assets are not ready', new.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists vivo_factories_set_updated_at on public.vivo_factories;
create trigger vivo_factories_set_updated_at
before update on public.vivo_factories
for each row
execute function public.vivo_set_updated_at();

drop trigger if exists vivo_audiences_set_updated_at on public.vivo_audiences;
create trigger vivo_audiences_set_updated_at
before update on public.vivo_audiences
for each row
execute function public.vivo_set_updated_at();

drop trigger if exists vivo_instances_set_updated_at on public.vivo_instances;
create trigger vivo_instances_set_updated_at
before update on public.vivo_instances
for each row
execute function public.vivo_set_updated_at();

drop trigger if exists vivo_stories_set_updated_at on public.vivo_stories;
create trigger vivo_stories_set_updated_at
before update on public.vivo_stories
for each row
execute function public.vivo_set_updated_at();

drop trigger if exists vivo_storage_objects_set_updated_at on public.vivo_storage_objects;
create trigger vivo_storage_objects_set_updated_at
before update on public.vivo_storage_objects
for each row
execute function public.vivo_set_updated_at();

drop trigger if exists vivo_story_assets_set_updated_at on public.vivo_story_assets;
create trigger vivo_story_assets_set_updated_at
before update on public.vivo_story_assets
for each row
execute function public.vivo_set_updated_at();

drop trigger if exists vivo_pipeline_jobs_set_updated_at on public.vivo_pipeline_jobs;
create trigger vivo_pipeline_jobs_set_updated_at
before update on public.vivo_pipeline_jobs
for each row
execute function public.vivo_set_updated_at();

drop trigger if exists vivo_story_publications_set_updated_at on public.vivo_story_publications;
create trigger vivo_story_publications_set_updated_at
before update on public.vivo_story_publications
for each row
execute function public.vivo_set_updated_at();

drop trigger if exists vivo_stories_validate_latest_classification on public.vivo_stories;
create trigger vivo_stories_validate_latest_classification
before insert or update of latest_classification_id on public.vivo_stories
for each row
execute function public.vivo_validate_story_latest_classification();

drop trigger if exists vivo_stories_validate_ready_to_publish on public.vivo_stories;
create trigger vivo_stories_validate_ready_to_publish
before insert or update of status on public.vivo_stories
for each row
execute function public.vivo_validate_story_ready_to_publish();

create unique index if not exists vivo_story_publications_channel_external_message_id_uidx
  on public.vivo_story_publications (channel, external_message_id)
  where external_message_id is not null;

create index if not exists vivo_stories_status_created_at_idx
  on public.vivo_stories (status, created_at desc);

create index if not exists vivo_stories_audience_created_at_idx
  on public.vivo_stories (audience_id, created_at desc);

create index if not exists vivo_stories_instance_created_at_idx
  on public.vivo_stories (instance_id, created_at desc);

create index if not exists vivo_story_classifications_story_classified_at_idx
  on public.vivo_story_classifications (story_id, classified_at desc);

create index if not exists vivo_story_assets_story_status_idx
  on public.vivo_story_assets (story_id, status, asset_type);

create index if not exists vivo_pipeline_jobs_status_queued_at_idx
  on public.vivo_pipeline_jobs (status, queued_at);

create index if not exists vivo_pipeline_jobs_story_queued_at_idx
  on public.vivo_pipeline_jobs (story_id, queued_at desc);

create index if not exists vivo_feedback_events_publication_snapshot_time_idx
  on public.vivo_feedback_events (publication_id, snapshot_time desc);

create index if not exists vivo_feedback_events_story_snapshot_time_idx
  on public.vivo_feedback_events (story_id, snapshot_time desc);

create index if not exists vivo_audit_events_entity_created_at_idx
  on public.vivo_audit_events (entity_type, entity_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vivo-content',
  'vivo-content',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
