import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";

async function loadModules() {
  try {
    const [repositoryModule, appModule] = await Promise.all([
      import("../src/repository.js"),
      import("../src/app.js")
    ]);
    return { ...repositoryModule, ...appModule };
  } catch (error) {
    assert.fail(`expected dashboard modules to exist: ${error.message}`);
  }
}

function createSeed() {
  return {
    audiences: [
      {
        id: "aud-1",
        audience_key: "barcelona-family",
        label: "Barcelona Family",
        language: "en",
        location: "Barcelona",
        family_context: "Married with one child",
        interests: ["beachwear"],
        content_pillars: ["family plans"],
        excluded_topics: [],
        tone: "helpful",
        profile_snapshot: { mood: "practical" },
        status: "active",
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z"
      }
    ],
    instances: [
      {
        id: "inst-1",
        factory_id: "factory-1",
        audience_id: "aud-1",
        instance_key: "barcelona-family-openclaw",
        service_name: "barcelona-family-openclaw",
        openclaw_admin_url: "http://127.0.0.1:7601",
        profile_base_url: "http://127.0.0.1:5401",
        runtime_config: {},
        status: "active",
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z"
      }
    ],
    stories: [
      {
        id: "story-1",
        factory_id: "factory-1",
        audience_id: "aud-1",
        instance_id: "inst-1",
        story_key: "story-1",
        title: "Beachwear picks",
        story_text: "Pack light for the coast.",
        summary: "Beachwear summary",
        status: "ready_to_publish",
        operator_review_status: "pending",
        operator_reviewed_at: null,
        operator_reviewed_by: null,
        operator_review_note: "",
        metadata: { campaign: "spring" },
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z"
      },
      {
        id: "story-2",
        factory_id: "factory-1",
        audience_id: "aud-1",
        instance_id: "inst-1",
        story_key: "story-2",
        title: "Sportswear picks",
        story_text: "Comfort first.",
        summary: "Sportswear summary",
        status: "asset_generating",
        operator_review_status: "changes_requested",
        operator_reviewed_at: "2026-03-20T10:00:00.000Z",
        operator_reviewed_by: "operator@example.com",
        operator_review_note: "Need a stronger image.",
        metadata: { campaign: "fitness" },
        created_at: "2026-03-20T10:00:00.000Z",
        updated_at: "2026-03-20T10:00:00.000Z"
      }
    ],
    storyAssets: [
      {
        id: "asset-1",
        story_id: "story-1",
        asset_slot: "hero",
        asset_type: "image",
        decision: "generate",
        status: "ready",
        is_required: true,
        is_selected: true,
        mime_type: "image/png",
        width: 1080,
        height: 1920,
        duration_seconds: null,
        checksum: "abc",
        source_asset_url: null,
        storage_object_id: "storage-1",
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z"
      },
      {
        id: "asset-2",
        story_id: "story-1",
        asset_slot: "backup",
        asset_type: "image",
        decision: "take_existing",
        status: "ready",
        is_required: false,
        is_selected: false,
        mime_type: "image/jpeg",
        width: 1200,
        height: 1600,
        duration_seconds: null,
        checksum: "def",
        source_asset_url: "https://example.com/image.jpg",
        storage_object_id: null,
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z"
      }
    ],
    storageObjects: [
      {
        id: "storage-1",
        bucket_name: "vivo-content",
        object_path: "stories/story-1/hero.png",
        file_name: "hero.png",
        mime_type: "image/png",
        size_bytes: 123,
        width: 1080,
        height: 1920,
        duration_seconds: null,
        checksum: "abc",
        download_url: "https://cdn.example.com/stories/story-1/hero.png",
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z"
      }
    ],
    storyReviews: [],
    storyPublications: [],
    auditEvents: [],
    feedbackEvents: [],
    instanceReports: [],
    operatorChats: [],
    deployments: []
  };
}

test("repository tracks review history, selected assets, audience edits, and publication queueing", async () => {
  const { createRepository } = await loadModules();
  const repository = createRepository(createSeed());

  const updatedStory = repository.updateStory("story-1", {
    title: "Updated beachwear picks",
    summary: "Sharper summary"
  });
  assert.equal(updatedStory.title, "Updated beachwear picks");
  assert.equal(repository.getStory("story-1").instance.service_name, "barcelona-family-openclaw");

  const updatedAudience = repository.updateAudience("aud-1", {
    tone: "direct",
    profile_snapshot: { mood: "decisive" }
  }, {
    actorId: "operator@example.com",
    timestamp: "2026-03-21T11:00:00.000Z"
  });
  assert.equal(updatedAudience.tone, "direct");

  const selectedAsset = repository.selectStoryAsset("story-1", "asset-2", {
    actorId: "operator@example.com",
    timestamp: "2026-03-21T11:01:00.000Z"
  });
  assert.equal(selectedAsset.id, "asset-2");
  assert.equal(repository.getStory("story-1").assets.find((asset) => asset.id === "asset-1").is_selected, false);

  const replacedAsset = repository.replaceStoryAsset("story-1", "asset-2", {
    file_name: "replacement.png",
    mime_type: "image/png",
    size_bytes: 456,
    width: 1080,
    height: 1920,
    file_data_base64: Buffer.from("replacement-image").toString("base64")
  }, {
    actorId: "operator@example.com",
    bucketName: "vivo-content",
    timestamp: "2026-03-21T11:02:00.000Z"
  });
  assert.equal(replacedAsset.storage_object.file_name, "replacement.png");

  const review = repository.submitStoryReview("story-1", {
    review_status: "approved",
    review_notes: "Ready for queueing.",
    actor_id: "operator@example.com",
    selected_asset_id: "asset-2",
    payload: { source: "dashboard" },
    created_at: "2026-03-21T11:03:00.000Z"
  });
  assert.equal(review.review_status, "approved");
  assert.equal(repository.getStory("story-1").operator_review_status, "approved");

  const publication = repository.queueStoryPublication("story-1", {
    asset_id: "asset-2",
    channel: "telegram",
    target_identifier: "-100123",
    publish_payload: { mode: "manual_queue" }
  }, {
    actorId: "operator@example.com",
    timestamp: "2026-03-21T11:04:00.000Z"
  });
  assert.equal(publication.status, "queued");
  assert.equal(repository.getStory("story-1").publications.length, 1);
  assert.equal(repository.listAuditLog().length, 7);
});

test("file repository persists stories, audiences, and review state across reloads", async () => {
  const { createFileRepository } = await loadModules();
  const filePath = path.join(os.tmpdir(), `vivo-factory-repository-${Date.now()}.json`);
  const repository = createFileRepository(filePath, createSeed());

  repository.updateStory("story-1", {
    title: "Persisted story"
  });
  repository.updateAudience("aud-1", {
    tone: "bold"
  }, {
    actorId: "operator@example.com",
    timestamp: "2026-03-21T12:00:00.000Z"
  });
  repository.submitStoryReview("story-1", {
    review_status: "approved",
    review_notes: "Persisted review",
    actor_id: "operator@example.com",
    selected_asset_id: "asset-1",
    payload: {},
    created_at: "2026-03-21T12:00:00.000Z"
  });

  const reloaded = createFileRepository(filePath);
  assert.equal(reloaded.getStory("story-1").title, "Persisted story");
  assert.equal(reloaded.getAudience("aud-1").tone, "bold");
  assert.equal(reloaded.getStory("story-1").reviews[0].review_status, "approved");
});

test("app exposes story queue filters, detail, story updates, reviews, asset replacement, audience edits, and publication queueing", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
    publicationTargetResolver(audience) {
      return audience.audience_key === "barcelona-family"
        ? { channel: "telegram", target_identifier: "-1001111111111" }
        : null;
    },
    freshnessCheck: async () => ({ ok: true }),
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const queueResponse = await app.handle({
    method: "GET",
    pathname: "/api/stories",
    query: {
      status: "ready_to_publish",
      review_status: "pending",
      search: "Beachwear"
    }
  });
  assert.equal(queueResponse.status, 200);
  assert.equal(JSON.parse(queueResponse.body).items.length, 1);

  const detailResponse = await app.handle({
    method: "GET",
    pathname: "/api/stories/story-1"
  });
  assert.equal(detailResponse.status, 200);
  assert.equal(JSON.parse(detailResponse.body).assets.length, 2);

  const updateResponse = await app.handle({
    method: "PUT",
    pathname: "/api/stories/story-1",
    body: JSON.stringify({
      actor_id: "operator@example.com",
      changes: {
        title: "Updated from app",
        story_text: "New story body",
        summary: "New summary",
        metadata: { campaign: "summer" }
      }
    })
  });
  assert.equal(updateResponse.status, 200);
  assert.equal(repository.getStory("story-1").title, "Updated from app");

  const selectAssetResponse = await app.handle({
    method: "POST",
    pathname: "/api/stories/story-1/assets/asset-2/select",
    body: JSON.stringify({ actor_id: "operator@example.com" })
  });
  assert.equal(selectAssetResponse.status, 200);
  assert.equal(repository.getStory("story-1").assets.find((asset) => asset.id === "asset-2").is_selected, true);

  const replaceAssetResponse = await app.handle({
    method: "POST",
    pathname: "/api/stories/story-1/assets/asset-2/replace",
    body: JSON.stringify({
      actor_id: "operator@example.com",
      file_name: "upload.png",
      mime_type: "image/png",
      size_bytes: 999,
      width: 1080,
      height: 1920,
      file_data_base64: Buffer.from("asset-from-app").toString("base64")
    })
  });
  assert.equal(replaceAssetResponse.status, 200);
  assert.equal(repository.getStory("story-1").assets.find((asset) => asset.id === "asset-2").storage_object.file_name, "upload.png");

  const audienceResponse = await app.handle({
    method: "PUT",
    pathname: "/api/audiences/aud-1",
    body: JSON.stringify({
      actor_id: "operator@example.com",
      changes: {
        tone: "direct",
        profile_snapshot: { mood: "urgent" }
      }
    })
  });
  assert.equal(audienceResponse.status, 200);
  assert.equal(repository.getAudience("aud-1").tone, "direct");

  const reviewResponse = await app.handle({
    method: "POST",
    pathname: "/api/stories/story-1/reviews",
    body: JSON.stringify({
      actor_id: "operator@example.com",
      review_status: "approved",
      review_notes: "Ready to go.",
      selected_asset_id: "asset-2"
    })
  });
  assert.equal(reviewResponse.status, 200);
  assert.equal(repository.getStory("story-1").operator_review_status, "approved");

  const publicationResponse = await app.handle({
    method: "POST",
    pathname: "/api/stories/story-1/publications",
    body: JSON.stringify({
      actor_id: "operator@example.com"
    })
  });
  assert.equal(publicationResponse.status, 200);
  assert.equal(repository.getStory("story-1").publications[0].target_identifier, "-1001111111111");
});

test("app exposes Marble audience profile summary, debug, fact sync, and decision ingestion routes", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const profileCalls = [];
  const app = createApp({
    repository,
    profileClientFactory({ audience, instance }) {
      profileCalls.push({
        type: "factory",
        audienceId: audience?.id ?? null,
        instanceId: instance?.id ?? null
      });
      return {
        async getSummary() {
          profileCalls.push({ type: "summary" });
          return {
            ok: true,
            data: {
              profile: {
                label: "Barcelona Family",
                tone: "helpful"
              }
            }
          };
        },
        async getDebug() {
          profileCalls.push({ type: "debug" });
          return {
            ok: true,
            data: {
              profile: { label: "Barcelona Family" },
              metadata: { event_websites: ["https://example.com/festival"] },
              decisions: [{ decisionType: "operator_feedback" }],
              memory_nodes: { interests: 2 }
            }
          };
        },
        async updateFacts(facts) {
          profileCalls.push({ type: "facts", facts });
          return {
            ok: true,
            data: {
              profile: {
                label: facts.label,
                tone: facts.tone
              }
            }
          };
        },
        async storeDecision(decision) {
          profileCalls.push({ type: "decision", decision });
          return { ok: true, data: { stored: true } };
        }
      };
    },
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const summaryResponse = await app.handle({
    method: "GET",
    pathname: "/api/audiences/aud-1/profile-summary"
  });
  const debugResponse = await app.handle({
    method: "GET",
    pathname: "/api/audiences/aud-1/profile-debug"
  });
  const factsResponse = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/profile-facts",
    body: JSON.stringify({
      actor_id: "operator@example.com",
      facts: {
        label: "Barcelona Family Updated",
        location: "Barcelona",
        family_context: "Married with one child",
        interests: ["beachwear", "local events"],
        content_pillars: ["family plans"],
        excluded_topics: ["politics"],
        tone: "direct",
        shopping_bias: "quality-first",
        posting_schedule: "weekday mornings",
        extra_metadata: {
          shopping_data: ["Maremagnum"],
          event_websites: ["https://example.com/events"]
        }
      }
    })
  });
  const decisionResponse = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/profile-decisions",
    body: JSON.stringify({
      actor_id: "operator@example.com",
      decisionType: "operator_enrichment",
      source: "dashboard",
      content: {
        shopping_data: ["Maremagnum"],
        location_notes: ["Weekend traffic high near Barceloneta"]
      }
    })
  });

  assert.equal(summaryResponse.status, 200);
  assert.equal(debugResponse.status, 200);
  assert.equal(factsResponse.status, 200);
  assert.equal(decisionResponse.status, 200);
  assert.equal(JSON.parse(summaryResponse.body).profile.label, "Barcelona Family");
  assert.equal(JSON.parse(debugResponse.body).metadata.event_websites[0], "https://example.com/festival");
  assert.equal(repository.getAudience("aud-1").tone, "direct");
  assert.equal(repository.getAudience("aud-1").shopping_bias, "quality-first");
  assert.deepEqual(repository.getAudience("aud-1").profile_snapshot.extra_metadata, {
    shopping_data: ["Maremagnum"],
    event_websites: ["https://example.com/events"]
  });
  assert.equal(profileCalls.find((entry) => entry.type === "facts").facts.audience_id, "aud-1");
  assert.equal(profileCalls.find((entry) => entry.type === "decision").decision.source, "dashboard");
});

test("app exposes setup status and audience import preview and confirmation", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
    setupService: {
      async getStatus() {
        return {
          ready: false,
          llm: { provider: "openai", model: "gpt-4.1-mini" },
          checks: {
            supabase_config: { ok: true },
            supabase_connection: { ok: false, message: "Cannot connect" },
            llm_config: { ok: true },
            story_admin: { ok: true }
          }
        };
      }
    },
    audienceImportService: {
      async previewImport() {
        return {
          source_file_name: "audience.md",
          import_required: true,
          items: [
            {
              audience_key: "madrid-runner",
              raw_text: "Runner in Madrid.",
              normalized: { label: "Runner in Madrid" },
              expanded: { label: "Runner in Madrid Expanded" }
            }
          ]
        };
      },
      async confirmImport(items) {
        return {
          audiences: items.map((item, index) => ({
            id: `aud-${index + 1}`,
            audience_key: item.audience_key,
            label: item.expanded.label
          }))
        };
      }
    },
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const setupResponse = await app.handle({
    method: "GET",
    pathname: "/api/setup"
  });
  const previewResponse = await app.handle({
    method: "POST",
    pathname: "/api/audiences/import-preview",
    body: JSON.stringify({})
  });
  const confirmResponse = await app.handle({
    method: "POST",
    pathname: "/api/audiences/import-confirm",
    body: JSON.stringify({
      items: [
        {
          audience_key: "madrid-runner",
          raw_text: "Runner in Madrid.",
          normalized: { label: "Runner in Madrid" },
          expanded: { label: "Runner in Madrid Expanded" }
        }
      ]
    })
  });

  assert.equal(setupResponse.status, 200);
  assert.equal(JSON.parse(setupResponse.body).ready, false);
  assert.equal(previewResponse.status, 200);
  assert.equal(JSON.parse(previewResponse.body).source_file_name, "audience.md");
  assert.equal(confirmResponse.status, 200);
  assert.equal(JSON.parse(confirmResponse.body).audiences[0].label, "Runner in Madrid Expanded");
});

test("root HTML renders setup-first audience manager controls when setup is incomplete", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
    setupService: {
      async getStatus() {
        return {
          ready: false,
          llm: { provider: "openai", model: "gpt-4.1-mini" },
          checks: {
            supabase_config: { ok: true },
            supabase_connection: { ok: false, message: "Cannot connect" },
            llm_config: { ok: true },
            story_admin: { ok: true }
          }
        };
      }
    },
    audienceImportService: {
      async previewImport() {
        return {
          source_file_name: "audience.md",
          import_required: true,
          items: [
            {
              audience_key: "madrid-runner",
              raw_text: "Runner in Madrid.",
              normalized: { label: "Runner in Madrid" },
              expanded: { label: "Runner in Madrid Expanded" }
            }
          ]
        };
      }
    },
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const response = await app.handle({
    method: "GET",
    pathname: "/"
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /aria-current="page"[^>]*>Setup/);
  assert.match(response.body, /href="\/\?tab=stories"/);
  assert.match(response.body, /href="\/\?tab=audiences"/);
  assert.match(response.body, /Setup Checklist/);
  assert.match(response.body, /Create Audiences/);
  assert.match(response.body, /Import audience\.md/);
  assert.doesNotMatch(response.body, /Launch Audience Manager/);
});

test("app blocks publication queueing when story is not operator-approved", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
    publicationTargetResolver() {
      return { channel: "telegram", target_identifier: "-1001111111111" };
    },
    freshnessCheck: async () => ({ ok: true }),
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const response = await app.handle({
    method: "POST",
    pathname: "/api/stories/story-1/publications",
    body: JSON.stringify({
      actor_id: "operator@example.com"
    })
  });

  assert.equal(response.status, 409);
  assert.match(response.body, /approved/i);
});

test("app blocks approval when no asset is selected", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  seed.storyAssets = seed.storyAssets.map((asset) => ({
    ...asset,
    is_selected: false
  }));
  const repository = createRepository(seed);
  const app = createApp({
    repository,
    publicationTargetResolver() {
      return { channel: "telegram", target_identifier: "-1001111111111" };
    },
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const response = await app.handle({
    method: "POST",
    pathname: "/api/stories/story-1/reviews",
    body: JSON.stringify({
      actor_id: "operator@example.com",
      review_status: "approved",
      review_notes: "Ship it."
    })
  });

  assert.equal(response.status, 409);
  assert.match(response.body, /selected asset/i);
});

test("POST /api/stories/:id/reviews — approves a story with no assets without requiring a selected_asset_id", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({
    audiences: [{
      id: "aud-1", audience_key: "bcn", label: "Barcelona", language: "en",
      location: "Barcelona", family_context: "", interests: [], content_pillars: [],
      excluded_topics: [], tone: "helpful", profile_snapshot: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }],
    instances: [],
    stories: [],
    storyAssets: [],
    storageObjects: [],
    storyReviews: [],
    storyPublications: [],
    auditEvents: [],
    feedbackEvents: [],
    instanceReports: [],
    operatorChats: [],
    deployments: []
  });
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", story_key: "review-test-1",
    title: "Daily News", story_text: "Today in Barcelona...", summary: "Today in Barcelona...",
    source_kind: "rss", primary_source_url: "https://example.com/news"
  });
  const app = createApp({ repository: repo, clock: () => "2026-04-17T10:00:00.000Z" });

  const result = await app.handle({
    method: "POST",
    pathname: `/api/stories/${story.id}/reviews`,
    query: {},
    body: JSON.stringify({ review_status: "approved", review_notes: "good", actor_id: "op-1" })
  });

  assert.equal(result.status, 200);
  const updated = repo.getStory(story.id);
  assert.equal(updated.operator_review_status, "approved");
  assert.equal(updated.status, "ready_to_publish");
});

test("stories workspace renders a Tremor-style table without opening details by default", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
    publicationTargetResolver() {
      return { channel: "telegram", target_identifier: "-1001111111111" };
    },
    instanceManager: {
      listInstances() {
        return [
          {
            audience_id: "barcelona-family",
            audience_key: "barcelona-family",
            service_name: "barcelona-family-openclaw",
            profile_service_name: "barcelona-family-profile",
            telegram_chat_id: "-1001111111111",
            telegram_report_chat_id: "-1002222222222",
            openclaw_admin_url: "http://127.0.0.1:7601",
            commands: {
              openclaw_shell: "docker compose -f generated/docker-compose.yml exec barcelona-family-openclaw /bin/sh",
              profile_shell: "docker compose -f generated/docker-compose.yml exec barcelona-family-profile /bin/sh"
            }
          }
        ];
      }
    },
    freshnessCheck: async () => ({ ok: true }),
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const response = await app.handle({
    method: "GET",
    pathname: "/",
    query: { tab: "stories" }
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /aria-current="page"[^>]*>Stories/);
  assert.match(response.body, /data-ui-framework="tremor-raw-dashboard"/);
  assert.match(response.body, /name="ui-framework" content="tremor-raw-dashboard"/);
  assert.match(response.body, /Stories/);
  assert.match(response.body, /data-tremor-component="Table"/);
  assert.match(response.body, /data-theme="light"/);
  assert.match(response.body, /rel="stylesheet" href="\/styles\.css"/);
  assert.match(response.body, /<th[^>]*>Story<\/th>/);
  assert.match(response.body, /<th[^>]*>Status<\/th>/);
  assert.match(response.body, /<th[^>]*>Review<\/th>/);
  assert.match(response.body, /name="status"/);
  assert.match(response.body, /assets_collected/);
  assert.doesNotMatch(response.body, /story-detail-drawer open/);
});

test("stories workspace opens a forty-percent right drawer for selected story details and assets", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
    publicationTargetResolver() {
      return { channel: "telegram", target_identifier: "-1001111111111" };
    },
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const response = await app.handle({
    method: "GET",
    pathname: "/",
    query: { tab: "stories", story_id: "story-1" }
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /<html lang="en" data-theme="light">/);
  assert.match(response.body, /data-ui-framework="tremor-raw-dashboard"/);
  assert.match(response.body, /data-tremor-component="DrawerPortal"/);
  assert.match(response.body, /data-tremor-component="Drawer"/);
  assert.match(response.body, /Story Details/);
  assert.match(response.body, /Asset Panel/);
  assert.match(response.body, /Publication Queue/);
  assert.match(response.body, /Channel/);
  assert.match(response.body, /<img /);
  assert.ok(response.body.indexOf('data-tremor-component="DrawerPortal"') > response.body.indexOf("</main>"));
});

test("audiences workspace renders audience data and launch controls after audience creation", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
    profileClientFactory() {
      return {
        async getSummary() {
          return {
            ok: true,
            data: {
              profile: {
                label: "Barcelona Family",
                location: "Barcelona",
                family_context: "Married with one child",
                interests: ["beachwear"],
                content_pillars: ["family plans"],
                tone: "helpful",
                shopping_bias: "quality-first",
                excluded_topics: ["gambling"],
                updated_at: "2026-03-21T13:00:00.000Z",
                reasoning_summary: "Barcelona Family, based in Barcelona, focused on beachwear"
              }
            }
          };
        },
        async getDebug() {
          return {
            ok: true,
            data: {
              profile: { label: "Barcelona Family" },
              metadata: {
                event_websites: ["https://example.com/events"],
                shopping_data: ["Maremagnum"]
              },
              decisions: [{ decisionType: "operator_feedback" }],
              memory_nodes: { interests: 1, preferences: 2 }
            }
          };
        }
      };
    },
    instanceManager: {
      listInstances() {
        return [
          {
            audience_id: "barcelona-family",
            audience_key: "barcelona-family",
            service_name: "barcelona-family-openclaw",
            profile_service_name: "barcelona-family-profile",
            telegram_chat_id: "-1001111111111",
            telegram_report_chat_id: "-1002222222222",
            openclaw_admin_url: "http://127.0.0.1:7601",
            commands: {
              openclaw_shell: "docker compose -f generated/docker-compose.yml exec barcelona-family-openclaw /bin/sh",
              profile_shell: "docker compose -f generated/docker-compose.yml exec barcelona-family-profile /bin/sh"
            }
          }
        ];
      }
    },
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const response = await app.handle({
    method: "GET",
    pathname: "/",
    query: { tab: "audiences" }
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /aria-current="page"[^>]*>Audiences/);
  assert.match(response.body, /Audience Directory/);
  assert.match(response.body, /Profile Canvas/);
  assert.match(response.body, /Knowledge Inputs/);
  assert.match(response.body, /Enrichment Feed/);
  assert.match(response.body, /Runtime Controls/);
  assert.match(response.body, /Barcelona Family/);
  assert.match(response.body, /Reasoning Summary/);
  assert.match(response.body, /Runtime Snapshot/);
  assert.match(response.body, /Manager Console/);
  assert.match(response.body, /name="telegram_chat_id"/);
  assert.match(response.body, /name="telegram_bot_token"/);
  assert.match(response.body, /name="llm_model"/);
  assert.match(response.body, /name="profile_engine_image"/);
  assert.match(response.body, /name="profile_engine_command"/);
  assert.match(response.body, /name="profile_engine_health_path"/);
  assert.match(response.body, /name="profile_storage_path"/);
  assert.match(response.body, /name="shopping_bias"/);
  assert.match(response.body, /name="extra_metadata"/);
  assert.match(response.body, /Launch Deployment/);
  assert.match(response.body, /docker compose -f generated\/docker-compose\.yml exec/);
  assert.doesNotMatch(response.body, /Deploy All/);
});

test("audiences workspace formats structured Marble fields and uses a three-plane operator layout", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
    profileClientFactory() {
      return {
        async getSummary() {
          return {
            ok: true,
            data: {
              profile: {
                label: "Bald tall man in his early 40s in Barcelona with school-age son",
                location: {
                  city: "Barcelona",
                  country: "Spain",
                  region: "Catalonia"
                },
                family_context: {
                  marital_status: "married",
                  children: [{ relation: "son", age_range: "8-10" }]
                },
                interests: [
                  { name: "beachwear" },
                  { name: "football" }
                ],
                content_pillars: [
                  { name: "family outings" },
                  { name: "local events" }
                ],
                excluded_topics: [
                  { name: "politics" }
                ],
                tone: "precise",
                shopping_bias: "quality-first",
                updated_at: "2026-03-21T13:00:00.000Z",
                reasoning_summary: "Prefers practical family outings near the Barcelona coast."
              }
            }
          };
        },
        async getDebug() {
          return {
            ok: true,
            data: {
              metadata: {
                posting_schedule: "weekend mornings",
                extra_metadata: {
                  event_websites: ["https://example.com/events"]
                }
              },
              decisions: [{ decisionType: "operator_feedback" }],
              memory_nodes: { interests: 2, preferences: 2 }
            }
          };
        }
      };
    },
    clock: () => "2026-03-21T13:00:00.000Z"
  });

  const response = await app.handle({
    method: "GET",
    pathname: "/",
    query: { tab: "audiences" }
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /Audiences/);
  assert.match(response.body, /Profile Canvas/);
  assert.match(response.body, /Knowledge Inputs/);
  assert.match(response.body, /Runtime Controls/);
  assert.match(response.body, /Manager Console/);
  assert.match(response.body, /Live Deployments/);
  assert.match(response.body, /Barcelona/);
  assert.match(response.body, /married/);
  assert.match(response.body, /beachwear/);
  assert.match(response.body, /family outings/);
  assert.doesNotMatch(response.body, /\[object Object\]/);
});

test("dashboard HTML still renders setup checklist when Supabase schema is incomplete", async () => {
  const { createApp } = await loadModules();
  const app = createApp({
    repository: {
      async listAudiences() {
        return [];
      },
      async listInstances() {
        return [];
      },
      async listStories() {
        throw new Error("should not query stories while schema is incomplete");
      },
      async getStory() {
        throw new Error("should not query story detail while schema is incomplete");
      },
      async listAuditLog() {
        return [];
      },
      async listFeedbackEvents() {
        return [];
      }
    },
    setupService: {
      async getStatus() {
        return {
          ready: false,
          llm: {
            provider: "openai",
            model: "gpt-4.1-mini"
          },
          checks: {
            supabase_config: { ok: true, message: "Credentials loaded" },
            supabase_connection: { ok: true, message: "Supabase reachable" },
            supabase_schema: { ok: false, message: "Missing table public.vivo_story_reviews" },
            llm_config: { ok: true, message: "Global LLM defaults loaded" },
            story_admin: { ok: true, message: "Dashboard available" }
          }
        };
      }
    }
  });

  const response = await app.handle({
    method: "GET",
    pathname: "/"
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /Setup Checklist/);
  assert.match(response.body, /Missing table public\.vivo_story_reviews/);
});

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
  const response = await app.handle({ method: "GET", pathname: "/api/instances/fitness-fans/chat/history", query: {}, body: null });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.messages[1].role, "assistant");
});

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
  const response = await app.handle({
    method: "POST",
    pathname: "/api/instances/fitness-fans/chat",
    body: JSON.stringify({ message: "Hi there", operator: "op@example.com" })
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.reply, "**Hello from AI**");
  assert.ok(body.conversationId, "should return conversationId");
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "Hi there");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, "**Hello from AI**");
});
