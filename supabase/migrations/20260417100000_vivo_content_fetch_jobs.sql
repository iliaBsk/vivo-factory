create table if not exists public.vivo_content_fetch_jobs (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid references public.vivo_factories(id) on delete restrict,
  audience_id uuid not null references public.vivo_audiences(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  stories_created integer,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists vivo_content_fetch_jobs_audience_status_idx
  on public.vivo_content_fetch_jobs (audience_id, status, created_at desc);
