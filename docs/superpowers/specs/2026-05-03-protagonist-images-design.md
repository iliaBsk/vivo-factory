# Protagonist Images per Category — Design Spec

## Goal

Each audience can have one protagonist image per story category. The existing hero image (personal photo) remains the global fallback. The pipeline picks the per-category image when set, and falls back to the hero image when not. Users can upload/replace/delete protagonist images post-creation from the audience detail drawer.

## Architecture

A new Supabase table (`vivo_audience_protagonist_images`) stores one row per (audience, category). The existing `hero_image_asset_storage_id` column on `vivo_audiences` is untouched — it acts as the fallback and also as the explicit image for lifestyle categories (fashion, entertainment, travel) unless overridden. Four new repository methods handle CRUD. Three new API endpoints handle upload/list/delete. The audience drawer gains an **Images** tab with a hero image replace section and a category grid.

## Valid Categories

The check constraint enforces this fixed set, matching the sources catalog plus content-pipeline values:

```
news, events, food, deals, tech, entertainment, health, sports, finance, fashion, travel
```

Category icons used in the UI:

| Category | Icon |
|---|---|
| news | 📰 |
| events | 🎭 |
| food | 🍽 |
| deals | 🏷 |
| tech | 💻 |
| entertainment | 🎬 |
| health | 🏃 |
| sports | ⚽ |
| finance | 📈 |
| fashion | 👗 |
| travel | ✈ |

## Database

### Migration file: `supabase/migrations/20260503120000_vivo_audience_protagonist_images.sql`

```sql
create table if not exists public.vivo_audience_protagonist_images (
  id                uuid        primary key default gen_random_uuid(),
  audience_id       uuid        not null references public.vivo_audiences(id) on delete cascade,
  category          text        not null,
  storage_object_id uuid        not null references public.vivo_storage_objects(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint vivo_audience_protagonist_images_unique  unique (audience_id, category),
  constraint vivo_audience_protagonist_images_category_check
    check (category in ('news','events','food','deals','tech',
                        'entertainment','health','sports','finance','fashion','travel'))
);

create index if not exists vivo_protagonist_images_audience_idx
  on public.vivo_audience_protagonist_images (audience_id);

create trigger vivo_protagonist_images_set_updated_at
  before update on public.vivo_audience_protagonist_images
  for each row execute function public.set_updated_at();
```

The `set_updated_at()` function already exists in the database (used on `vivo_audiences`).

## Repository (`src/repository.js`)

Four new methods on the Supabase repository (and matching no-op stubs on the file repository):

### `getProtagonistImages(audienceId)`

Returns `Map<category, { storage_object_id, url }>`. Joins `vivo_audience_protagonist_images` with `vivo_storage_objects` to resolve the public URL.

### `upsertProtagonistImage(audienceId, category, photo)`

`photo` has the same shape as the existing photo payload: `{ file_data_base64, mime_type, file_name, size_bytes }`.

- Validates category is in the allowed set
- Uploads buffer to Supabase Storage at path `vivo-audiences/{audienceId}/protagonist/{category}.{ext}`
- Upserts `vivo_storage_objects` row (same pattern as `storeAudiencePhoto`)
- Upserts `vivo_audience_protagonist_images` row with `on conflict (audience_id, category) do update`
- Returns `storage_object_id`

### `deleteProtagonistImage(audienceId, category)`

Deletes the `vivo_audience_protagonist_images` row. Storage object is kept (same convention as hero image delete — no orphan cleanup).

### `getEffectiveProtagonistStorageId(audienceId, category)`

Returns the per-category `storage_object_id` if set, else the audience's `hero_image_asset_storage_id`. Used by the story asset pipeline.

## API Endpoints (`src/app.js`)

All three routes are added alongside the existing `/api/audiences/:id/*` routes. The `audienceId` is validated against the repository; a missing audience returns 404.

### `GET /api/audiences/:id/protagonist-images`

Returns:
```json
{
  "success": true,
  "data": {
    "images": {
      "news": { "url": "https://...", "storage_object_id": "uuid" },
      "tech": { "url": "https://...", "storage_object_id": "uuid" }
    }
  }
}
```

### `POST /api/audiences/:id/protagonist-images/:category`

Request body (JSON):
```json
{
  "photo": {
    "file_data_base64": "...",
    "mime_type": "image/jpeg",
    "file_name": "batman.jpg",
    "size_bytes": 204800
  }
}
```

Validation:
- `category` must be in the allowed set → 400 otherwise
- `mime_type` must be `image/jpeg`, `image/png`, `image/webp`, or `image/gif` → 400
- `size_bytes` must be ≤ 5 MB → 400
- `file_data_base64` must decode to a non-empty buffer → 400

Returns `{ "success": true, "data": { "storage_object_id": "uuid" } }` on success.

### `DELETE /api/audiences/:id/protagonist-images/:category`

Returns `{ "success": true }` on success, 404 if no image was set for that category.

## UI (`src/app.js` — `renderAudienceDrawer`)

A new **Images** tab is added to the audience drawer alongside the existing Details / Links / Chat tabs.

### Images Tab layout

```
┌─ Hero Image ─────────────────────────────────────────────────┐
│  [thumbnail]  Replaced via upload below.                     │
│               Used as fallback for categories without their  │
│               own protagonist.                               │
│               [↑ Replace hero image]                         │
└──────────────────────────────────────────────────────────────┘

Protagonist Images
──────────────────
One image per story category. Falls back to hero image if not set.

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ 📰   │ │ 🎭   │ │ 🍽   │ │ 🏷   │
│ news │ │events│ │ food │ │deals │
│ [↑]  │ │ [↑]  │ │ [↑]  │ │ [↑]  │
└──────┘ └──────┘ └──────┘ └──────┘
... (all 11 categories in a responsive grid)
```

Each category card:
- Shows category icon + name
- If image is set: thumbnail + small `×` remove button
- If not set: grey placeholder with dashed border + "fallback" label
- `↑ Upload` button triggers a hidden `<input type="file" accept="image/*">`, reads as base64, POSTs to `/api/audiences/{id}/protagonist-images/{category}`, refreshes the drawer on success

Hero image replace:
- Same UI as the category cards but labelled "Hero / Fallback"
- Triggers `POST /api/audiences/:id/protagonist-images` pattern — actually calls the existing `storeAudiencePhoto` path (no new endpoint needed; hero image upload is already wired in the create-full flow; we expose it here as a standalone button calling a new `POST /api/audiences/:id/photo` endpoint)

### `POST /api/audiences/:id/photo` (new standalone endpoint)

Same logic as the `storeAudiencePhoto` call inside `create-full`, extracted into its own handler so the Images tab can replace the hero image post-creation. Body: same `{ photo: { file_data_base64, mime_type, file_name, size_bytes } }` shape.

## Pipeline lookup

Wherever `hero_image_asset_storage_id` is currently used to pick the protagonist for story asset generation, replace with a call to `getEffectiveProtagonistStorageId(audienceId, story.current_category)`. This affects `src/publish-service.js` and any place that reads `hero_image_asset_storage_id` for story generation (not for display — the dashboard story list continues to use `hero_image_url` directly).

## File Repository stubs

The file-backend repository (`createFileRepository`) gets no-op stubs that return empty maps / no-ops for all four new methods, keeping dev mode working without Supabase.

## Out of scope

- Automatic fallback chain beyond hero (e.g. "no news image → use tech image")
- Per-category image in the onboarding wizard (wizard uses hero only)
- Deleting storage objects on image removal
- RLS policies (same as existing `vivo_storage_objects` — managed via service role key)
