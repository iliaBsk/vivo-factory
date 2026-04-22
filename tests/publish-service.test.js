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
