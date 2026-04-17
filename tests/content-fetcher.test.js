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

test("fetchForAudience drops items with marble score below 0.3", async () => {
  const { createContentFetcher } = await import("../src/content-fetcher.js");
  const repo = await makeRepo();
  const fakeProfileClient = {
    selectItems: async (items) => ({
      ok: true,
      data: {
        selected: [
          { id: items[0].id, score: 0.9, rank: 1 },
          { id: items[1].id, score: 0.2, rank: 2 }
        ]
      },
      errors: []
    })
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

  const result = await fetcher.fetchForAudience(
    { id: "aud-1", location: "Barcelona" },
    { id: "inst-1", runtime_config: {} },
    { limit: 5 }
  );

  assert.equal(result.stories_created, 1, "item with score 0.2 should be dropped");
  const stories = repo.listStories({ audience_id: "aud-1" });
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
