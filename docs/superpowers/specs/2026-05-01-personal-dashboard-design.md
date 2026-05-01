# Personal Shopping / Entertainment / Travel Dashboard

**Date:** 2026-05-01
**Status:** Approved

---

## Overview

Each vivo-factory audience member gets a personal dashboard served from their existing Marble profile-engine container. The dashboard ingests their Gmail archive (Google Takeout mbox), classifies emails into Shopping / Entertainment / Travel, feeds the enriched data into Marble's knowledge graph, and surfaces three views per category: **Bought**, **Gaps + Advices**, and **Deals**.

The user creates a new audience entry for themselves and goes through the same provisioning pipeline as any other audience.

---

## 1. System Architecture

Each audience's Docker stack gains a **3rd container** — the vault Python email engine — alongside the existing OpenClaw (Telegram bot) and Marble (profile-server) containers.

```
Per-audience Docker stack
┌─────────────────────────────────────────────────────────────┐
│  openclaw       Telegram bot           port 18801+index     │
│  marble         profile-server.js      port  5401+index     │
│  vault-engine   Python HTTP API        port  4876+index  NEW│
└─────────────────────────────────────────────────────────────┘
```

**Data flow:**

```
User visits :5401/personal/
     │
     ├─ uploads mbox file
     │       │
     │       ▼
     │   vault-engine /onboarding/email/import
     │       │ streaming mbox parser
     │       │ regex pre-filter
     │       │ LLM classifier (Shopping / Entertainment / Travel)
     │       │ LLM entity extractor
     │       │ → DuckDB (raw store)
     │       │ → source extractor → vivo-factory sources catalog
     │       │ → marble.learn()   → Marble KG
     │       ▼
     │   Marble KG updated
     │
     └─ views /personal/:category/:tab
             ├─ Bought       ← vault-engine /profile/history
             ├─ Gaps         ← Marble hypotheses + LLM judge
             └─ Deals        ← catalog RSS + mbox promos → marble.select()
```

**Component reuse vs new:**

| Component | Status |
|---|---|
| `mbox_import.py` | Reused from vault |
| `email_normalizer.py` | Extended — add LLM classifier |
| `purchase_features.py`, `next_purchase.py`, `repurchase.py` | Reused |
| `marble.learn()`, `marble.select()` | Reused |
| Source extractor from mbox senders | New |
| Dashboard routes in `profile-server.js` | New |
| Vault container in `stacks.js` | New |
| N8N workflows (3) | New |

---

## 2. Email Ingestion Pipeline

Triggered by mbox upload. Runs as a background async job; upload returns a `job_id` immediately and progress is streamed via SSE.

### Optimisations for large archives (10 GB+)

- **Streaming mbox parser** — line-by-line `From ` boundary splitter; never loads the full file into memory. Replaces Python's `mailbox.mbox()` which builds a full index upfront.
- **Regex pre-filter** — existing `MERCHANT_PATTERNS` in `email_normalizer.py` gate emails before any LLM call. ~85% of a typical inbox (social, spam, notifications) is classified as `other` without touching the LLM.
- **Async job queue** — asyncio queue with configurable concurrency (default: 5 parallel LLM batch calls). Job state persisted in `sqlite_state.py` (already in vault). ~500K emails processed in 2–4 hours in the background.

### Steps

```
1. UPLOAD
   POST /personal/upload-mbox  (Marble profile-server)
   → streams file to disk (chunked, never buffered)
   → creates job in sqlite_state (status: queued)
   → returns { job_id }
   → SSE /personal/upload-mbox/status/:job_id

2. PARSE  (streaming_mbox_parser — new, replaces mailbox.mbox)
   → emits one message at a time
   → DuckDB insert: message_id, from_addr, subject, snippet, sent_at

3. PRE-FILTER  (email_normalizer.py MERCHANT_PATTERNS — existing)
   → other → DuckDB insert, skip LLM   (~85% of emails)
   → candidate → batch queue

4. CLASSIFY  (LLM, batches of 50, parallel)
   Input:  subject + snippet + from_addr
   Output: { category, subcategory, confidence }
   Categories: shopping | entertainment | travel | promo | other

5. ENTITY EXTRACT  (LLM, only shopping / entertainment / travel)
   shopping      → { merchant, item_name, amount, currency, order_id, date }
   entertainment → { service, title, type, date, amount }
   travel        → { destination, type, date, amount, provider }
   → DuckDB entities table

5b. MEDIA ENRICHMENT  (N8N vivo-media-enrich webhook)
   → batch entities missing media_url
   → SERP image search: "{merchant} {item_name} product"
   → OpenAI vision: selects best product photo, rejects logos/stock art
   → DuckDB entities.media_url updated
   [PLACEHOLDER] vivo-stories pipeline: personalized image/video
   using protagonist character-map — swap stock image for user-in-context
   visual once protagonist pipeline is stable (no schema changes required)

6. SOURCE EXTRACT  (new)
   → deduplicate from_addr domains
   → resolve against merchant-registry.json
   → RSS autodiscovery for unknown domains
   → POST /api/audiences/:id/sources  (vivo-factory)
   → Gmail-discovered brands become Marble content sources for this audience

7. MARBLE SYNC  (new)
   → marble.learn({ type, ...entity }) per entity
   → promo emails queued as Deals candidates

8. GAPS TRIGGER  (also runs weekly via N8N vivo-gaps-weekly)
   → see Section 4

Re-upload: incremental — message_id deduplication in DuckDB; only new
emails processed on subsequent uploads.
```

---

## 3. Dashboard UI

Served from Marble `profile-server.js`. Server-rendered HTML + Tailwind (same stack as vivo-factory dashboard). No SPA, no build step.

### Routes

```
GET  /personal/                          → redirect to /personal/shopping
GET  /personal/:category                 → dashboard (shopping|entertainment|travel)
GET  /personal/:category/:tab            → tab content fragment (htmx swap)
POST /personal/upload-mbox               → starts async job, returns job_id
GET  /personal/upload-mbox/status/:id    → SSE progress stream
```

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Aleks  ·  Personal Dashboard                    [↑ Upload]  │
│                                                              │
│  [ 🛍 Shopping ]  [ 🎬 Entertainment ]  [ ✈ Travel ]         │
│  ────────────────────────────────────────────────────────── │
│  [ Bought ]  [ Gaps + Advices ]  [ Deals ]                   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  tab content                                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ░░░░░░░░░░░░░░░░░░░░  Processing 67%  (SSE bar)            │
└──────────────────────────────────────────────────────────────┘
```

### Tab contents

**Bought** — chronological list: merchant, item/title/destination, amount, date. Filterable by year. Each item shows a media thumbnail (product photo from N8N enrichment; skeleton placeholder while processing). Click expands to full image.

```
┌─────────────────────────────────────────────────────┐
│  [photo]  Nike Air Max 270                           │
│           Nike · €129 · Mar 2024                     │
│           🛍 Shopping › Footwear                     │
└─────────────────────────────────────────────────────┘
```

**Gaps + Advices** — ranked gap cards with confidence score, rationale, and a direct link to the Deals tab pre-filtered to the relevant merchant/category.

```
┌─────────────────────────────────────────────────────┐
│  ⚠️  Running shoes overdue          confidence: 87%  │
│  Last bought Mar 2023 · Nike Air Max · €129          │
│  Typical lifespan 12 months — now 18 months old      │
│  → See Deals for current Nike running offers         │
└─────────────────────────────────────────────────────┘
```

**Deals** — deal cards ranked by Marble `select()`. Source badges show origin (email / catalog). Media from N8N enrichment with protagonist personalization placeholder.

```
┌─────────────────────────────────────────────────────┐
│  [personalized image]  Nike Summer Sale      #1     │
│  30% off running shoes                               │
│  Code: SUMMER30 · Expires May 31                     │
│  📧 from email · 🌐 catalog                          │
│                                    [Open Deal →]    │
└─────────────────────────────────────────────────────┘
```

**Data freshness indicators:** each section header shows "Last updated: N days ago" from DuckDB job timestamp. Deals show "Refreshed: today".

---

## 4. Gaps + Advices Engine

Runs after ingestion completes and weekly via N8N `vivo-gaps-weekly`.

```
INPUT A: Vault predictive models
  repurchase.py        → "Nike shoes: due in ~2 months"
  next_purchase.py     → "likely to buy: camera lens"
  subscription_risk.py → "Netflix lapsed 6 months ago"

INPUT B: Marble hypothesis engine
  marble.investigate({ audience_id, focus: "gaps" })
  → 10–20 hypotheses, e.g.:
    "User buys athletic gear but no gym membership"
    "Annual travel pattern broken — 14 months without trip"

INPUT C: LLM direct history analysis
  Condensed purchase history → LLM
  Prompt: "Identify gaps, missing accessories, overdue
  replacements, lapsed habits across shopping/travel/
  entertainment. Be specific and concrete."

LLM JUDGE
  Input:  A + B + C deduplicated by embedding (cosine > 0.9)
  Output per gap: {
    type:             overdue | accessory | lapsed | pattern_break
    title:            "Running shoes overdue"
    rationale:        "Last bought Mar 2023 (18mo), typical lifespan 12mo"
    confidence:       0.87
    suggested_action: "Replace before winter season"
    related_category: shopping
  }
  → stored in DuckDB gaps table (TTL: 7 days)
```

**Gap types:**

| Type | Example |
|---|---|
| Overdue replacement | Running shoes, 18 months old |
| Missing accessory | Bought DSLR, no quality lens |
| Lapsed subscription | Netflix cancelled 6 months ago |
| Pattern break | Vacation every 8 months → 14 months without one |
| Entertainment habit | Monthly concerts → last ticket 8 months ago |

---

## 5. Deals Aggregation

### Sources (MVP)

**Source A — mbox promo emails**
Extracted during ingestion (category: promo). Fields: merchant, title, discount, promo_code, expires_at, url. Refreshed on each mbox upload. Deals past `expires_at` auto-archived.

**Source B — vivo sources catalog (RSS/web)**
`sources-catalog.js` tracks per-audience merchant feeds. Gmail-discovered merchants added to catalog on mbox upload. N8N `vivo-deals-catalog` fetches RSS/deal pages daily, LLM extracts deal structure.

> Telegram deal channels: excluded from MVP. Can be added later via `vivo-deals-telegram`
> N8N workflow without schema changes.

### Pipeline

```
Source A + Source B
        │
        ▼
Deduplication
  same deal across sources → one card, all sources cited
  similarity: merchant + title embedding (cosine > 0.9)
  stored in DuckDB deals table
        │
        ▼
Media Enrichment  (N8N vivo-media-enrich)
  Step 1: SERP + OpenAI vision → stock product image
  Step 2: [PLACEHOLDER] vivo-stories + protagonist character-map
          → personalized image/video (user experiencing the deal)
        │
        ▼
Marble Ranking
  marble.select(all_deals, {
    gaps:             current_gaps,       // boost gap-related deals
    purchase_history: summary,            // boost known merchants
    category_filter:  active_tab          // shopping|entertainment|travel
  })
  → top 20 deals per category, re-ranked daily
```

---

## 6. Deployment

### `stacks.js` additions

```javascript
vault: {
  image:        options.vaultEngineImage,   // ghcr.io/openclaw/vault-engine:latest
  command:      "python -m user_profile_engine.main",
  health_path:  "/healthz",
  storage_path: "/data/vault",
  port:         4876 + index,               // 4876, 4877, 4878…
  data_volume:  `${audience_id}-vault-data`
}
```

### Port allocation (complete)

```
OpenClaw:      18801 + index   (existing)
Marble:         5401 + index   (existing)
Vault engine:   4876 + index   (new)
```

### `runtime.json` additions per audience

```json
"vault_base_url": "http://192.168.1.79:4876",
"vault_storage_path": "/data/vault"
```

### `app.js` additions (vivo-factory)

```
POST /api/audiences/:id/upload-mbox   → relay to vault_base_url/onboarding/email/import
GET  /api/audiences/:id/vault-status  → SSE relay to vault_base_url/jobs/:id
POST /api/audiences/:id/sources       → extended to accept vault-discovered sources
```

### N8N workflows (3 new)

| Workflow | Trigger | Purpose |
|---|---|---|
| `vivo-media-enrich` | Webhook from vault-engine | SERP + OpenAI vision image enrichment for items and deals |
| `vivo-deals-catalog` | Cron daily | Fetch catalog RSS/web, extract deals, POST to vault |
| `vivo-gaps-weekly` | Cron weekly | Trigger gap analysis refresh for each active audience |

### New audience bootstrap (self as audience)

```
1. Add entry to audience_group.md
2. npm run bootstrap          → Supabase rows created
3. npm run generate:stacks    → docker-compose gains vault container
4. docker compose up -d       → vault-engine starts
5. Visit :5401/personal/      → upload mbox via Marble dashboard
6. Async processing           → SSE progress bar
7. Done: Shopping / Entertainment / Travel dashboard live at :5401/personal/
```

### Rollout for existing audiences (non-breaking)

```
npm run generate:stacks   → manifests regenerated with vault container
docker compose up -d      → only vault containers are new
                             OpenClaw + Marble untouched, zero downtime
```

---

## Open Items / Future Work

- **Protagonist personalization (Step 2 media):** wire vivo-stories pipeline into `vivo-media-enrich` N8N workflow once protagonist character-map is stable. No schema changes required — `media_url` field already exists.
- **Telegram deal channels:** add `vivo-deals-telegram` N8N cron (every 2h) polling OpenClaw admin API. DuckDB deals table is already source-agnostic.
- **Incremental mbox sync:** explore IMAP app-password or alternative sync once Google policy is clearer; ingestion pipeline is provider-agnostic.
