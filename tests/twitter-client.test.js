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

test("generateTweet calls OpenAI and returns text truncated to 280 chars", async () => {
  const { createTwitterClient } = await loadModule();
  const longText = "x".repeat(300);
  const client = createTwitterClient({
    apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts",
    openaiApiKey: "oai-key", openaiModel: "gpt-5.1",
    openaiBaseUrl: "https://api.openai.com/v1",
    fetchImpl: async (url) => {
      if (url.includes("/responses")) {
        return { ok: true, json: async () => ({ output_text: longText }) };
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
