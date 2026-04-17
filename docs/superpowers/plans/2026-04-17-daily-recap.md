# Daily Recap Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable each OpenClaw audience manager to collect locally-relevant content from RSS/merchant sources, score it with marble, create stories in `vivo_stories`, and publish a daily recap to the audience's Telegram channel.

**Architecture:** Vivo-factory owns the full pipeline — source registry, content fetching, marble scoring, and story creation. OpenClaw handles Telegram delivery via its admin API. Jobs run asynchronously in-process; callers poll `GET /api/jobs/:jobId` for completion.

**Tech Stack:** Node.js built-ins (`node:crypto`), regex-based RSS parser (no new npm deps), existing Supabase REST client pattern, OpenClaw HTTP admin API.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `config/sources.json` | Create | Source registry with Barcelona seed data |
| `src/content-fetcher.js` | Create | RSS/merchant fetch, 80/20 split, dedup, marble scoring, story creation |
| `src/profile-client.js` | Modify | Add `selectItems(items, context)` method |
| `src/repository.js` | Modify | Add `createStory`, `transitionStoryStatus`, `createJob`, `getJob`, `updateJob` to in-memory + Supabase repos |
| `src/app.js` | Modify | Add `contentFetcher`, `dispatchFetch` options; add 4 new endpoints |
| `src/server.js` | Modify | Wire contentFetcher + dispatchFetch; add daily cron |
| `src/plugins/user-profile/index.js` | Modify | Add `audience_add_source` tool; update config schema |
| `src/plugins/user-profile/openclaw.plugin.json` | Modify | Add `vivoFactoryUrl` to configSchema |
| `supabase/migrations/20260417100000_vivo_content_fetch_jobs.sql` | Create | New jobs table |
| `tests/content-fetcher.test.js` | Create | Tests for content fetcher |
| `tests/repository-content-fetch.test.js` | Create | Tests for createStory + jobs |
| `tests/profile-client.test.js` | Modify | Add selectItems test |
| `tests/dashboard.test.js` | Modify | Add new endpoint tests |

---

## Task 1: Source Registry

**Files:**
- Create: `config/sources.json`

- [ ] **Step 1: Create the source registry file**

```json
{
  "version": 1,
  "sources": [
    {
      "id": "bcn-news-lavanguardia",
      "location": "barcelona",
      "category": "news",
      "type": "rss",
      "url": "https://www.lavanguardia.com/rss/home.xml",
      "weight": 1.0,
      "lang": "es"
    },
    {
      "id": "bcn-news-elpais-bcn",
      "location": "barcelona",
      "category": "news",
      "type": "rss",
      "url": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada",
      "weight": 0.9,
      "lang": "es"
    },
    {
      "id": "bcn-events-timeout",
      "location": "barcelona",
      "category": "entertainment",
      "type": "rss",
      "url": "https://www.timeout.com/barcelona/rss/all",
      "weight": 0.85,
      "lang": "en"
    },
    {
      "id": "bcn-events-barcelona-metropolitan",
      "location": "barcelona",
      "category": "entertainment",
      "type": "rss",
      "url": "https://www.barcelona-metropolitan.com/feed",
      "weight": 0.8,
      "lang": "en"
    },
    {
      "id": "bcn-travel-tripadvisor",
      "location": "barcelona",
      "category": "travel",
      "type": "rss",
      "url": "https://www.tripadvisor.com/Tourism-g187497-Barcelona_Catalonia-Vacations.html",
      "weight": 0.7,
      "lang": "en"
    },
    {
      "id": "bcn-deals-zara",
      "location": "barcelona",
      "category": "deals",
      "type": "merchant",
      "merchant_id": "zara-es",
      "weight": 0.75
    },
    {
      "id": "global-tech-hackernews",
      "location": "global",
      "category": "tech",
      "type": "rss",
      "url": "https://news.ycombinator.com/rss",
      "weight": 0.6,
      "lang": "en"
    },
    {
      "id": "global-news-bbc",
      "location": "global",
      "category": "news",
      "type": "rss",
      "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
      "weight": 0.65,
      "lang": "en"
    },
    {
      "id": "global-tech-verge",
      "location": "global",
      "category": "tech",
      "type": "rss",
      "url": "https://www.theverge.com/rss/index.xml",
      "weight": 0.55,
      "lang": "en"
    }
  ]
}
```

- [ ] **Step 2: Verify it parses as valid JSON**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('config/sources.json','utf8')).sources.length)"`
Expected output: `9`

- [ ] **Step 3: Commit**

```bash
git add config/sources.json
git commit -m "feat: add source registry with Barcelona seed data"
```

---

## Task 2: Profile Client `selectItems`

**Files:**
- Modify: `src/profile-client.js`
- Test: `tests/profile-client.test.js`

- [ ] **Step 1: Write the failing test**

Add to the END of `tests/profile-client.test.js`:

```javascript
test("createProfileClient.selectItems posts items to /user-profile/select and returns scored list", async () => {
  const { createProfileClient } = await import("../src/profile-client.js");
  const requests = [];
  const client = createProfileClient({
    baseUrl: "http://127.0.0.1:5400",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            data: { selected: [{ id: "item-1", score: 0.9, rank: 1 }] },
            warnings: [],
            errors: []
          };
        }
      };
    }
  });

  const items = [{ id: "item-1", title: "Test", summary: "desc", category: "news", url: "http://example.com" }];
  const result = await client.selectItems(items, { task: "daily_recap", limit: 10 });

  assert.equal(requests[0].url, "http://127.0.0.1:5400/user-profile/select");
  assert.equal(requests[0].options.method, "POST");
  const body = JSON.parse(requests[0].options.body);
  assert.deepEqual(body.items, items);
  assert.deepEqual(body.context, { task: "daily_recap", limit: 10 });
  assert.deepEqual(result.data.selected[0], { id: "item-1", score: 0.9, rank: 1 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/profile-client.test.js`
Expected: FAIL with `TypeError: client.selectItems is not a function`

- [ ] **Step 3: Add `selectItems` to `src/profile-client.js`**

In the returned object inside `createProfileClient`, add after `getDebug()`:

```javascript
selectItems(items, context = {}) {
  return postJson(fetchImpl, `${baseUrl}/user-profile/select`, { items, context });
},
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/profile-client.test.js`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/profile-client.js tests/profile-client.test.js
git commit -m "feat: add selectItems method to profile client"
```

---

## Task 3: Repository `createStory` + `transitionStoryStatus`

**Files:**
- Modify: `src/repository.js`
- Test: `tests/repository-content-fetch.test.js`

**Background:** The existing `updateStory` only allows `title`, `story_text`, `summary`, `metadata`. We need `createStory` to create new stories from the content pipeline, and `transitionStoryStatus` to move stories through `new → ready_to_publish → published`. Also update `submitStoryReview` to auto-transition: `approved → ready_to_publish`, `rejected → archived`.

- [ ] **Step 1: Write the failing tests**

Create `tests/repository-content-fetch.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

async function loadRepo() {
  const { createRepository } = await import("../src/repository.js");
  return createRepository({
    audiences: [{
      id: "aud-1", audience_key: "bcn", label: "Barcelona", language: "en",
      location: "Barcelona", family_context: "", interests: [], content_pillars: [],
      excluded_topics: [], tone: "helpful", profile_snapshot: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }],
    instances: [{
      id: "inst-1", factory_id: "factory-1", audience_id: "aud-1",
      instance_key: "bcn-openclaw", service_name: "bcn-openclaw",
      openclaw_admin_url: "http://127.0.0.1:18801", profile_base_url: "http://127.0.0.1:5401",
      runtime_config: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }]
  });
}

test("createStory creates a story with status=new and operator_review_status=pending", async () => {
  const repo = await loadRepo();

  const story = repo.createStory({
    factory_id: "factory-1",
    audience_id: "aud-1",
    instance_id: "inst-1",
    story_key: "sha1-abc123",
    title: "Test News",
    story_text: "This is a test news story from Barcelona.",
    summary: "Test news story",
    source_kind: "rss",
    primary_source_url: "https://example.com/news1",
    is_deal: false,
    is_local: true,
    metadata: { marble_score: 0.87, source_id: "bcn-news-lv" }
  }, { timestamp: "2026-04-17T09:00:00.000Z" });

  assert.ok(story.id, "should have an id");
  assert.equal(story.story_key, "sha1-abc123");
  assert.equal(story.status, "new");
  assert.equal(story.operator_review_status, "pending");
  assert.equal(story.title, "Test News");
  assert.equal(story.source_kind, "rss");
  assert.equal(story.is_local, true);
  assert.equal(story.metadata.marble_score, 0.87);
});

test("createStory throws on duplicate story_key", async () => {
  const repo = await loadRepo();
  const base = {
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "unique-key-1", title: "A", story_text: "B", summary: "C",
    source_kind: "rss", primary_source_url: "https://example.com/1"
  };
  repo.createStory(base);
  assert.throws(() => repo.createStory(base), /story_key/);
});

test("transitionStoryStatus changes story status", async () => {
  const repo = await loadRepo();
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "key-2",
    title: "T", story_text: "S", summary: "U", source_kind: "rss",
    primary_source_url: "https://example.com/2"
  });

  const updated = repo.transitionStoryStatus(story.id, "ready_to_publish", {
    actorId: "system", timestamp: "2026-04-17T10:00:00.000Z"
  });

  assert.equal(updated.status, "ready_to_publish");
  assert.equal(updated.updated_at, "2026-04-17T10:00:00.000Z");
});

test("submitStoryReview auto-transitions to ready_to_publish on approved (no assets)", async () => {
  const repo = await loadRepo();
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "key-3",
    title: "T", story_text: "S", summary: "U", source_kind: "rss",
    primary_source_url: "https://example.com/3"
  });

  repo.submitStoryReview(story.id, {
    review_status: "approved",
    review_notes: "looks good",
    actor_id: "operator-1",
    selected_asset_id: null,
    payload: {}
  });

  const updated = repo.getStory(story.id);
  assert.equal(updated.operator_review_status, "approved");
  assert.equal(updated.status, "ready_to_publish");
});

test("submitStoryReview auto-transitions to archived on rejected", async () => {
  const repo = await loadRepo();
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "key-4",
    title: "T", story_text: "S", summary: "U", source_kind: "rss",
    primary_source_url: "https://example.com/4"
  });

  repo.submitStoryReview(story.id, {
    review_status: "rejected",
    review_notes: "not relevant",
    actor_id: "operator-1",
    selected_asset_id: null,
    payload: {}
  });

  const updated = repo.getStory(story.id);
  assert.equal(updated.operator_review_status, "rejected");
  assert.equal(updated.status, "archived");
});
```

- [ ] **Step 2: Run to verify tests fail**

Run: `node --test tests/repository-content-fetch.test.js`
Expected: FAIL with `TypeError: repo.createStory is not a function`

- [ ] **Step 3: Add `createStory` to the in-memory `createRepository` object in `src/repository.js`**

In `createRepository`, after `updateAudience(...)` and before `selectStoryAsset(...)`, add:

```javascript
createStory(story, options = {}) {
  const now = options.timestamp ?? nowIso();
  // Enforce story_key uniqueness
  const exists = [...state.stories.values()].some(s => s.story_key === story.story_key);
  if (exists) {
    throw new Error(`Duplicate story_key: ${story.story_key}`);
  }
  const created = {
    id: story.id ?? crypto.randomUUID(),
    factory_id: story.factory_id ?? null,
    audience_id: story.audience_id,
    instance_id: story.instance_id ?? null,
    story_key: story.story_key,
    title: story.title,
    story_text: story.story_text ?? "",
    summary: story.summary ?? story.story_text?.slice(0, 200) ?? "",
    source_kind: story.source_kind ?? "rss",
    primary_source_url: story.primary_source_url ?? null,
    status: "new",
    is_deal: story.is_deal ?? false,
    is_local: story.is_local ?? false,
    operator_review_status: "pending",
    operator_reviewed_at: null,
    operator_reviewed_by: null,
    operator_review_note: "",
    metadata: story.metadata ?? {},
    created_at: story.created_at ?? now,
    updated_at: story.updated_at ?? now
  };
  state.stories.set(created.id, created);
  appendAudit(state, {
    type: "story_created",
    entity_type: "story",
    entity_id: created.id,
    actor_id: options.actorId ?? "system",
    timestamp: now,
    payload: { audience_id: created.audience_id, source_kind: created.source_kind }
  });
  return hydrateStory(state, created);
},
transitionStoryStatus(storyId, status, options = {}) {
  const story = requireStory(state, storyId);
  const now = options.timestamp ?? nowIso();
  const updated = { ...story, status, updated_at: now };
  state.stories.set(storyId, updated);
  appendAudit(state, {
    type: "story_status_changed",
    entity_type: "story",
    entity_id: storyId,
    actor_id: options.actorId ?? "system",
    timestamp: now,
    payload: { from: story.status, to: status }
  });
  return hydrateStory(state, updated);
},
```

- [ ] **Step 4: Update `submitStoryReview` in `createRepository` to auto-transition status**

Find this block in `createRepository`'s `submitStoryReview` (around line 227):

```javascript
      state.stories.set(storyId, {
        ...story,
        operator_review_status: reviewRow.review_status,
        operator_reviewed_at: timestamp,
        operator_reviewed_by: reviewRow.actor_id,
        operator_review_note: reviewRow.review_notes,
        updated_at: timestamp
      });
```

Replace with:

```javascript
      const statusFromReview = reviewRow.review_status === "approved"
        ? "ready_to_publish"
        : reviewRow.review_status === "rejected"
          ? "archived"
          : story.status;
      state.stories.set(storyId, {
        ...story,
        status: statusFromReview,
        operator_review_status: reviewRow.review_status,
        operator_reviewed_at: timestamp,
        operator_reviewed_by: reviewRow.actor_id,
        operator_review_note: reviewRow.review_notes,
        updated_at: timestamp
      });
```

- [ ] **Step 5: Add `createStory` and `transitionStoryStatus` to the `withPersistence` array**

Find the `withPersistence` function in `src/repository.js` (around line 1026). In the array of method names, add `"createStory"` and `"transitionStoryStatus"`:

```javascript
  for (const methodName of [
    "createStory",
    "transitionStoryStatus",
    "updateStory",
    "updateAudience",
    "createInstanceForAudience",
    "updateInstance",
    "selectStoryAsset",
    "replaceStoryAsset",
    "submitStoryReview",
    "queueStoryPublication",
    "saveFeedbackEvent",
    "saveInstanceReport",
    "saveOperatorChat",
    "saveDeploymentResult"
  ]) {
```

- [ ] **Step 6: Add `createStory` and `transitionStoryStatus` to `createSupabaseRepository`**

In `createSupabaseRepository` (after `updateAudience`), add:

```javascript
async createStory(story, options = {}) {
  const rows = await client.insert("vivo_stories", {
    factory_id: story.factory_id ?? null,
    audience_id: story.audience_id,
    instance_id: story.instance_id ?? null,
    story_key: story.story_key,
    title: story.title,
    story_text: story.story_text ?? "",
    summary: story.summary ?? story.story_text?.slice(0, 200) ?? "",
    source_kind: story.source_kind ?? "rss",
    primary_source_url: story.primary_source_url ?? null,
    status: "new",
    is_deal: story.is_deal ?? false,
    is_local: story.is_local ?? false,
    metadata: story.metadata ?? {}
  });
  await insertAuditEvent(client, {
    entity_type: "story",
    entity_id: rows[0].id,
    event_type: "story_created",
    actor_id: options.actorId ?? "system",
    payload: { audience_id: story.audience_id, source_kind: story.source_kind }
  });
  return rows[0];
},
async transitionStoryStatus(storyId, status, options = {}) {
  const rows = await client.update("vivo_stories", { id: `eq.${storyId}` }, { status });
  await insertAuditEvent(client, {
    entity_type: "story",
    entity_id: storyId,
    event_type: "story_status_changed",
    actor_id: options.actorId ?? "system",
    payload: { to: status }
  });
  const hydrated = await hydrateSupabaseStories(client, rows);
  return hydrated[0] ?? null;
},
```

- [ ] **Step 7: Update `submitStoryReview` in `createSupabaseRepository` to auto-transition status**

Find the `client.update("vivo_stories", ...)` call inside `submitStoryReview` in the Supabase repo (around line 696). Replace:

```javascript
      await client.update("vivo_stories", { id: `eq.${storyId}` }, {
        operator_review_status: rows[0].review_status,
        operator_reviewed_at: rows[0].created_at,
        operator_reviewed_by: rows[0].actor_id,
        operator_review_note: rows[0].review_notes
      });
```

With:

```javascript
      const statusFromReview = rows[0].review_status === "approved"
        ? "ready_to_publish"
        : rows[0].review_status === "rejected"
          ? "archived"
          : undefined;
      await client.update("vivo_stories", { id: `eq.${storyId}` }, {
        ...(statusFromReview ? { status: statusFromReview } : {}),
        operator_review_status: rows[0].review_status,
        operator_reviewed_at: rows[0].created_at,
        operator_reviewed_by: rows[0].actor_id,
        operator_review_note: rows[0].review_notes
      });
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test tests/repository-content-fetch.test.js`
Expected: all 5 tests PASS

- [ ] **Step 9: Run full test suite to confirm no regressions**

Run: `npm test`
Expected: all tests PASS (note: existing review tests that expected status NOT to change will now fail — update those to expect `ready_to_publish` on approved)

If any existing dashboard.test.js review tests fail, find the assertion and update `status` expectation:
- For `approved` review: expect `story.status === "ready_to_publish"`
- For `rejected` review: expect `story.status === "archived"`

- [ ] **Step 10: Commit**

```bash
git add src/repository.js tests/repository-content-fetch.test.js tests/dashboard.test.js
git commit -m "feat: add createStory, transitionStoryStatus; auto-transition status on review"
```

---

## Task 4: Repository Jobs + Migration

**Files:**
- Create: `supabase/migrations/20260417100000_vivo_content_fetch_jobs.sql`
- Modify: `src/repository.js`
- Test: `tests/repository-content-fetch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/repository-content-fetch.test.js`:

```javascript
test("createJob creates a pending job", async () => {
  const repo = await loadRepo();

  const job = repo.createJob({
    factory_id: "factory-1",
    audience_id: "aud-1"
  }, { timestamp: "2026-04-17T09:00:00.000Z" });

  assert.ok(job.id, "should have an id");
  assert.equal(job.audience_id, "aud-1");
  assert.equal(job.status, "pending");
  assert.equal(job.stories_created, null);
  assert.equal(job.error, null);
  assert.equal(job.created_at, "2026-04-17T09:00:00.000Z");
});

test("getJob returns null for unknown id", async () => {
  const repo = await loadRepo();
  assert.equal(repo.getJob("nonexistent-id"), null);
});

test("updateJob changes status and stores stories_created", async () => {
  const repo = await loadRepo();
  const job = repo.createJob({ audience_id: "aud-1" });

  const updated = repo.updateJob(job.id, { status: "done", stories_created: 5 });

  assert.equal(updated.status, "done");
  assert.equal(updated.stories_created, 5);
  assert.equal(repo.getJob(job.id).status, "done");
});
```

- [ ] **Step 2: Run to verify new tests fail**

Run: `node --test tests/repository-content-fetch.test.js`
Expected: first 5 tests PASS, last 3 FAIL with `TypeError: repo.createJob is not a function`

- [ ] **Step 3: Create the Supabase migration**

Create `supabase/migrations/20260417100000_vivo_content_fetch_jobs.sql`:

```sql
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
```

- [ ] **Step 4: Add `contentFetchJobs` to `normalizeState` in `src/repository.js`**

Find `normalizeState` (around line 842). Add the `contentFetchJobs` entry:

```javascript
function normalizeState(seed) {
  return {
    audiences: new Map((seed.audiences ?? []).map((item) => [item.id, { ...item }])),
    instances: new Map((seed.instances ?? []).map((item) => [item.id, { ...item }])),
    stories: new Map((seed.stories ?? []).map((item) => [item.id, { ...item }])),
    storyAssets: new Map((seed.storyAssets ?? []).map((item) => [item.id, { ...item }])),
    storageObjects: new Map((seed.storageObjects ?? []).map((item) => [item.id, { ...item }])),
    contentFetchJobs: new Map((seed.contentFetchJobs ?? []).map((item) => [item.id, { ...item }])),
    storyReviews: [...(seed.storyReviews ?? [])],
    storyPublications: [...(seed.storyPublications ?? [])],
    auditEvents: [...(seed.auditEvents ?? seed.auditLog ?? [])].map(normalizeAuditEvent),
    feedbackEvents: [...(seed.feedbackEvents ?? [])],
    instanceReports: [...(seed.instanceReports ?? [])],
    operatorChats: [...(seed.operatorChats ?? [])],
    deployments: [...(seed.deployments ?? [])],
    conversations: Object.fromEntries(
      Object.entries(seed.conversations ?? {}).map(([k, v]) => [k, { ...v, _messages: [] }])
    )
  };
}
```

- [ ] **Step 5: Add `contentFetchJobs` to `exportState`**

Find `exportState` (around line 862). Add:

```javascript
function exportState(state) {
  return {
    audiences: [...state.audiences.values()],
    instances: [...state.instances.values()],
    stories: [...state.stories.values()],
    storyAssets: [...state.storyAssets.values()],
    storageObjects: [...state.storageObjects.values()],
    contentFetchJobs: [...state.contentFetchJobs.values()],
    storyReviews: [...state.storyReviews],
    storyPublications: [...state.storyPublications],
    auditEvents: [...state.auditEvents],
    feedbackEvents: [...state.feedbackEvents],
    instanceReports: [...state.instanceReports],
    operatorChats: [...state.operatorChats],
    deployments: [...state.deployments],
    conversations: Object.fromEntries(
      Object.entries(state.conversations).map(([k, { _messages, ...rest }]) => [k, rest])
    )
  };
}
```

- [ ] **Step 6: Add job methods to `createRepository` in `src/repository.js`**

In `createRepository`, after `transitionStoryStatus`, add:

```javascript
createJob(job, options = {}) {
  const now = options.timestamp ?? nowIso();
  const created = {
    id: job.id ?? crypto.randomUUID(),
    factory_id: job.factory_id ?? null,
    audience_id: job.audience_id,
    status: "pending",
    stories_created: null,
    error: null,
    created_at: now,
    updated_at: now
  };
  state.contentFetchJobs.set(created.id, created);
  return { ...created };
},
getJob(jobId) {
  const job = state.contentFetchJobs.get(jobId);
  return job ? { ...job } : null;
},
updateJob(jobId, changes = {}, options = {}) {
  const job = state.contentFetchJobs.get(jobId);
  if (!job) throw new Error(`Unknown job id: ${jobId}`);
  const updated = { ...job, ...changes, updated_at: options.timestamp ?? nowIso() };
  state.contentFetchJobs.set(jobId, updated);
  return { ...updated };
},
```

- [ ] **Step 7: Add job methods to `createSupabaseRepository`**

In `createSupabaseRepository`, after `transitionStoryStatus`, add:

```javascript
async createJob(job, options = {}) {
  const rows = await client.insert("vivo_content_fetch_jobs", {
    factory_id: job.factory_id ?? null,
    audience_id: job.audience_id,
    status: "pending"
  });
  return rows[0];
},
async getJob(jobId) {
  const rows = await client.select("vivo_content_fetch_jobs", {
    id: `eq.${jobId}`,
    limit: "1"
  });
  return rows[0] ?? null;
},
async updateJob(jobId, changes = {}) {
  const rows = await client.update("vivo_content_fetch_jobs", { id: `eq.${jobId}` }, changes);
  return rows[0] ?? null;
},
```

- [ ] **Step 8: Add `createJob` and `updateJob` to the `withPersistence` array**

```javascript
  for (const methodName of [
    "createStory",
    "transitionStoryStatus",
    "createJob",
    "updateJob",
    "updateStory",
    // ... rest unchanged
  ]) {
```

- [ ] **Step 9: Run tests**

Run: `node --test tests/repository-content-fetch.test.js`
Expected: all 8 tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/repository.js supabase/migrations/20260417100000_vivo_content_fetch_jobs.sql tests/repository-content-fetch.test.js
git commit -m "feat: add job tracking to repository + Supabase migration for content fetch jobs"
```

---

## Task 5: Review Endpoint — Relax Asset Requirement

**Files:**
- Modify: `src/app.js`
- Test: `tests/dashboard.test.js`

**Background:** The existing `POST /api/stories/:id/reviews` endpoint requires a selected asset for approved reviews. Content-fetcher stories have no assets. Relax this to only require a selected asset when the story has assets.

- [ ] **Step 1: Write the failing test**

In `tests/dashboard.test.js`, find the existing story review tests and add one new test for approving a text-only story (no assets). Add this test to the existing test file:

```javascript
test("POST /api/stories/:id/reviews — approves a story with no assets without requiring a selected_asset_id", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({
    audiences: [{
      id: "aud-1", audience_key: "bcn", label: "Barcelona", language: "en",
      location: "Barcelona", family_context: "", interests: [], content_pillars: [],
      excluded_topics: [], tone: "helpful", profile_snapshot: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }]
  });
  // Create a text-only story (no assets)
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "review-test-1",
    title: "Daily News", story_text: "Today in Barcelona...", summary: "Today in Barcelona...",
    source_kind: "rss", primary_source_url: "https://example.com/news"
  });
  const app = createApp({ repository: repo, clock: () => "2026-04-17T10:00:00.000Z" });

  const result = await app.handle({
    method: "POST",
    pathname: `/api/stories/${story.id}/reviews`,
    query: {},
    body: JSON.stringify({ review_status: "approved", review_notes: "good", actor_id: "op-1" })
  });

  assert.equal(result.status, 200);
  const updated = repo.getStory(story.id);
  assert.equal(updated.operator_review_status, "approved");
  assert.equal(updated.status, "ready_to_publish");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dashboard.test.js 2>&1 | grep -A3 "approves a story with no assets"`
Expected: FAIL with status 409

- [ ] **Step 3: Update `src/app.js` — relax the asset requirement**

Find the review submission handler in `src/app.js` (around line 150). Find:

```javascript
    const selectedAssetId = body.selected_asset_id ?? story.selected_asset_id ?? null;
    if (body.review_status === "approved" && !selectedAssetId) {
      return json(409, { error: "An approved review requires a selected asset." });
    }
```

Replace with:

```javascript
    const hasAssets = (story.assets?.length ?? 0) > 0;
    const selectedAssetId = body.selected_asset_id ?? story.selected_asset_id ?? null;
    if (body.review_status === "approved" && hasAssets && !selectedAssetId) {
      return json(409, { error: "An approved review requires a selected asset when the story has assets." });
    }
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/dashboard.test.js`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.js tests/dashboard.test.js
git commit -m "fix: allow approving text-only stories without a selected asset"
```

---

## Task 6: Content Fetcher Service

**Files:**
- Create: `src/content-fetcher.js`
- Test: `tests/content-fetcher.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/content-fetcher.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

const FAKE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Barcelona News Today</title>
    <link>https://example.com/news/1</link>
    <description>Something happened in the city today.</description>
  </item>
  <item>
    <title><![CDATA[Weather Report]]></title>
    <link>https://example.com/news/2</link>
    <description><![CDATA[<p>Sunny with clouds</p>]]></description>
  </item>
</channel></rss>`;

async function makeRepo() {
  const { createRepository } = await import("../src/repository.js");
  return createRepository({
    audiences: [{
      id: "aud-1", audience_key: "bcn", label: "Barcelona", language: "en",
      location: "Barcelona", family_context: "", interests: [], content_pillars: [],
      excluded_topics: [], tone: "helpful", profile_snapshot: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }],
    instances: [{
      id: "inst-1", factory_id: "f-1", audience_id: "aud-1",
      instance_key: "bcn-oc", service_name: "bcn-oc",
      openclaw_admin_url: "http://127.0.0.1:18801",
      profile_base_url: "http://127.0.0.1:5401",
      runtime_config: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }]
  });
}

const SOURCES_CONFIG = {
  sources: [
    { id: "src-bcn-news", location: "barcelona", category: "news", type: "rss",
      url: "https://fake.feed/rss", weight: 1.0 },
    { id: "src-global-tech", location: "global", category: "tech", type: "rss",
      url: "https://global.feed/rss", weight: 0.6 }
  ]
};

const MERCHANT_REGISTRY = { merchants: [], audienceOverrides: [] };

test("fetchForAudience fetches RSS items and creates stories", async () => {
  const { createContentFetcher } = await import("../src/content-fetcher.js");
  const repo = await makeRepo();
  const fetcher = createContentFetcher({
    sourcesConfig: SOURCES_CONFIG,
    merchantRegistry: MERCHANT_REGISTRY,
    profileClientFactory: null,
    repository: repo,
    fetchImpl: async () => ({ ok: true, text: async () => FAKE_RSS }),
    factoryId: "f-1",
    clock: () => "2026-04-17T09:00:00.000Z"
  });

  const audience = { id: "aud-1", location: "Barcelona" };
  const instance = { id: "inst-1", runtime_config: {} };
  const result = await fetcher.fetchForAudience(audience, instance, { limit: 5 });

  assert.equal(result.stories_created, 2);
  const stories = repo.listStories({ audience_id: "aud-1" });
  assert.equal(stories.length, 2);
  assert.equal(stories[0].source_kind, "rss");
  assert.equal(stories[0].factory_id, "f-1");
});

test("fetchForAudience strips CDATA and HTML from RSS descriptions", async () => {
  const { createContentFetcher } = await import("../src/content-fetcher.js");
  const repo = await makeRepo();
  const fetcher = createContentFetcher({
    sourcesConfig: SOURCES_CONFIG,
    merchantRegistry: MERCHANT_REGISTRY,
    profileClientFactory: null,
    repository: repo,
    fetchImpl: async () => ({ ok: true, text: async () => FAKE_RSS }),
    factoryId: "f-1",
    clock: () => "2026-04-17T09:00:00.000Z"
  });

  await fetcher.fetchForAudience({ id: "aud-1", location: "Barcelona" }, { id: "inst-1", runtime_config: {} }, { limit: 5 });

  const stories = repo.listStories({ audience_id: "aud-1" });
  const weatherStory = stories.find(s => s.title === "Weather Report");
  assert.ok(weatherStory, "should find the CDATA story");
  assert.ok(!weatherStory.story_text.includes("<p>"), "should strip HTML tags");
  assert.equal(weatherStory.story_text, "Sunny with clouds");
});

test("fetchForAudience deduplicates by URL against recent stories", async () => {
  const { createContentFetcher } = await import("../src/content-fetcher.js");
  const repo = await makeRepo();
  // Pre-create a story with the same URL
  repo.createStory({
    factory_id: "f-1", audience_id: "aud-1", story_key: "preexisting-key",
    title: "Old", story_text: "Old story", summary: "Old",
    source_kind: "rss", primary_source_url: "https://example.com/news/1"
  });

  const fetcher = createContentFetcher({
    sourcesConfig: SOURCES_CONFIG,
    merchantRegistry: MERCHANT_REGISTRY,
    profileClientFactory: null,
    repository: repo,
    fetchImpl: async () => ({ ok: true, text: async () => FAKE_RSS }),
    factoryId: "f-1",
    clock: () => "2026-04-17T09:00:00.000Z"
  });

  const result = await fetcher.fetchForAudience(
    { id: "aud-1", location: "Barcelona" },
    { id: "inst-1", runtime_config: {} },
    { limit: 5 }
  );

  assert.equal(result.stories_created, 1, "should skip the already-seen URL");
});

test("fetchForAudience uses marble scoring when profileClient is available", async () => {
  const { createContentFetcher } = await import("../src/content-fetcher.js");
  const repo = await makeRepo();
  let selectItemsCalled = false;
  const fakeProfileClient = {
    selectItems: async (items, context) => {
      selectItemsCalled = true;
      // Only return the first item, score it
      return { ok: true, data: { selected: [{ id: items[0].id, score: 0.9, rank: 1 }] }, errors: [] };
    }
  };
  const fetcher = createContentFetcher({
    sourcesConfig: SOURCES_CONFIG,
    merchantRegistry: MERCHANT_REGISTRY,
    profileClientFactory: () => fakeProfileClient,
    repository: repo,
    fetchImpl: async () => ({ ok: true, text: async () => FAKE_RSS }),
    factoryId: "f-1",
    clock: () => "2026-04-17T09:00:00.000Z"
  });

  await fetcher.fetchForAudience({ id: "aud-1", location: "Barcelona" }, { id: "inst-1", runtime_config: {} }, { limit: 5 });

  assert.ok(selectItemsCalled, "should have called marble selectItems");
  const stories = repo.listStories({ audience_id: "aud-1" });
  assert.equal(stories.length, 1, "marble returned only 1 selected item");
  assert.equal(stories[0].metadata.marble_score, 0.9);
});

test("fetchForAudience includes merchant items", async () => {
  const { createContentFetcher } = await import("../src/content-fetcher.js");
  const repo = await makeRepo();
  const sourcesWithMerchant = {
    sources: [
      { id: "src-bcn-deals", location: "barcelona", category: "deals",
        type: "merchant", merchant_id: "zara-es", weight: 0.8 }
    ]
  };
  const merchantRegistry = {
    merchants: [{
      merchant_id: "zara-es", domain: "zara.com", enabled: true,
      discovery_config: { listing_url: "https://zara.com/es/" }
    }],
    audienceOverrides: []
  };

  const fetcher = createContentFetcher({
    sourcesConfig: sourcesWithMerchant,
    merchantRegistry,
    profileClientFactory: null,
    repository: repo,
    fetchImpl: async () => { throw new Error("should not fetch for merchant"); },
    factoryId: "f-1",
    clock: () => "2026-04-17T09:00:00.000Z"
  });

  const result = await fetcher.fetchForAudience(
    { id: "aud-1", location: "Barcelona" },
    { id: "inst-1", runtime_config: {} },
    { limit: 5 }
  );

  assert.equal(result.stories_created, 1);
  const stories = repo.listStories({ audience_id: "aud-1" });
  assert.equal(stories[0].source_kind, "merchant");
  assert.equal(stories[0].is_deal, true);
});
```

- [ ] **Step 2: Run to verify tests fail**

Run: `node --test tests/content-fetcher.test.js`
Expected: FAIL with `Error: Cannot find module '../src/content-fetcher.js'`

- [ ] **Step 3: Create `src/content-fetcher.js`**

```javascript
import crypto from "node:crypto";

export function createContentFetcher(options = {}) {
  const sourcesConfig = options.sourcesConfig ?? { sources: [] };
  const merchantRegistry = options.merchantRegistry ?? { merchants: [], audienceOverrides: [] };
  const profileClientFactory = options.profileClientFactory ?? null;
  const repository = options.repository;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const factoryId = options.factoryId ?? null;
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    async fetchForAudience(audience, instance, fetchOptions = {}) {
      const limit = fetchOptions.limit ?? 20;
      const audienceLocation = normalizeLocation(audience.location ?? "");

      const customSources = instance?.runtime_config?.custom_sources ?? [];
      const allSources = [...sourcesConfig.sources, ...customSources];
      const localSources = allSources.filter(
        (s) => normalizeLocation(s.location ?? "") === audienceLocation
      );
      const globalSources = allSources.filter((s) => s.location === "global");

      const [localCandidates, globalCandidates] = await Promise.all([
        fetchSources(localSources, fetchImpl, merchantRegistry, 40),
        fetchSources(globalSources, fetchImpl, merchantRegistry, 10)
      ]);
      const allCandidates = [...localCandidates, ...globalCandidates];

      // Deduplicate vs stories created in the last 7 days
      const existing = await repository.listStories({ audience_id: audience.id });
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentUrls = new Set(
        existing
          .filter((s) => (s.created_at ?? "") >= sevenDaysAgo)
          .map((s) => s.primary_source_url)
          .filter(Boolean)
      );
      const deduplicated = allCandidates.filter((c) => !recentUrls.has(c.url));

      if (deduplicated.length === 0) {
        return { stories_created: 0 };
      }

      // Score with marble if profileClient available
      const profileClient = typeof profileClientFactory === "function"
        ? profileClientFactory({ audience, instance })
        : null;
      const scored = await scoreWithMarble(profileClient, deduplicated, limit);

      const storyKey = (audienceId, url) =>
        crypto.createHash("sha1").update(`${audienceId}:${url}`).digest("hex");

      let created = 0;
      const timestamp = clock();
      for (const item of scored) {
        try {
          await repository.createStory({
            factory_id: factoryId,
            audience_id: audience.id,
            instance_id: instance?.id ?? null,
            story_key: storyKey(audience.id, item.url),
            title: item.title,
            story_text: item.description,
            summary: item.description.slice(0, 200),
            source_kind: item.source_type,
            primary_source_url: item.url,
            is_deal: item.category === "deals",
            is_local: item.is_local,
            metadata: {
              marble_score: item.score,
              marble_rank: item.rank,
              source_id: item.source_id,
              category: item.category
            }
          }, { actorId: "content-fetcher", timestamp });
          created++;
        } catch (err) {
          // Duplicate story_key = already seen; skip silently
          if (!String(err.message).toLowerCase().includes("duplicate") &&
              !String(err.message).toLowerCase().includes("unique") &&
              !String(err.message).toLowerCase().includes("story_key")) {
            throw err;
          }
        }
      }

      return { stories_created: created };
    }
  };
}

async function fetchSources(sources, fetchImpl, merchantRegistry, maxItems) {
  const results = [];
  for (const source of sources) {
    if (results.length >= maxItems) break;
    try {
      if (source.type === "rss") {
        const items = await fetchRss(source, fetchImpl, maxItems - results.length);
        results.push(...items);
      } else if (source.type === "merchant") {
        const items = fetchMerchantItems(source, merchantRegistry, maxItems - results.length);
        results.push(...items);
      }
    } catch {
      // Skip failed sources silently; don't break the whole fetch
    }
  }
  return results.slice(0, maxItems);
}

async function fetchRss(source, fetchImpl, max) {
  const res = await fetchImpl(source.url, {});
  if (!res.ok) return [];
  const xml = await res.text();
  return parseRssItems(xml, source, max);
}

function parseRssItems(xml, source, max) {
  const items = [];
  const itemPattern = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemPattern.exec(xml)) !== null) {
    if (items.length >= max) break;
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link") || extractTag(block, "guid");
    const description = extractTag(block, "description") || extractTag(block, "summary") || "";
    if (title && link) {
      items.push({
        id: link,
        title: stripCdata(title),
        description: stripHtml(stripCdata(description)),
        url: link,
        category: source.category,
        source_id: source.id,
        source_type: "rss",
        is_local: source.location !== "global"
      });
    }
  }
  return items;
}

function fetchMerchantItems(source, merchantRegistry, max) {
  const merchant = (merchantRegistry.merchants ?? []).find(
    (m) => m.merchant_id === source.merchant_id
  );
  if (!merchant || !merchant.enabled) return [];
  const url = merchant.discovery_config?.listing_url ?? `https://${merchant.domain}`;
  return [{
    id: url,
    title: `Deals from ${merchant.domain}`,
    description: `Curated deals and offers from ${merchant.domain}`,
    url,
    category: source.category,
    source_id: source.id,
    source_type: "merchant",
    is_local: source.location !== "global"
  }].slice(0, max);
}

async function scoreWithMarble(profileClient, items, limit) {
  if (!profileClient?.selectItems) {
    return items.slice(0, limit).map((item, i) => ({ ...item, score: 0.5, rank: i + 1 }));
  }
  const input = items.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.description,
    category: item.category,
    url: item.url
  }));
  const result = await profileClient.selectItems(input, { task: "daily_recap", limit });
  const ranked = result.data?.selected ?? [];
  const scoreMap = new Map(ranked.map((r) => [r.id, r]));
  return items
    .filter((item) => scoreMap.has(item.id))
    .map((item) => ({
      ...item,
      score: scoreMap.get(item.id).score,
      rank: scoreMap.get(item.id).rank
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
}

function extractTag(xml, tag) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function stripCdata(text) {
  return String(text).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function normalizeLocation(location) {
  return String(location).toLowerCase().trim();
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/content-fetcher.test.js`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-fetcher.js tests/content-fetcher.test.js
git commit -m "feat: add content fetcher with RSS/merchant support, dedup, and marble scoring"
```

---

## Task 7: App Endpoints

**Files:**
- Modify: `src/app.js`
- Test: `tests/dashboard.test.js`

Add four new endpoints:
- `POST /api/audiences/:id/fetch-content` → start async fetch job
- `POST /api/audiences/:id/sources` → add custom source to instance
- `GET /api/jobs/:jobId` → poll job status
- `POST /api/audiences/:id/publish-recap` → send approved stories to Telegram

- [ ] **Step 1: Write the failing tests**

Add to `tests/dashboard.test.js`:

```javascript
test("POST /api/audiences/:id/fetch-content creates a job and returns job_id", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({ audiences: [createSeed().audiences[0]] });
  const dispatchCalls = [];
  const app = createApp({
    repository: repo,
    clock: () => "2026-04-17T09:00:00.000Z",
    dispatchFetch: async (audience, instance, jobId, opts) => {
      dispatchCalls.push({ audienceId: audience.id, jobId, opts });
    }
  });

  const result = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/fetch-content",
    query: {},
    body: JSON.stringify({ limit: 10 })
  });

  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.ok(body.job_id, "should return a job_id");
  const job = repo.getJob(body.job_id);
  assert.ok(job, "job should exist in repository");
  assert.equal(job.audience_id, "aud-1");
  assert.equal(job.status, "pending");
});

test("POST /api/audiences/:id/fetch-content returns 404 when dispatchFetch not configured", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({ audiences: [createSeed().audiences[0]] });
  const app = createApp({ repository: repo });

  const result = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/fetch-content",
    query: {},
    body: ""
  });

  assert.equal(result.status, 404);
});

test("GET /api/jobs/:jobId returns job status", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({ audiences: [createSeed().audiences[0]] });
  const job = repo.createJob({ audience_id: "aud-1" });
  const app = createApp({ repository: repo });

  const result = await app.handle({
    method: "GET",
    pathname: `/api/jobs/${job.id}`,
    query: {},
    body: ""
  });

  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.id, job.id);
  assert.equal(body.status, "pending");
});

test("GET /api/jobs/:jobId returns 404 for unknown job", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({});
  const app = createApp({ repository: repo });

  const result = await app.handle({
    method: "GET",
    pathname: "/api/jobs/nonexistent-id",
    query: {},
    body: ""
  });

  assert.equal(result.status, 404);
});

test("POST /api/audiences/:id/sources adds custom source to instance runtime_config", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });
  const app = createApp({ repository: repo, clock: () => "2026-04-17T10:00:00.000Z" });

  const result = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/sources",
    query: {},
    body: JSON.stringify({
      source: { type: "rss", url: "https://myfeed.com/rss", category: "news", weight: 0.8 }
    })
  });

  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.ok(body.source_id, "should return source_id");
  const instance = repo.getInstance("inst-1");
  const customSources = instance.runtime_config?.custom_sources ?? [];
  assert.equal(customSources.length, 1);
  assert.equal(customSources[0].url, "https://myfeed.com/rss");
});

test("POST /api/audiences/:id/publish-recap publishes ready_to_publish+approved stories", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({
    audiences: seed.audiences,
    instances: [{ ...seed.instances[0], openclaw_admin_url: "http://127.0.0.1:18801" }]
  });
  // Create a story manually in ready_to_publish + approved state
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "recap-story-1", title: "Daily News",
    story_text: "Today in Barcelona something great happened.",
    summary: "Today in Barcelona", source_kind: "rss",
    primary_source_url: "https://example.com/news/1"
  });
  repo.transitionStoryStatus(story.id, "ready_to_publish");
  repo.submitStoryReview(story.id, {
    review_status: "approved", review_notes: "", actor_id: "op-1", selected_asset_id: null, payload: {}
  });

  const openclawRequests = [];
  const app = createApp({
    repository: repo,
    clock: () => "2026-04-17T10:00:00.000Z",
    fetchImpl: async (url, opts) => {
      openclawRequests.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    }
  });

  const result = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/publish-recap",
    query: {},
    body: ""
  });

  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.published, 1);
  assert.equal(openclawRequests.length, 1);
  assert.ok(openclawRequests[0].url.includes("/api/send"));
  assert.ok(openclawRequests[0].body.message.includes("Daily News"));
  const published = repo.getStory(story.id);
  assert.equal(published.status, "published");
});
```

- [ ] **Step 2: Run to verify tests fail**

Run: `node --test tests/dashboard.test.js 2>&1 | tail -20`
Expected: new tests FAIL (endpoints return 404)

- [ ] **Step 3: Update `createApp` to accept new options**

In `src/app.js`, update the top of `createApp`:

```javascript
export function createApp(options) {
  const repository = options.repository;
  const instanceManager = options.instanceManager ?? null;
  const profileClientFactory = options.profileClientFactory ?? null;
  const setupService = options.setupService ?? null;
  const audienceImportService = options.audienceImportService ?? null;
  const audienceManagerLauncher = options.audienceManagerLauncher ?? null;
  const publicationTargetResolver = options.publicationTargetResolver ?? (() => null);
  const dispatchFetch = options.dispatchFetch ?? null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const clock = options.clock ?? (() => new Date().toISOString());
```

And update `handleRequest` to destructure `dispatchFetch` and `fetchImpl`:

```javascript
async function handleRequest(context) {
  const {
    repository,
    instanceManager,
    profileClientFactory,
    setupService,
    audienceImportService,
    audienceManagerLauncher,
    publicationTargetResolver,
    dispatchFetch,
    fetchImpl,
    clock,
    request
  } = context;
```

And update the `createApp` return to pass through:
```javascript
  return {
    async handle(request) {
      try {
        return await handleRequest({
          repository,
          instanceManager,
          profileClientFactory,
          setupService,
          audienceImportService,
          audienceManagerLauncher,
          publicationTargetResolver,
          dispatchFetch,
          fetchImpl,
          clock,
          request
        });
      } catch (error) {
        return json(500, { error: error.message });
      }
    }
  };
```

- [ ] **Step 4: Add the four new endpoints to `handleRequest` in `src/app.js`**

Add these handlers before the final `return json(404, { error: "Not found" })` line:

```javascript
  // POST /api/audiences/:id/fetch-content
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/fetch-content$/)) {
    if (!dispatchFetch) {
      return json(404, { error: "Content fetching is not configured." });
    }
    const audienceId = request.pathname.split("/")[3];
    const audience = await repository.getAudience(audienceId);
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const body = readBody(request.body);
    const instance = typeof repository.getInstanceByAudience === "function"
      ? await safeLoad(() => repository.getInstanceByAudience(audienceId), null)
      : null;
    const job = await repository.createJob({ audience_id: audienceId }, { timestamp: clock() });
    dispatchFetch(audience, instance, job.id, { limit: body.limit ?? 20 }).catch(() => {});
    return json(200, { job_id: job.id });
  }

  // GET /api/jobs/:jobId
  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/jobs\/([^/]+)$/)) {
    const jobId = request.pathname.split("/")[3];
    const job = await repository.getJob(jobId);
    return job ? json(200, job) : json(404, { error: "Job not found" });
  }

  // POST /api/audiences/:id/sources
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/sources$/)) {
    const audienceId = request.pathname.split("/")[3];
    const audience = await repository.getAudience(audienceId);
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const body = readBody(request.body);
    const source = body.source ?? {};
    if (!source.url && !source.merchant_id) {
      return json(400, { error: "source must have url or merchant_id" });
    }
    const instance = typeof repository.getInstanceByAudience === "function"
      ? await safeLoad(() => repository.getInstanceByAudience(audienceId), null)
      : null;
    if (!instance) {
      return json(404, { error: "No instance configured for this audience." });
    }
    const { randomUUID } = await import("node:crypto");
    const newSource = { id: randomUUID(), ...source };
    const customSources = instance.runtime_config?.custom_sources ?? [];
    await repository.updateInstance(instance.id, {
      runtime_config: { ...instance.runtime_config, custom_sources: [...customSources, newSource] }
    }, { actorId: "system", timestamp: clock() });
    return json(200, { source_id: newSource.id });
  }

  // POST /api/audiences/:id/publish-recap
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/publish-recap$/)) {
    const audienceId = request.pathname.split("/")[3];
    const audience = await repository.getAudience(audienceId);
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const body = readBody(request.body);
    const instance = typeof repository.getInstanceByAudience === "function"
      ? await safeLoad(() => repository.getInstanceByAudience(audienceId), null)
      : null;
    const openclawUrl = instance?.openclaw_admin_url ?? "";
    if (!openclawUrl) {
      return json(409, { error: "No OpenClaw admin URL configured for this audience." });
    }
    const allReady = await repository.listStories({
      audience_id: audienceId,
      status: "ready_to_publish",
      review_status: "approved"
    });
    const toPublish = body.story_ids?.length
      ? allReady.filter((s) => body.story_ids.includes(s.id))
      : allReady;

    let published = 0;
    for (const story of toPublish) {
      try {
        const message = [
          `<b>${escapeHtml(story.title)}</b>`,
          story.story_text,
          story.primary_source_url ?? ""
        ].filter(Boolean).join("\n\n");
        await fetchImpl(`${openclawUrl}/api/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel: "telegram", message })
        });
        await repository.transitionStoryStatus(story.id, "published", {
          actorId: "system",
          timestamp: clock()
        });
        await repository.updateStory(story.id, {
          metadata: { ...story.metadata, published_at: clock() }
        }, { actorId: "system", timestamp: clock() });
        published++;
      } catch {
        await repository.transitionStoryStatus(story.id, "failed", {
          actorId: "system",
          timestamp: clock()
        }).catch(() => {});
      }
    }
    return json(200, { published });
  }
```

- [ ] **Step 5: Add the `escapeHtml` helper to `src/app.js`**

At the bottom of `src/app.js`, after the existing helper functions, add:

```javascript
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 6: Run tests**

Run: `node --test tests/dashboard.test.js`
Expected: all tests PASS

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/app.js tests/dashboard.test.js
git commit -m "feat: add fetch-content, sources, jobs, and publish-recap endpoints"
```

---

## Task 8: Server Wiring + Cron

**Files:**
- Modify: `src/server.js`

No automated tests for server.js (it's a wiring file); verify manually.

- [ ] **Step 1: Import `createContentFetcher` and add source loading in `src/server.js`**

At the top of `src/server.js`, after existing imports, add:

```javascript
import { createContentFetcher } from "./content-fetcher.js";
```

- [ ] **Step 2: Load sources config and create contentFetcher in `src/server.js`**

After the `const runtimeConfig = loadJsonConfig(...)` line, add:

```javascript
const sourcesConfig = loadJsonConfig("config/sources.json", { sources: [] });
const merchantRegistryConfig = loadJsonConfig("config/merchant-registry.json", { merchants: [], audienceOverrides: [] });
```

After the `const profileClientFactory = createDashboardProfileClientFactory(runtimeConfig)` line, add:

```javascript
const contentFetcher = createContentFetcher({
  sourcesConfig,
  merchantRegistry: merchantRegistryConfig,
  profileClientFactory,
  repository,
  fetchImpl: globalThis.fetch,
  factoryId: runtimeConfig.factory_id ?? null,
  clock: () => new Date().toISOString()
});
```

- [ ] **Step 3: Add `dispatchFetch` function and wire it into `createApp` call**

Before the `const app = createApp({...})` call, add:

```javascript
async function dispatchFetch(audience, instance, jobId, fetchOptions = {}) {
  await repository.updateJob(jobId, { status: "running" });
  try {
    const result = await contentFetcher.fetchForAudience(audience, instance, fetchOptions);
    await repository.updateJob(jobId, { status: "done", stories_created: result.stories_created });
  } catch (err) {
    await repository.updateJob(jobId, { status: "failed", error: String(err.message).slice(0, 500) });
  }
}
```

In the `createApp({...})` call, add:

```javascript
const app = createApp({
  repository,
  instanceManager,
  profileClientFactory,
  setupService,
  audienceImportService,
  audienceManagerLauncher,
  dispatchFetch,
  fetchImpl: globalThis.fetch,
  publicationTargetResolver(audience, story) {
    // ... (existing implementation unchanged)
  },
  clock: () => new Date().toISOString()
});
```

- [ ] **Step 4: Add the daily cron after `server.listen(...)`**

After the `server.listen(port, host, () => { ... })` block, add:

```javascript
const RECAP_HOUR_UTC = parseInt(runtimeConfig.recap_hour_utc ?? "8", 10);
let lastCronDay = "";

setInterval(async () => {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  if (now.getUTCHours() === RECAP_HOUR_UTC && now.getUTCMinutes() < 2 && todayKey !== lastCronDay) {
    lastCronDay = todayKey;
    console.log(`[cron] Starting daily recap fetch for all audiences (${todayKey})`);
    try {
      const audiences = await repository.listAudiences();
      for (const audience of audiences) {
        const instance = typeof repository.getInstanceByAudience === "function"
          ? await repository.getInstanceByAudience(audience.id).catch(() => null)
          : null;
        const job = await repository.createJob({ audience_id: audience.id });
        dispatchFetch(audience, instance, job.id, { limit: 20 }).catch(console.error);
      }
    } catch (err) {
      console.error("[cron] Daily recap failed:", err.message);
    }
  }
}, 60 * 1000);
```

- [ ] **Step 5: Start the server and verify it starts without errors**

Run: `node src/server.js &`
Expected: `Vivo Factory dashboard listening on http://0.0.0.0:4310`

Then: `kill %1` (stop it)

- [ ] **Step 6: Commit**

```bash
git add src/server.js
git commit -m "feat: wire content fetcher into server, add daily cron at UTC 08:00"
```

---

## Task 9: OpenClaw Plugin Tool `audience_add_source`

**Files:**
- Modify: `src/plugins/user-profile/index.js`
- Modify: `src/plugins/user-profile/openclaw.plugin.json`

No automated test (plugin runs inside OpenClaw container). Verify by reading the final code.

- [ ] **Step 1: Update the plugin config schema to add `vivoFactoryUrl`**

In `src/plugins/user-profile/openclaw.plugin.json`, update `configSchema`:

```json
{
  "id": "user-profile",
  "enabledByDefault": true,
  "name": "User Profile",
  "description": "Marble-powered user profile sidecar: injects user interests into prompts and provides tools to record reactions and update profile facts.",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "baseUrl": { "type": "string", "minLength": 1 },
      "vivoFactoryUrl": { "type": "string", "minLength": 1 }
    }
  }
}
```

- [ ] **Step 2: Add `audience_add_source` tool to `src/plugins/user-profile/index.js`**

In `src/plugins/user-profile/index.js`, inside the `register(api)` method, after the `marble_update_facts` tool registration, add:

```javascript
      const vivoFactoryUrl = (api.pluginConfig?.vivoFactoryUrl ?? "").replace(/\/$/, "");
      const audienceId = process.env.AUDIENCE_ID ?? "";

      api.registerTool({
        name: "audience_add_source",
        description:
          "Add a news source, RSS feed, or website to this audience's daily recap pipeline. " +
          "Use this when the user mentions a publication, website, or topic they want to follow regularly.",
        parameters: {
          type: "object",
          required: ["url", "category"],
          properties: {
            url: {
              type: "string",
              description: "RSS feed URL or main website URL of the source"
            },
            category: {
              type: "string",
              description: "Content category: news, entertainment, deals, travel, tech, sports, lifestyle"
            },
            type: {
              type: "string",
              enum: ["rss", "merchant"],
              description: "Source type — use rss for feeds and websites (default: rss)"
            },
            weight: {
              type: "number",
              description: "Relevance weight from 0.1 (low) to 1.0 (high). Default: 0.7"
            }
          }
        },
        execute: async (_id, params) => {
          if (!vivoFactoryUrl || !audienceId) {
            return jsonResult({
              ok: false,
              errors: ["audience_add_source: vivoFactoryUrl or AUDIENCE_ID not configured"],
              warnings: [],
              data: null
            });
          }
          const response = await fetch(
            `${vivoFactoryUrl}/api/audiences/${audienceId}/sources`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                source: {
                  type: params.type ?? "rss",
                  url: params.url,
                  category: params.category,
                  weight: params.weight ?? 0.7,
                  location: "custom"
                }
              })
            }
          );
          const data = await response.json();
          return jsonResult({
            ok: response.ok,
            data: response.ok ? { source_id: data.source_id } : null,
            errors: response.ok ? [] : ["Failed to add source to pipeline"],
            warnings: []
          });
        }
      });
```

- [ ] **Step 3: Verify the plugin file is syntactically valid**

Run: `node --input-type=module < src/plugins/user-profile/index.js 2>&1 | head -5`
Expected: no syntax errors (the command will fail with an import error since it's a plugin, but no syntax errors should appear)

- [ ] **Step 4: Commit**

```bash
git add src/plugins/user-profile/index.js src/plugins/user-profile/openclaw.plugin.json
git commit -m "feat: add audience_add_source tool to OpenClaw user-profile plugin"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Source Registry → Task 1
- [x] `profileClient.selectItems()` → Task 2
- [x] `repository.createStory()` → Task 3
- [x] `transitionStoryStatus` → Task 3
- [x] `submitStoryReview` auto-transition → Task 3
- [x] Supabase migration `vivo_content_fetch_jobs` → Task 4
- [x] `createJob` / `getJob` / `updateJob` → Task 4
- [x] Relax asset requirement for text-only story reviews → Task 5
- [x] `createContentFetcher` with RSS, merchant, 80/20, dedup, marble → Task 6
- [x] `POST /api/audiences/:id/fetch-content` → Task 7
- [x] `GET /api/jobs/:jobId` → Task 7
- [x] `POST /api/audiences/:id/sources` → Task 7
- [x] `POST /api/audiences/:id/publish-recap` → Task 7
- [x] Server wiring + daily cron → Task 8
- [x] `audience_add_source` OpenClaw tool → Task 9

**Method name consistency across tasks:**
- `repository.createStory(story, options)` — used in Task 3, 6, 7
- `repository.transitionStoryStatus(storyId, status, options)` — used in Task 3, 7
- `repository.createJob(job, options)` — used in Task 4, 7
- `repository.getJob(jobId)` — used in Task 4, 7
- `repository.updateJob(jobId, changes, options)` — used in Task 4, 8
- `profileClient.selectItems(items, context)` — used in Task 2, 6
- `contentFetcher.fetchForAudience(audience, instance, options)` — used in Task 6, 8
- `dispatchFetch(audience, instance, jobId, options)` — used in Task 7, 8
