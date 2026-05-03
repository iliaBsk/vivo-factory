# Protagonist Images per Category — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each vivo-factory audience can have one protagonist image per story category; the pipeline picks the per-category image or falls back to the hero image; users manage images from a new Images tab in the audience detail drawer.

**Architecture:** New Supabase table `vivo_audience_protagonist_images` (one row per audience+category) is backed by four new repository methods. Three API endpoints handle upload/list/delete; a fourth lets users replace the hero image post-creation. The audience drawer gains an Images tab rendered server-side using a `Map<category, {url}>` loaded alongside chat history.

**Tech Stack:** Node.js, Supabase PostgREST, node:test (tests). All changes are in `/srv/projects/vivo-factory/`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260503120000_vivo_audience_protagonist_images.sql` | Create | DB table + index + trigger |
| `src/repository.js` | Modify | `createSupabaseClient.delete`, 4 Supabase repo methods, 4 file repo stubs |
| `src/app.js` | Modify | 4 new API routes, Images tab in drawer, GET handler loads `protagonistImages` |
| `tests/repository-supabase.test.js` | Modify | Tests for the 4 Supabase repo methods |
| `tests/protagonist-images.test.js` | Create | Tests for the 4 API routes |

---

## Task 1: Supabase migration

**Files:**
- Create: `supabase/migrations/20260503120000_vivo_audience_protagonist_images.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260503120000_vivo_audience_protagonist_images.sql
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
```

- [ ] **Step 2: Verify the file exists**

```bash
cat supabase/migrations/20260503120000_vivo_audience_protagonist_images.sql
```

Expected: full SQL printed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260503120000_vivo_audience_protagonist_images.sql
git commit -m "feat: add vivo_audience_protagonist_images migration"
```

---

## Task 2: Supabase client `delete` + repository CRUD methods

**Files:**
- Modify: `src/repository.js` (lines ~1463–1475 for client, ~1010 area for repo methods)
- Modify: `tests/repository-supabase.test.js`

### Step 1: Write the failing tests

Append to `tests/repository-supabase.test.js`:

```javascript
test("getProtagonistImages returns a Map of category → {storage_object_id, url}", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([
          { id: "pi-1", audience_id: "aud-1", category: "news", storage_object_id: "so-news" }
        ]);
      }
      if (url.pathname === "/rest/v1/vivo_storage_objects") {
        return jsonResponse([
          { id: "so-news", bucket_name: "vivo-audiences", object_path: "aud-1/protagonist/news.jpg" }
        ]);
      }
      if (url.pathname === "/storage/v1/object/sign/vivo-audiences/aud-1%2Fprotagonist%2Fnews.jpg") {
        return jsonResponse({ signedURL: "/object/sign/vivo-audiences/aud-1/protagonist/news.jpg?token=xyz" });
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });

  const images = await repository.getProtagonistImages("aud-1");
  assert.ok(images instanceof Map);
  assert.ok(images.has("news"));
  assert.equal(images.get("news").storage_object_id, "so-news");
  assert.ok(images.get("news").url.includes("news.jpg"));
});

test("upsertProtagonistImage uploads to storage and upserts both tables", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const calls = [];
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      calls.push({ method: options.method ?? "GET", path: url.pathname });
      if (url.pathname.startsWith("/storage/v1/object/vivo-audiences/")) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.pathname === "/rest/v1/vivo_storage_objects") {
        return jsonResponse([{ id: "so-new", bucket_name: "vivo-audiences", object_path: "aud-1/protagonist/tech.jpg" }]);
      }
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([{ id: "pi-new", audience_id: "aud-1", category: "tech", storage_object_id: "so-new" }]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });

  const buf = Buffer.from("fake-image-data");
  const storageId = await repository.upsertProtagonistImage("aud-1", "tech", {
    file_data_base64: buf.toString("base64"),
    mime_type: "image/jpeg",
    file_name: "tech.jpg",
    size_bytes: buf.length
  });
  assert.equal(storageId, "so-new");
  assert.ok(calls.some(c => c.method === "POST" && c.path.includes("/storage/v1/object/vivo-audiences/")));
  assert.ok(calls.some(c => c.path === "/rest/v1/vivo_audience_protagonist_images"));
});

test("upsertProtagonistImage throws on invalid category", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async () => { throw new Error("fetch not expected"); }
  });
  await assert.rejects(
    () => repository.upsertProtagonistImage("aud-1", "invalid-cat", {
      file_data_base64: "abc",
      mime_type: "image/jpeg",
      file_name: "x.jpg",
      size_bytes: 3
    }),
    /Invalid category/
  );
});

test("deleteProtagonistImage returns false when no row exists", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });
  const result = await repository.deleteProtagonistImage("aud-1", "news");
  assert.equal(result, false);
});

test("deleteProtagonistImage returns true and DELETEs when row exists", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const calls = [];
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      calls.push({ method: options.method ?? "GET", path: url.pathname });
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        if ((options.method ?? "GET") === "DELETE") return jsonResponse([]);
        return jsonResponse([{ id: "pi-1" }]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });
  const result = await repository.deleteProtagonistImage("aud-1", "news");
  assert.equal(result, true);
  assert.ok(calls.some(c => c.method === "DELETE"));
});

test("getEffectiveProtagonistStorageId returns per-category id when set", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([{ id: "pi-1", storage_object_id: "so-tech" }]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });
  const id = await repository.getEffectiveProtagonistStorageId("aud-1", "tech");
  assert.equal(id, "so-tech");
});

test("getEffectiveProtagonistStorageId falls back to audience hero_image_asset_storage_id", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([]);
      }
      if (url.pathname === "/rest/v1/vivo_audiences") {
        return jsonResponse([{ id: "aud-1", hero_image_asset_storage_id: "so-hero" }]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });
  const id = await repository.getEffectiveProtagonistStorageId("aud-1", "tech");
  assert.equal(id, "so-hero");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /srv/projects/vivo-factory
node --test tests/repository-supabase.test.js 2>&1 | tail -20
```

Expected: 7 new tests FAIL with "repository.getProtagonistImages is not a function" or similar.

- [ ] **Step 3: Add `delete` method to `createSupabaseClient` in `src/repository.js`**

Find the `upsert` method ending at line ~1474 and add the `delete` method right after it:

```javascript
    async delete(table, filters) {
      const url = new URL(`${baseUrl}/rest/v1/${table}`);
      for (const [key, value] of Object.entries(filters)) {
        url.searchParams.set(key, value);
      }
      const response = await fetchImpl(url, {
        method: "DELETE",
        headers: {
          ...createSupabaseHeaders(serviceRoleKey),
          prefer: "return=representation"
        }
      });
      return parseSupabaseResponse(response);
    },
```

- [ ] **Step 4: Add 4 methods to `createSupabaseRepository` in `src/repository.js`**

Find the `listFeedbackEvents` method (around line 1010) and add the 4 new methods before it:

```javascript
    async getProtagonistImages(audienceId) {
      const rows = await client.select("vivo_audience_protagonist_images", {
        audience_id: `eq.${audienceId}`
      });
      if (rows.length === 0) return new Map();
      const storageIds = rows.map(r => r.storage_object_id).filter(Boolean);
      const storageObjects = storageIds.length > 0
        ? await client.select("vivo_storage_objects", { id: `in.(${storageIds.join(",")})` })
        : [];
      const urlById = new Map(
        await Promise.all(storageObjects.map(async obj => {
          const url = await client.signObjectUrl(obj.bucket_name ?? DEFAULT_STORAGE_BUCKET, obj.object_path);
          return [obj.id, url];
        }))
      );
      const result = new Map();
      for (const row of rows) {
        result.set(row.category, {
          storage_object_id: row.storage_object_id,
          url: urlById.get(row.storage_object_id) ?? null
        });
      }
      return result;
    },
    async upsertProtagonistImage(audienceId, category, photo) {
      const VALID = new Set(['news','events','food','deals','tech','entertainment','health','sports','finance','fashion','travel']);
      if (!VALID.has(category)) throw new Error(`Invalid category: ${category}`);
      const buffer = Buffer.from(photo.file_data_base64, "base64");
      const ext = photo.mime_type?.split("/")[1] ?? "jpg";
      const bucket = "vivo-audiences";
      const storagePath = `${audienceId}/protagonist/${category}.${ext}`;
      const objectPath = `${bucket}/${storagePath}`;
      await client.uploadObject(bucket, storagePath, buffer, {
        contentType: photo.mime_type ?? "image/jpeg"
      });
      const storageRows = await client.upsert("vivo_storage_objects", {
        bucket_name: bucket,
        object_path: objectPath,
        file_name: photo.file_name ?? `${category}.${ext}`,
        mime_type: photo.mime_type ?? "image/jpeg",
        size_bytes: buffer.length,
        storage_metadata: {}
      });
      const storageObject = Array.isArray(storageRows) ? storageRows[0] : storageRows;
      if (!storageObject?.id) throw new Error("Failed to create storage object record");
      await client.upsert("vivo_audience_protagonist_images", {
        audience_id: audienceId,
        category,
        storage_object_id: storageObject.id,
        updated_at: new Date().toISOString()
      });
      return storageObject.id;
    },
    async deleteProtagonistImage(audienceId, category) {
      const existing = await client.select("vivo_audience_protagonist_images", {
        audience_id: `eq.${audienceId}`,
        category: `eq.${category}`,
        limit: "1"
      });
      if (existing.length === 0) return false;
      await client.delete("vivo_audience_protagonist_images", {
        audience_id: `eq.${audienceId}`,
        category: `eq.${category}`
      });
      return true;
    },
    async getEffectiveProtagonistStorageId(audienceId, category) {
      const rows = await client.select("vivo_audience_protagonist_images", {
        audience_id: `eq.${audienceId}`,
        category: `eq.${category}`,
        limit: "1"
      });
      if (rows.length > 0) return rows[0].storage_object_id;
      const audiences = await client.select("vivo_audiences", {
        id: `eq.${audienceId}`,
        limit: "1"
      });
      return audiences[0]?.hero_image_asset_storage_id ?? null;
    },
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /srv/projects/vivo-factory
node --test tests/repository-supabase.test.js 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/repository.js tests/repository-supabase.test.js
git commit -m "feat: protagonist image CRUD — Supabase client delete + 4 repository methods"
```

---

## Task 3: File repository stubs

**Files:**
- Modify: `src/repository.js` (the `createFileRepository` function, around line 67)

- [ ] **Step 1: Write failing test**

Append to `tests/dashboard.test.js`:

```javascript
test("file repository getProtagonistImages returns empty Map", async () => {
  const { createRepository } = await loadModules();
  const repo = createRepository(createSeed());
  const images = await repo.getProtagonistImages("aud-1");
  assert.ok(images instanceof Map);
  assert.equal(images.size, 0);
});

test("file repository getEffectiveProtagonistStorageId returns null when no hero", async () => {
  const { createRepository } = await loadModules();
  const repo = createRepository(createSeed());
  const id = await repo.getEffectiveProtagonistStorageId("aud-1", "tech");
  assert.equal(id, null);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node --test tests/dashboard.test.js 2>&1 | tail -10
```

Expected: 2 new tests FAIL with "repo.getProtagonistImages is not a function".

- [ ] **Step 3: Add stubs to `createFileRepository` in `src/repository.js`**

Find the `storeAudiencePhoto` stub in the file repository (around line 67) and add the 4 stubs directly after it:

```javascript
    async getProtagonistImages(_audienceId) {
      return new Map();
    },
    async upsertProtagonistImage(_audienceId, _category, _photo) {
      return null;
    },
    async deleteProtagonistImage(_audienceId, _category) {
      return false;
    },
    async getEffectiveProtagonistStorageId(audienceId, _category) {
      const audience = state.audiences.get(audienceId);
      return audience?.hero_image_asset_storage_id ?? null;
    },
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/dashboard.test.js 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repository.js tests/dashboard.test.js
git commit -m "feat: protagonist image stubs for file repository"
```

---

## Task 4: API endpoints

**Files:**
- Modify: `src/app.js`
- Create: `tests/protagonist-images.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/protagonist-images.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createRepository } from "../src/repository.js";

const SEED = {
  audiences: [{
    id: "aud-1",
    audience_key: "test-audience",
    label: "Test Audience",
    language: "en",
    location: "Barcelona",
    family_context: "",
    interests: [],
    content_pillars: [],
    excluded_topics: [],
    tone: "direct",
    profile_snapshot: {},
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z"
  }],
  instances: [],
  stories: [],
  storyAssets: [],
  storageObjects: [],
  storyReviews: [],
  storyPublications: [],
  auditEvents: [],
  feedbackEvents: [],
  instanceReports: [],
  operatorChats: [],
  deployments: []
};

function makeApp(repoOverrides = {}) {
  const baseRepo = createRepository(SEED);
  const repository = { ...baseRepo, ...repoOverrides };
  return createApp({ repository, fetchImpl: async () => { throw new Error("unexpected fetch"); } });
}

async function handle(app, method, pathname, body = null) {
  return app.handle({
    method,
    pathname,
    body: body ? JSON.stringify(body) : null,
    query: {}
  });
}

test("GET /api/audiences/:id/protagonist-images — returns 404 for unknown audience", async () => {
  const app = makeApp();
  const res = await handle(app, "GET", "/api/audiences/no-such-id/protagonist-images");
  assert.equal(res.status, 404);
});

test("GET /api/audiences/:id/protagonist-images — returns empty images map for audience with no protagonist images", async () => {
  const app = makeApp();
  const res = await handle(app, "GET", "/api/audiences/aud-1/protagonist-images");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.success, true);
  assert.deepEqual(body.data.images, {});
});

test("GET /api/audiences/:id/protagonist-images — returns set images", async () => {
  const app = makeApp({
    getProtagonistImages: async () => new Map([
      ["news", { storage_object_id: "so-1", url: "https://example.com/news.jpg" }]
    ])
  });
  const res = await handle(app, "GET", "/api/audiences/aud-1/protagonist-images");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.data.images.news.url, "https://example.com/news.jpg");
});

test("POST /api/audiences/:id/protagonist-images/:category — returns 400 for invalid category", async () => {
  const app = makeApp();
  const res = await handle(app, "POST", "/api/audiences/aud-1/protagonist-images/invalid-cat", {
    photo: { file_data_base64: "abc", mime_type: "image/jpeg", file_name: "x.jpg", size_bytes: 3 }
  });
  assert.equal(res.status, 400);
  assert.ok(JSON.parse(res.body).error.includes("Invalid category"));
});

test("POST /api/audiences/:id/protagonist-images/:category — returns 400 for invalid mime_type", async () => {
  const app = makeApp();
  const res = await handle(app, "POST", "/api/audiences/aud-1/protagonist-images/news", {
    photo: { file_data_base64: "abc", mime_type: "image/bmp", file_name: "x.bmp", size_bytes: 3 }
  });
  assert.equal(res.status, 400);
  assert.ok(JSON.parse(res.body).error.includes("mime_type"));
});

test("POST /api/audiences/:id/protagonist-images/:category — returns 400 when photo exceeds 5 MB", async () => {
  const app = makeApp();
  const res = await handle(app, "POST", "/api/audiences/aud-1/protagonist-images/news", {
    photo: { file_data_base64: "abc", mime_type: "image/jpeg", file_name: "x.jpg", size_bytes: 6 * 1024 * 1024 }
  });
  assert.equal(res.status, 400);
  assert.ok(JSON.parse(res.body).error.includes("5 MB"));
});

test("POST /api/audiences/:id/protagonist-images/:category — returns 200 on success", async () => {
  const app = makeApp({
    upsertProtagonistImage: async () => "so-new"
  });
  const buf = Buffer.from("fake-image");
  const res = await handle(app, "POST", "/api/audiences/aud-1/protagonist-images/news", {
    photo: { file_data_base64: buf.toString("base64"), mime_type: "image/jpeg", file_name: "news.jpg", size_bytes: buf.length }
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).data.storage_object_id, "so-new");
});

test("DELETE /api/audiences/:id/protagonist-images/:category — returns 404 when no image set", async () => {
  const app = makeApp({
    deleteProtagonistImage: async () => false
  });
  const res = await handle(app, "DELETE", "/api/audiences/aud-1/protagonist-images/news");
  assert.equal(res.status, 404);
});

test("DELETE /api/audiences/:id/protagonist-images/:category — returns 200 on success", async () => {
  const app = makeApp({
    deleteProtagonistImage: async () => true
  });
  const res = await handle(app, "DELETE", "/api/audiences/aud-1/protagonist-images/news");
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).success, true);
});

test("POST /api/audiences/:id/photo — returns 404 for unknown audience", async () => {
  const app = makeApp();
  const buf = Buffer.from("img");
  const res = await handle(app, "POST", "/api/audiences/no-such/photo", {
    photo: { file_data_base64: buf.toString("base64"), mime_type: "image/jpeg", file_name: "x.jpg", size_bytes: buf.length }
  });
  assert.equal(res.status, 404);
});

test("POST /api/audiences/:id/photo — returns 200 on success", async () => {
  const app = makeApp({
    storeAudiencePhoto: async () => "storage-id"
  });
  const buf = Buffer.from("img");
  const res = await handle(app, "POST", "/api/audiences/aud-1/photo", {
    photo: { file_data_base64: buf.toString("base64"), mime_type: "image/jpeg", file_name: "x.jpg", size_bytes: buf.length }
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).success, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /srv/projects/vivo-factory
node --test tests/protagonist-images.test.js 2>&1 | tail -20
```

Expected: all 10 tests FAIL (routes not yet implemented).

- [ ] **Step 3: Add 4 routes to `src/app.js`**

Find the `POST /api/audiences/:id/fetch-content` handler (around line 945) and add the 4 new routes immediately before it:

```javascript
  // GET /api/audiences/:id/protagonist-images
  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/protagonist-images$/)) {
    const audienceId = request.pathname.split("/")[3];
    const audience = await safeLoad(() => repository.getAudience(audienceId), null);
    if (!audience) return json(404, { error: "Audience not found" });
    const images = await repository.getProtagonistImages(audienceId);
    const data = {};
    for (const [category, info] of images) data[category] = info;
    return json(200, { success: true, data: { images: data } });
  }

  // POST /api/audiences/:id/protagonist-images/:category
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/protagonist-images\/([^/]+)$/)) {
    const parts = request.pathname.split("/");
    const audienceId = parts[3];
    const category = parts[5];
    const VALID_CATEGORIES = new Set(['news','events','food','deals','tech','entertainment','health','sports','finance','fashion','travel']);
    if (!VALID_CATEGORIES.has(category)) return json(400, { error: "Invalid category" });
    const audience = await safeLoad(() => repository.getAudience(audienceId), null);
    if (!audience) return json(404, { error: "Audience not found" });
    const body = readBody(request.body);
    const photo = body.photo ?? null;
    if (!photo) return json(400, { error: "photo is required" });
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedMimes.includes(photo.mime_type)) return json(400, { error: "photo.mime_type must be jpeg, png, webp, or gif" });
    if ((photo.size_bytes ?? 0) > 5 * 1024 * 1024) return json(400, { error: "Photo must be under 5 MB" });
    if (!photo.file_data_base64) return json(400, { error: "photo.file_data_base64 is required" });
    try {
      const storageObjectId = await repository.upsertProtagonistImage(audienceId, category, photo);
      return json(200, { success: true, data: { storage_object_id: storageObjectId } });
    } catch (err) {
      console.error("[protagonist-images] upload failed:", err.message);
      return json(500, { error: "Failed to upload image" });
    }
  }

  // DELETE /api/audiences/:id/protagonist-images/:category
  if (request.method === "DELETE" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/protagonist-images\/([^/]+)$/)) {
    const parts = request.pathname.split("/");
    const audienceId = parts[3];
    const category = parts[5];
    const audience = await safeLoad(() => repository.getAudience(audienceId), null);
    if (!audience) return json(404, { error: "Audience not found" });
    const deleted = await repository.deleteProtagonistImage(audienceId, category);
    if (!deleted) return json(404, { error: "No protagonist image set for this category" });
    return json(200, { success: true });
  }

  // POST /api/audiences/:id/photo — replace hero image post-creation
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/photo$/)) {
    const audienceId = request.pathname.split("/")[3];
    const audience = await safeLoad(() => repository.getAudience(audienceId), null);
    if (!audience) return json(404, { error: "Audience not found" });
    const body = readBody(request.body);
    const photo = body.photo ?? null;
    if (!photo) return json(400, { error: "photo is required" });
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedMimes.includes(photo.mime_type)) return json(400, { error: "photo.mime_type must be jpeg, png, webp, or gif" });
    if ((photo.size_bytes ?? 0) > 5 * 1024 * 1024) return json(400, { error: "Photo must be under 5 MB" });
    if (!photo.file_data_base64) return json(400, { error: "photo.file_data_base64 is required" });
    try {
      await repository.storeAudiencePhoto(audienceId, photo);
      return json(200, { success: true });
    } catch (err) {
      console.error("[audiences/photo] upload failed:", err.message);
      return json(500, { error: "Failed to upload photo" });
    }
  }
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/protagonist-images.test.js 2>&1 | tail -20
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app.js tests/protagonist-images.test.js
git commit -m "feat: protagonist image API — GET/POST/DELETE per-category + POST /photo"
```

---

## Task 5: Images tab UI

**Files:**
- Modify: `src/app.js` (GET handler ~line 917, `renderDashboard` ~line 1756, `renderAudienceDrawer` ~line 2827)

- [ ] **Step 1: Write failing test**

Append to `tests/protagonist-images.test.js`:

```javascript
test("renderAudienceDrawer includes Images tab button", async () => {
  const appModule = await import("../src/app.js");
  // renderAudienceDrawer is not exported; test via GET / page render
  const repo = createRepository(SEED);
  const app = createApp({ repository: repo, fetchImpl: async () => { throw new Error("unexpected"); } });
  const res = await app.handle({
    method: "GET",
    pathname: "/",
    query: { tab: "audiences", audience_id: "aud-1" }
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.includes("Images"), "drawer should include Images tab");
  assert.ok(res.body.includes("data-tab=\"images\""), "drawer tab button should have data-tab=images");
});

test("renderAudienceDrawer Images tab shows category grid with 11 categories", async () => {
  const repo = createRepository(SEED);
  const app = createApp({ repository: repo, fetchImpl: async () => { throw new Error("unexpected"); } });
  const res = await app.handle({
    method: "GET",
    pathname: "/",
    query: { tab: "audiences", audience_id: "aud-1" }
  });
  assert.equal(res.status, 200);
  const body = res.body;
  // Each category should have a data-upload-category attribute
  const categories = ['news','events','food','deals','tech','entertainment','health','sports','finance','fashion','travel'];
  for (const cat of categories) {
    assert.ok(body.includes(`data-upload-category="${cat}"`), `missing upload target for ${cat}`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node --test tests/protagonist-images.test.js 2>&1 | grep -E "FAIL|fail|Images|data-tab" | head -10
```

Expected: 2 new tests FAIL (no Images tab in HTML yet).

- [ ] **Step 3: Load `protagonistImages` in the main GET handler in `src/app.js`**

Find the `chatHistory` load block (around line 917):

```javascript
    const chatHistory = selectedAudience && activeTab === "audiences"
      ? await (async () => {
          const conv = await repository.getOrCreateConversation(selectedAudience.audience_key, "operator_console");
          return repository.getConversationMessages(conv.id);
        })()
      : [];
```

Add immediately after it (before `return html(200, renderDashboard(...))`):

```javascript
    const protagonistImages = selectedAudience && activeTab === "audiences"
      ? await safeLoad(() => repository.getProtagonistImages(selectedAudience.id), new Map())
      : new Map();
```

Then in the `renderDashboard(...)` call, add `protagonistImages` to the model object:

```javascript
    return html(200, renderDashboard({
      activeTab,
      selectedAudienceId,
      filters,
      setupStatus,
      audienceImportPreview,
      audiences,
      audienceInstances,
      audienceProfiles,
      stories,
      activeStory,
      auditItems,
      analyticsItems,
      instances,
      chatHistory,
      protagonistImages,
      merchants,
      activeMerchant,
      activeMerchantOverrides,
      audienceRuntimeConfig
    }));
```

- [ ] **Step 4: Pass `protagonistImages` through `renderDashboard` to `renderAudienceDrawer`**

In the `renderDashboard` function (~line 1756), update the `audienceDrawerPortal` assignment:

```javascript
  const audienceDrawerPortal = activeTab === "audiences" && model.selectedAudienceId && selectedAudience
    ? renderAudienceDrawer({
        audience: selectedAudience,
        instance: selectedAudienceInstance,
        profileState: selectedProfileState,
        deployment: selectedDeployment,
        deployments,
        chatHistory: model.chatHistory ?? [],
        protagonistImages: model.protagonistImages ?? new Map()
      })
    : "";
```

- [ ] **Step 5: Add Images tab to `renderAudienceDrawer` in `src/app.js`**

In `renderAudienceDrawer`, update the function signature to accept `protagonistImages`:

```javascript
function renderAudienceDrawer({ audience, instance, profileState = {}, deployment, deployments = [], chatHistory = [], protagonistImages = new Map() }) {
```

Add the `CATEGORY_META` constant at the top of the function (before `const detailsTab`):

```javascript
  const CATEGORY_META = {
    news:          { icon: '📰', label: 'News' },
    events:        { icon: '🎭', label: 'Events' },
    food:          { icon: '🍽', label: 'Food' },
    deals:         { icon: '🏷', label: 'Deals' },
    tech:          { icon: '💻', label: 'Tech' },
    entertainment: { icon: '🎬', label: 'Entertainment' },
    health:        { icon: '🏃', label: 'Health' },
    sports:        { icon: '⚽', label: 'Sports' },
    finance:       { icon: '📈', label: 'Finance' },
    fashion:       { icon: '👗', label: 'Fashion' },
    travel:        { icon: '✈', label: 'Travel' }
  };
```

Add the `imagesTab` variable after the `chatTab` variable (before the `return` statement):

```javascript
  const heroPhotoBlock = photo
    ? `<img src="${escapeAttribute(photo)}" alt="" class="w-16 h-16 rounded-lg object-cover flex-shrink-0" />`
    : `<div class="w-16 h-16 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-2xl flex-shrink-0">👤</div>`;

  const protagonistCards = Object.entries(CATEGORY_META).map(([cat, meta]) => {
    const img = protagonistImages.get(cat);
    const thumb = img?.url
      ? `<img src="${escapeAttribute(img.url)}" alt="" class="w-full h-full object-cover rounded-lg" />`
      : `<div class="w-full h-full flex items-center justify-center text-2xl bg-gray-50 dark:bg-gray-800">${meta.icon}</div>`;
    const removeBtn = img?.url
      ? `<button type="button" class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none flex items-center justify-center hover:bg-red-600 z-10" data-remove-category="${escapeAttribute(cat)}" title="Remove">×</button>`
      : '';
    const badge = !img?.url
      ? `<span class="text-xs text-gray-400 dark:text-gray-500">fallback</span>`
      : '';
    return `<div class="flex flex-col items-center gap-1 relative">
        <div class="relative w-16 h-16 rounded-lg border-2 ${img?.url ? 'border-gray-200 dark:border-gray-600' : 'border-dashed border-gray-300 dark:border-gray-600'} overflow-hidden cursor-pointer hover:border-indigo-400 transition-colors" data-upload-category="${escapeAttribute(cat)}" title="Upload ${escapeAttribute(meta.label)} image">
          ${thumb}${removeBtn}
        </div>
        <span class="text-xs font-medium text-gray-600 dark:text-gray-400">${escapeHtml(meta.label)}</span>
        ${badge}
        <input type="file" accept="image/*" class="hidden" data-file-input-category="${escapeAttribute(cat)}">
      </div>`;
  }).join('');

  const imagesTab = `
    <div class="space-y-6 p-5">
      <div>
        <span class="label mb-2">Hero Image</span>
        <div class="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          ${heroPhotoBlock}
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-800 dark:text-gray-200 mb-0.5">Personal · Fallback</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">Used for categories without their own protagonist.</p>
            <button type="button" id="hero-upload-btn"
              class="mt-2 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
              ↑ Replace hero image
            </button>
            <input type="file" accept="image/*" class="hidden" id="hero-file-input">
          </div>
        </div>
      </div>
      <div>
        <span class="label mb-1">Protagonist Images</span>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Click a card to upload. × to remove. Unset cards fall back to hero image.</p>
        <div class="grid grid-cols-4 gap-4">
          ${protagonistCards}
        </div>
      </div>
    </div>`;
```

- [ ] **Step 6: Add the Images tab button and panel to the drawer HTML**

In the tab list (around line 2926):

Replace:
```javascript
        <button class="audience-drawer-tab ... data-tab="details" ...>Details</button>
        <button class="audience-drawer-tab ... data-tab="links" ...>Links</button>
        <button class="audience-drawer-tab ... data-tab="chat" ...>Chat</button>
```

With (add Images button at the end):
```javascript
        <button class="audience-drawer-tab px-5 py-3 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400 -mb-px" data-tab="details" role="tab" aria-selected="true">Details</button>
        <button class="audience-drawer-tab px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 -mb-px" data-tab="links" role="tab" aria-selected="false">Links</button>
        <button class="audience-drawer-tab px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 -mb-px" data-tab="chat" role="tab" aria-selected="false">Chat</button>
        <button class="audience-drawer-tab px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 -mb-px" data-tab="images" role="tab" aria-selected="false">Images</button>
```

In the panels section (around line 2932):

Replace:
```javascript
        <div data-tab-panel="details">${detailsTab}</div>
        <div data-tab-panel="links" class="hidden">${linksTab}</div>
        <div data-tab-panel="chat" class="hidden">${chatTab}</div>
```

With:
```javascript
        <div data-tab-panel="details">${detailsTab}</div>
        <div data-tab-panel="links" class="hidden">${linksTab}</div>
        <div data-tab-panel="chat" class="hidden">${chatTab}</div>
        <div data-tab-panel="images" class="hidden">${imagesTab}</div>
```

- [ ] **Step 7: Add upload/delete JavaScript to the drawer `<script>` block**

In the `<script>` block inside `renderAudienceDrawer` (after the existing `refreshDrawerStatus` and badge code, before the closing `})();`), add:

```javascript
      // Protagonist image upload
      var audienceIdJs = ${JSON.stringify(audience.id)};
      var currentUrl = window.location.href;

      function reloadDrawer() { window.location.href = currentUrl; }

      async function uploadImage(endpoint, file) {
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = async function(e) {
            var dataUrl = e.target.result;
            var comma = dataUrl.indexOf(',');
            var base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
            var mimeMatch = dataUrl.match(/^data:([^;]+);/);
            var mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            try {
              var res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ photo: {
                  file_data_base64: base64,
                  mime_type: mimeType,
                  file_name: file.name,
                  size_bytes: file.size
                }})
              });
              if (!res.ok) {
                var err = await res.json().catch(function() { return { error: 'Upload failed' }; });
                reject(new Error(err.error ?? 'Upload failed'));
              } else {
                resolve();
              }
            } catch(err) { reject(err); }
          };
          reader.readAsDataURL(file);
        });
      }

      // Hero image replace
      document.getElementById('hero-upload-btn')?.addEventListener('click', function() {
        document.getElementById('hero-file-input')?.click();
      });
      document.getElementById('hero-file-input')?.addEventListener('change', async function(e) {
        var file = e.target.files[0];
        if (!file) return;
        try {
          await uploadImage('/api/audiences/' + encodeURIComponent(audienceIdJs) + '/photo', file);
          reloadDrawer();
        } catch(err) { alert('Upload failed: ' + err.message); }
      });

      // Per-category upload
      document.querySelectorAll('[data-upload-category]').forEach(function(card) {
        card.addEventListener('click', function(e) {
          if (e.target.closest('[data-remove-category]')) return;
          var cat = card.dataset.uploadCategory;
          document.querySelector('[data-file-input-category="' + cat + '"]')?.click();
        });
      });
      document.querySelectorAll('[data-file-input-category]').forEach(function(input) {
        input.addEventListener('change', async function(e) {
          var file = e.target.files[0];
          if (!file) return;
          var cat = input.dataset.fileInputCategory;
          try {
            await uploadImage('/api/audiences/' + encodeURIComponent(audienceIdJs) + '/protagonist-images/' + encodeURIComponent(cat), file);
            reloadDrawer();
          } catch(err) { alert('Upload failed: ' + err.message); }
        });
      });

      // Per-category remove
      document.querySelectorAll('[data-remove-category]').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
          e.stopPropagation();
          var cat = btn.dataset.removeCategory;
          if (!confirm('Remove ' + cat + ' protagonist image?')) return;
          try {
            var res = await fetch('/api/audiences/' + encodeURIComponent(audienceIdJs) + '/protagonist-images/' + encodeURIComponent(cat), { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            reloadDrawer();
          } catch(err) { alert('Remove failed: ' + err.message); }
        });
      });
```

Note: `audienceIdJs` is already serialized above as `JSON.stringify(audience.id)` — make sure the variable name doesn't conflict with the existing `audienceKeyJs` in the script block. Use `audienceIdJs` for the ID and keep the existing `audienceKey` for the badge refresh.

- [ ] **Step 8: Run tests**

```bash
node --test tests/protagonist-images.test.js 2>&1 | tail -20
```

Expected: all 12 tests PASS.

- [ ] **Step 9: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app.js tests/protagonist-images.test.js
git commit -m "feat: Images tab in audience drawer — hero replace + per-category protagonist grid"
```

---

**Plan complete.** All four Tasks (migration, repository, API, UI) produce working, testable software independently.
