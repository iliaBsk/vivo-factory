# Daily Recap Feature Design

**Date:** 2026-04-17  
**Status:** Approved

---

## Goal

Enable each OpenClaw audience manager to collect locally-relevant news, deals, and entertainment based on the audience's marble profile, create stories in `vivo_stories`, pass them through operator review, and then have OpenClaw publish a daily recap to the audience's Telegram channel — marking each story published.

---

## Section 1: Source Registry

**What it is:** A curated JSON file at `config/sources.json` that maps location + category keys to a list of source entries. Vivo-factory owns this file; it is the authoritative list of where content is fetched from.

**Structure:**

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
      "id": "bcn-deals-groupon",
      "location": "barcelona",
      "category": "deals",
      "type": "merchant",
      "merchant_id": "groupon-es",
      "weight": 0.8
    },
    {
      "id": "global-tech-hackernews",
      "location": "global",
      "category": "tech",
      "type": "rss",
      "url": "https://news.ycombinator.com/rss",
      "weight": 0.6
    }
  ]
}
```

**Source types:**
- `rss` — fetch and parse feed URL
- `merchant` — pull affiliate products from merchant registry (`config/merchant-registry.json`) by `merchant_id`
- `search_query` — reserved for future web search integration

**80/20 split:** When fetching for an audience, 80% of items come from sources matching the audience's location, 20% from `location: "global"`. This ratio is applied at fetch time (not stored in the source record).

**Audience-specific sources:** Audiences can add custom sources via an OpenClaw tool `audience_add_source`. These are stored in `runtime_config.custom_sources[]` on the audience's instance record. They are merged with `config/sources.json` at fetch time.

**Seed data for Barcelona audiences:** `config/sources.json` ships with at minimum:
- 3 Barcelona news RSS feeds (La Vanguardia, El País Barcelona, Time Out Barcelona)
- 2 Barcelona entertainment/events feeds
- 1 Barcelona travel/deals merchant entry
- 3 global feeds (HN, BBC World, one tech feed)

---

## Section 2: Content Fetch Pipeline

**Service:** `src/content-fetcher.js` — a `createContentFetcher(options)` factory following the project's constructor-injection pattern.

**Dependencies injected:** `fetch`, `sourcesConfig`, `merchantRegistry`, `profileClient`, `repository`

**What it does:**
1. Loads sources for the target audience (location match + global, merged with instance `custom_sources`)
2. Fetches each source concurrently:
   - RSS: parse feed, extract title + description + link + publishedAt
   - Merchant: pull affiliate products from `merchant-registry.json`, generate affiliate link
3. Applies 80/20 split: sample up to N_local local items and N_global global items (configurable, default 40 local + 10 global = 50 candidates total)
4. Deduplicates by URL against stories already in `vivo_stories` for this audience in the last 7 days
5. Passes candidate items to marble scoring (Section 3) — marble returns ranked, scored list; items below score 0.3 are dropped
6. Creates `vivo_stories` rows for the top `limit` items (default 20) after scoring

**API endpoint:**

```
POST /api/audiences/:id/fetch-content
Body: { limit?: number }           // max stories to create, default 20
Response: { job_id: string }       // async — poll GET /api/jobs/:jobId
```

The endpoint enqueues a job and returns immediately. The job runs the full pipeline asynchronously.

**Source management endpoint:**

```
POST /api/audiences/:id/sources
Body: { source: { type, url, category, weight, lang? } }
Response: { source_id: string }
```

Writes the new source into the audience's instance `runtime_config.custom_sources` array via `repository.updateInstance()`.

---

## Section 3: Marble Scoring Endpoint

**New marble sidecar route:** `POST /user-profile/select`

Request:
```json
{
  "items": [
    { "id": "uuid", "title": "...", "summary": "...", "category": "news", "url": "..." }
  ],
  "context": { "task": "daily_recap", "limit": 20 }
}
```

Response:
```json
{
  "selected": [
    { "id": "uuid", "score": 0.87, "rank": 1 }
  ]
}
```

Marble's internal `select()` function scores each item against the user's profile graph and returns them ranked. Items below a threshold (0.3) are dropped.

**Client method:** `profileClient.selectItems(items, context)` — added to `src/profile-client.js`.

```javascript
async selectItems(items, context = {}) {
  const res = await this.fetch(`${this.baseUrl}/user-profile/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, context })
  });
  if (!res.ok) throw new Error(`marble select failed: ${res.status}`);
  return res.json(); // { selected: [{ id, score, rank }] }
}
```

---

## Section 4: Story Creation

**Method:** `repository.createStory(story)` — added to both `createFileRepository` and `createSupabaseRepository`.

Each scored item becomes a `vivo_stories` row:

| Column | Source |
|--------|--------|
| `factory_id` | from server context |
| `audience_id` | target audience ID |
| `instance_id` | audience's active instance ID |
| `story_key` | `sha1(audience_id + url)` — ensures uniqueness per audience |
| `title` | item title from feed/merchant |
| `story_text` | item description/summary |
| `summary` | first 200 chars of story_text |
| `source_kind` | `"rss"` / `"merchant"` / `"search"` |
| `primary_source_url` | item URL |
| `status` | `"new"` |
| `is_deal` | `true` if category is `"deals"` |
| `is_local` | `true` if source location matches audience location |
| `metadata` | `{ marble_score, marble_rank, source_id, category, lang }` |
| `operator_review_status` | `"pending"` |

`story_key` uniqueness prevents duplicate stories for the same audience + URL across fetch runs.

**Simplified status lifecycle for content-fetcher stories:** Stories created by the fetch pipeline skip the `classifying`/`media_decided`/`asset_generating` steps. Their lifecycle is:

```
new → (operator sets operator_review_status = 'approved') → ready_to_publish → published
                                                          ↘ (operator rejects) → archived
```

Operator approval is done via the existing review workflow (dashboard UI sets `operator_review_status`). When an operator approves, the server sets `status = 'ready_to_publish'`. When rejected, `status = 'archived'`.

---

## Section 5: Async Jobs

**New Supabase table:** `vivo_content_fetch_jobs`

```sql
create table vivo_content_fetch_jobs (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references vivo_factories(id),
  audience_id uuid not null references vivo_audiences(id),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  stories_created integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**Job lifecycle:**
1. `POST /api/audiences/:id/fetch-content` → inserts row with `status: 'pending'`, returns `{ job_id }`
2. Server picks up pending jobs and processes them (immediate async execution in same process for MVP — no separate worker)
3. On completion: update `status: 'done'`, `stories_created: N`
4. On error: update `status: 'failed'`, `error: message`

**Polling endpoint:**

```
GET /api/jobs/:jobId
Response: {
  id, status, stories_created, error, created_at, updated_at
}
```

File repository implements jobs in-memory (dev only). Supabase repository persists to table.

---

## Section 6: Delivery

**Trigger:** `POST /api/audiences/:id/publish-recap`

```
POST /api/audiences/:id/publish-recap
Body: { story_ids?: string[] }   // optional: publish specific stories; default: all operator-approved unpublished stories
Response: { published: number, job_id?: string }
```

**Flow:**
1. Query `vivo_stories` for the audience where `status = 'ready_to_publish'` and `operator_review_status = 'approved'` (or provided `story_ids`)
2. For each story, call the OpenClaw HTTP admin API to send a Telegram message via the bot configured in the audience's instance (`openclaw_admin_url`)
3. On successful send, update `vivo_stories.status = 'published'` and set `published_at` in metadata
4. On failure for a story, update `status = 'failed'`

**OpenClaw send call:**

```
POST {openclaw_admin_url}/api/send
Body: {
  channel: "telegram",
  message: "<b>{title}</b>\n\n{story_text}\n\n{primary_source_url}"
}
```

**Cron schedule:** `src/server.js` registers a daily cron at 09:00 local time per audience timezone (default UTC+1 for Barcelona) that triggers both `fetch-content` and, after a configurable delay, `publish-recap`. Schedule stored in `config/runtime.json` under `recap_schedule` per audience.

**OpenClaw plugin tool `audience_add_source`:** Registered in `src/plugins/user-profile/index.js`. When a user tells OpenClaw about a source they want to follow, the plugin calls `POST /api/audiences/:audienceId/sources` on vivo-factory. The `audienceId` is injected from the `AUDIENCE_ID` env var available to the plugin.

---

## Architecture Summary

```
config/sources.json
       │
       ▼
src/content-fetcher.js
  ├── Fetch RSS / merchant items (80% local, 20% global)
  ├── Deduplicate vs vivo_stories (7-day window)
  ├── POST /user-profile/select → marble scoring
  └── repository.createStory() × N
       │
       ▼
vivo_stories (status: new → operator review → ready_to_publish)
       │
       ▼
POST /api/audiences/:id/publish-recap
  ├── OpenClaw admin API → Telegram send
  └── vivo_stories.status = published
```

**Key invariants:**
- `story_key` = `sha1(audience_id + url)` enforces per-audience deduplication at the database level
- Marble scoring runs server-side (no token cost, no LLM call)
- OpenClaw publishes; vivo-factory tracks state
- Operator review gate sits between `classified` and `ready_to_publish` — no story reaches Telegram without human approval
- Async job pattern for fetch-content: `POST` returns `job_id`, client polls `GET /api/jobs/:jobId`
