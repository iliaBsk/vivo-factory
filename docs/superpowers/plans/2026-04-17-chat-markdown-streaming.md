# Chat Thread — Markdown Support & Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the alert-based operator chat with a persistent, markdown-rendering, typewriter-streaming chat thread backed by a general-purpose conversation/message store across three storage backends (file JSON, SQLite, Supabase).

**Architecture:** `getOrCreateConversation`, `appendChatMessage`, and `getConversationMessages` are added to all three repository backends. The file backend gains a new `conversations` state key. The SQLite backend is a hybrid: it delegates all existing operations to a file repository and adds SQLite-backed conversation tables for richer querying. The Supabase backend adds the two new tables via migration. The `POST /api/instances/:id/chat` route gains persistence; a new `GET /api/instances/:id/chat/history` route is added. `renderOperatorConsole` is rebuilt as a chat thread (history inlined server-side, user/assistant bubbles, compact input bar). Client-side JS handles typewriter animation at 20ms/char then replaces with `marked.parse()` on completion.

**Tech Stack:** Node.js ESM, built-in `node:test`, `better-sqlite3` (new), `marked.js` (CDN, no build step), Tailwind CSS (existing), Supabase (existing)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/repository.js` | Modify | Add `getOrCreateConversation`, `appendChatMessage`, `getConversationMessages` to file + Supabase backends; new `createSQLiteRepository()` |
| `src/server.js` | Modify | Add `SQLITE_DB_PATH` selection branch in `createDashboardRepository()` |
| `src/app.js` | Modify | `marked.js` script tag; rebuild `renderOperatorConsole`; extend `POST /chat` handler; add `GET /chat/history`; replace old JS chat handlers |
| `supabase/migrations/20260417000000_chat.sql` | Create | `vivo_conversations` + `vivo_messages` tables |
| `tests/repository-conversations.test.js` | Create | Tests for file + SQLite backends' conversation methods |
| `package.json` | Modify | Add `better-sqlite3` dependency |

---

## Task 1: Install better-sqlite3

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install better-sqlite3
```

Expected: `package.json` updated with `"better-sqlite3": "^9.x.x"` in `dependencies`.

- [ ] **Step 2: Verify the import resolves**

```bash
node -e "import('better-sqlite3').then(m => console.log('ok', typeof m.default)).catch(e => console.error(e.message))"
```

Expected output: `ok function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 for SQLite conversation backend"
```

---

## Task 2: Supabase migration

**Files:**
- Create: `supabase/migrations/20260417000000_chat.sql`

- [ ] **Step 1: Create the migration file**

```sql
create table if not exists vivo_conversations (
  id uuid primary key default gen_random_uuid(),
  audience_id text not null references vivo_audiences(audience_id) on delete cascade,
  channel text not null,
  external_id text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vivo_conversations_audience_channel
  on vivo_conversations(audience_id, channel);

create table if not exists vivo_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references vivo_conversations(id) on delete cascade,
  audience_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  sender_id text,
  sender_name text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vivo_messages_conversation_created
  on vivo_messages(conversation_id, created_at);

create index if not exists vivo_messages_audience_created
  on vivo_messages(audience_id, created_at);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260417000000_chat.sql
git commit -m "feat: add vivo_conversations and vivo_messages Supabase migration"
```

---

## Task 3: Write failing tests for conversation methods

**Files:**
- Create: `tests/repository-conversations.test.js`

- [ ] **Step 1: Write the test file**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createFileRepository, createSQLiteRepository } from "../src/repository.js";

function makeFileRepo() {
  return createFileRepository(new URL(`file:///tmp/test-conv-${Date.now()}.json`));
}

function makeSQLiteRepo() {
  return createSQLiteRepository(`/tmp/test-conv-${Date.now()}.db`);
}

for (const [label, makeRepo] of [["file", makeFileRepo], ["sqlite", makeSQLiteRepo]]) {
  test(`${label}: getOrCreateConversation creates a conversation`, async () => {
    const repo = makeRepo();
    const conv = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    assert.equal(conv.audienceId, "fitness-fans");
    assert.equal(conv.channel, "operator_console");
    assert.ok(conv.id, "should have id");
    assert.ok(conv.createdAt, "should have createdAt");
  });

  test(`${label}: getOrCreateConversation is idempotent`, async () => {
    const repo = makeRepo();
    const a = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    const b = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    assert.equal(a.id, b.id);
  });

  test(`${label}: getOrCreateConversation creates separate entries per channel`, async () => {
    const repo = makeRepo();
    const op = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    const tg = await repo.getOrCreateConversation("fitness-fans", "telegram_channel");
    assert.notEqual(op.id, tg.id);
  });

  test(`${label}: appendChatMessage adds a message`, async () => {
    const repo = makeRepo();
    const conv = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    const msg = await repo.appendChatMessage(conv.id, {
      audienceId: "fitness-fans",
      role: "user",
      content: "Hello!",
      senderId: "op@example.com",
      senderName: "Operator",
      metadata: {}
    });
    assert.ok(msg.id);
    assert.equal(msg.role, "user");
    assert.equal(msg.content, "Hello!");
    assert.equal(msg.conversationId, conv.id);
  });

  test(`${label}: getConversationMessages returns messages in insertion order`, async () => {
    const repo = makeRepo();
    const conv = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    await repo.appendChatMessage(conv.id, { audienceId: "fitness-fans", role: "user", content: "Hi", senderId: "op@example.com", senderName: "Op", metadata: {} });
    await repo.appendChatMessage(conv.id, { audienceId: "fitness-fans", role: "assistant", content: "Hello!", senderId: "bot", senderName: "AI", metadata: {} });
    const msgs = await repo.getConversationMessages(conv.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
  });

  test(`${label}: getConversationMessages returns [] for new conversation`, async () => {
    const repo = makeRepo();
    const conv = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    const msgs = await repo.getConversationMessages(conv.id);
    assert.deepEqual(msgs, []);
  });
}
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
node --test tests/repository-conversations.test.js 2>&1 | head -20
```

Expected: FAIL — `createSQLiteRepository is not a function` or `repo.getOrCreateConversation is not a function`

---

## Task 4: Implement conversation methods in the file repository

**Files:**
- Modify: `src/repository.js`

`crypto` is already imported at the top of the file as `import crypto from "node:crypto"`.

- [ ] **Step 1: Add `conversations` to `normalizeState()`**

In `normalizeState()` at line 639, add the new key inside the returned object (after `deployments`):

```javascript
conversations: { ...(seed.conversations ?? {}) },
```

- [ ] **Step 2: Add `conversations` to `exportState()`**

In `exportState()` (the function that serializes state back to JSON, around line 656), add:

```javascript
conversations: { ...state.conversations },
```

- [ ] **Step 3: Add the three conversation methods to the object returned by `createRepository()`**

Inside the `return { ... }` block of `createRepository()`, add these three methods after the existing ones:

```javascript
async getOrCreateConversation(audienceId, channel) {
  const key = `${audienceId}::${channel}`;
  if (!state.conversations[key]) {
    state.conversations[key] = {
      id: crypto.randomUUID(),
      audienceId,
      channel,
      externalId: null,
      title: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _messages: []
    };
  }
  const { _messages, ...conv } = state.conversations[key];
  return { ...conv };
},

async appendChatMessage(conversationId, message) {
  const entry = Object.values(state.conversations).find(c => c.id === conversationId);
  if (!entry) throw new Error(`Conversation ${conversationId} not found`);
  const msg = {
    id: crypto.randomUUID(),
    conversationId,
    audienceId: message.audienceId,
    role: message.role,
    content: message.content,
    senderId: message.senderId ?? null,
    senderName: message.senderName ?? null,
    metadata: message.metadata ?? {},
    createdAt: new Date().toISOString()
  };
  entry._messages.push(msg);
  entry.updatedAt = new Date().toISOString();
  return { ...msg };
},

async getConversationMessages(conversationId) {
  const entry = Object.values(state.conversations).find(c => c.id === conversationId);
  if (!entry) return [];
  return entry._messages.map(m => ({ ...m }));
},
```

Note: `_messages` is a private key on the in-memory object (not serialized). The `exportState` function only copies `conversations` shallowly — ensure serialization strips `_messages` when writing to disk. To do this, update the `exportState` line you added in Step 2 to:

```javascript
conversations: Object.fromEntries(
  Object.entries(state.conversations).map(([k, { _messages, ...rest }]) => [k, rest])
),
```

And update `normalizeState` to re-attach the `_messages` array as an empty array (since they are not persisted — only the conversation metadata is):

```javascript
conversations: Object.fromEntries(
  Object.entries(seed.conversations ?? {}).map(([k, v]) => [k, { ...v, _messages: [] }])
),
```

- [ ] **Step 4: Run the file backend tests only**

```bash
node --test tests/repository-conversations.test.js 2>&1 | grep -E "file:|▶|✓|✗" | head -20
```

Expected: All 6 `file:` tests PASS; `sqlite:` tests still FAIL (not implemented yet)

---

## Task 5: Create the SQLite repository

**Files:**
- Modify: `src/repository.js`

The SQLite repository is a hybrid: it delegates all existing operations to a file repository and stores conversations in SQLite.

- [ ] **Step 1: Add `createSQLiteRepository` import for better-sqlite3**

At the top of `src/repository.js`, add after the existing imports:

```javascript
import Database from "better-sqlite3";
```

- [ ] **Step 2: Add `createSQLiteRepository` export function**

Add this function after `createFileRepository`:

```javascript
export function createSQLiteRepository(dbPath, stateFilePath = "data/dashboard-state.json") {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS vivo_conversations (
      id TEXT PRIMARY KEY,
      audience_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      external_id TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(audience_id, channel, COALESCE(external_id, ''))
    );
    CREATE TABLE IF NOT EXISTS vivo_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES vivo_conversations(id) ON DELETE CASCADE,
      audience_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msgs_conv ON vivo_messages(conversation_id, created_at);
  `);

  const fileRepo = createFileRepository(path.resolve(stateFilePath));

  return {
    ...fileRepo,

    async getOrCreateConversation(audienceId, channel) {
      const existing = db.prepare(
        `SELECT * FROM vivo_conversations
         WHERE audience_id = ? AND channel = ? AND external_id IS NULL LIMIT 1`
      ).get(audienceId, channel);
      if (existing) {
        return {
          id: existing.id, audienceId: existing.audience_id, channel: existing.channel,
          externalId: existing.external_id, title: existing.title,
          createdAt: existing.created_at, updatedAt: existing.updated_at
        };
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO vivo_conversations (id, audience_id, channel, external_id, title, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`
      ).run(id, audienceId, channel, now, now);
      return { id, audienceId, channel, externalId: null, title: null, createdAt: now, updatedAt: now };
    },

    async appendChatMessage(conversationId, message) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO vivo_messages
           (id, conversation_id, audience_id, role, content, sender_id, sender_name, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, conversationId, message.audienceId, message.role, message.content,
        message.senderId ?? null, message.senderName ?? null,
        JSON.stringify(message.metadata ?? {}), now
      );
      db.prepare(`UPDATE vivo_conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
      return {
        id, conversationId, audienceId: message.audienceId, role: message.role,
        content: message.content, senderId: message.senderId ?? null,
        senderName: message.senderName ?? null, metadata: message.metadata ?? {},
        createdAt: now
      };
    },

    async getConversationMessages(conversationId) {
      const rows = db.prepare(
        `SELECT * FROM vivo_messages WHERE conversation_id = ? ORDER BY created_at ASC`
      ).all(conversationId);
      return rows.map(r => ({
        id: r.id, conversationId: r.conversation_id, audienceId: r.audience_id,
        role: r.role, content: r.content, senderId: r.sender_id,
        senderName: r.sender_name, metadata: r.metadata ? JSON.parse(r.metadata) : {},
        createdAt: r.created_at
      }));
    }
  };
}
```

- [ ] **Step 3: Run all conversation tests**

```bash
node --test tests/repository-conversations.test.js
```

Expected: All 12 tests (6 file + 6 sqlite) PASS

- [ ] **Step 4: Commit**

```bash
git add src/repository.js tests/repository-conversations.test.js
git commit -m "feat: add conversation methods to file + SQLite repository backends"
```

---

## Task 6: Wire SQLite backend in server.js

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add `createSQLiteRepository` to the import**

Find the import line that imports from `"./repository.js"` and add `createSQLiteRepository`:

```javascript
import { createFileRepository, createSupabaseRepository, createSQLiteRepository } from "./repository.js";
```

- [ ] **Step 2: Update `createDashboardRepository()`**

Replace the existing function body with:

```javascript
function createDashboardRepository(runtimeConfig, envConfig) {
  const supabaseUrl = envConfig.SUPABASE_URL ?? "";
  const serviceRoleKey = envConfig.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const storageBucket = envConfig.SUPABASE_STORAGE_BUCKET ?? "vivo-content";
  const sqliteDbPath = envConfig.SQLITE_DB_PATH ?? "";

  if (isConfiguredValue(supabaseUrl) && isConfiguredValue(serviceRoleKey)) {
    return createSupabaseRepository({
      url: supabaseUrl,
      serviceRoleKey,
      storageBucket,
      fetchImpl: globalThis.fetch
    });
  }

  if (isConfiguredValue(sqliteDbPath)) {
    const stateFilePath = runtimeConfig.dashboard_state_file ?? "data/dashboard-state.json";
    return createSQLiteRepository(sqliteDbPath, stateFilePath);
  }

  return createFileRepository(path.resolve(runtimeConfig.dashboard_state_file ?? "data/dashboard-state.json"));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: add SQLITE_DB_PATH backend selection in server.js"
```

---

## Task 7: Add conversation methods to the Supabase repository

**Files:**
- Modify: `src/repository.js`

- [ ] **Step 1: Add the three methods to the object returned by `createSupabaseRepository()`**

Find the `return { ... }` block inside `createSupabaseRepository()` (around line 364) and add these three methods:

```javascript
async getOrCreateConversation(audienceId, channel) {
  const { data: existing, error: selectErr } = await client
    .from("vivo_conversations")
    .select("*")
    .eq("audience_id", audienceId)
    .eq("channel", channel)
    .is("external_id", null)
    .limit(1)
    .maybeSingle();
  if (selectErr) throw new Error(selectErr.message);
  if (existing) {
    return {
      id: existing.id, audienceId: existing.audience_id, channel: existing.channel,
      externalId: existing.external_id, title: existing.title,
      createdAt: existing.created_at, updatedAt: existing.updated_at
    };
  }
  const { data: created, error: insertErr } = await client
    .from("vivo_conversations")
    .insert({ audience_id: audienceId, channel })
    .select()
    .single();
  if (insertErr) throw new Error(insertErr.message);
  return {
    id: created.id, audienceId: created.audience_id, channel: created.channel,
    externalId: created.external_id, title: created.title,
    createdAt: created.created_at, updatedAt: created.updated_at
  };
},

async appendChatMessage(conversationId, message) {
  const { data, error } = await client
    .from("vivo_messages")
    .insert({
      conversation_id: conversationId,
      audience_id: message.audienceId,
      role: message.role,
      content: message.content,
      sender_id: message.senderId ?? null,
      sender_name: message.senderName ?? null,
      metadata: message.metadata ?? {}
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id, conversationId: data.conversation_id, audienceId: data.audience_id,
    role: data.role, content: data.content, senderId: data.sender_id,
    senderName: data.sender_name, metadata: data.metadata, createdAt: data.created_at
  };
},

async getConversationMessages(conversationId) {
  const { data, error } = await client
    .from("vivo_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id, conversationId: r.conversation_id, audienceId: r.audience_id,
    role: r.role, content: r.content, senderId: r.sender_id,
    senderName: r.sender_name, metadata: r.metadata, createdAt: r.created_at
  }));
},
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: All tests pass (Supabase backend is not unit-tested — it requires a live connection).

- [ ] **Step 3: Commit**

```bash
git add src/repository.js
git commit -m "feat: add conversation methods to Supabase repository"
```

---

## Task 8: Extend POST /api/instances/:audienceId/chat to persist messages

**Files:**
- Modify: `src/app.js`
- Modify: `tests/dashboard.test.js`

- [ ] **Step 1: Write a failing test**

In `tests/dashboard.test.js`, find the test suite setup (the `loadModules()` call) and add this test. Note: look for an existing `minimalRepo` or stub helper in the test file and reuse it. If none exists, define one inline:

```javascript
test("POST /api/instances/:audienceId/chat persists user and assistant messages and returns conversationId", async () => {
  const { createApp } = await loadModules();

  const messages = [];
  const conversations = {};

  const repo = {
    getOrCreateConversation: async (audienceId, channel) => {
      const key = `${audienceId}::${channel}`;
      if (!conversations[key]) conversations[key] = { id: `conv-${audienceId}`, audienceId, channel, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
      return conversations[key];
    },
    appendChatMessage: async (conversationId, message) => {
      const msg = { id: `msg-${messages.length}`, conversationId, ...message, createdAt: "2026-01-01T00:00:00Z" };
      messages.push(msg);
      return msg;
    },
    getConversationMessages: async (conversationId) => messages.filter(m => m.conversationId === conversationId),
    saveOperatorChat: () => {},
    getInstance: async () => null,
    getInstanceByAudience: async () => null,
    listAudiences: async () => [],
    listInstances: async () => [],
    listStories: async () => [],
    listAuditLog: async () => [],
    listDeployments: async () => []
  };

  const instanceManager = {
    chatWithInstance: async (audienceId, payload) => ({ reply: "**Hello from AI**" })
  };

  const app = createApp({ repository: repo, instanceManager });
  const response = await app.handle(new Request("http://localhost/api/instances/fitness-fans/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Hi there", operator: "op@example.com" })
  }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reply, "**Hello from AI**");
  assert.ok(body.conversationId, "should return conversationId");
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "Hi there");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, "**Hello from AI**");
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
node --test tests/dashboard.test.js 2>&1 | grep -A 3 "persists user and assistant"
```

Expected: FAIL — response missing `conversationId` or messages not persisted

- [ ] **Step 3: Update the POST /api/instances/:audienceId/chat handler in app.js**

Find the handler at line 415 in `src/app.js`. Replace the body of the handler (the block starting with `ensureInstanceManager(instanceManager)`) with:

```javascript
ensureInstanceManager(instanceManager);
const audienceId = request.pathname.split("/")[3];
const body = readBody(request.body);
const message = body.message ?? "";
const operator = body.operator ?? body.actor_id ?? "unknown";

const conv = await repository.getOrCreateConversation(audienceId, "operator_console");

await repository.appendChatMessage(conv.id, {
  audienceId,
  role: "user",
  content: message,
  senderId: operator,
  senderName: operator,
  metadata: {}
});

const result = await instanceManager.chatWithInstance(audienceId, { operator, message });
const reply = result.reply ?? result.stdout ?? "";

await repository.appendChatMessage(conv.id, {
  audienceId,
  role: "assistant",
  content: reply,
  senderId: "assistant",
  senderName: "AI",
  metadata: {}
});

repository.saveOperatorChat({
  audience_id: audienceId,
  operator,
  message,
  response: result,
  timestamp: clock()
});

return json(200, { reply, conversationId: conv.id });
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
node --test tests/dashboard.test.js 2>&1 | grep -A 3 "persists user and assistant"
```

Expected: PASS

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/app.js tests/dashboard.test.js
git commit -m "feat: persist user + assistant messages on operator chat POST"
```

---

## Task 9: Add GET /api/instances/:audienceId/chat/history route

**Files:**
- Modify: `src/app.js`
- Modify: `tests/dashboard.test.js`

- [ ] **Step 1: Write a failing test**

Add to `tests/dashboard.test.js`:

```javascript
test("GET /api/instances/:audienceId/chat/history returns persisted messages", async () => {
  const { createApp } = await loadModules();

  const storedMessages = [
    { id: "m1", conversationId: "c1", audienceId: "fitness-fans", role: "user", content: "Hi", senderId: "op@example.com", senderName: "Op", metadata: {}, createdAt: "2026-01-01T00:00:00Z" },
    { id: "m2", conversationId: "c1", audienceId: "fitness-fans", role: "assistant", content: "Hello!", senderId: "assistant", senderName: "AI", metadata: {}, createdAt: "2026-01-01T00:00:01Z" }
  ];

  const repo = {
    getOrCreateConversation: async () => ({ id: "c1", audienceId: "fitness-fans", channel: "operator_console", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z" }),
    getConversationMessages: async () => storedMessages,
    listAudiences: async () => [],
    listInstances: async () => [],
    listStories: async () => [],
    listAuditLog: async () => [],
    listDeployments: async () => []
  };

  const app = createApp({ repository: repo });
  const response = await app.handle(new Request("http://localhost/api/instances/fitness-fans/chat/history"));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.messages[1].role, "assistant");
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
node --test tests/dashboard.test.js 2>&1 | grep -A 3 "chat/history returns"
```

Expected: FAIL (404 or missing route)

- [ ] **Step 3: Add the GET route in app.js**

In `handleRequest()` in `src/app.js`, add this block immediately before the `POST /api/instances/:audienceId/chat` handler (line 415):

```javascript
if (request.method === "GET" && /^\/api\/instances\/[^/]+\/chat\/history$/.test(request.pathname)) {
  const audienceId = decodeURIComponent(request.pathname.split("/")[3]);
  const conv = await repository.getOrCreateConversation(audienceId, "operator_console");
  const messages = await repository.getConversationMessages(conv.id);
  return json(200, { messages });
}
```

- [ ] **Step 4: Run — verify it passes**

```bash
node --test tests/dashboard.test.js 2>&1 | grep -A 3 "chat/history returns"
```

Expected: PASS

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/app.js tests/dashboard.test.js
git commit -m "feat: add GET /api/instances/:audienceId/chat/history route"
```

---

## Task 10: Add marked.js to the page head

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Find the stylesheet link in the HTML head template**

Search for `<link rel="stylesheet" href="/styles.css" />` in `src/app.js`.

- [ ] **Step 2: Add marked.js script tag after it**

Change:
```javascript
    <link rel="stylesheet" href="/styles.css" />
```
To:
```javascript
    <link rel="stylesheet" href="/styles.css" />
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: add marked.js CDN script to dashboard page head"
```

---

## Task 11: Rebuild renderOperatorConsole as a chat thread

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Load chat history in the GET / handler**

In `src/app.js`, find where the audiences workspace is rendered (around where `renderAudienceInspector` is called, line 1069). Before that call, add code to load the chat history for the selected audience. Look for the block where `selectedAudience` is determined (it's set from `request.query` and the loaded audiences list). Add after `selectedAudience` is resolved:

```javascript
const chatHistory = selectedAudience
  ? await (async () => {
      const conv = await repository.getOrCreateConversation(selectedAudience.id, "operator_console");
      return repository.getConversationMessages(conv.id);
    })()
  : [];
const chatConversation = selectedAudience
  ? await repository.getOrCreateConversation(selectedAudience.id, "operator_console")
  : null;
```

- [ ] **Step 2: Pass chatHistory to renderAudienceInspector**

Change line 1069:
```javascript
${renderAudienceInspector(selectedAudience, selectedDeployment, deployments)}
```
To:
```javascript
${renderAudienceInspector(selectedAudience, selectedDeployment, deployments, chatHistory)}
```

- [ ] **Step 3: Update renderAudienceInspector signature**

Find `function renderAudienceInspector(audience, selectedDeployment, deployments)` at line 1333. Change its signature and its call to `renderOperatorConsole`:

```javascript
function renderAudienceInspector(audience, selectedDeployment, deployments, chatHistory = []) {
```

And change the inner call at line 1347 from:
```javascript
<div class="px-4 py-4">${renderOperatorConsole(audience, selectedDeployment)}</div>
```
To:
```javascript
<div class="px-4 py-4">${renderOperatorConsole(audience, selectedDeployment, chatHistory)}</div>
```

- [ ] **Step 4: Replace renderOperatorConsole with the chat thread UI**

Replace the entire `renderOperatorConsole` function at line 1400 with:

```javascript
function renderChatBubble(msg) {
  if (msg.role === "user") {
    return `<div class="flex justify-end">
      <div class="max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 bg-blue-600 text-white text-sm leading-relaxed whitespace-pre-wrap">${escapeHtml(msg.content)}</div>
    </div>`;
  }
  return `<div class="flex items-start gap-2">
    <div class="flex-shrink-0 w-5 h-5 rounded-full bg-gray-600 dark:bg-gray-500 flex items-center justify-center" style="font-size:9px;color:#d1d5db;font-weight:600">AI</div>
    <div class="max-w-[82%] rounded-2xl rounded-tl-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm leading-relaxed prose prose-sm dark:prose-invert">${escapeHtml(msg.content)}</div>
  </div>`;
}

function renderOperatorConsole(audience, selectedDeployment, chatHistory = []) {
  const audienceId = audience?.id ?? selectedDeployment?.audience_id ?? "";
  if (!audienceId) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">Select an audience or launch a deployment to send operator feedback.</div>`;
  }

  const bubbles = chatHistory.map(renderChatBubble).join("\n");
  const inputClass = "flex-1 block rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none";

  return `<div class="flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden" style="height:460px">
    <div id="chat-thread-${escapeAttribute(audienceId)}" class="flex-1 overflow-y-auto p-3 space-y-3">${bubbles || '<div class="text-xs text-gray-400 dark:text-gray-500 text-center pt-4">No messages yet</div>'}</div>
    <div class="border-t border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
      <form class="flex gap-2 items-end" data-instance-chat-form="${escapeAttribute(audienceId)}">
        <input type="hidden" name="audience_id" value="${escapeAttribute(audienceId)}" />
        <input type="hidden" name="operator" value="operator@example.com" />
        <textarea name="message" rows="2" placeholder="Ask the audience manager…" class="${inputClass}"></textarea>
        <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors cursor-pointer flex-shrink-0">↑</button>
      </form>
    </div>
  </div>`;
}
```

- [ ] **Step 5: Verify the page renders**

```bash
node src/server.js &
sleep 1
curl -s http://localhost:4310/ | grep -c "chat-thread"
kill %1
```

Expected: output `>= 0` without crashing (if no audience selected, the thread element won't appear; that's fine)

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/app.js
git commit -m "feat: rebuild operator console as persistent chat thread with bubble UI"
```

---

## Task 12: Replace old JS chat handlers with typewriter + bubble logic

**Files:**
- Modify: `src/app.js`

All changes are inside `renderDashboardScript()` — the function that returns the inline `<script>` block.

- [ ] **Step 1: Remove the old chat form handlers**

Inside `renderDashboardScript()`, find and delete both of these blocks:

```javascript
document.getElementById("chat-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await postInstance("/api/instances/" + form.audience_id.value + "/chat", {
    operator: form.operator.value || "operator@example.com",
    message: form.message.value || ""
  });
});

document.querySelectorAll("form[data-instance-chat-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await postInstance("/api/instances/" + form.dataset.instanceChatForm + "/chat", {
      operator: form.operator.value || "operator@example.com",
      message: form.message.value || ""
    });
  });
});
```

- [ ] **Step 2: Add the new chat handlers in their place**

```javascript
function escapeHtmlClient(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appendUserBubble(threadEl, text) {
  const div = document.createElement("div");
  div.className = "flex justify-end";
  div.innerHTML =
    '<div class="max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 bg-blue-600 text-white text-sm leading-relaxed whitespace-pre-wrap">' +
    escapeHtmlClient(text) +
    "</div>";
  threadEl.appendChild(div);
  threadEl.scrollTop = threadEl.scrollHeight;
}

function appendAssistantBubble(threadEl) {
  const wrapper = document.createElement("div");
  wrapper.className = "flex items-start gap-2";
  const avatar = document.createElement("div");
  avatar.className = "flex-shrink-0 w-5 h-5 rounded-full bg-gray-600 dark:bg-gray-500 flex items-center justify-center";
  avatar.style.cssText = "font-size:9px;color:#d1d5db;font-weight:600";
  avatar.textContent = "AI";
  const bubble = document.createElement("div");
  bubble.className = "max-w-[82%] rounded-2xl rounded-tl-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm leading-relaxed prose prose-sm dark:prose-invert";
  const cursor = document.createElement("span");
  cursor.className = "inline-block w-2 h-3 bg-blue-500 rounded-sm align-middle";
  cursor.style.animation = "pulse 1s step-end infinite";
  bubble.appendChild(cursor);
  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  threadEl.appendChild(wrapper);
  threadEl.scrollTop = threadEl.scrollHeight;
  return bubble;
}

function startTypewriter(bubble, fullText, threadEl) {
  let i = 0;
  let current = "";
  bubble.textContent = "";
  const cursor = document.createElement("span");
  cursor.className = "inline-block w-2 h-3 bg-blue-500 rounded-sm ml-0.5 align-middle";
  cursor.style.animation = "pulse 1s step-end infinite";
  bubble.appendChild(cursor);

  const timer = setInterval(() => {
    if (i >= fullText.length) {
      clearInterval(timer);
      if (window.marked) {
        bubble.innerHTML = window.marked.parse(fullText);
      } else {
        bubble.textContent = fullText;
      }
      threadEl.scrollTop = threadEl.scrollHeight;
      return;
    }
    current += fullText[i++];
    bubble.textContent = current;
    bubble.appendChild(cursor);
    threadEl.scrollTop = threadEl.scrollHeight;
  }, 20);
}

document.querySelectorAll("form[data-instance-chat-form]").forEach((form) => {
  const audienceId = form.dataset.instanceChatForm;
  const threadEl = document.getElementById("chat-thread-" + audienceId);
  if (!threadEl) return;

  threadEl.scrollTop = threadEl.scrollHeight;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.message.value.trim();
    const operator = form.operator?.value || "operator@example.com";
    if (!message) return;

    form.message.value = "";
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    appendUserBubble(threadEl, message);
    const bubble = appendAssistantBubble(threadEl);

    try {
      const result = await sendJson(
        "/api/instances/" + audienceId + "/chat",
        "POST",
        { message, operator }
      );
      startTypewriter(bubble, result.reply ?? "", threadEl);
    } catch (err) {
      bubble.className = bubble.className + " text-red-500";
      bubble.textContent = "Error: " + err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 4: Manual end-to-end verification**

```bash
npm start
```

Open `http://localhost:4310`, go to the Audiences tab, select an audience. Verify:

1. The Manager Console shows the chat thread panel (bubbles area + input bar at bottom)
2. Prior messages from history appear as static bubbles
3. Type a message and submit — user bubble appears immediately in blue on the right
4. Assistant bubble appears with a pulsing cursor while waiting for the API response
5. Characters type out one at a time at ~20ms/char
6. On completion, the plain-text bubble flips to rendered markdown (bold, lists, code blocks, etc.)
7. Thread scrolls to bottom automatically
8. Reload the page — the conversation history is still there

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: typewriter animation and markdown rendering for operator chat thread"
```
