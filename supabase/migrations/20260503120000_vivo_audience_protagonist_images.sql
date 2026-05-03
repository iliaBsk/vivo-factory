create table if not exists public.vivo_audience_protagonist_images (
  id                uuid        primary key default gen_random_uuid(),
  audience_id       uuid        not null references public.vivo_audiences(id) on delete cascade,
  category          text        not null,
  storage_object_id uuid        not null references public.vivo_storage_objects(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint vivo_audience_protagonist_images_unique
    unique (audience_id, category),
  constraint vivo_audience_protagonist_images_category_check
    check (category in ('news','events','food','deals','tech',
                        'entertainment','health','sports','finance','fashion','travel'))
);

create index if not exists vivo_protagonist_images_audience_idx
  on public.vivo_audience_protagonist_images (audience_id);

create trigger vivo_protagonist_images_set_updated_at
  before update on public.vivo_audience_protagonist_images
  for each row execute function public.set_updated_at();
