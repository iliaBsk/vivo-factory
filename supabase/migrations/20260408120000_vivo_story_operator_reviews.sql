begin;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'vivo_operator_review_status'
      and n.nspname = 'public'
  ) then
    create type public.vivo_operator_review_status as enum (
      'pending',
      'approved',
      'rejected',
      'changes_requested'
    );
  end if;
end
$$;

create table if not exists public.vivo_story_reviews (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  review_status public.vivo_operator_review_status not null,
  selected_asset_id uuid references public.vivo_story_assets(id) on delete set null,
  review_notes text not null default '',
  actor_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.vivo_stories
  add column if not exists operator_review_status public.vivo_operator_review_status not null default 'pending',
  add column if not exists operator_reviewed_at timestamptz,
  add column if not exists operator_reviewed_by text,
  add column if not exists operator_review_note text not null default '';

alter table public.vivo_story_assets
  add column if not exists is_selected boolean not null default false;

create unique index if not exists vivo_story_assets_story_selected_uidx
  on public.vivo_story_assets (story_id)
  where is_selected = true;

create index if not exists vivo_story_reviews_story_created_at_idx
  on public.vivo_story_reviews (story_id, created_at desc);

create index if not exists vivo_stories_review_status_created_at_idx
  on public.vivo_stories (operator_review_status, created_at desc);

commit;
