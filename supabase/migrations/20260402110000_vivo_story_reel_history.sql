begin;

create table if not exists public.vivo_story_reel_generation_runs (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  pipeline_job_id uuid references public.vivo_pipeline_jobs(id) on delete set null,
  content_strategy public.vivo_asset_decision not null default 'generate',
  generator_name text,
  generator_version text,
  selector_name text,
  selector_version text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  run_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vivo_story_reel_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.vivo_story_reel_generation_runs(id) on delete cascade,
  candidate_key text not null,
  candidate_kind text not null,
  candidate_rank integer not null default 0,
  creative_mode text,
  is_selected boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint vivo_story_reel_candidates_kind_check
    check (candidate_kind in ('selection', 'reel')),
  constraint vivo_story_reel_candidates_rank_check
    check (candidate_rank >= 0),
  constraint vivo_story_reel_candidates_run_key_key
    unique (run_id, candidate_key)
);

create index if not exists vivo_story_reel_generation_runs_story_created_at_idx
  on public.vivo_story_reel_generation_runs (story_id, created_at desc);

create index if not exists vivo_story_reel_generation_runs_content_strategy_created_at_idx
  on public.vivo_story_reel_generation_runs (content_strategy, created_at desc);

create index if not exists vivo_story_reel_candidates_run_selected_rank_idx
  on public.vivo_story_reel_candidates (run_id, is_selected desc, candidate_rank asc, created_at asc);

create index if not exists vivo_story_reel_candidates_creative_mode_idx
  on public.vivo_story_reel_candidates (creative_mode)
  where creative_mode is not null;

create index if not exists vivo_story_reel_candidates_payload_gin_idx
  on public.vivo_story_reel_candidates
  using gin (payload jsonb_path_ops);

commit;
