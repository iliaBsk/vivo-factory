alter table public.vivo_audiences
  add column if not exists hero_image_asset_storage_id uuid references public.vivo_storage_objects(id) on delete set null;
