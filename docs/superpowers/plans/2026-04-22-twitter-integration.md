# Twitter/X Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Twitter/X as a publish channel alongside Telegram — LLM-generated tweet posted first, then Telegram; both must succeed or the story transitions to `failed`.

**Architecture:** Two new files (`src/twitter-client.js`, `src/publish-service.js`) encapsulate Twitter OAuth and the dual-channel publish sequence. `app.js` `publish-recap` handler delegates to `publishService`. `server.js` constructs and injects the service. No new npm dependencies — OAuth 1.0a signing uses Node.js `crypto` built-in.

**Tech Stack:** Node.js built-ins (`node:crypto`, `node:test`, `node:assert/strict`), X API v2 `POST /2/tweets`, OpenAI Responses API, Telegram Bot API.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/twitter-client.js` | OAuth 1.0a signing, `generateTweet` (OpenAI), `postTweet` (X API v2) |
| Create | `src/publish-service.js` | Ordered dual-channel publish + atomic rollback |
| Create | `tests/twitter-client.test.js` | Unit tests for twitter-client |
| Create | `tests/publish-service.test.js` | Unit tests for publish-service |
| Modify | `src/app.js` | Wire `publishService` option; refactor `publish-recap` handler; add Twitter fields to settings panel and wizard |
| Modify | `src/server.js` | Import + construct `twitterClientFactory` and `publishService`; pass to `createApp` |
| Modify | `tests/dashboard.test.js` | Update two publish-recap tests to use `publishService` mock |
| Modify | `config/runtime.json` | Add four Twitter credential keys per audience |
| Modify | `generated/audience-managers/chontang.env` | Add four `TWITTER_*` env vars |
| Modify | `generated/audience-managers/aleks-barcelona-tech-ai-30s.env` | Add four `TWITTER_*` env vars |
| Modify | `generated/audience-managers/bald-high-man-early-40s-barcelona.env` | Add four `TWITTER_*` env vars |

---

### Task 1: Create `src/twitter-client.js` — skeleton + null when credentials missing

**Files:**
- Create: `src/twitter-client.js`
- Create: `tests/twitter-client.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/twitter-client.test.js
import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  const { createTwitterClient } = await import("../src/twitter-client.js");
  return { createTwitterClient };
}

test("createTwitterClient returns null when any credential is missing", async () => {
  const { createTwitterClient } = await loadModule();
  assert.equal(createTwitterClient({}), null);
  assert.equal(createTwitterClient({ apiKey: "k" }), null);
  assert.equal(createTwitterClient({ apiKey: "k", apiSecret: "s" }), null);
  assert.equal(
    createTwitterClient({ apiKey: "k", apiSecret: "s", accessToken: "t" }),
    null
  );
});

test("createTwitterClient returns client object when all four credentials present", async () => {
  const { createTwitterClient } = await loadModule();
  const client = createTwitterClient({
    apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts",
    fetchImpl: async () => {}
  });
  assert.ok(client !== null);
  assert.equal(typeof client.generateTweet, "function");
  assert.equal(typeof client.postTweet, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/twitter-client.test.js
```

Expected: `Cannot find module '../src/twitter-client.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/twitter-client.js
import { createHmac } from "node:crypto";

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

function buildOAuthHeader({ method, url, apiKey, apiSecret, accessToken, accessTokenSecret }) {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0"
  };
  const paramString = Object.keys(oauthParams).sort()
    .map(k => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`).join("&");
  const signatureBase = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(signatureBase).digest("base64");
  const withSig = { ...oauthParams, oauth_signature: signature };
  const headerParts = Object.keys(withSig).sort()
    .map(k => `${percentEncode(k)}="${percentEncode(withSig[k])}"`).join(", ");
  return `OAuth ${headerParts}`;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export function createTwitterClient({
  apiKey = "", apiSecret = "", accessToken = "", accessTokenSecret = "",
  fetchImpl = globalThis.fetch,
  openaiApiKey = "", openaiModel = "", openaiBaseUrl = "https://api.openai.com/v1"
} = {}) {
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  const base = String(openaiBaseUrl).replace(/\/+$/, "");

  return {
    async generateTweet(story) {
      const context = [story.title, story.summary ?? "", story.primary_source_url ?? ""]
        .filter(Boolean).join(" — ");
      const response = await fetchImpl(`${base}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${openaiApiKey}` },
        body: JSON.stringify({
          model: openaiModel,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: "Write a single tweet (max 280 characters) for this story. Include the URL if provided. Return only the tweet text, no quotes, no markdown." }]
            },
            { role: "user", content: [{ type: "input_text", text: context }] }
          ]
        })
      });
      if (!response.ok) {
        const err = await response.text().catch(() => "");
        throw new Error(`OpenAI tweet generation failed: ${response.status} ${err.slice(0, 100)}`);
      }
      const payload = await response.json();
      const text = extractOutputText(payload);
      if (!text) throw new Error("OpenAI returned empty response for tweet generation");
      return text.slice(0, 280);
    },

    async postTweet(text) {
      const url = "https://api.twitter.com/2/tweets";
      const authHeader = buildOAuthHeader({ method: "POST", url, apiKey, apiSecret, accessToken, accessTokenSecret });
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({ text })
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Twitter postTweet failed: ${response.status} ${errText.slice(0, 100)}`);
      }
      return response.json();
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/twitter-client.test.js
```

Expected: `# pass 2`

- [ ] **Step 5: Commit**

```bash
git add src/twitter-client.js tests/twitter-client.test.js
git commit -m "feat: add twitter-client skeleton with OAuth 1.0a and null-when-unconfigured"
```

---

### Task 2: Test and verify `postTweet` OAuth headers

**Files:**
- Modify: `tests/twitter-client.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/twitter-client.test.js`:

```js
test("postTweet POSTs to https://api.twitter.com/2/tweets with OAuth Authorization header", async () => {
  const { createTwitterClient } = await loadModule();
  const calls = [];
  const client = createTwitterClient({
    apiKey: "mykey", apiSecret: "mysecret",
    accessToken: "mytoken", accessTokenSecret: "mytokensecret",
    fetchImpl: async (url, opts) => {
      calls.push({ url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ data: { id: "123", text: "hello" } }) };
    }
  });

  await client.postTweet("Hello from vivo!");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.twitter.com/2/tweets");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.text, "Hello from vivo!");
  assert.ok(calls[0].headers.authorization.startsWith("OAuth "));
  assert.ok(calls[0].headers.authorization.includes("oauth_consumer_key"));
  assert.ok(calls[0].headers.authorization.includes("oauth_signature"));
});

test("postTweet throws when Twitter API returns non-2xx", async () => {
  const { createTwitterClient } = await loadModule();
  const client = createTwitterClient({
    apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts",
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => "Forbidden" })
  });

  await assert.rejects(
    () => client.postTweet("test"),
    (err) => err.message.includes("Twitter postTweet failed: 403")
  );
});
```

- [ ] **Step 2: Run to verify they pass** (they already exercise implemented code)

```bash
node --test tests/twitter-client.test.js
```

Expected: `# pass 4`

- [ ] **Step 3: Commit**

```bash
git add tests/twitter-client.test.js
git commit -m "test: add postTweet OAuth header and error tests"
```

---

### Task 3: Test and verify `generateTweet`

**Files:**
- Modify: `tests/twitter-client.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/twitter-client.test.js`:

```js
test("generateTweet calls OpenAI and returns text truncated to 280 chars", async () => {
  const { createTwitterClient } = await loadModule();
  const longText = "x".repeat(300);
  const client = createTwitterClient({
    apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts",
    openaiApiKey: "oai-key", openaiModel: "gpt-5.1",
    openaiBaseUrl: "https://api.openai.com/v1",
    fetchImpl: async (url) => {
      if (url.includes("/responses")) {
        return {
          ok: true,
          json: async () => ({ output_text: longText })
        };
      }
      return { ok: true, json: async () => ({}) };
    }
  });

  const story = { title: "Big news", summary: "Something happened", primary_source_url: "https://example.com/1" };
  const tweet = await client.generateTweet(story);
  assert.ok(tweet.length <= 280);
  assert.equal(tweet, longText.slice(0, 280));
});

test("generateTweet throws when OpenAI returns non-2xx", async () => {
  const { createTwitterClient } = await loadModule();
  const client = createTwitterClient({
    apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts",
    openaiApiKey: "oai-key", openaiModel: "gpt-5.1",
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => "Rate limit" })
  });

  await assert.rejects(
    () => client.generateTweet({ title: "Test" }),
    (err) => err.message.includes("OpenAI tweet generation failed: 429")
  );
});

test("generateTweet throws when OpenAI returns empty text", async () => {
  const { createTwitterClient } = await loadModule();
  const client = createTwitterClient({
    apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts",
    openaiApiKey: "oai-key", openaiModel: "gpt-5.1",
    fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: "" }) })
  });

  await assert.rejects(
    () => client.generateTweet({ title: "Test" }),
    (err) => err.message.includes("OpenAI returned empty response")
  );
});
```

- [ ] **Step 2: Run tests**

```bash
node --test tests/twitter-client.test.js
```

Expected: `# pass 7`

- [ ] **Step 3: Commit**

```bash
git add tests/twitter-client.test.js
git commit -m "test: add generateTweet tests — truncation, OpenAI error, empty response"
```

---

### Task 4: Create `src/publish-service.js` with full test coverage

**Files:**
- Create: `src/publish-service.js`
- Create: `tests/publish-service.test.js`

- [ ] **Step 1: Write all failing tests**

```js
// tests/publish-service.test.js
import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  const { createPublishService } = await import(`../src/publish-service.js?bust=${Date.now()}`);
  return { createPublishService };
}

function makeRepo(overrides = {}) {
  const transitions = [];
  const updates = [];
  return {
    transitions,
    updates,
    async transitionStoryStatus(id, status, meta) { transitions.push({ id, status, meta }); },
    async updateStory(id, changes, meta) { updates.push({ id, changes, meta }); },
    ...overrides
  };
}

const baseStory = {
  id: "story-1",
  title: "Big News",
  story_text: "Something great happened today.",
  summary: "Great news",
  primary_source_url: "https://example.com/1",
  metadata: {}
};

const baseAudienceConfig = {
  telegram_bot_token: "bot-token-123",
  telegram_chat_id: "@test_channel"
};

test("publishStory: Twitter first then Telegram, both succeed → published", async () => {
  const { createPublishService } = await loadModule();
  const repo = makeRepo();
  const calls = [];

  const twitterClient = {
    async generateTweet(story) { calls.push("generateTweet"); return "Test tweet"; },
    async postTweet(text) { calls.push(`postTweet:${text}`); }
  };

  const service = createPublishService({
    fetchImpl: async (url, opts) => {
      calls.push(`telegram:${url.includes("sendMessage") ? "sendMessage" : url}`);
      return { ok: true, text: async () => "" };
    },
    twitterClientFactory: () => twitterClient,
    repository: repo,
    clock: () => "2026-04-22T10:00:00.000Z"
  });

  await service.publishStory(baseStory, baseAudienceConfig);

  assert.deepEqual(calls, ["generateTweet", "postTweet:Test tweet", "telegram:sendMessage"]);
  assert.equal(repo.transitions.length, 1);
  assert.equal(repo.transitions[0].status, "published");
  assert.equal(repo.updates[0].changes.metadata.published_at, "2026-04-22T10:00:00.000Z");
});

test("publishStory: Twitter fails → transitions to failed, Telegram never called", async () => {
  const { createPublishService } = await loadModule();
  const repo = makeRepo();
  const telegramCalls = [];

  const twitterClient = {
    async generateTweet() { return "tweet"; },
    async postTweet() { throw new Error("Twitter 403 Forbidden"); }
  };

  const service = createPublishService({
    fetchImpl: async (url) => { telegramCalls.push(url); return { ok: true, text: async () => "" }; },
    twitterClientFactory: () => twitterClient,
    repository: repo,
    clock: () => "2026-04-22T10:00:00.000Z"
  });

  await assert.rejects(
    () => service.publishStory(baseStory, baseAudienceConfig),
    (err) => err.message.includes("Twitter 403 Forbidden")
  );

  assert.equal(telegramCalls.length, 0);
  assert.equal(repo.transitions.length, 1);
  assert.equal(repo.transitions[0].status, "failed");
});

test("publishStory: Telegram fails → transitions to failed", async () => {
  const { createPublishService } = await loadModule();
  const repo = makeRepo();

  const service = createPublishService({
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => "Internal error" }),
    twitterClientFactory: () => null,
    repository: repo,
    clock: () => "2026-04-22T10:00:00.000Z"
  });

  await assert.rejects(
    () => service.publishStory(baseStory, baseAudienceConfig),
    (err) => err.message.includes("Telegram sendMessage failed: 500")
  );

  assert.equal(repo.transitions.length, 1);
  assert.equal(repo.transitions[0].status, "failed");
});

test("publishStory: no Twitter credentials → skips Twitter, Telegram-only succeeds", async () => {
  const { createPublishService } = await loadModule();
  const repo = makeRepo();
  const calls = [];

  const service = createPublishService({
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, text: async () => "" };
    },
    twitterClientFactory: () => null,
    repository: repo,
    clock: () => "2026-04-22T10:00:00.000Z"
  });

  await service.publishStory(baseStory, baseAudienceConfig);

  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("api.telegram.org"));
  assert.equal(repo.transitions[0].status, "published");
});

test("publishStory: Telegram message includes title, text, and source URL", async () => {
  const { createPublishService } = await loadModule();
  const repo = makeRepo();
  let capturedBody;

  const service = createPublishService({
    fetchImpl: async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, text: async () => "" };
    },
    twitterClientFactory: () => null,
    repository: repo,
    clock: () => "2026-04-22T10:00:00.000Z"
  });

  await service.publishStory(baseStory, baseAudienceConfig);

  assert.ok(capturedBody.text.includes("Big News"));
  assert.ok(capturedBody.text.includes("Something great happened today."));
  assert.ok(capturedBody.text.includes("https://example.com/1"));
  assert.equal(capturedBody.chat_id, "@test_channel");
  assert.equal(capturedBody.parse_mode, "HTML");
});
```

- [ ] **Step 2: Run to verify all fail**

```bash
node --test tests/publish-service.test.js
```

Expected: `Cannot find module '../src/publish-service.js'`

- [ ] **Step 3: Implement `src/publish-service.js`**

```js
// src/publish-service.js

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function createPublishService({ fetchImpl, twitterClientFactory, repository, clock }) {
  const resolveTwitterClient = twitterClientFactory ?? (() => null);

  return {
    async publishStory(story, audienceConfig) {
      const botToken = String(audienceConfig?.telegram_bot_token ?? "").trim();
      const chatId = String(audienceConfig?.telegram_chat_id ?? "").trim();
      const twitterClient = resolveTwitterClient(audienceConfig ?? {});

      try {
        if (twitterClient) {
          const tweetText = await twitterClient.generateTweet(story);
          await twitterClient.postTweet(tweetText);
        }

        const message = [
          `<b>${escapeHtml(story.title)}</b>`,
          story.story_text ? escapeHtml(story.story_text.slice(0, 800)) : "",
          story.primary_source_url ? `<a href="${story.primary_source_url}">Read more</a>` : ""
        ].filter(Boolean).join("\n\n");

        const sendRes = await fetchImpl(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" })
          }
        );

        if (!sendRes.ok) {
          const errText = await sendRes.text().catch(() => "");
          throw new Error(`Telegram sendMessage failed: ${sendRes.status} ${errText.slice(0, 100)}`);
        }

        await repository.transitionStoryStatus(story.id, "published", {
          actorId: "system",
          timestamp: clock()
        });
        await repository.updateStory(story.id, {
          metadata: { ...story.metadata, published_at: clock() }
        }, { actorId: "system", timestamp: clock() });
      } catch (err) {
        try {
          await repository.transitionStoryStatus(story.id, "failed", {
            actorId: "system",
            timestamp: clock()
          });
        } catch {}
        throw err;
      }
    }
  };
}
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/publish-service.test.js
```

Expected: `# pass 5`

- [ ] **Step 5: Commit**

```bash
git add src/publish-service.js tests/publish-service.test.js
git commit -m "feat: add publish-service with Twitter-first dual-channel publish and rollback"
```

---

### Task 5: Wire `publishService` into `app.js` and `server.js`; update dashboard tests

**Files:**
- Modify: `src/app.js`
- Modify: `src/server.js`
- Modify: `tests/dashboard.test.js`

- [ ] **Step 1: Add `publishService` to `createApp` options and `handleRequest` context**

In `src/app.js`, find:
```js
export function createApp(options) {
  const repository = options.repository;
  const instanceManager = options.instanceManager ?? null;
  const profileClientFactory = options.profileClientFactory ?? null;
  const setupService = options.setupService ?? null;
  const audienceImportService = options.audienceImportService ?? null;
  const audienceManagerLauncher = options.audienceManagerLauncher ?? null;
  const publicationTargetResolver = options.publicationTargetResolver ?? (() => null);
  const clock = options.clock ?? (() => new Date().toISOString());
  const dispatchFetch = options.dispatchFetch ?? null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const audienceRuntimeConfig = options.audienceRuntimeConfig ?? {};
  const runtimeStatusService = options.runtimeStatusService ?? null;
```

Add `publishService` after `runtimeStatusService`:
```js
  const publishService = options.publishService ?? null;
```

Find the `return { async handle(request) {` block that calls `handleRequest(...)`. It passes an object with all context. Add `publishService` to that object:
```js
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
          publishService,   // ← add this line
          request
        });
```

In `async function handleRequest(context)`, add `publishService` to the destructuring:
```js
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
    publishService,   // ← add this line
    request
  } = context;
```

- [ ] **Step 2: Replace the `publish-recap` handler body (lines 751–815 of `src/app.js`)**

Replace the entire block from `if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/publish-recap$/))` through its closing `}` with:

```js
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/publish-recap$/)) {
    const audienceId = request.pathname.split("/")[3];
    let audience = await safeLoad(() => repository.getAudience(audienceId), null);
    if (!audience) {
      const all = await safeLoad(() => repository.listAudiences(), []);
      audience = all.find(a => a.audience_key === audienceId) ?? null;
    }
    if (!audience) return json(404, { error: "Audience not found" });

    const body = readBody(request.body);
    const instance = typeof repository.getInstanceByAudience === "function"
      ? await safeLoad(() => repository.getInstanceByAudience(audience.id), null)
      : null;

    const instanceRC = instance?.runtime_config ?? {};
    const runtimeRC = audienceRuntimeConfig?.[audience.audience_key] ?? {};
    const mergedConfig = { ...runtimeRC, ...instanceRC };

    const botToken = mergedConfig.telegram_bot_token ?? "";
    const chatId = mergedConfig.telegram_chat_id ?? "";
    if (!botToken || !chatId) {
      return json(409, { error: "No Telegram bot token or chat_id configured for this audience." });
    }

    const allReady = (await repository.listStories({ audience_id: audience.id }))
      .filter((s) => s.status === "ready_to_publish" && s.operator_review_status === "approved");
    const toPublish = body.story_ids?.length
      ? allReady.filter((s) => body.story_ids.includes(s.id))
      : allReady;

    let published = 0;
    for (const story of toPublish) {
      try {
        await publishService.publishStory(story, mergedConfig);
        published++;
      } catch (err) {
        console.error(`[publish-recap] Failed to publish story ${story.id}:`, err.message);
      }
    }
    return json(200, { published });
  }
```

- [ ] **Step 3: Add `twitter_*` keys to `INSTANCE_SETTABLE_KEYS` in `src/app.js`**

Find the array at line ~990:
```js
    "telegram_report_chat_id",
    "llm_provider",
```

Add four keys after `"telegram_report_chat_id"`:
```js
    "telegram_report_chat_id",
    "twitter_api_key",
    "twitter_api_secret",
    "twitter_access_token",
    "twitter_access_token_secret",
    "llm_provider",
```

- [ ] **Step 4: Wire `publishService` into `src/server.js`**

Add imports at the top of `src/server.js` after the existing imports:
```js
import { createTwitterClient } from "./twitter-client.js";
import { createPublishService } from "./publish-service.js";
```

Add `publishService` construction after `runtimeStatusService` construction:
```js
const publishService = createPublishService({
  fetchImpl: globalThis.fetch,
  twitterClientFactory: (audienceConfig) => createTwitterClient({
    apiKey: audienceConfig.twitter_api_key ?? "",
    apiSecret: audienceConfig.twitter_api_secret ?? "",
    accessToken: audienceConfig.twitter_access_token ?? "",
    accessTokenSecret: audienceConfig.twitter_access_token_secret ?? "",
    fetchImpl: globalThis.fetch,
    openaiApiKey: envConfig.OPENAI_API_KEY ?? "",
    openaiModel: envConfig.OPENAI_MODEL ?? envConfig.LLM_MODEL ?? "",
    openaiBaseUrl: envConfig.OPENAI_BASE_URL ?? envConfig.LLM_BASE_URL ?? "https://api.openai.com/v1"
  }),
  repository,
  clock: () => new Date().toISOString()
});
```

In the `createApp({...})` call, add `publishService`:
```js
const app = createApp({
  repository,
  instanceManager,
  profileClientFactory,
  setupService,
  audienceImportService,
  audienceManagerLauncher,
  audienceRuntimeConfig: runtimeConfig.audiences ?? {},
  runtimeStatusService,
  publishService,           // ← add this line
  dispatchFetch,
  fetchImpl: globalThis.fetch,
  publicationTargetResolver(audience, story) {
    // ... existing unchanged
  },
  clock: () => new Date().toISOString()
});
```

- [ ] **Step 5: Update `tests/dashboard.test.js` — fix the two publish-recap tests**

Find and replace the test at line 1200 (`"POST /api/audiences/:id/publish-recap publishes ready_to_publish+approved stories"`):

```js
test("POST /api/audiences/:id/publish-recap publishes ready_to_publish+approved stories", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({
    audiences: seed.audiences,
    instances: [{
      ...seed.instances[0],
      openclaw_admin_url: "http://127.0.0.1:18801",
      runtime_config: {
        telegram_bot_token: "test-bot-token",
        telegram_chat_id: "@test_channel"
      }
    }]
  });
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

  const publishedStories = [];
  const mockPublishService = {
    async publishStory(s, audienceConfig) {
      publishedStories.push({ story: s, audienceConfig });
      await repo.transitionStoryStatus(s.id, "published", { actorId: "system", timestamp: "2026-04-22T10:00:00.000Z" });
      await repo.updateStory(s.id, { metadata: { published_at: "2026-04-22T10:00:00.000Z" } }, { actorId: "system", timestamp: "2026-04-22T10:00:00.000Z" });
    }
  };

  const app = createApp({
    repository: repo,
    clock: () => "2026-04-22T10:00:00.000Z",
    publishService: mockPublishService
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
  assert.equal(publishedStories.length, 1);
  assert.equal(publishedStories[0].story.id, story.id);
  assert.equal(publishedStories[0].audienceConfig.telegram_bot_token, "test-bot-token");
  const published = repo.getStory(story.id);
  assert.equal(published.status, "published");
});
```

Find and replace the test at line 1246 (`"POST /api/audiences/:id/publish-recap transitions story to failed when OpenClaw returns non-2xx"`):

```js
test("POST /api/audiences/:id/publish-recap transitions story to failed when publishService throws", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({
    audiences: seed.audiences,
    instances: [{
      ...seed.instances[0],
      openclaw_admin_url: "http://127.0.0.1:18801",
      runtime_config: {
        telegram_bot_token: "test-bot-token",
        telegram_chat_id: "@test_channel"
      }
    }]
  });
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "recap-fail-1", title: "Failing Story",
    story_text: "This send will fail.", summary: "Fail",
    source_kind: "rss", primary_source_url: "https://example.com/fail"
  });
  repo.transitionStoryStatus(story.id, "ready_to_publish");
  repo.submitStoryReview(story.id, {
    review_status: "approved", review_notes: "", actor_id: "op-1", selected_asset_id: null, payload: {}
  });

  const mockPublishService = {
    async publishStory(s) {
      await repo.transitionStoryStatus(s.id, "failed", { actorId: "system", timestamp: "2026-04-22T10:00:00.000Z" });
      throw new Error("Telegram sendMessage failed: 500");
    }
  };

  const app = createApp({
    repository: repo,
    clock: () => "2026-04-22T10:00:00.000Z",
    publishService: mockPublishService
  });

  const result = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/publish-recap",
    query: {},
    body: ""
  });

  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.published, 0);
  const failed = repo.getStory(story.id);
  assert.equal(failed.status, "failed");
});
```

- [ ] **Step 6: Run all tests**

```bash
node --test tests/twitter-client.test.js tests/publish-service.test.js tests/dashboard.test.js
```

Expected: `# pass` count matches previous pass count for dashboard tests (pre-existing failures in audience workspace tests are unrelated and should remain unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/app.js src/server.js tests/dashboard.test.js
git commit -m "feat: wire publishService into app.js and server.js; refactor publish-recap handler"
```

---

### Task 6: Update `config/runtime.json` and audience `.env` files

**Files:**
- Modify: `config/runtime.json`
- Modify: `generated/audience-managers/chontang.env`
- Modify: `generated/audience-managers/aleks-barcelona-tech-ai-30s.env`
- Modify: `generated/audience-managers/bald-high-man-early-40s-barcelona.env`

- [ ] **Step 1: Add Twitter credential keys to each audience in `config/runtime.json`**

For each of the four audience entries (`bald-high-man-early-40s-barcelona`, `aleks-barcelona-tech-ai-30s`, `chontang`, `a16z-andrew-chen-applied-mathematics-from-the-university-of-washington`), add after `telegram_report_chat_id` (or `telegram_chat_id`):

```json
"twitter_api_key": "",
"twitter_api_secret": "",
"twitter_access_token": "",
"twitter_access_token_secret": ""
```

- [ ] **Step 2: Add Twitter env vars to each audience `.env` file**

Append to `generated/audience-managers/chontang.env`:
```
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_TOKEN_SECRET=
```

Append to `generated/audience-managers/aleks-barcelona-tech-ai-30s.env`:
```
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_TOKEN_SECRET=
```

Append to `generated/audience-managers/bald-high-man-early-40s-barcelona.env`:
```
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_TOKEN_SECRET=
```

- [ ] **Step 3: Commit**

```bash
git add config/runtime.json generated/audience-managers/chontang.env generated/audience-managers/aleks-barcelona-tech-ai-30s.env generated/audience-managers/bald-high-man-early-40s-barcelona.env
git commit -m "chore: add Twitter credential placeholders to runtime.json and audience env files"
```

---

### Task 7: Dashboard UI — audience settings panel Twitter fields

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add four Twitter fields to the audience settings panel**

In `src/app.js`, find (around line 3031):
```js
      <label class="block"><span class="${labelClass}">Telegram Channel ID</span><input name="telegram_chat_id" value="${value("telegram_chat_id")}" placeholder="-100..." required class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Telegram Report ID</span>
```

After the Telegram Channel ID label, add:
```js
      <label class="block"><span class="${labelClass}">Telegram Channel ID</span><input name="telegram_chat_id" value="${value("telegram_chat_id")}" placeholder="-100..." required class="${inputClass}" /></label>
      <label class="block col-span-2"><span class="${labelClass}">Twitter / X API Key <span class="font-normal normal-case text-gray-400">(optional)</span></span><input name="twitter_api_key" value="${value("twitter_api_key")}" autocomplete="off" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Twitter / X API Secret</span><input name="twitter_api_secret" value="${value("twitter_api_secret")}" autocomplete="off" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Twitter / X Access Token</span><input name="twitter_access_token" value="${value("twitter_access_token")}" autocomplete="off" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Twitter / X Access Token Secret</span><input name="twitter_access_token_secret" value="${value("twitter_access_token_secret")}" autocomplete="off" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Telegram Report ID</span>
```

- [ ] **Step 2: Run dashboard tests to verify UI change doesn't break anything**

```bash
node --test tests/dashboard.test.js
```

Expected: same pass/fail counts as after Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: add Twitter/X credential fields to audience settings panel"
```

---

### Task 8: Dashboard UI — setup wizard optional Twitter step

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add optional Twitter fields to wizard step 2**

In `src/app.js`, find the `step2` variable (around line 2306) ending with `</div>\`;`. Add four optional Twitter fields inside the step2 div, after the posting schedule select:

```js
  const step2 = `
    <div class="space-y-4">
      <div>
        <label class="label" for="wiz-bot-token">Telegram Bot Token *</label>
        <input id="wiz-bot-token" name="telegram_bot_token" class="input font-mono" placeholder="123456:ABC-DEF..." />
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Get from @BotFather on Telegram</p>
      </div>
      <div>
        <label class="label" for="wiz-chat-id">Telegram Chat ID *</label>
        <input id="wiz-chat-id" name="telegram_chat_id" class="input font-mono" placeholder="-100123456789" />
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Channel or group ID where posts will be sent</p>
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
          <p class="text-xs text-gray-400 dark:text-gray-500">Add credentials to cross-post to Twitter/X. Leave blank to use Telegram only. Each audience needs its own Twitter account and OAuth 1.0a tokens from the X Developer Portal.</p>
          <div>
            <label class="label" for="wiz-twitter-api-key">API Key</label>
            <input id="wiz-twitter-api-key" name="twitter_api_key" class="input font-mono" placeholder="consumer key" autocomplete="off" />
          </div>
          <div>
            <label class="label" for="wiz-twitter-api-secret">API Secret</label>
            <input id="wiz-twitter-api-secret" name="twitter_api_secret" class="input font-mono" placeholder="consumer secret" autocomplete="off" />
          </div>
          <div>
            <label class="label" for="wiz-twitter-access-token">Access Token</label>
            <input id="wiz-twitter-access-token" name="twitter_access_token" class="input font-mono" placeholder="user access token" autocomplete="off" />
          </div>
          <div>
            <label class="label" for="wiz-twitter-access-token-secret">Access Token Secret</label>
            <input id="wiz-twitter-access-token-secret" name="twitter_access_token_secret" class="input font-mono" placeholder="user access token secret" autocomplete="off" />
          </div>
        </div>
      </details>
    </div>`;
```

- [ ] **Step 2: Update the wizard submit handler to include Twitter credentials in the `channels` payload**

Find the wizard submit section that builds the `channels` object (around line 2850). It currently reads:
```js
            channels: {
              telegram_bot_token: form.telegram_bot_token.value.trim(),
              telegram_chat_id: form.telegram_chat_id.value.trim(),
              posting_schedule: form.posting_schedule?.value ?? 'twice_daily'
            },
```

Replace with:
```js
            channels: {
              telegram_bot_token: form.telegram_bot_token.value.trim(),
              telegram_chat_id: form.telegram_chat_id.value.trim(),
              posting_schedule: form.posting_schedule?.value ?? 'twice_daily',
              twitter_api_key: form.twitter_api_key?.value?.trim() ?? '',
              twitter_api_secret: form.twitter_api_secret?.value?.trim() ?? '',
              twitter_access_token: form.twitter_access_token?.value?.trim() ?? '',
              twitter_access_token_secret: form.twitter_access_token_secret?.value?.trim() ?? ''
            },
```

- [ ] **Step 3: Update `POST /api/audiences/create-full` handler to forward Twitter credentials**

In `src/app.js`, find the `create-full` handler (added in the current uncommitted changes). Find where it reads the `channels` object and passes to `createAudience`. Currently it passes:
```js
      channels: { telegram_bot_token: botToken, telegram_chat_id: chatId, posting_schedule: channels.posting_schedule ?? "twice_daily" }
```

Replace with:
```js
      channels: {
        telegram_bot_token: botToken,
        telegram_chat_id: chatId,
        posting_schedule: channels.posting_schedule ?? "twice_daily",
        twitter_api_key: String(channels.twitter_api_key ?? "").trim(),
        twitter_api_secret: String(channels.twitter_api_secret ?? "").trim(),
        twitter_access_token: String(channels.twitter_access_token ?? "").trim(),
        twitter_access_token_secret: String(channels.twitter_access_token_secret ?? "").trim()
      }
```

- [ ] **Step 4: Run all tests**

```bash
node --test tests/twitter-client.test.js tests/publish-service.test.js tests/dashboard.test.js
```

Expected: same pass/fail counts as Task 5 step 6.

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: add optional Twitter/X fields to audience creation wizard"
```

---

### Task 9: Full test suite run and final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

- [ ] **Step 2: Verify server restarts cleanly**

```bash
pkill -f "node.*server.js" 2>/dev/null; npm start &
sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:4310/
```

Expected: `200`

- [ ] **Step 3: Verify the audience settings panel shows Twitter fields**

Open browser to `http://localhost:4310`. Navigate to any audience → click the settings gear. Confirm four Twitter/X input fields appear below the Telegram fields.

- [ ] **Step 4: Final commit if any clean-up needed**

```bash
npm test
git add -p  # stage only intended changes
git commit -m "chore: final cleanup for Twitter/X integration"
```
