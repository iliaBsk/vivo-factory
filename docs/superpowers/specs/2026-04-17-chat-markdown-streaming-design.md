# Chat Window — Markdown Support & Streaming

**Date:** 2026-04-17
**Scope:** Upgrade the Manager Console chat in the Audiences workspace to a persistent, markdown-rendering, typewriter-streaming chat thread backed by a general-purpose conversation/message store.

---

## 1. Goals

- Render LLM responses as formatted markdown instead of raw text in an alert dialog
- Show a typewriter animation while the response "streams in" (client-side, full response arrives then types out)
- Persist full conversation history server-side, visible across page reloads
- Data model designed for any conversation channel — not just the operator console

---

## 2. Architecture

Four existing files change; one new Supabase migration file is added.

| File | Change |
|------|--------|
| `src/app.js` | `renderOperatorConsole()` rebuilt as chat thread UI; two new API routes; `marked.js` CDN link added to `<head>` |
| `src/repository.js` | `getChatHistory(audienceId)`, `appendChatMessage(audienceId, msg)`, `getOrCreateConversation(audienceId, channel)` added to all three backends |
| `data/dashboard-state.json` | New top-level key `conversations` for file backend |
| `supabase/migrations/` | New migration: `vivo_conversations` + `vivo_messages` tables |

A new `better-sqlite3` dependency is added for the SQLite backend.

---

## 3. Data Model

### 3.1 Schema

**`vivo_conversations`** — one row per thread

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `audience_id` | `text` | FK → `vivo_audiences.audience_id` |
| `channel` | `text` | `operator_console`, `openclaw`, `telegram_channel`, `telegram_dm`, … |
| `external_id` | `text` | nullable; Telegram `chat_id`, etc. |
| `title` | `text` | nullable; human-readable label |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | bumped on each new message |

**`vivo_messages`** — one row per message, append-only

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `conversation_id` | `uuid` | FK → `vivo_conversations.id` |
| `audience_id` | `text` | denormalized for fast per-audience queries |
| `role` | `text` | `user`, `assistant`, `system` |
| `content` | `text` | raw markdown string |
| `sender_id` | `text` | operator email, Telegram user ID, bot ID, etc. |
| `sender_name` | `text` | display name |
| `metadata` | `jsonb` | channel-specific extras (`message_id`, `reply_to`, etc.) |
| `created_at` | `timestamptz` | `now()` default |

### 3.2 File Backend

New key in `data/dashboard-state.json`:

```json
{
  "conversations": {
    "<audienceId>": {
      "operator_console": {
        "id": "uuid",
        "messages": [ ...Message ]
      }
    }
  }
}
```

### 3.3 SQLite Backend

`better-sqlite3` is used (synchronous, no native build complexity). The DB file defaults to `data/vivo-factory.db`, overridable via `SQLITE_DB_PATH`.

Tables are created with `CREATE TABLE IF NOT EXISTS` on startup — no separate migration runner needed. Schema mirrors Supabase columns using SQLite-compatible types (`TEXT`, `INTEGER`).

---

## 4. Backend Selection

Logic in `src/server.js` (extends existing dual-backend selection):

```
SUPABASE_URL + SUPABASE_KEY set  →  createSupabaseRepository()
SQLITE_DB_PATH set               →  createSQLiteRepository()      ← new
(default)                        →  createFileRepository()
```

---

## 5. API Routes

Two routes in `src/app.js`:

### POST `/api/instances/:audienceId/chat`
- Unchanged signature (`{ message, operator }`)
- Now also: gets or creates an `operator_console` conversation for the audience; persists the user message; calls `instanceManager.chatWithInstance()`; persists the assistant response
- Returns `{ reply: string, conversationId: string }`

### GET `/api/instances/:audienceId/chat/history`
- Returns `{ messages: Message[] }` for the `operator_console` conversation
- Used only if future clients need to fetch history on demand; the initial page render inlines history server-side

---

## 6. UI

### Layout

```
┌─────────────────────────────────┐
│  MANAGER CONSOLE  [audience-id] │
├─────────────────────────────────┤
│  scrollable thread (flex-col)   │
│                                 │
│          [user bubble →]        │
│  [← assistant bubble]           │
│          [user bubble →]        │
│  [← assistant bubble ▋]         │
│                                 │
├─────────────────────────────────┤
│  [textarea]          [Send ↑]   │
└─────────────────────────────────┘
```

### Rendering

- History is inlined server-side in `renderOperatorConsole(audience, history)` — no extra GET on load
- User bubbles: right-aligned, blue background
- Assistant bubbles: left-aligned, dark background, avatar badge
- Markdown rendered via `marked.parse()` (loaded from CDN: `https://cdn.jsdelivr.net/npm/marked/marked.min.js`)

### Typewriter Animation

1. On submit: user bubble appended to DOM immediately; input cleared; `POST` fires
2. Response arrives: assistant bubble inserted with empty content and blinking cursor
3. `setInterval` at 20ms/char appends one character per tick to a raw-text buffer in the bubble
4. Container scrolls to bottom on each tick
5. On completion: `clearInterval`; cursor removed; bubble `innerHTML` replaced with `marked.parse(buffer)` — switches from plain text to rendered markdown

---

## 7. Markdown Library

`marked.js` via CDN. No build step required. Added as a single `<script>` tag inside the `<head>` block of the HTML template returned by the page-render function in `src/app.js`.

No HTML sanitization applied — this is an internal operator tool; content originates from trusted LLM responses, not user-supplied HTML.

---

## 8. Out of Scope

- Real token-by-token streaming from the LLM (SSE endpoint)
- Conversation search or archival
- Multi-operator presence indicators
- Message editing or deletion
