# Audience Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-step audience creation wizard with a 5-step wizard that investigates a protagonist via N8N workflows (handle / upload / manual), streams live progress via SSE, and seeds marble with a canonical persona before final audience creation.

**Architecture:** An in-memory SSE relay (`src/onboarding-relay.js`) holds EventEmitter-backed jobs keyed by UUID; five new API routes in `app.js` bridge between the browser and N8N; N8N posts progress callbacks back to vivo-factory which fan them to the waiting SSE connection; the wizard UI is refactored in-place within `app.js`.

**Tech Stack:** Node.js 20 ES modules, node:test + node:assert/strict, EventEmitter (node:events), SSE via raw HTTP response hijack, N8N webhooks, OpenAI Responses API (in N8N), Supabase (existing repository pattern)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/onboarding-relay.js` | In-memory job store with EventEmitter-per-job, SSE streaming, 5-min TTL cleanup |
| Create | `tests/onboarding-relay.test.js` | Unit tests for relay module (startJob, postEvent, complete, streamSSE, cancelJob) |
| Create | `tests/onboarding-routes.test.js` | Integration tests for the 5 new `/api/onboarding/*` routes via `app.handle()` |
| Modify | `src/server.js` | Instantiate relay, pass to `createApp()`, intercept `__hijack` sentinel from SSE route |
| Modify | `src/app.js` | Accept `onboardingRelay` + `n8nConfig` in options; add 5 routes; extend `create-full`; replace wizard UI (3 steps → 5 steps) and wizard JS |
| Modify | `config/runtime.json` | Add `"n8n"` block with 4 webhook URLs |

---

## Task 1: Create `src/onboarding-relay.js`

**Files:**
- Create: `src/onboarding-relay.js`

- [ ] **Step 1: Write the file**

```javascript
// src/onboarding-relay.js
import { EventEmitter } from "node:events";

const JOB_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function createOnboardingRelay() {
  const jobs = new Map(); // Map<jobId, { emitter: EventEmitter, timer: NodeJS.Timeout }>

  function startJob(jobId) {
    if (jobs.has(jobId)) return;
    const emitter = new EventEmitter();
    const timer = setTimeout(() => cancelJob(jobId), JOB_TTL_MS);
    jobs.set(jobId, { emitter, timer });
  }

  function postEvent(jobId, event) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.emitter.emit("event", event);
  }

  function complete(jobId, persona) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.emitter.emit("event", { type: "complete", persona: persona ?? null });
    job.emitter.emit("done");
    cancelJob(jobId);
  }

  function streamSSE(jobId, res) {
    const job = jobs.get(jobId);
    if (!job) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Job not found");
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no"
    });
    res.write(":\n\n"); // initial keep-alive comment

    const keepAlive = setInterval(() => res.write(":\n\n"), 20_000);

    function sendEvent(event) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    function onDone() {
      clearInterval(keepAlive);
      res.end();
    }

    job.emitter.on("event", sendEvent);
    job.emitter.once("done", onDone);

    res.on("close", () => {
      clearInterval(keepAlive);
      job.emitter.off("event", sendEvent);
      job.emitter.off("done", onDone);
    });
  }

  function cancelJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;
    clearTimeout(job.timer);
    job.emitter.emit("done");
    jobs.delete(jobId);
  }

  return { startJob, postEvent, complete, streamSSE, cancelJob };
}
```

- [ ] **Step 2: Verify the file loads**

```bash
node --input-type=module <<'EOF'
import { createOnboardingRelay } from "./src/onboarding-relay.js";
const relay = createOnboardingRelay();
relay.startJob("test-id");
relay.postEvent("test-id", { type: "progress", label: "hello" });
relay.cancelJob("test-id");
console.log("relay ok");
EOF
```

Expected: prints `relay ok`, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/onboarding-relay.js
git commit -m "feat: add onboarding SSE relay module"
```

---

## Task 2: Tests for `onboarding-relay.js`

**Files:**
- Create: `tests/onboarding-relay.test.js`

- [ ] **Step 1: Write tests**

```javascript
// tests/onboarding-relay.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createOnboardingRelay } from "../src/onboarding-relay.js";

test("startJob creates a job; duplicate startJob is a no-op", () => {
  const relay = createOnboardingRelay();
  relay.startJob("j1");
  relay.startJob("j1"); // no-op, must not throw
  relay.cancelJob("j1");
});

test("postEvent on unknown job is a no-op", () => {
  const relay = createOnboardingRelay();
  relay.postEvent("missing", { type: "progress", label: "x" }); // must not throw
});

test("cancelJob on unknown job is a no-op", () => {
  const relay = createOnboardingRelay();
  relay.cancelJob("missing"); // must not throw
});

test("postEvent fans event to streamSSE listener", (t, done) => {
  const relay = createOnboardingRelay();
  relay.startJob("j2");

  const received = [];
  const fakeRes = Object.assign(new EventEmitter(), {
    writeHead: () => {},
    write: (chunk) => { received.push(chunk); },
    end: () => {}
  });

  relay.streamSSE("j2", fakeRes);
  relay.postEvent("j2", { type: "progress", label: "step 1" });

  // Give the synchronous emit a tick
  setImmediate(() => {
    assert.ok(received.some(c => c.includes('"step 1"')), "event chunk not found");
    relay.cancelJob("j2");
    done();
  });
});

test("complete fans complete event then ends SSE", (t, done) => {
  const relay = createOnboardingRelay();
  relay.startJob("j3");

  const chunks = [];
  let ended = false;
  const fakeRes = Object.assign(new EventEmitter(), {
    writeHead: () => {},
    write: (chunk) => { chunks.push(chunk); },
    end: () => { ended = true; }
  });

  relay.streamSSE("j3", fakeRes);
  relay.complete("j3", { biographical: { name: { value: "Test" } } });

  setImmediate(() => {
    assert.ok(chunks.some(c => c.includes('"complete"')), "complete event missing");
    assert.ok(ended, "response not ended");
    done();
  });
});

test("streamSSE returns 404 for unknown job", () => {
  const relay = createOnboardingRelay();
  let statusCode = 0;
  let body = "";
  const fakeRes = Object.assign(new EventEmitter(), {
    writeHead: (code) => { statusCode = code; },
    end: (b) => { body = b ?? ""; }
  });

  relay.streamSSE("no-such-job", fakeRes);
  assert.equal(statusCode, 404);
  assert.ok(body.includes("not found"));
});
```

- [ ] **Step 2: Run tests**

```bash
node --test tests/onboarding-relay.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/onboarding-relay.test.js
git commit -m "test: onboarding relay unit tests"
```

---

## Task 3: Wire SSE hijack in `src/server.js`

**Files:**
- Modify: `src/server.js`

The SSE route in app.js cannot write to the raw `response` object because `app.handle()` only returns a plain object. This task adds a sentinel pattern: the route returns `{ __hijack: true, type: "sse", jobId }`, and server.js intercepts it before calling `writeHead`.

- [ ] **Step 1: Import relay and instantiate it in server.js**

At the top of `server.js`, after the existing imports (after line 22), add:

```javascript
import { createOnboardingRelay } from "./onboarding-relay.js";
```

After the line `const storyEnrichmentService = createStoryEnrichmentService(...)` (around line 104), add:

```javascript
const onboardingRelay = createOnboardingRelay();
```

- [ ] **Step 2: Pass relay and n8nConfig to createApp()**

In the `createApp({...})` call (around line 147), add two new properties:

```javascript
const app = createApp({
  repository,
  instanceManager,
  profileClientFactory,
  setupService,
  audienceImportService,
  audienceManagerLauncher,
  audienceRuntimeConfig: runtimeConfig.audiences ?? {},
  runtimeStatusService,
  publishService,
  dispatchFetch,
  fetchImpl: globalThis.fetch,
  publicationTargetResolver(audience, story) {
    // ... existing implementation unchanged ...
  },
  clock: () => new Date().toISOString(),
  onboardingRelay,                                          // NEW
  n8nConfig: runtimeConfig.n8n ?? {},                      // NEW
  vivoFactoryUrl                                            // NEW (already defined above)
});
```

- [ ] **Step 3: Intercept the SSE hijack in the request handler**

Replace the block at lines 192–201:
```javascript
  const result = await app.handle({
    method: request.method ?? "GET",
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  response.writeHead(result.status, result.headers);
  response.end(result.body);
```

With:
```javascript
  const result = await app.handle({
    method: request.method ?? "GET",
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  if (result.__hijack === true && result.type === "sse") {
    onboardingRelay.streamSSE(result.jobId, response);
    return;
  }

  response.writeHead(result.status, result.headers);
  response.end(result.body);
```

- [ ] **Step 4: Start the server and verify it still loads**

```bash
node src/server.js &
sleep 2
curl -s http://localhost:4310/api/setup | grep -q "status" && echo "server ok"
kill %1
```

Expected: prints `server ok`.

- [ ] **Step 5: Commit**

```bash
git add src/server.js
git commit -m "feat: wire onboarding relay into server with SSE hijack"
```

---

## Task 4: Add N8N webhook URLs to `config/runtime.json`

**Files:**
- Modify: `config/runtime.json`

- [ ] **Step 1: Read current runtime.json to get full content**

```bash
cat config/runtime.json
```

- [ ] **Step 2: Add the `"n8n"` block**

After the last top-level key (before the closing `}`), add:

```json
{
  ...(existing keys)...,
  "n8n": {
    "onboarding_handle_webhook":  "http://localhost:5678/webhook/vivo-onboarding-handle",
    "onboarding_upload_webhook":  "http://localhost:5678/webhook/vivo-onboarding-upload",
    "onboarding_manual_webhook":  "http://localhost:5678/webhook/vivo-onboarding-manual",
    "onboarding_photo_webhook":   "http://localhost:5678/webhook/vivo-describe-hero"
  }
}
```

- [ ] **Step 3: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('config/runtime.json','utf8')); console.log('json ok')"
```

Expected: `json ok`.

- [ ] **Step 4: Commit**

```bash
git add config/runtime.json
git commit -m "chore: add n8n onboarding webhook URLs to runtime config"
```

---

## Task 5: Add five onboarding routes to `src/app.js`

**Files:**
- Modify: `src/app.js`

These routes must be added **before** the existing `// POST /api/audiences/create-full` comment (around line 104). They also require `onboardingRelay` and `n8nConfig` extracted from `options`.

- [ ] **Step 1: Extract new options in `createApp()`**

In `createApp()`, after the existing `const publishService = options.publishService ?? null;` line (around line 25), add:

```javascript
  const onboardingRelay = options.onboardingRelay ?? null;
  const n8nConfig = options.n8nConfig ?? {};
  const vivoFactoryUrl = options.vivoFactoryUrl ?? "http://localhost:4310";
```

And pass these into the `handleRequest(context)` call by adding them to the `context` object passed to `handleRequest`. In the `handle()` method (around line 28), add to the arguments of `handleRequest({...})`:

```javascript
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
        audienceRuntimeConfig,
        runtimeStatusService,
        publishService,
        onboardingRelay,       // NEW
        n8nConfig,             // NEW
        vivoFactoryUrl,        // NEW
        request
      });
```

And destructure them in `handleRequest(context)`:

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
    audienceRuntimeConfig,
    runtimeStatusService,
    publishService,
    onboardingRelay,    // NEW
    n8nConfig,          // NEW
    vivoFactoryUrl,     // NEW
    request
  } = context;
```

- [ ] **Step 2: Add POST /api/onboarding/photo route**

Insert before the `// POST /api/audiences/create-full` comment:

```javascript
  // POST /api/onboarding/photo — synchronous protagonist photo analysis via N8N
  if (request.method === "POST" && request.pathname === "/api/onboarding/photo") {
    const body = readBody(request.body);
    const { image_base64, mime_type } = body;
    if (!image_base64) return json(400, { error: "image_base64 is required" });
    if (!mime_type) return json(400, { error: "mime_type is required" });
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedMimeTypes.includes(mime_type)) return json(400, { error: "mime_type must be jpeg, png, or webp" });
    const photoWebhook = n8nConfig.onboarding_photo_webhook;
    if (!photoWebhook) return json(503, { error: "Photo analysis webhook not configured" });
    let n8nRes;
    try {
      n8nRes = await fetchImpl(photoWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_base64, mime_type })
      });
    } catch (err) {
      console.error("[onboarding/photo] N8N request failed:", err.message);
      return json(502, { error: "Photo analysis service unreachable" });
    }
    if (!n8nRes.ok) {
      const errText = await n8nRes.text().catch(() => "");
      return json(502, { error: `Photo analysis failed: ${errText.slice(0, 200)}` });
    }
    const photoContext = await n8nRes.json();
    return json(200, photoContext);
  }

  // POST /api/onboarding/start — create job, fire N8N investigation webhook
  if (request.method === "POST" && request.pathname === "/api/onboarding/start") {
    if (!onboardingRelay) return json(503, { error: "Onboarding relay not configured" });
    const body = readBody(request.body);
    const { mode, payload, photo_context } = body;
    const validModes = ["handle", "upload", "manual"];
    if (!validModes.includes(mode)) return json(400, { error: `mode must be one of: ${validModes.join(", ")}` });
    const webhookMap = {
      handle: n8nConfig.onboarding_handle_webhook,
      upload: n8nConfig.onboarding_upload_webhook,
      manual: n8nConfig.onboarding_manual_webhook
    };
    const webhook = webhookMap[mode];
    if (!webhook) return json(503, { error: `N8N webhook for mode '${mode}' not configured` });
    const { randomUUID } = await import("node:crypto");
    const jobId = randomUUID();
    onboardingRelay.startJob(jobId);
    const callbackBase = vivoFactoryUrl;
    fetchImpl(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode,
        payload: payload ?? {},
        photo_context: photo_context ?? null,
        job_id: jobId,
        callback_url: callbackBase
      })
    }).catch(err => console.error("[onboarding/start] webhook fire failed:", err.message));
    return json(200, { job_id: jobId });
  }

  // GET /api/onboarding/stream/:job_id — SSE stream (handled via hijack in server.js)
  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/onboarding\/stream\/([^/]+)$/)) {
    const jobId = request.pathname.split("/")[4];
    if (!onboardingRelay) return json(503, { error: "Onboarding relay not configured" });
    return { __hijack: true, type: "sse", jobId };
  }

  // POST /api/onboarding/jobs/:job_id/event — N8N progress callback
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/onboarding\/jobs\/([^/]+)\/event$/)) {
    const jobId = request.pathname.split("/")[4];
    if (!onboardingRelay) return json(503, { error: "Onboarding relay not configured" });
    const body = readBody(request.body);
    onboardingRelay.postEvent(jobId, { type: "progress", label: body.label ?? "", data: body.data ?? null });
    return json(200, { ok: true });
  }

  // POST /api/onboarding/jobs/:job_id/complete — N8N completion callback
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/onboarding\/jobs\/([^/]+)\/complete$/)) {
    const jobId = request.pathname.split("/")[4];
    if (!onboardingRelay) return json(503, { error: "Onboarding relay not configured" });
    const body = readBody(request.body);
    onboardingRelay.complete(jobId, body.persona ?? null);
    return json(200, { ok: true });
  }
```

- [ ] **Step 3: Start server and smoke-test routes**

```bash
node src/server.js &
sleep 2

# Photo route — 503 is expected (webhook not running yet, but route exists)
curl -s -X POST http://localhost:4310/api/onboarding/photo \
  -H 'content-type: application/json' \
  -d '{"image_base64":"abc","mime_type":"image/jpeg"}' | grep -q "error" && echo "photo route ok"

# Start route — job_id returned
curl -s -X POST http://localhost:4310/api/onboarding/start \
  -H 'content-type: application/json' \
  -d '{"mode":"handle","payload":{"handle":"test"}}' | grep -q "job_id" && echo "start route ok"

# Event callback route
curl -s -X POST http://localhost:4310/api/onboarding/jobs/fake-id/event \
  -H 'content-type: application/json' \
  -d '{"label":"step 1"}' | grep -q "ok" && echo "event route ok"

kill %1
```

Expected: `photo route ok`, `start route ok`, `event route ok`.

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "feat: add five onboarding API routes to app.js"
```

---

## Task 6: Integration tests for onboarding routes

**Files:**
- Create: `tests/onboarding-routes.test.js`

- [ ] **Step 1: Write tests**

```javascript
// tests/onboarding-routes.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createOnboardingRelay } from "../src/onboarding-relay.js";

function makeApp(overrides = {}) {
  const relay = createOnboardingRelay();
  const app = createApp({
    repository: null,
    onboardingRelay: relay,
    n8nConfig: {
      onboarding_photo_webhook: "http://localhost:19999/photo",
      onboarding_handle_webhook: "http://localhost:19999/handle",
      onboarding_upload_webhook: "http://localhost:19999/upload",
      onboarding_manual_webhook: "http://localhost:19999/manual"
    },
    vivoFactoryUrl: "http://localhost:4310",
    fetchImpl: overrides.fetchImpl ?? (async () => {
      throw new Error("fetch not expected");
    }),
    ...overrides
  });
  return { app, relay };
}

test("POST /api/onboarding/photo — returns 400 when image_base64 missing", async () => {
  const { app } = makeApp();
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/photo",
    body: JSON.stringify({ mime_type: "image/jpeg" })
  });
  assert.equal(result.status, 400);
  assert.ok(JSON.parse(result.body).error.includes("image_base64"));
});

test("POST /api/onboarding/photo — returns 400 for disallowed mime_type", async () => {
  const { app } = makeApp();
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/photo",
    body: JSON.stringify({ image_base64: "abc", mime_type: "image/gif" })
  });
  assert.equal(result.status, 400);
});

test("POST /api/onboarding/photo — proxies N8N response", async () => {
  const photoContext = { gender_presentation: "male", age_range: "40s" };
  const { app } = makeApp({
    fetchImpl: async () => ({
      ok: true,
      json: async () => photoContext
    })
  });
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/photo",
    body: JSON.stringify({ image_base64: "abc", mime_type: "image/jpeg" })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), photoContext);
});

test("POST /api/onboarding/start — returns 400 for invalid mode", async () => {
  const { app } = makeApp();
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/start",
    body: JSON.stringify({ mode: "unknown" })
  });
  assert.equal(result.status, 400);
  assert.ok(JSON.parse(result.body).error.includes("mode"));
});

test("POST /api/onboarding/start — creates job and returns job_id", async () => {
  const { app } = makeApp({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  });
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/start",
    body: JSON.stringify({ mode: "handle", payload: { handle: "andrewchen" } })
  });
  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.ok(typeof body.job_id === "string" && body.job_id.length > 0);
});

test("GET /api/onboarding/stream/:id — returns SSE hijack sentinel", async () => {
  const { app, relay } = makeApp();
  relay.startJob("test-job-999");
  const result = await app.handle({
    method: "GET", pathname: "/api/onboarding/stream/test-job-999", body: ""
  });
  assert.equal(result.__hijack, true);
  assert.equal(result.type, "sse");
  assert.equal(result.jobId, "test-job-999");
  relay.cancelJob("test-job-999");
});

test("POST /api/onboarding/jobs/:id/event — fans event to relay", async () => {
  const { app, relay } = makeApp();
  relay.startJob("ev-job");
  const received = [];
  relay.postEvent = (id, ev) => received.push({ id, ev });

  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/jobs/ev-job/event",
    body: JSON.stringify({ label: "Fetching profile…" })
  });
  assert.equal(result.status, 200);
  relay.cancelJob("ev-job");
});

test("POST /api/onboarding/jobs/:id/complete — calls relay.complete", async () => {
  const { app, relay } = makeApp();
  relay.startJob("comp-job");
  let completedPersona = null;
  relay.complete = (id, persona) => { completedPersona = persona; };

  const persona = { biographical: { name: { value: "Test" } } };
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/jobs/comp-job/complete",
    body: JSON.stringify({ persona })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(completedPersona, persona);
});
```

- [ ] **Step 2: Run tests**

```bash
node --test tests/onboarding-routes.test.js
```

Expected: all 8 tests pass.

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/onboarding-routes.test.js
git commit -m "test: integration tests for onboarding API routes"
```

---

## Task 7: Extend `POST /api/audiences/create-full` to accept and seed persona

**Files:**
- Modify: `src/app.js`

The create-full endpoint currently accepts `{ details, channels, photo }`. Extend it to also accept `persona` (canonical persona JSON) and `photo_context`. When persona is present, seed marble after audience creation.

- [ ] **Step 1: Add `personaToMarbleFacts` helper function**

In `src/app.js`, after the `normalizeAudienceProfileFacts` function (around line 940), add:

```javascript
function personaToMarbleFacts(persona) {
  if (!persona || typeof persona !== "object") return {};
  const bio = persona.biographical ?? {};
  const cog = persona.cognitive ?? {};
  const comm = persona.communication ?? {};
  const mv = persona.motivations_values ?? {};
  const pers = persona.personalization ?? {};

  return {
    label: bio.name?.value ?? "",
    location: bio.current_role?.value
      ? `${bio.current_role.value}${bio.location?.value ? ", " + bio.location.value : ""}`
      : (bio.location?.value ?? ""),
    interests: Array.isArray(cog.interests) ? cog.interests : [],
    tone: comm.preferred_tone ?? pers.tone ?? "",
    content_pillars: Array.isArray(pers.topics) ? pers.topics : [],
    excluded_topics: Array.isArray(pers.anti_patterns) ? pers.anti_patterns : [],
    family_context: "",
    shopping_bias: "",
    posting_schedule: "",
    extra_metadata: {
      thinking_style: cog.thinking_style ?? [],
      resonates_with: comm.resonates_with ?? [],
      tunes_out: comm.tunes_out ?? [],
      core_motivations: mv.core_motivations ?? [],
      values: mv.values ?? [],
      big_five: persona.big_five ?? {}
    }
  };
}
```

- [ ] **Step 2: Extend the `create-full` handler to accept persona and seed marble**

Find the `create-full` handler (line 104). The handler currently ends with:

```javascript
    return json(200, {
      audience_id: result.audience?.id,
      audience_key: result.audience?.audience_key,
      hero_image_asset_storage_id: heroImageStorageId,
      status: "new"
    });
```

Replace the code starting from the body parsing at line 109 through that final `return json(200, ...)` with:

```javascript
    const body = readBody(request.body);
    const details = body.details ?? {};
    const channels = body.channels ?? {};
    const photo = body.photo ?? null;
    const persona = body.persona ?? null;
    const photoContext = body.photo_context ?? null;

    const label = String(details.label ?? "").trim();
    const profileRawText = String(details.profile_raw_text ?? details.description ?? "").trim();
    const botToken = String(channels.telegram_bot_token ?? "").trim();
    const chatId = String(channels.telegram_chat_id ?? "").trim();

    if (!label) return json(400, { error: "details.label is required." });
    if (!botToken) return json(400, { error: "channels.telegram_bot_token is required." });
    if (!chatId) return json(400, { error: "channels.telegram_chat_id is required." });
    if (!profileRawText && !persona) return json(400, { error: "details.profile_raw_text or persona is required." });
    if (photo) {
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(photo.mime_type)) return json(400, { error: "photo.mime_type must be jpeg, png, webp, or gif." });
      if ((photo.size_bytes ?? 0) > 5 * 1024 * 1024) return json(400, { error: "Photo must be under 5 MB." });
    }

    const rawText = profileRawText || [
      label,
      details.location ? `Location: ${details.location}` : null,
      details.interests?.length ? `Interests: ${details.interests.join(", ")}` : null
    ].filter(Boolean).join(". ");

    const result = await audienceImportService.createAudience({
      raw_text: rawText,
      initial_status: "new",
      channels: {
        telegram_bot_token: botToken,
        telegram_chat_id: chatId,
        posting_schedule: channels.posting_schedule ?? "twice_daily",
        twitter_api_key: String(channels.twitter_api_key ?? "").trim(),
        twitter_api_secret: String(channels.twitter_api_secret ?? "").trim(),
        twitter_access_token: String(channels.twitter_access_token ?? "").trim(),
        twitter_access_token_secret: String(channels.twitter_access_token_secret ?? "").trim()
      }
    });

    const audienceId = result.audience?.id;

    // Seed marble with persona facts
    if (persona && audienceId) {
      try {
        const profileClient = await resolveProfileClient({ repository, profileClientFactory, audienceId });
        if (profileClient?.updateFacts) {
          await profileClient.updateFacts(personaToMarbleFacts(persona));
        }
      } catch (err) {
        console.error("[create-full] marble seeding failed:", err.message);
      }
    }

    // Save persona + photo_context to profile_snapshot.onboarding
    if ((persona || photoContext) && audienceId) {
      try {
        const existingAudience = await repository.getAudience(audienceId);
        const updatedSnapshot = {
          ...(existingAudience?.profile_snapshot ?? {}),
          onboarding: {
            persona: persona ?? null,
            photo_context: photoContext ?? null,
            seeded_at: clock()
          }
        };
        await repository.updateAudience(audienceId, { profile_snapshot: updatedSnapshot }, {
          actorId: "system",
          timestamp: clock()
        });
      } catch (err) {
        console.error("[create-full] snapshot save failed:", err.message);
      }
    }

    let heroImageStorageId = null;
    if (photo && audienceId) {
      try {
        heroImageStorageId = await repository.storeAudiencePhoto(audienceId, photo);
      } catch (err) {
        console.error("[create-full] photo upload failed:", err.message);
      }
    }

    return json(200, {
      audience_id: audienceId,
      audience_key: result.audience?.audience_key,
      hero_image_asset_storage_id: heroImageStorageId,
      status: "new"
    });
```

- [ ] **Step 3: Run the test suite**

```bash
npm test
```

Expected: all tests pass (create-full is not tested in isolation, but existing tests should still pass).

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "feat: extend create-full to accept and seed persona into marble"
```

---

## Task 8: Refactor wizard HTML to 5 steps

**Files:**
- Modify: `src/app.js`

Replace the `renderAudienceWizard()` function body (currently around lines 2315–2455). The new wizard has 5 steps: Investigate (0), Photo (1), Progress (2), Review (3), Channels (4).

- [ ] **Step 1: Replace `renderAudienceWizard()` function**

Find the function starting with:
```javascript
  const stepTitles = ["Audience Details", "Publishing Channels", "Protagonist Photo"];
```

And ending with the closing `}` of `renderAudienceWizard()` (the function ends at the `}` after the `return \`...\`` block, around line 2455).

Replace the entire body of `renderAudienceWizard()` with:

```javascript
  const stepTitles = ["Investigate", "Photo", "Progress", "Review", "Channels"];

  const step0 = `
    <div class="space-y-4">
      <div class="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden" id="wiz-tabs">
        <button type="button" class="wiz-tab wiz-tab-active flex-1 py-2 text-sm font-medium" data-tab="handle" onclick="wizTab('handle')">Social Handle</button>
        <button type="button" class="wiz-tab flex-1 py-2 text-sm font-medium border-l border-gray-200 dark:border-gray-700" data-tab="upload" onclick="wizTab('upload')">Upload Report</button>
        <button type="button" class="wiz-tab flex-1 py-2 text-sm font-medium border-l border-gray-200 dark:border-gray-700" data-tab="manual" onclick="wizTab('manual')">Manual</button>
      </div>

      <div id="wiz-tab-handle">
        <div class="space-y-3">
          <div>
            <label class="label" for="wiz-handle">X / Twitter Handle *</label>
            <input id="wiz-handle" name="handle" class="input font-mono" placeholder="@andrewchen" />
          </div>
          <div>
            <label class="label" for="wiz-github">GitHub Handle <span class="font-normal text-gray-400">(optional)</span></label>
            <input id="wiz-github" name="github" class="input font-mono" placeholder="@andrewchen" />
          </div>
        </div>
      </div>

      <div id="wiz-tab-upload" class="hidden">
        <div class="space-y-3">
          <p class="text-sm text-gray-500 dark:text-gray-400">Upload a .md or .txt file describing this audience persona (max 500 KB).</p>
          <label class="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 cursor-pointer hover:border-indigo-400 transition-colors">
            <span class="text-2xl">📄</span>
            <span class="text-sm text-gray-500" id="wiz-upload-label">Click to select .md or .txt</span>
            <input type="file" id="wiz-upload-file" name="upload_file" accept=".md,.txt,text/markdown,text/plain" class="hidden" onchange="wizUploadChange(this)" />
          </label>
        </div>
      </div>

      <div id="wiz-tab-manual" class="hidden">
        <div class="space-y-4">
          <div>
            <label class="label" for="wiz-q1-role">What's your role, and what city do you live in? *</label>
            <input id="wiz-q1-role" name="q1_role" class="input" placeholder="e.g. Startup founder in San Francisco" />
          </div>
          <div>
            <label class="label" for="wiz-q2-jtbd">What's the one thing you're most trying to figure out or get done right now? *</label>
            <textarea id="wiz-q2-jtbd" name="q2_jtbd" rows="2" class="input resize-none" placeholder="e.g. How to grow my user base without burning out my team"></textarea>
          </div>
          <div>
            <p class="label">When you buy something premium, what drives you more?</p>
            <div class="grid grid-cols-2 gap-2 mt-1">
              <label class="wiz-tile"><input type="radio" name="q3_wealth" value="value" class="sr-only" /><span>💡 Getting the best value</span></label>
              <label class="wiz-tile"><input type="radio" name="q3_wealth" value="quality" class="sr-only" /><span>✨ Highest quality</span></label>
            </div>
          </div>
          <div>
            <p class="label">Pick the trade-off that fits you better:</p>
            <div class="grid grid-cols-2 gap-2 mt-1">
              <label class="wiz-tile"><input type="radio" name="q4_values" value="speed_over_perfection" class="sr-only" /><span>⚡ Speed over perfection</span></label>
              <label class="wiz-tile"><input type="radio" name="q4_values" value="depth_over_breadth" class="sr-only" /><span>🔬 Depth over breadth</span></label>
              <label class="wiz-tile"><input type="radio" name="q4_values" value="autonomy_over_stability" class="sr-only" /><span>🦅 Autonomy over stability</span></label>
              <label class="wiz-tile"><input type="radio" name="q4_values" value="impact_over_income" class="sr-only" /><span>🌍 Impact over income</span></label>
            </div>
          </div>
          <div>
            <p class="label">What are you into? <span class="font-normal text-gray-400">(pick all that apply)</span></p>
            <div class="flex flex-wrap gap-2 mt-1" id="wiz-q5-tiles">
              ${["Technology","AI/ML","Startups","Design","Science","Finance","Sports","Health","Travel","Food","Music","Books","Gaming","Politics","Environment"].map(p =>
                `<label class="wiz-tile wiz-tile-check"><input type="checkbox" name="q5_passions" value="${p}" class="sr-only" /><span>${p}</span></label>`
              ).join("")}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const step1 = `
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">Upload a photo of the audience protagonist for AI-powered physical description. Optional — skip to proceed without one.</p>
      <div id="wiz-drop-zone"
           class="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-10 cursor-pointer hover:border-indigo-400 transition-colors"
           onclick="document.getElementById('wiz-photo-file').click()">
        <div class="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center">
          <img id="wiz-photo-preview" src="" alt="" class="w-full h-full object-cover hidden" />
          <span id="wiz-photo-placeholder" class="text-3xl">📷</span>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400">Click to select or drag &amp; drop</p>
        <p class="text-xs text-gray-400">JPEG, PNG or WebP · max 5 MB</p>
        <input type="file" id="wiz-photo-file" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="wizPhotoChanged(this)" />
      </div>
      <div id="wiz-photo-chips" class="hidden flex-wrap gap-2"></div>
      <div id="wiz-photo-analyzing" class="hidden text-sm text-indigo-600 dark:text-indigo-400">Analysing photo…</div>
    </div>`;

  const step2 = `
    <div class="space-y-2">
      <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Investigation in progress…</p>
      <div id="wiz-progress-log" class="rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 text-sm font-mono space-y-1 min-h-32 max-h-64 overflow-y-auto">
        <div class="text-gray-400">Starting investigation…</div>
      </div>
    </div>`;

  const step3 = `
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">Review and edit the generated profile before creating the audience.</p>
      <div class="grid grid-cols-2 gap-4">
        <div class="col-span-2">
          <label class="label" for="wiz-review-label">Audience Name *</label>
          <input id="wiz-review-label" name="review_label" class="input" required />
        </div>
        <div>
          <label class="label" for="wiz-review-location">Location</label>
          <input id="wiz-review-location" name="review_location" class="input" />
        </div>
        <div>
          <label class="label" for="wiz-review-tone">Tone</label>
          <input id="wiz-review-tone" name="review_tone" class="input" placeholder="direct, warm, professional…" />
        </div>
        <div class="col-span-2">
          <label class="label" for="wiz-review-interests">Interests <span class="font-normal text-gray-400">(comma-separated)</span></label>
          <input id="wiz-review-interests" name="review_interests" class="input" placeholder="AI, startups, design…" />
        </div>
        <div class="col-span-2">
          <label class="label" for="wiz-review-pillars">Content Pillars <span class="font-normal text-gray-400">(comma-separated)</span></label>
          <input id="wiz-review-pillars" name="review_pillars" class="input" placeholder="growth, product, leadership…" />
        </div>
        <div class="col-span-2">
          <label class="label" for="wiz-review-excluded">Excluded Topics <span class="font-normal text-gray-400">(comma-separated)</span></label>
          <input id="wiz-review-excluded" name="review_excluded" class="input" placeholder="politics, religion…" />
        </div>
      </div>
      <div id="wiz-photo-context-block" class="hidden rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Physical Description (from photo)</p>
        <p id="wiz-photo-context-text" class="text-sm text-gray-700 dark:text-gray-300"></p>
      </div>
      <details>
        <summary class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 cursor-pointer select-none">Raw Synthesis Output</summary>
        <pre id="wiz-persona-raw" class="mt-2 text-xs bg-gray-50 dark:bg-gray-800 rounded p-3 overflow-auto max-h-48"></pre>
      </details>
    </div>`;

  const step4 = `
    <div class="space-y-4">
      <div>
        <label class="label" for="wiz-bot-token">Telegram Bot Token *</label>
        <input id="wiz-bot-token" name="telegram_bot_token" class="input font-mono" placeholder="123456:ABC-DEF…" />
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Get from @BotFather on Telegram</p>
      </div>
      <div>
        <label class="label" for="wiz-chat-id">Telegram Chat ID *</label>
        <input id="wiz-chat-id" name="telegram_chat_id" class="input font-mono" placeholder="-100123456789" />
      </div>
      <div>
        <label class="label" for="wiz-schedule">Posting Schedule</label>
        <select id="wiz-schedule" name="posting_schedule" class="input">
          <option value="twice_daily">Twice daily (9:00 and 18:00)</option>
          <option value="daily">Daily (9:00)</option>
          <option value="hourly">Hourly</option>
        </select>
      </div>
      <details class="mt-2">
        <summary class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 cursor-pointer select-none">Twitter / X (optional)</summary>
        <div class="mt-3 space-y-3">
          <p class="text-xs text-gray-400 dark:text-gray-500">Add credentials to cross-post to Twitter/X. Leave blank to use Telegram only.</p>
          <div>
            <label class="label" for="wiz-twitter-api-key">API Key</label>
            <input id="wiz-twitter-api-key" name="twitter_api_key" class="input font-mono" autocomplete="off" />
          </div>
          <div>
            <label class="label" for="wiz-twitter-api-secret">API Secret</label>
            <input id="wiz-twitter-api-secret" name="twitter_api_secret" class="input font-mono" autocomplete="off" />
          </div>
          <div>
            <label class="label" for="wiz-twitter-access-token">Access Token</label>
            <input id="wiz-twitter-access-token" name="twitter_access_token" class="input font-mono" autocomplete="off" />
          </div>
          <div>
            <label class="label" for="wiz-twitter-access-token-secret">Access Token Secret</label>
            <input id="wiz-twitter-access-token-secret" name="twitter_access_token_secret" class="input font-mono" autocomplete="off" />
          </div>
        </div>
      </details>
    </div>`;

  return `<div id="audience-wizard" class="dialog-backdrop" style="display:none" role="dialog" aria-modal="true" aria-labelledby="wiz-title">
    <div class="dialog-panel">

      <div class="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h2 id="wiz-title" class="text-base font-semibold text-gray-900 dark:text-gray-100">New Audience</h2>
        <button onclick="closeAudienceWizard()" class="rounded p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="Close">✕</button>
      </div>

      <div class="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-1" id="wiz-stepper">
          ${stepTitles.map((title, i) => `
            <div class="flex items-center gap-1 flex-1 ${i < stepTitles.length - 1 ? "" : "flex-none"}">
              <div class="flex items-center gap-2">
                <span class="step-circle ${i === 0 ? "active" : "pending"}" data-step-circle="${i}">${i + 1}</span>
                <span class="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap" data-step-label="${i}">${escapeHtml(title)}</span>
              </div>
              ${i < stepTitles.length - 1 ? `<div class="step-connector flex-1" data-step-connector="${i}"></div>` : ""}
            </div>`).join("")}
        </div>
      </div>

      <form id="audience-wizard-form" class="flex-1 overflow-y-auto">
        <div class="px-6 py-5">
          <div data-wiz-step="0">${step0}</div>
          <div data-wiz-step="1" class="hidden">${step1}</div>
          <div data-wiz-step="2" class="hidden">${step2}</div>
          <div data-wiz-step="3" class="hidden">${step3}</div>
          <div data-wiz-step="4" class="hidden">${step4}</div>
        </div>
      </form>

      <div class="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
        <button id="wiz-back" class="btn btn-outline btn-sm hidden" onclick="wizardBack()">← Back</button>
        <div class="ml-auto flex items-center gap-3">
          <span id="wiz-error" class="text-xs text-red-600 dark:text-red-400 hidden"></span>
          <button id="wiz-next" class="btn btn-accent btn-sm" onclick="wizardNext()">Next →</button>
          <button id="wiz-investigate" class="btn btn-accent btn-sm hidden" onclick="wizardInvestigate()">Investigate →</button>
          <button id="wiz-submit" class="btn btn-accent btn-sm hidden" onclick="wizardSubmit()">Create Audience</button>
        </div>
      </div>

    </div>
  </div>`;
```

- [ ] **Step 2: Add CSS for wizard tiles in public/styles.css** (if styles.css exists; otherwise skip)

```bash
grep -q "wiz-tile" public/styles.css 2>/dev/null || echo "no styles.css - inline styles only"
```

If styles.css exists, add to it:
```css
.wiz-tab { background: transparent; transition: background 0.1s, color 0.1s; }
.wiz-tab-active { background: rgb(99 102 241 / 0.1); color: rgb(99 102 241); font-weight: 600; }
.wiz-tile { display: flex; align-items: center; justify-content: center; padding: 0.5rem 0.75rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; cursor: pointer; font-size: 0.875rem; transition: border-color 0.1s, background 0.1s; }
.wiz-tile:has(input:checked) { border-color: rgb(99 102 241); background: rgb(99 102 241 / 0.08); font-weight: 500; }
```

- [ ] **Step 3: Run tests and verify server starts**

```bash
npm test
node src/server.js &
sleep 2
curl -s http://localhost:4310/ | grep -q "audience-wizard" && echo "wizard html ok"
kill %1
```

Expected: tests pass, `wizard html ok`.

- [ ] **Step 4: Commit**

```bash
git add src/app.js public/styles.css 2>/dev/null; git add src/app.js
git commit -m "feat: refactor audience wizard to 5-step onboarding UI"
```

---

## Task 9: Replace wizard JavaScript (SSE + state machine)

**Files:**
- Modify: `src/app.js`

Replace the wizard JS block (the section containing `var _wizStep`, `openAudienceWizard`, `wizardRender`, `validateWizardStep`, `wizardNext`, `wizardBack`, `wizardSubmit`, and the photo drop zone wiring) inside `renderDashboardScript()`.

Find the comment `var _wizStep = 0;` and replace everything from that line through the closing photo-drop-zone block (ending around `if (dropZone) { ... } }`).

- [ ] **Step 1: Replace wizard state + logic**

```javascript
      // ── Wizard state ────────────────────────────────────────────────
      var _wizStep = 0;
      var _wizStepCount = 5;
      var _wizTab = 'handle';         // 'handle' | 'upload' | 'manual'
      var _wizPhotoFile = null;       // File object
      var _wizPhotoContext = null;    // N8N photo analysis result
      var _wizPersona = null;         // N8N investigation result
      var _wizJobId = null;           // SSE job ID
      var _wizUploadText = null;      // extracted text from uploaded file
      var _wizSseSource = null;       // EventSource

      function wizTab(tab) {
        _wizTab = tab;
        ['handle','upload','manual'].forEach(function(t) {
          var panel = document.getElementById('wiz-tab-' + t);
          var btn = document.querySelector('[data-tab="' + t + '"]');
          if (panel) panel.classList.toggle('hidden', t !== tab);
          if (btn) btn.classList.toggle('wiz-tab-active', t === tab);
        });
      }

      function wizUploadChange(input) {
        var file = input.files[0];
        if (!file) return;
        if (file.size > 500 * 1024) { showWizError('File must be under 500 KB.'); input.value = ''; return; }
        var label = document.getElementById('wiz-upload-label');
        if (label) label.textContent = file.name;
        var reader = new FileReader();
        reader.onload = function(e) { _wizUploadText = e.target.result; };
        reader.readAsText(file);
      }

      function wizPhotoChanged(input) {
        var file = input.files[0];
        if (!file) return;
        _wizPhotoFile = file;
        var preview = document.getElementById('wiz-photo-preview');
        var placeholder = document.getElementById('wiz-photo-placeholder');
        var reader = new FileReader();
        reader.onload = function(e) {
          if (preview) { preview.src = e.target.result; preview.classList.remove('hidden'); }
          if (placeholder) placeholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
      }

      function openAudienceWizard() {
        _wizStep = 0;
        _wizTab = 'handle';
        _wizPhotoFile = null;
        _wizPhotoContext = null;
        _wizPersona = null;
        _wizJobId = null;
        _wizUploadText = null;
        if (_wizSseSource) { _wizSseSource.close(); _wizSseSource = null; }
        wizardRender();
        var wiz = document.getElementById('audience-wizard');
        wiz.style.display = '';
        wiz.addEventListener('click', function onBdClick(e) {
          if (e.target === wiz) closeAudienceWizard();
        }, { once: true });
        wizTab('handle');
      }

      function closeAudienceWizard() {
        if (_wizSseSource) { _wizSseSource.close(); _wizSseSource = null; }
        document.getElementById('audience-wizard').style.display = 'none';
        document.getElementById('audience-wizard-form').reset();
        var preview = document.getElementById('wiz-photo-preview');
        var placeholder = document.getElementById('wiz-photo-placeholder');
        if (preview) preview.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        showWizError('');
      }

      function wizardRender() {
        document.querySelectorAll('[data-wiz-step]').forEach(function(panel) {
          panel.classList.toggle('hidden', Number(panel.dataset.wizStep) !== _wizStep);
        });
        document.querySelectorAll('[data-step-circle]').forEach(function(el) {
          var idx = Number(el.dataset.stepCircle);
          el.className = 'step-circle ' + (idx < _wizStep ? 'done' : idx === _wizStep ? 'active' : 'pending');
        });
        document.querySelectorAll('[data-step-connector]').forEach(function(el) {
          el.className = 'step-connector flex-1 ' + (Number(el.dataset.stepConnector) < _wizStep ? 'done' : '');
        });
        var isProgress = (_wizStep === 2);
        var isLast = (_wizStep === _wizStepCount - 1);
        document.getElementById('wiz-back').classList.toggle('hidden', _wizStep === 0 || isProgress);
        document.getElementById('wiz-next').classList.toggle('hidden', _wizStep === 1 || isProgress || isLast);
        document.getElementById('wiz-investigate').classList.toggle('hidden', _wizStep !== 1);
        document.getElementById('wiz-submit').classList.toggle('hidden', !isLast);
        showWizError('');
      }

      function showWizError(msg) {
        var el = document.getElementById('wiz-error');
        el.textContent = msg;
        el.classList.toggle('hidden', !msg);
      }

      function validateWizardStep(step) {
        if (step === 0) {
          if (_wizTab === 'handle') {
            var handle = document.getElementById('wiz-handle')?.value.trim() ?? '';
            if (!handle) { showWizError('X/Twitter handle is required.'); return false; }
          }
          if (_wizTab === 'upload') {
            if (!_wizUploadText) { showWizError('Please select a .md or .txt file.'); return false; }
          }
          if (_wizTab === 'manual') {
            var role = document.getElementById('wiz-q1-role')?.value.trim() ?? '';
            var jtbd = document.getElementById('wiz-q2-jtbd')?.value.trim() ?? '';
            if (!role) { showWizError('Role + city is required.'); return false; }
            if (!jtbd) { showWizError('JTBD answer is required.'); return false; }
          }
        }
        if (step === 3) {
          var label = document.getElementById('wiz-review-label')?.value.trim() ?? '';
          if (!label) { showWizError('Audience Name is required.'); return false; }
        }
        if (step === 4) {
          var botToken = document.getElementById('wiz-bot-token')?.value.trim() ?? '';
          var chatId = document.getElementById('wiz-chat-id')?.value.trim() ?? '';
          if (!botToken) { showWizError('Telegram Bot Token is required.'); return false; }
          if (!chatId) { showWizError('Telegram Chat ID is required.'); return false; }
        }
        return true;
      }

      function wizardNext() {
        if (!validateWizardStep(_wizStep)) return;
        if (_wizStep < _wizStepCount - 1) { _wizStep++; wizardRender(); }
      }

      function wizardBack() {
        if (_wizStep > 0) { _wizStep--; wizardRender(); }
      }

      async function wizardInvestigate() {
        // Step 1 → analyse photo (if any) → start job → advance to step 2
        showWizError('');
        var btn = document.getElementById('wiz-investigate');
        btn.disabled = true;
        btn.textContent = 'Starting…';

        try {
          // Analyse photo if selected
          if (_wizPhotoFile && !_wizPhotoContext) {
            var b64 = await fileToBase64(_wizPhotoFile);
            var analysing = document.getElementById('wiz-photo-analyzing');
            if (analysing) analysing.classList.remove('hidden');
            var photoRes = await sendJson('/api/onboarding/photo', 'POST', {
              image_base64: b64,
              mime_type: _wizPhotoFile.type
            });
            _wizPhotoContext = photoRes;
            if (analysing) analysing.classList.add('hidden');
            renderPhotoChips(photoRes);
          }

          // Build mode-specific payload
          var payload = buildInvestigationPayload();

          // Start job
          var startRes = await sendJson('/api/onboarding/start', 'POST', {
            mode: _wizTab,
            payload,
            photo_context: _wizPhotoContext ?? null
          });
          _wizJobId = startRes.job_id;

          // Advance to progress step
          _wizStep = 2;
          wizardRender();

          // Open SSE stream
          wizardStartSse(_wizJobId);
        } catch (err) {
          showWizError(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Investigate →';
        }
      }

      function buildInvestigationPayload() {
        if (_wizTab === 'handle') {
          var handle = document.getElementById('wiz-handle')?.value.trim() ?? '';
          var github = document.getElementById('wiz-github')?.value.trim() ?? '';
          return { handle, github: github || null };
        }
        if (_wizTab === 'upload') {
          var uploadFile = document.getElementById('wiz-upload-file')?.files[0];
          return { text: _wizUploadText ?? '', filename: uploadFile?.name ?? 'report.txt' };
        }
        // manual
        var passions = Array.from(document.querySelectorAll('[name="q5_passions"]:checked')).map(function(el) { return el.value; });
        return {
          q1_role: document.getElementById('wiz-q1-role')?.value.trim() ?? '',
          q2_jtbd: document.getElementById('wiz-q2-jtbd')?.value.trim() ?? '',
          q3_wealth: document.querySelector('[name="q3_wealth"]:checked')?.value ?? '',
          q4_values: document.querySelector('[name="q4_values"]:checked')?.value ?? '',
          q5_passions: passions
        };
      }

      function renderPhotoChips(ctx) {
        var chips = document.getElementById('wiz-photo-chips');
        if (!chips || !ctx) return;
        var entries = [
          ctx.gender_presentation ? 'Gender: ' + ctx.gender_presentation : null,
          ctx.age_range ? 'Age: ' + ctx.age_range : null,
          ctx.skin_tone ? 'Skin tone: ' + ctx.skin_tone : null,
          ctx.build ? 'Build: ' + ctx.build : null,
          ctx.notable_features ? ctx.notable_features : null
        ].filter(Boolean);
        chips.innerHTML = entries.map(function(e) {
          return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">' + escapeHtml(e) + '</span>';
        }).join('');
        chips.classList.remove('hidden');
        chips.classList.add('flex');
      }

      function wizardStartSse(jobId) {
        var log = document.getElementById('wiz-progress-log');
        if (log) log.innerHTML = '';
        if (_wizSseSource) { _wizSseSource.close(); }

        var es = new EventSource('/api/onboarding/stream/' + encodeURIComponent(jobId));
        _wizSseSource = es;

        es.onmessage = function(e) {
          var event;
          try { event = JSON.parse(e.data); } catch { return; }
          if (event.type === 'progress') {
            wizAppendLog(event.label ?? '');
          } else if (event.type === 'complete') {
            _wizPersona = event.persona ?? null;
            es.close();
            _wizSseSource = null;
            wizardFillReviewStep();
            _wizStep = 3;
            wizardRender();
          } else if (event.type === 'error') {
            showWizError(event.label ?? 'Investigation failed');
            _wizStep = 1;
            wizardRender();
          }
        };

        es.onerror = function() {
          es.close();
          _wizSseSource = null;
          showWizError('Connection to investigation stream lost. Please try again.');
          _wizStep = 1;
          wizardRender();
        };
      }

      function wizAppendLog(label) {
        var log = document.getElementById('wiz-progress-log');
        if (!log) return;
        var line = document.createElement('div');
        line.className = 'text-gray-700 dark:text-gray-300';
        line.textContent = '✓ ' + label;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
      }

      function wizardFillReviewStep() {
        if (!_wizPersona) return;
        var bio = _wizPersona.biographical ?? {};
        var cog = _wizPersona.cognitive ?? {};
        var comm = _wizPersona.communication ?? {};
        var pers = _wizPersona.personalization ?? {};

        var setVal = function(id, val) {
          var el = document.getElementById(id);
          if (el && val) el.value = val;
        };
        setVal('wiz-review-label', bio.name?.value ?? '');
        setVal('wiz-review-location', bio.location?.value ?? '');
        setVal('wiz-review-tone', comm.preferred_tone ?? pers.tone ?? '');
        setVal('wiz-review-interests', (cog.interests ?? []).join(', '));
        setVal('wiz-review-pillars', (pers.topics ?? []).join(', '));
        setVal('wiz-review-excluded', (pers.anti_patterns ?? []).join(', '));

        var rawEl = document.getElementById('wiz-persona-raw');
        if (rawEl) rawEl.textContent = JSON.stringify(_wizPersona, null, 2);

        if (_wizPhotoContext) {
          var block = document.getElementById('wiz-photo-context-block');
          var text = document.getElementById('wiz-photo-context-text');
          var ctx = _wizPhotoContext;
          var desc = [
            ctx.gender_presentation, ctx.age_range, ctx.skin_tone ? 'skin tone: ' + ctx.skin_tone : null,
            ctx.build ? 'build: ' + ctx.build : null, ctx.notable_features
          ].filter(Boolean).join(', ');
          if (text) text.textContent = desc;
          if (block) block.classList.remove('hidden');
        }
      }

      async function wizardSubmit() {
        if (!validateWizardStep(_wizStep)) return;
        var btn = document.getElementById('wiz-submit');
        btn.disabled = true;
        btn.textContent = 'Creating…';
        showWizError('');

        try {
          // Build updated persona from review fields
          var label = document.getElementById('wiz-review-label')?.value.trim() ?? '';
          var location = document.getElementById('wiz-review-location')?.value.trim() ?? '';
          var tone = document.getElementById('wiz-review-tone')?.value.trim() ?? '';
          var interests = (document.getElementById('wiz-review-interests')?.value ?? '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          var pillars = (document.getElementById('wiz-review-pillars')?.value ?? '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          var excluded = (document.getElementById('wiz-review-excluded')?.value ?? '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);

          var persona = _wizPersona ? JSON.parse(JSON.stringify(_wizPersona)) : null;
          if (persona) {
            persona.biographical = persona.biographical ?? {};
            persona.biographical.name = { value: label, confidence: 1.0 };
            persona.biographical.location = { value: location, confidence: 1.0 };
            persona.cognitive = persona.cognitive ?? {};
            persona.cognitive.interests = interests;
            persona.communication = persona.communication ?? {};
            persona.communication.preferred_tone = tone;
            persona.personalization = persona.personalization ?? {};
            persona.personalization.topics = pillars;
            persona.personalization.anti_patterns = excluded;
          }

          var photoPayload = null;
          if (_wizPhotoFile) {
            var b64 = await fileToBase64(_wizPhotoFile);
            photoPayload = { file_name: _wizPhotoFile.name, mime_type: _wizPhotoFile.type, size_bytes: _wizPhotoFile.size, file_data_base64: b64 };
          }

          var payload = {
            details: {
              label,
              profile_raw_text: label
            },
            channels: {
              telegram_bot_token: document.getElementById('wiz-bot-token')?.value.trim() ?? '',
              telegram_chat_id: document.getElementById('wiz-chat-id')?.value.trim() ?? '',
              posting_schedule: document.getElementById('wiz-schedule')?.value ?? 'twice_daily',
              twitter_api_key: document.getElementById('wiz-twitter-api-key')?.value.trim() ?? '',
              twitter_api_secret: document.getElementById('wiz-twitter-api-secret')?.value.trim() ?? '',
              twitter_access_token: document.getElementById('wiz-twitter-access-token')?.value.trim() ?? '',
              twitter_access_token_secret: document.getElementById('wiz-twitter-access-token-secret')?.value.trim() ?? ''
            },
            photo: photoPayload,
            persona,
            photo_context: _wizPhotoContext ?? null
          };

          var result = await sendJson('/api/audiences/create-full', 'POST', payload);
          closeAudienceWizard();
          window.location.href = '/?tab=audiences&audience_id=' + encodeURIComponent(result.audience_id ?? '');
        } catch (err) {
          showWizError(err.message);
          btn.disabled = false;
          btn.textContent = 'Create Audience';
        }
      }

      // Photo drop zone wiring
      (function() {
        var dropZone = document.getElementById('wiz-drop-zone');
        var photoFile = document.getElementById('wiz-photo-file');
        if (!dropZone || !photoFile) return;
        dropZone.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('border-indigo-400'); });
        dropZone.addEventListener('dragleave', function() { this.classList.remove('border-indigo-400'); });
        dropZone.addEventListener('drop', function(e) {
          e.preventDefault(); this.classList.remove('border-indigo-400');
          var file = e.dataTransfer.files[0];
          if (file) { photoFile.files = e.dataTransfer.files; wizPhotoChanged(photoFile); }
        });
      })();
```

- [ ] **Step 2: Run tests and verify server**

```bash
npm test
node src/server.js &
sleep 2
curl -s http://localhost:4310/ | grep -q "wizardInvestigate" && echo "wizard js ok"
kill %1
```

Expected: tests pass, `wizard js ok`.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: replace wizard JS with 5-step SSE-driven state machine"
```

---

## Task 10: Create N8N workflow — `vivo-onboarding-photo`

**Files:** N8N (via MCP tools)

This workflow receives a base64 image from vivo-factory, calls GPT-4o Vision via OpenAI Responses API, and returns a structured physical description.

- [ ] **Step 1: Verify N8N health**

```bash
node -e "
const { execSync } = require('child_process');
// Use n8n MCP health check tool
console.log('checking n8n…');
"
```

Use the `mcp__n8n__n8n_health_check` MCP tool to confirm N8N is running.

- [ ] **Step 2: Create the workflow via MCP**

Use `mcp__n8n__n8n_create_workflow` with this workflow structure:

```json
{
  "name": "vivo-onboarding-photo",
  "active": true,
  "nodes": [
    {
      "id": "webhook",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [200, 300],
      "parameters": {
        "httpMethod": "POST",
        "path": "vivo-describe-hero",
        "responseMode": "responseNode",
        "options": {}
      }
    },
    {
      "id": "normalize",
      "name": "Normalize Input",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "parameters": {
        "jsCode": "const body = $input.first().json.body ?? $input.first().json;\nconst imageBase64 = body.image_base64 ?? '';\nconst mimeType = body.mime_type ?? 'image/jpeg';\nreturn [{ json: { image_base64: imageBase64, mime_type: mimeType } }];"
      }
    },
    {
      "id": "vision",
      "name": "OpenAI Vision",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [680, 300],
      "parameters": {
        "method": "POST",
        "url": "https://api.openai.com/v1/responses",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "openAiApi",
        "sendBody": true,
        "contentType": "json",
        "body": {
          "model": "gpt-4o",
          "input": [
            {
              "role": "user",
              "content": [
                {
                  "type": "input_image",
                  "image_url": "={{ 'data:' + $json.mime_type + ';base64,' + $json.image_base64 }}"
                },
                {
                  "type": "input_text",
                  "text": "Analyse this person's visible physical characteristics. Return ONLY a JSON object with these fields (no markdown, no explanation):\n{\n  \"gender_presentation\": \"male | female | androgynous | unclear\",\n  \"age_range\": \"teen | 20s | 30s | 40s | 50s_plus | unclear\",\n  \"skin_tone\": \"very_light | light | medium | dark | very_dark | unclear\",\n  \"ethnicity_presentation\": \"1-3 word visible cues only\",\n  \"build\": \"slim | average | athletic | broad | unclear\",\n  \"hair\": \"bald | short | medium | long | unclear\",\n  \"notable_features\": \"one sentence, non-sensitive visible traits only\"\n}"
                }
              ]
            }
          ]
        },
        "options": {}
      }
    },
    {
      "id": "parse",
      "name": "Parse Response",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [920, 300],
      "parameters": {
        "jsCode": "const output = $input.first().json.output ?? [];\nconst text = (output.find(o => o.type === 'message')?.content ?? []).find(c => c.type === 'output_text')?.text ?? '{}';\ntry {\n  const parsed = JSON.parse(text.trim());\n  return [{ json: parsed }];\n} catch {\n  return [{ json: { error: 'Failed to parse vision response', raw: text } }];\n}"
      }
    },
    {
      "id": "respond",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1160, 300],
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ $json }}"
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Normalize Input", "type": "main", "index": 0 }]] },
    "Normalize Input": { "main": [[{ "node": "OpenAI Vision", "type": "main", "index": 0 }]] },
    "OpenAI Vision": { "main": [[{ "node": "Parse Response", "type": "main", "index": 0 }]] },
    "Parse Response": { "main": [[{ "node": "Respond to Webhook", "type": "main", "index": 0 }]] }
  }
}
```

- [ ] **Step 3: Test the workflow**

```bash
curl -s -X POST http://localhost:5678/webhook/vivo-describe-hero \
  -H 'content-type: application/json' \
  -d '{"image_base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==","mime_type":"image/png"}' \
  | python3 -m json.tool
```

Expected: JSON with `gender_presentation`, `age_range`, etc. (values may be "unclear" for a 1x1 pixel test image).

- [ ] **Step 4: Commit note** (no code change — workflow lives in N8N)

```bash
git commit --allow-empty -m "chore: vivo-onboarding-photo N8N workflow created (webhook: vivo-describe-hero)"
```

---

## Task 11: Create N8N workflow — `vivo-onboarding-handle`

**Files:** N8N (via MCP tools)

Investigates an X/Twitter handle using OpenAI Responses API web_search_preview, then synthesises a canonical persona.

- [ ] **Step 1: Create workflow via MCP**

Use `mcp__n8n__n8n_create_workflow`:

```json
{
  "name": "vivo-onboarding-handle",
  "active": true,
  "nodes": [
    {
      "id": "webhook",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [200, 300],
      "parameters": {
        "httpMethod": "POST",
        "path": "vivo-onboarding-handle",
        "responseMode": "lastNode",
        "options": {}
      }
    },
    {
      "id": "extract",
      "name": "Extract Fields",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "parameters": {
        "jsCode": "const b = $input.first().json.body ?? $input.first().json;\nconst payload = b.payload ?? {};\nreturn [{ json: { handle: payload.handle ?? '', github: payload.github ?? null, photo_context: b.photo_context ?? null, job_id: b.job_id ?? '', callback_url: b.callback_url ?? '' } }];"
      }
    },
    {
      "id": "cb-start",
      "name": "Callback: Fetching profile",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [680, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $json.callback_url }}/api/onboarding/jobs/{{ $json.job_id }}/event",
        "sendBody": true,
        "contentType": "json",
        "body": { "label": "={{ 'Fetching X profile for @' + $json.handle }}" },
        "options": {}
      }
    },
    {
      "id": "research",
      "name": "OpenAI: Research handle",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [920, 300],
      "parameters": {
        "method": "POST",
        "url": "https://api.openai.com/v1/responses",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "openAiApi",
        "sendBody": true,
        "contentType": "json",
        "body": {
          "model": "gpt-4o",
          "tools": [{ "type": "web_search_preview" }],
          "input": "={{ 'Research @' + $('Extract Fields').first().json.handle + ' on X/Twitter. Find their bio, recent post themes, inferred professional context, and key interests. Return a structured summary with: bio, recent_themes (array), interests (array), tone, location.' }}"
        },
        "options": {}
      }
    },
    {
      "id": "cb-synth",
      "name": "Callback: Synthesising",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1160, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $('Extract Fields').first().json.callback_url }}/api/onboarding/jobs/{{ $('Extract Fields').first().json.job_id }}/event",
        "sendBody": true,
        "contentType": "json",
        "body": { "label": "Retrieved profile — synthesising persona…" },
        "options": {}
      }
    },
    {
      "id": "extract-research",
      "name": "Extract Research Text",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1400, 300],
      "parameters": {
        "jsCode": "const output = $('OpenAI: Research handle').first().json.output ?? [];\nconst text = (output.find(o => o.type === 'message')?.content ?? []).find(c => c.type === 'output_text')?.text ?? '';\nconst ctx = $('Extract Fields').first().json;\nreturn [{ json: { research_text: text, photo_context: ctx.photo_context, job_id: ctx.job_id, callback_url: ctx.callback_url, handle: ctx.handle } }];"
      }
    },
    {
      "id": "synthesise",
      "name": "OpenAI: Synthesise persona",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1640, 300],
      "parameters": {
        "method": "POST",
        "url": "https://api.openai.com/v1/responses",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "openAiApi",
        "sendBody": true,
        "contentType": "json",
        "body": {
          "model": "gpt-4o",
          "input": "={{ 'You are a persona analyst. Based on the following research about @' + $json.handle + ', produce a canonical persona JSON.\\n\\nResearch:\\n' + $json.research_text + (($json.photo_context) ? '\\n\\nPhysical context (from photo): ' + JSON.stringify($json.photo_context) : '') + '\\n\\nReturn ONLY a JSON object matching this schema exactly (no markdown, no explanation):\\n{\\n  \"biographical\": { \"name\": { \"value\": \"\", \"confidence\": 0.0 }, \"current_role\": { \"value\": \"\", \"confidence\": 0.0 }, \"location\": { \"value\": \"\", \"confidence\": 0.0 } },\\n  \"cognitive\": { \"thinking_style\": [], \"interests\": [] },\\n  \"communication\": { \"preferred_tone\": \"\", \"resonates_with\": [], \"tunes_out\": [] },\\n  \"motivations_values\": { \"core_motivations\": [], \"values\": [] },\\n  \"big_five\": { \"openness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"conscientiousness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"extraversion\": { \"value\": 0.0, \"confidence\": 0.0 }, \"agreeableness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"neuroticism\": { \"value\": 0.0, \"confidence\": 0.0 } },\\n  \"personalization\": { \"tone\": \"\", \"topics\": [], \"formats\": [], \"hooks\": [], \"anti_patterns\": [] },\\n  \"provenance\": { \"sources_used\": [\"x-twitter\"], \"compiled_at\": \"' + new Date().toISOString() + '\", \"compiler\": \"openai-responses-api / vivo-onboarding-v1\" }\\n}' }}"
        },
        "options": {}
      }
    },
    {
      "id": "parse-persona",
      "name": "Parse Persona",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1880, 300],
      "parameters": {
        "jsCode": "const output = $input.first().json.output ?? [];\nconst text = (output.find(o => o.type === 'message')?.content ?? []).find(c => c.type === 'output_text')?.text ?? '{}';\ntry {\n  const persona = JSON.parse(text.trim());\n  const ctx = $('Extract Fields').first().json;\n  return [{ json: { persona, job_id: ctx.job_id, callback_url: ctx.callback_url } }];\n} catch {\n  return [{ json: { error: 'parse failed', raw: text, job_id: $('Extract Fields').first().json.job_id, callback_url: $('Extract Fields').first().json.callback_url } }];\n}"
      }
    },
    {
      "id": "cb-complete",
      "name": "Callback: Complete",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [2120, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $json.callback_url }}/api/onboarding/jobs/{{ $json.job_id }}/complete",
        "sendBody": true,
        "contentType": "json",
        "body": { "persona": "={{ $json.persona }}" },
        "options": {}
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Extract Fields", "type": "main", "index": 0 }]] },
    "Extract Fields": { "main": [[{ "node": "Callback: Fetching profile", "type": "main", "index": 0 }]] },
    "Callback: Fetching profile": { "main": [[{ "node": "OpenAI: Research handle", "type": "main", "index": 0 }]] },
    "OpenAI: Research handle": { "main": [[{ "node": "Callback: Synthesising", "type": "main", "index": 0 }]] },
    "Callback: Synthesising": { "main": [[{ "node": "Extract Research Text", "type": "main", "index": 0 }]] },
    "Extract Research Text": { "main": [[{ "node": "OpenAI: Synthesise persona", "type": "main", "index": 0 }]] },
    "OpenAI: Synthesise persona": { "main": [[{ "node": "Parse Persona", "type": "main", "index": 0 }]] },
    "Parse Persona": { "main": [[{ "node": "Callback: Complete", "type": "main", "index": 0 }]] }
  }
}
```

- [ ] **Step 2: Verify workflow appears in N8N**

Use `mcp__n8n__n8n_list_workflows` and confirm `vivo-onboarding-handle` is listed and active.

- [ ] **Step 3: Commit note**

```bash
git commit --allow-empty -m "chore: vivo-onboarding-handle N8N workflow created"
```

---

## Task 12: Create N8N workflow — `vivo-onboarding-upload`

**Files:** N8N (via MCP tools)

Receives document text, sends to OpenAI Responses API for persona extraction, posts complete callback.

- [ ] **Step 1: Create workflow via MCP**

Use `mcp__n8n__n8n_create_workflow`:

```json
{
  "name": "vivo-onboarding-upload",
  "active": true,
  "nodes": [
    {
      "id": "webhook",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [200, 300],
      "parameters": {
        "httpMethod": "POST",
        "path": "vivo-onboarding-upload",
        "responseMode": "lastNode",
        "options": {}
      }
    },
    {
      "id": "extract",
      "name": "Extract Fields",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "parameters": {
        "jsCode": "const b = $input.first().json.body ?? $input.first().json;\nconst payload = b.payload ?? {};\nreturn [{ json: { text: payload.text ?? '', filename: payload.filename ?? 'report.txt', photo_context: b.photo_context ?? null, job_id: b.job_id ?? '', callback_url: b.callback_url ?? '' } }];"
      }
    },
    {
      "id": "cb-parsing",
      "name": "Callback: Parsing",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [680, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $json.callback_url }}/api/onboarding/jobs/{{ $json.job_id }}/event",
        "sendBody": true,
        "contentType": "json",
        "body": { "label": "={{ 'Parsing ' + $json.filename + '…' }}" },
        "options": {}
      }
    },
    {
      "id": "synthesise",
      "name": "OpenAI: Parse to persona",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [920, 300],
      "parameters": {
        "method": "POST",
        "url": "https://api.openai.com/v1/responses",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "openAiApi",
        "sendBody": true,
        "contentType": "json",
        "body": {
          "model": "gpt-4o",
          "input": "={{ 'Extract a canonical audience persona from the following document. ' + (($('Extract Fields').first().json.photo_context) ? 'Additional physical context from photo: ' + JSON.stringify($(\\'Extract Fields\\').first().json.photo_context) + '. ' : '') + 'Return ONLY a JSON object matching this schema (no markdown):\\n{\\n  \"biographical\": { \"name\": { \"value\": \"\", \"confidence\": 0.0 }, \"current_role\": { \"value\": \"\", \"confidence\": 0.0 }, \"location\": { \"value\": \"\", \"confidence\": 0.0 } },\\n  \"cognitive\": { \"thinking_style\": [], \"interests\": [] },\\n  \"communication\": { \"preferred_tone\": \"\", \"resonates_with\": [], \"tunes_out\": [] },\\n  \"motivations_values\": { \"core_motivations\": [], \"values\": [] },\\n  \"big_five\": { \"openness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"conscientiousness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"extraversion\": { \"value\": 0.0, \"confidence\": 0.0 }, \"agreeableness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"neuroticism\": { \"value\": 0.0, \"confidence\": 0.0 } },\\n  \"personalization\": { \"tone\": \"\", \"topics\": [], \"formats\": [], \"hooks\": [], \"anti_patterns\": [] },\\n  \"provenance\": { \"sources_used\": [\"uploaded-document\"], \"compiled_at\": \"' + new Date().toISOString() + '\", \"compiler\": \"openai-responses-api / vivo-onboarding-v1\" }\\n}\\n\\nDocument:\\n' + $('Extract Fields').first().json.text.slice(0, 8000) }}"
        },
        "options": {}
      }
    },
    {
      "id": "parse-persona",
      "name": "Parse Persona",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1160, 300],
      "parameters": {
        "jsCode": "const output = $input.first().json.output ?? [];\nconst text = (output.find(o => o.type === 'message')?.content ?? []).find(c => c.type === 'output_text')?.text ?? '{}';\ntry {\n  const persona = JSON.parse(text.trim());\n  const ctx = $('Extract Fields').first().json;\n  return [{ json: { persona, job_id: ctx.job_id, callback_url: ctx.callback_url } }];\n} catch {\n  const ctx = $('Extract Fields').first().json;\n  return [{ json: { error: 'parse failed', raw: text, job_id: ctx.job_id, callback_url: ctx.callback_url } }];\n}"
      }
    },
    {
      "id": "cb-complete",
      "name": "Callback: Complete",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1400, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $json.callback_url }}/api/onboarding/jobs/{{ $json.job_id }}/complete",
        "sendBody": true,
        "contentType": "json",
        "body": { "persona": "={{ $json.persona }}" },
        "options": {}
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Extract Fields", "type": "main", "index": 0 }]] },
    "Extract Fields": { "main": [[{ "node": "Callback: Parsing", "type": "main", "index": 0 }]] },
    "Callback: Parsing": { "main": [[{ "node": "OpenAI: Parse to persona", "type": "main", "index": 0 }]] },
    "OpenAI: Parse to persona": { "main": [[{ "node": "Parse Persona", "type": "main", "index": 0 }]] },
    "Parse Persona": { "main": [[{ "node": "Callback: Complete", "type": "main", "index": 0 }]] }
  }
}
```

- [ ] **Step 2: Verify workflow listed and active**

Use `mcp__n8n__n8n_list_workflows`.

- [ ] **Step 3: Commit note**

```bash
git commit --allow-empty -m "chore: vivo-onboarding-upload N8N workflow created"
```

---

## Task 13: Create N8N workflow — `vivo-onboarding-manual`

**Files:** N8N (via MCP tools)

Receives Q1–Q5 answers, synthesises canonical persona via OpenAI Responses API.

- [ ] **Step 1: Create workflow via MCP**

Use `mcp__n8n__n8n_create_workflow`:

```json
{
  "name": "vivo-onboarding-manual",
  "active": true,
  "nodes": [
    {
      "id": "webhook",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [200, 300],
      "parameters": {
        "httpMethod": "POST",
        "path": "vivo-onboarding-manual",
        "responseMode": "lastNode",
        "options": {}
      }
    },
    {
      "id": "extract",
      "name": "Extract Fields",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "parameters": {
        "jsCode": "const b = $input.first().json.body ?? $input.first().json;\nconst payload = b.payload ?? {};\nreturn [{ json: {\n  q1_role: payload.q1_role ?? '',\n  q2_jtbd: payload.q2_jtbd ?? '',\n  q3_wealth: payload.q3_wealth ?? '',\n  q4_values: payload.q4_values ?? '',\n  q5_passions: payload.q5_passions ?? [],\n  photo_context: b.photo_context ?? null,\n  job_id: b.job_id ?? '',\n  callback_url: b.callback_url ?? ''\n} }];"
      }
    },
    {
      "id": "cb-processing",
      "name": "Callback: Processing",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [680, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $json.callback_url }}/api/onboarding/jobs/{{ $json.job_id }}/event",
        "sendBody": true,
        "contentType": "json",
        "body": { "label": "Processing your answers…" },
        "options": {}
      }
    },
    {
      "id": "synthesise",
      "name": "OpenAI: Build persona",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [920, 300],
      "parameters": {
        "method": "POST",
        "url": "https://api.openai.com/v1/responses",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "openAiApi",
        "sendBody": true,
        "contentType": "json",
        "body": {
          "model": "gpt-4o",
          "input": "={{ 'Build a canonical audience persona from these onboarding answers.\\n\\nQ1 (Role + City): ' + $json.q1_role + '\\nQ2 (JTBD): ' + $json.q2_jtbd + '\\nQ3 (Premium driver): ' + $json.q3_wealth + '\\nQ4 (Trade-off): ' + $json.q4_values + '\\nQ5 (Passions): ' + ($json.q5_passions ?? []).join(', ') + (($json.photo_context) ? '\\n\\nPhysical context from photo: ' + JSON.stringify($json.photo_context) : '') + '\\n\\nReturn ONLY a JSON object matching this schema (no markdown):\\n{\\n  \"biographical\": { \"name\": { \"value\": \"\", \"confidence\": 0.0 }, \"current_role\": { \"value\": \"\", \"confidence\": 0.0 }, \"location\": { \"value\": \"\", \"confidence\": 0.0 } },\\n  \"cognitive\": { \"thinking_style\": [], \"interests\": [] },\\n  \"communication\": { \"preferred_tone\": \"\", \"resonates_with\": [], \"tunes_out\": [] },\\n  \"motivations_values\": { \"core_motivations\": [], \"values\": [] },\\n  \"big_five\": { \"openness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"conscientiousness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"extraversion\": { \"value\": 0.0, \"confidence\": 0.0 }, \"agreeableness\": { \"value\": 0.0, \"confidence\": 0.0 }, \"neuroticism\": { \"value\": 0.0, \"confidence\": 0.0 } },\\n  \"personalization\": { \"tone\": \"\", \"topics\": [], \"formats\": [], \"hooks\": [], \"anti_patterns\": [] },\\n  \"provenance\": { \"sources_used\": [\"manual-onboarding\"], \"compiled_at\": \"' + new Date().toISOString() + '\", \"compiler\": \"openai-responses-api / vivo-onboarding-v1\" }\\n}' }}"
        },
        "options": {}
      }
    },
    {
      "id": "parse-persona",
      "name": "Parse Persona",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1160, 300],
      "parameters": {
        "jsCode": "const output = $input.first().json.output ?? [];\nconst text = (output.find(o => o.type === 'message')?.content ?? []).find(c => c.type === 'output_text')?.text ?? '{}';\ntry {\n  const persona = JSON.parse(text.trim());\n  const ctx = $('Extract Fields').first().json;\n  return [{ json: { persona, job_id: ctx.job_id, callback_url: ctx.callback_url } }];\n} catch {\n  const ctx = $('Extract Fields').first().json;\n  return [{ json: { error: 'parse failed', job_id: ctx.job_id, callback_url: ctx.callback_url } }];\n}"
      }
    },
    {
      "id": "cb-complete",
      "name": "Callback: Complete",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1400, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $json.callback_url }}/api/onboarding/jobs/{{ $json.job_id }}/complete",
        "sendBody": true,
        "contentType": "json",
        "body": { "persona": "={{ $json.persona }}" },
        "options": {}
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Extract Fields", "type": "main", "index": 0 }]] },
    "Extract Fields": { "main": [[{ "node": "Callback: Processing", "type": "main", "index": 0 }]] },
    "Callback: Processing": { "main": [[{ "node": "OpenAI: Build persona", "type": "main", "index": 0 }]] },
    "OpenAI: Build persona": { "main": [[{ "node": "Parse Persona", "type": "main", "index": 0 }]] },
    "Parse Persona": { "main": [[{ "node": "Callback: Complete", "type": "main", "index": 0 }]] }
  }
}
```

- [ ] **Step 2: Verify all 4 N8N workflows are listed and active**

Use `mcp__n8n__n8n_list_workflows` — expect to see: `vivo-onboarding-photo`, `vivo-onboarding-handle`, `vivo-onboarding-upload`, `vivo-onboarding-manual`.

- [ ] **Step 3: Commit note**

```bash
git commit --allow-empty -m "chore: vivo-onboarding-manual N8N workflow created"
```

---

## Task 14: End-to-end smoke test

**Files:** none

- [ ] **Step 1: Start the server**

```bash
node src/server.js &
sleep 2
```

- [ ] **Step 2: Smoke-test the photo endpoint with vivo-factory as proxy**

```bash
# Encode a small test image
B64=$(base64 -w0 /dev/urandom | head -c 100)
curl -s -X POST http://localhost:4310/api/onboarding/photo \
  -H 'content-type: application/json' \
  -d "{\"image_base64\":\"${B64}\",\"mime_type\":\"image/jpeg\"}" \
  | python3 -m json.tool
```

Expected: response from N8N (may be an error for random bytes, but the round-trip should complete).

- [ ] **Step 3: Smoke-test SSE stream**

```bash
# Start a job
JOB=$(curl -s -X POST http://localhost:4310/api/onboarding/start \
  -H 'content-type: application/json' \
  -d '{"mode":"handle","payload":{"handle":"test-user"}}' | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
echo "Job: $JOB"

# Open SSE stream in background and capture events
curl -s -N "http://localhost:4310/api/onboarding/stream/${JOB}" &
SSE_PID=$!
sleep 1

# Post a test event
curl -s -X POST "http://localhost:4310/api/onboarding/jobs/${JOB}/event" \
  -H 'content-type: application/json' \
  -d '{"label":"Test event from smoke test"}' | grep -q "ok" && echo "event posted"

# Post complete
curl -s -X POST "http://localhost:4310/api/onboarding/jobs/${JOB}/complete" \
  -H 'content-type: application/json' \
  -d '{"persona":{"biographical":{"name":{"value":"Test","confidence":1.0}}}}' | grep -q "ok" && echo "complete posted"

sleep 1
kill $SSE_PID 2>/dev/null
```

Expected: `event posted`, `complete posted`, SSE process exits cleanly.

- [ ] **Step 4: Open browser and test wizard UI**

Navigate to `http://localhost:4310` and click "New Audience":
1. Verify 5 steps show in the stepper (Investigate / Photo / Progress / Review / Channels)
2. Verify tab switching works (Handle / Upload / Manual)
3. Verify Next button advances from step 0 to step 1
4. Verify photo drop zone appears on step 1
5. Verify "Investigate →" button appears on step 1

- [ ] **Step 5: Kill server and run full tests**

```bash
kill %1 2>/dev/null
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: audience onboarding wizard — 5-step with N8N investigation and SSE progress"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task covering it |
|---|---|
| Step 1 — Investigate (3 tabs: handle/upload/manual) | Tasks 8, 9 |
| Step 2 — Photo upload + N8N analysis chips | Tasks 8, 9, 10 |
| Step 3 — Progress SSE log, auto-advance | Tasks 1, 3, 9 |
| Step 4 — Review editable form | Tasks 8, 9 |
| Step 5 — Channels (existing) | Tasks 8, 9 |
| `POST /api/onboarding/photo` | Task 5 |
| `POST /api/onboarding/start` | Task 5 |
| `GET /api/onboarding/stream/:id` | Tasks 1, 3, 5 |
| `POST /api/onboarding/jobs/:id/event` | Task 5 |
| `POST /api/onboarding/jobs/:id/complete` | Task 5 |
| In-memory relay, 5-min TTL | Task 1 |
| SSE keep-alive every 20s | Task 1 |
| N8N `vivo-onboarding-photo` workflow | Task 10 |
| N8N `vivo-onboarding-handle` workflow | Task 11 |
| N8N `vivo-onboarding-upload` workflow | Task 12 |
| N8N `vivo-onboarding-manual` workflow | Task 13 |
| `config/runtime.json` N8N webhook config | Task 4 |
| Extend `create-full` with persona seeding | Task 7 |
| `personaToMarbleFacts` helper | Task 7 |
| server.js SSE hijack | Task 3 |

**Placeholder scan:** No TBDs or TODOs. All steps contain actual code or commands.

**Type consistency:** `onboardingRelay` object signature (`startJob`, `postEvent`, `complete`, `streamSSE`, `cancelJob`) defined in Task 1 and used consistently in Tasks 2, 3, 5, 6. `n8nConfig` object shape (four `_webhook` keys) defined in Task 4 and accessed by the same key names in Task 5. `persona` canonical JSON shape defined once and used consistently across Tasks 7, 9, 11, 12, 13.
