import test from "node:test";
import assert from "node:assert/strict";

async function loadRepo() {
  const { createRepository } = await import("../src/repository.js");
  return createRepository({
    audiences: [{
      id: "aud-1", audience_key: "bcn", label: "Barcelona", language: "en",
      location: "Barcelona", family_context: "", interests: [], content_pillars: [],
      excluded_topics: [], tone: "helpful", profile_snapshot: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }],
    instances: [{
      id: "inst-1", factory_id: "factory-1", audience_id: "aud-1",
      instance_key: "bcn-openclaw", service_name: "bcn-openclaw",
      openclaw_admin_url: "http://127.0.0.1:18801", profile_base_url: "http://127.0.0.1:5401",
      runtime_config: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }]
  });
}

test("createStory creates a story with status=new and operator_review_status=pending", async () => {
  const repo = await loadRepo();

  const story = repo.createStory({
    factory_id: "factory-1",
    audience_id: "aud-1",
    instance_id: "inst-1",
    story_key: "sha1-abc123",
    title: "Test News",
    story_text: "This is a test news story from Barcelona.",
    summary: "Test news story",
    source_kind: "rss",
    primary_source_url: "https://example.com/news1",
    is_deal: false,
    is_local: true,
    metadata: { marble_score: 0.87, source_id: "bcn-news-lv" }
  }, { timestamp: "2026-04-17T09:00:00.000Z" });

  assert.ok(story.id, "should have an id");
  assert.equal(story.story_key, "sha1-abc123");
  assert.equal(story.status, "new");
  assert.equal(story.operator_review_status, "pending");
  assert.equal(story.title, "Test News");
  assert.equal(story.source_kind, "rss");
  assert.equal(story.is_local, true);
  assert.equal(story.metadata.marble_score, 0.87);
});

test("createStory throws when story_key is missing", async () => {
  const repo = await loadRepo();
  assert.throws(
    () => repo.createStory({ audience_id: "aud-1", title: "T" }),
    /story_key is required/
  );
});

test("createStory throws when audience_id is missing", async () => {
  const repo = await loadRepo();
  assert.throws(
    () => repo.createStory({ story_key: "key-x", title: "T" }),
    /audience_id is required/
  );
});

test("createStory throws when title is missing", async () => {
  const repo = await loadRepo();
  assert.throws(
    () => repo.createStory({ story_key: "key-y", audience_id: "aud-1" }),
    /title is required/
  );
});

test("transitionStoryStatus throws on invalid status string", async () => {
  const repo = await loadRepo();
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "key-invalid-status",
    title: "T", story_text: "S", summary: "U", source_kind: "rss",
    primary_source_url: "https://example.com/invalid"
  });
  assert.throws(
    () => repo.transitionStoryStatus(story.id, "not_a_real_status"),
    /Invalid story status/
  );
});

test("createStory throws on duplicate story_key", async () => {
  const repo = await loadRepo();
  const base = {
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "unique-key-1", title: "A", story_text: "B", summary: "C",
    source_kind: "rss", primary_source_url: "https://example.com/1"
  };
  repo.createStory(base);
  assert.throws(() => repo.createStory(base), /story_key/);
});

test("transitionStoryStatus changes story status", async () => {
  const repo = await loadRepo();
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "key-2",
    title: "T", story_text: "S", summary: "U", source_kind: "rss",
    primary_source_url: "https://example.com/2"
  });

  const updated = repo.transitionStoryStatus(story.id, "ready_to_publish", {
    actorId: "system", timestamp: "2026-04-17T10:00:00.000Z"
  });

  assert.equal(updated.status, "ready_to_publish");
  assert.equal(updated.updated_at, "2026-04-17T10:00:00.000Z");
});

test("submitStoryReview auto-transitions to ready_to_publish on approved (no assets)", async () => {
  const repo = await loadRepo();
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "key-3",
    title: "T", story_text: "S", summary: "U", source_kind: "rss",
    primary_source_url: "https://example.com/3"
  });

  repo.submitStoryReview(story.id, {
    review_status: "approved",
    review_notes: "looks good",
    actor_id: "operator-1",
    selected_asset_id: null,
    payload: {}
  });

  const updated = repo.getStory(story.id);
  assert.equal(updated.operator_review_status, "approved");
  assert.equal(updated.status, "ready_to_publish");
});

test("submitStoryReview auto-transitions to archived on rejected", async () => {
  const repo = await loadRepo();
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "key-4",
    title: "T", story_text: "S", summary: "U", source_kind: "rss",
    primary_source_url: "https://example.com/4"
  });

  repo.submitStoryReview(story.id, {
    review_status: "rejected",
    review_notes: "not relevant",
    actor_id: "operator-1",
    selected_asset_id: null,
    payload: {}
  });

  const updated = repo.getStory(story.id);
  assert.equal(updated.operator_review_status, "rejected");
  assert.equal(updated.status, "archived");
});
