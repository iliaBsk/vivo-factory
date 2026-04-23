# Audience Onboarding Wizard — Design Spec
**Date:** 2026-04-23  
**Project:** vivo-factory  
**Status:** Approved — ready for implementation planning

---

## 1. Overview

Replace the current single-step audience creation form with a 5-step wizard that profiles an audience using social handles, uploaded documents, or manual questions. Investigation is delegated to N8N workflows (using OpenAI Responses API); results stream live to the browser via SSE; the final persona seeds marble and persists to `vivo_audiences.profile_snapshot`.

Reference architecture: `../marble` — KG schema, prompt patterns, and manual question set are sourced directly from that codebase.

---

## 2. Wizard Steps

```
Step 1 — Investigate    Handle / Upload Report / Manual (3 tabs)
Step 2 — Photo          Protagonist photo upload + N8N vision analysis
Step 3 — Progress       SSE live investigation stream
Step 4 — Review         Editable pre-filled profile
Step 5 — Channels       Telegram + Twitter credentials (existing, unchanged)
```

### Step 1 — Investigate

Three tabs presented simultaneously; user picks one:

| Tab | Input | N8N workflow triggered |
|---|---|---|
| Social Handle | X/Twitter handle (required), GitHub handle (optional) | `vivo-onboarding-handle` |
| Upload Report | Drag-drop `.md` or `.txt`, ≤500 KB, text extracted client-side | `vivo-onboarding-upload` |
| Manual | 5 questions copied from marble wizard | `vivo-onboarding-manual` |

Clicking **Next** advances to Step 2 (Photo). The investigation job is not started until the user clicks **Investigate** on Step 2 after uploading the photo. `photo_context` is optional — if the user skips the photo, the investigation runs without it.

### Step 2 — Photo

- File picker: JPEG / PNG / WEBP, ≤5 MB
- On selection, image is base64-encoded client-side and POSTed synchronously to `POST /api/onboarding/photo`
- vivo-factory forwards to N8N workflow `vivo-onboarding-photo` (derived from `02c. Vivo Protagonist Classifier`, workflow ID `c5poTf5qpVaJKpMH`)
- Response in <5 s; shown as confirmation chips:

```
Gender: male   Age: 40s   Skin tone: medium   Build: average
Notable: strong jawline, clean-shaven
```

- Result stored in wizard state as `photo_context` — passed to investigation workflow as additional synthesis context
- Photo step is optional — user may click **Skip** to proceed without a photo; `photo_context` will be `null` in the investigation payload
- Photo is held as base64 blob until final submit, at which point it is uploaded to Supabase Storage via `repository.storeAudiencePhoto()`

**`vivo-onboarding-photo` differs from `02c.` as follows:**
- Input: single base64 image (not URL array) — Normalize node updated accordingly
- Prompt: garment / product fields removed; `ethnicity_presentation` field added alongside existing `model_signature` fields
- No `is_model` guard (user is deliberately uploading their protagonist)
- Single synchronous Respond to Webhook (no batch loop)

Output schema:
```json
{
  "gender_presentation": "male | female | androgynous | unclear",
  "age_range": "teen | 20s | 30s | 40s | 50s_plus | unclear",
  "skin_tone": "very_light | light | medium | dark | very_dark | unclear",
  "ethnicity_presentation": "free text, 1–3 words, visible cues only",
  "build": "slim | average | athletic | broad | unclear",
  "hair": "bald | short | medium | long | unclear",
  "notable_features": "one sentence, non-sensitive visible traits only"
}
```

### Step 3 — Progress

Full-width event log. Each SSE event from N8N appends one line:

```
✓  Fetching X profile for @andrewchen
✓  Retrieved 200 posts
⟳  Synthesising persona…
✓  Identified 9 interests · 4 beliefs · 3 identities
✓  Done — review your profile
```

Event shape: `{ type: "progress" | "complete" | "error", label: string, data?: object }`

On `complete` event: wizard auto-advances to Step 4.  
On `error` event: error message shown with **Back** button.

### Step 4 — Review

Pre-filled from persona JSON. All fields editable:

- Label, Location, Language, Tone
- Interests (comma chips), Content Pillars, Excluded Topics
- Family Context, Shopping Bias
- Physical description block (read-only, from `photo_context`)
- Raw synthesis output (collapsed accordion)

Edited values replace persona fields before final submit.

### Step 5 — Channels

Unchanged from current implementation: Telegram bot token, chat ID, report chat ID, Twitter credentials, posting schedule.

---

## 3. Architecture

```
Browser Wizard
  │
  ├─ POST /api/onboarding/photo          ──► N8N vivo-onboarding-photo (sync)
  │   { image_base64, mime_type }         ◄── { gender, age_range, skin_tone, ... }
  │
  ├─ POST /api/onboarding/start          ──► N8N investigation webhook (async)
  │   { mode, payload, photo_context,         triggers one of 3 workflows
  │     callback_url, job_id }
  │
  ├─ GET /api/onboarding/stream/:job_id  ◄── SSE events from relay
  │                                           N8N nodes POST /jobs/:id/event per step
  │                                           N8N final node POST /jobs/:id/complete
  │
  └─ POST /api/audiences/create-full    (existing, extended — see §5)
```

### In-memory relay — `src/onboarding-relay.js`

```
createOnboardingRelay() → {
  startJob(jobId)           // Map<jobId, EventEmitter> entry; 5-min TTL
  postEvent(jobId, event)   // emit to attached SSE response
  complete(jobId, persona)  // emit final persona, delete entry
  streamSSE(jobId, res)     // attach res; send keep-alive every 20 s
  cancelJob(jobId)          // called on SSE disconnect
}
```

No external queue or Redis needed — all state is in-process. TTL cleanup via `setTimeout`.

### New routes in `app.js`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/onboarding/photo` | Sync photo analysis via N8N |
| `POST` | `/api/onboarding/start` | Create job, fire N8N webhook, return `{ job_id }` |
| `GET` | `/api/onboarding/stream/:job_id` | SSE stream |
| `POST` | `/api/onboarding/jobs/:job_id/event` | N8N progress callback |
| `POST` | `/api/onboarding/jobs/:job_id/complete` | N8N completion callback |

### N8N webhook config in `config/runtime.json`

```json
"n8n": {
  "onboarding_handle_webhook":  "http://localhost:5678/webhook/vivo-onboarding-handle",
  "onboarding_upload_webhook":  "http://localhost:5678/webhook/vivo-onboarding-upload",
  "onboarding_manual_webhook":  "http://localhost:5678/webhook/vivo-onboarding-manual",
  "onboarding_photo_webhook":   "http://localhost:5678/webhook/vivo-describe-hero"
}
```

---

## 4. N8N Workflows

All investigation workflows use OpenAI **Responses API** (`https://api.openai.com/v1/responses`) with credentials already configured in N8N. Photo workflow uses GPT-5.1 vision (same model as existing `02c.`).

### `vivo-onboarding-handle`

```
Webhook trigger
  → Extract: { handle, photo_context, job_id, callback_url }
  → HTTP: Callback event "Fetching X profile for @{handle}"
  → HTTP: OpenAI Responses API (web_search_preview)
      input: "Research {handle} on X/Twitter. Return bio, recent post themes,
              inferred interests, tone, and professional context."
  → HTTP: Callback event "Retrieved profile — synthesising persona…"
  → HTTP: OpenAI Responses API (synthesis prompt — see §6)
      input: { x_profile, photo_context }  →  canonical persona JSON
  → HTTP: Callback event "Done — {n} interests · {n} beliefs identified"
  → HTTP: POST {callback_url}/jobs/{job_id}/complete  { persona }
```

### `vivo-onboarding-upload`

```
Webhook trigger
  → Extract: { text, filename, photo_context, job_id, callback_url }
  → HTTP: Callback event "Parsing {filename}…"
  → HTTP: OpenAI Responses API (parse-to-canonical prompt — see §6)
      input: { document_text, photo_context }  →  canonical persona JSON
  → HTTP: Callback event "Parsed — {n} attributes extracted"
  → HTTP: POST {callback_url}/jobs/{job_id}/complete  { persona }
```

### `vivo-onboarding-manual`

```
Webhook trigger
  → Extract: { q1_role, q1_city, q2_jtbd, q3_wealth, q4_values, q5_passions,
               photo_context, job_id, callback_url }
  → HTTP: Callback event "Processing your answers…"
  → HTTP: OpenAI Responses API (manual-to-canonical prompt — see §6)
      input: { answers, photo_context }  →  canonical persona JSON
  → HTTP: Callback event "Profile built from manual input"
  → HTTP: POST {callback_url}/jobs/{job_id}/complete  { persona }
```

---

## 5. Manual Onboarding Questions

Copied verbatim from `../marble/core/onboarding/` wizard schema:

| # | Question | Input type |
|---|---|---|
| Q1 | What's your role, and what city do you live in? | Text input + city autocomplete |
| Q2 | What's the one thing you're most trying to figure out or get done right now? | Free text (JTBD) |
| Q3 | When you buy something premium, what drives you more? | 2-option tile (value vs. quality) |
| Q4 | Pick the trade-off that fits you better | 4 paired-value tiles |
| Q5 | What are you into? | Multi-select passion tiles |

Option sets and validation rules match marble exactly. The `vivo-onboarding-manual` N8N workflow maps these using the same logic as `marble/core/onboarding/to-kg.js::answersToKgSeed()`, ported into a Responses API prompt.

---

## 6. Canonical Persona JSON

Every N8N workflow produces this schema (based on spec §13 and Andrew Chen exemplar):

```json
{
  "biographical": {
    "name": { "value": "...", "confidence": 0.0–1.0 },
    "current_role": { "value": "...", "confidence": 0.0–1.0 },
    "location": { "value": "...", "confidence": 0.0–1.0 }
  },
  "cognitive": {
    "thinking_style": [],
    "interests": []
  },
  "communication": {
    "preferred_tone": "",
    "resonates_with": [],
    "tunes_out": []
  },
  "motivations_values": {
    "core_motivations": [],
    "values": []
  },
  "big_five": {
    "openness":          { "value": 0.0, "confidence": 0.0 },
    "conscientiousness": { "value": 0.0, "confidence": 0.0 },
    "extraversion":      { "value": 0.0, "confidence": 0.0 },
    "agreeableness":     { "value": 0.0, "confidence": 0.0 },
    "neuroticism":       { "value": 0.0, "confidence": 0.0 }
  },
  "personalization": {
    "tone": "",
    "topics": [],
    "formats": [],
    "hooks": [],
    "anti_patterns": []
  },
  "provenance": {
    "sources_used": [],
    "compiled_at": "ISO8601",
    "compiler": "openai-responses-api / vivo-onboarding-v1"
  }
}
```

Null fields are permitted; `confidence: 0` means the field was not inferable from available evidence. Big Five are omitted for manual path unless Q2/Q5 answers provide sufficient signal.

---

## 7. Final Submit Flow

`POST /api/audiences/create-full` (extended):

1. **Validate** form fields (label, channels — existing validation)
2. **createAudience()** — existing flow, saves row to `vivo_audiences`
3. **createInstanceForAudience()** — creates `vivo_instances` row with `custom_sources: []`
4. **Seed marble** — `POST marble_url/user-profile/profile/facts` with flattened persona facts (interests, beliefs, identities, tone, location from persona JSON)
5. **Sync snapshot** — `POST /api/audiences/:id/profile-snapshot/sync` → pulls full marble graph into `vivo_audiences.profile_snapshot`
6. **Store photo** — `repository.storeAudiencePhoto()` → Supabase Storage → links `hero_image_asset_storage_id`

---

## 8. Key Constraints & Decisions

| Decision | Choice | Reason |
|---|---|---|
| LLM in N8N | OpenAI Responses API | Keys already configured; enables experimentation in N8N UI |
| Progress transport | SSE relay (not polling) | Real streaming; matches marble's own SSE onboarding pattern |
| Job state | In-memory Map + EventEmitter | No external dependency; 5-min TTL is sufficient for wizard session |
| Photo analysis | Synchronous N8N webhook | Fast (<5 s); no SSE complexity needed for single vision call |
| Manual questions | Copied from marble verbatim | Consistency; marble's option sets are already validated |
| Persona storage | `vivo_audiences.profile_snapshot.marble` | Reuses existing sync endpoint; non-destructive to existing fields |

---

## 9. Out of Scope (this iteration)

- Path C (auto-compile from name + keywords) — deferred to next sprint
- LinkedIn / GitHub / Crunchbase enrichment — deferred
- Evidence graph / Neo4j — not applicable; vivo-factory uses Supabase + marble KG JSON
- Confidence decay / re-resolution — marble handles this natively
- Lookalike engine — deferred per spec §10.4

---

## 10. Prerequisites Before Implementation

1. **N8N API key** — existing key in `~/.claude.json` is expired. Generate a new one in the N8N UI (`localhost:5678 → Settings → API`) and update `~/.claude.json` and the MCP config.
2. **N8N `user-management:reset`** — was run during exploration; verify admin login still works at `http://192.168.1.79:5678` and re-confirm the existing OpenAI credentials are intact.
3. **`vivo-describe-hero` webhook path** — confirm the existing `02c. Vivo Protagonist Classifier` workflow's active webhook path matches `vivo-describe-hero` before creating the photo fork.
