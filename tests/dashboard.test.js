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

test("POST /api/audiences/:id/fetch-content creates a job and returns job_id", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({ audiences: [createSeed().audiences[0]] });
  const dispatchCalls = [];
  const app = createApp({
    repository: repo,
    clock: () => "2026-04-17T09:00:00.000Z",
    dispatchFetch: async (audience, instance, jobId, opts) => {
      dispatchCalls.push({ audienceId: audience.id, jobId, opts });
    }
  });

  const result = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/fetch-content",
    query: {},
    body: JSON.stringify({ limit: 10 })
  });

  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.ok(body.job_id, "should return a job_id");
  const job = repo.getJob(body.job_id);
  assert.ok(job, "job should exist in repository");
  assert.equal(job.audience_id, "aud-1");
  assert.equal(job.status, "pending");
});

test("POST /api/audiences/:id/fetch-content returns 404 when dispatchFetch not configured", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({ audiences: [createSeed().audiences[0]] });
  const app = createApp({ repository: repo });

  const result = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/fetch-content",
    query: {},
    body: ""
  });

  assert.equal(result.status, 404);
});

test("GET /api/jobs/:jobId returns job status", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({ audiences: [createSeed().audiences[0]] });
  const job = repo.createJob({ audience_id: "aud-1" });
  const app = createApp({ repository: repo });

  const result = await app.handle({
    method: "GET",
    pathname: `/api/jobs/${job.id}`,
    query: {},
    body: ""
  });

  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.id, job.id);
  assert.equal(body.status, "pending");
});

test("GET /api/jobs/:jobId returns 404 for unknown job", async () => {
  const { createRepository, createApp } = await loadModules();
  const repo = createRepository({});
  const app = createApp({ repository: repo });

  const result = await app.handle({
    method: "GET",
    pathname: "/api/jobs/nonexistent-id",
    query: {},
    body: ""
  });

  assert.equal(result.status, 404);
});

test("POST /api/audiences/:id/sources adds custom source to instance runtime_config", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });
  const app = createApp({ repository: repo, clock: () => "2026-04-17T10:00:00.000Z" });

  const result = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/sources",
    query: {},
    body: JSON.stringify({
      source: { type: "rss", url: "https://myfeed.com/rss", category: "news", weight: 0.8 }
    })
  });

  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.ok(body.source_id, "should return source_id");
  const instance = repo.getInstance("inst-1");
  const customSources = instance.runtime_config?.custom_sources ?? [];
  assert.equal(customSources.length, 1);
  assert.equal(customSources[0].url, "https://myfeed.com/rss");
});

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

// ─── Merchant API tests ───────────────────────────────────────────────────

async function makeMerchantTestRepo() {
  const { createRepository } = await import(`../src/repository.js?bust=${Date.now()}`);
  return createRepository({
    merchants: [{
      merchant_id: "zara-es",
      name: "Zara Spain",
      domain: "zara.com",
      country: "ES",
      currency: "EUR",
      network: "awin",
      network_merchant_code: "13623",
      affiliate_url_template: "https://www.awin1.com/cread.php?awinmid=13623&awinaffid={{publisher_id}}&ued={{url}}",
      publisher_id: null,
      needs_setup: true,
      enabled: true,
      categories: ["fashion"],
      disclosure_text: "Affiliate links included.",
      created_at: "2026-04-17T00:00:00.000Z",
      updated_at: "2026-04-17T00:00:00.000Z"
    }],
    merchantOverrides: [{
      merchant_id: "zara-es",
      audience_id: "bald-bcn",
      enabled: true,
      boost_tags: []
    }]
  });
}

test("GET /api/merchants returns list of merchants", async () => {
  const { createApp } = await import(`../src/app.js?bust=${Date.now()}`);
  const repo = await makeMerchantTestRepo();
  const app = createApp({ repository: repo });
  const response = await app.handle({ method: "GET", pathname: "/api/merchants", query: {}, body: null, headers: {} });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].merchant_id, "zara-es");
});

test("GET /api/merchants/:id returns single merchant", async () => {
  const { createApp } = await import(`../src/app.js?bust=${Date.now()}`);
  const repo = await makeMerchantTestRepo();
  const app = createApp({ repository: repo });
  const response = await app.handle({ method: "GET", pathname: "/api/merchants/zara-es", query: {}, body: null, headers: {} });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.merchant_id, "zara-es");
});

test("GET /api/merchants/:id returns 404 for unknown merchant", async () => {
  const { createApp } = await import(`../src/app.js?bust=${Date.now()}`);
  const repo = await makeMerchantTestRepo();
  const app = createApp({ repository: repo });
  const response = await app.handle({ method: "GET", pathname: "/api/merchants/no-such", query: {}, body: null, headers: {} });
  assert.equal(response.status, 404);
});

test("PUT /api/merchants/:id updates merchant and clears needs_setup", async () => {
  const { createApp } = await import(`../src/app.js?bust=${Date.now()}`);
  const repo = await makeMerchantTestRepo();
  const app = createApp({ repository: repo });
  const response = await app.handle({
    method: "PUT",
    pathname: "/api/merchants/zara-es",
    query: {},
    body: JSON.stringify({ publisher_id: "654321" }),
    headers: {}
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.publisher_id, "654321");
  assert.equal(body.needs_setup, false);
});

test("GET /api/merchants/:id/overrides returns overrides", async () => {
  const { createApp } = await import(`../src/app.js?bust=${Date.now()}`);
  const repo = await makeMerchantTestRepo();
  const app = createApp({ repository: repo });
  const response = await app.handle({ method: "GET", pathname: "/api/merchants/zara-es/overrides", query: {}, body: null, headers: {} });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].audience_id, "bald-bcn");
});

test("PUT /api/merchants/:id/overrides/:audienceId upserts override", async () => {
  const { createApp } = await import(`../src/app.js?bust=${Date.now()}`);
  const repo = await makeMerchantTestRepo();
  const app = createApp({ repository: repo });
  const response = await app.handle({
    method: "PUT",
    pathname: "/api/merchants/zara-es/overrides/bald-bcn",
    query: {},
    body: JSON.stringify({ enabled: false }),
    headers: {}
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.enabled, false);
});

test("file repository getProtagonistImages returns empty Map", async () => {
  const { createRepository } = await loadModules();
  const repo = createRepository(createSeed());
  const images = await repo.getProtagonistImages("aud-1");
  assert.ok(images instanceof Map);
  assert.equal(images.size, 0);
});

test("file repository getEffectiveProtagonistStorageId returns null when no hero", async () => {
  const { createRepository } = await loadModules();
  const repo = createRepository(createSeed());
  const id = await repo.getEffectiveProtagonistStorageId("aud-1", "tech");
  assert.equal(id, null);
});

test("POST /api/audiences/:id/archive-daily-remainder archives ready_to_publish stories", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const makeStory = (key, status) => repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: key, title: key, story_text: "text", summary: "sum", source_kind: "rss"
  });

  const s1 = makeStory("s1");
  const s2 = makeStory("s2");
  const s3 = makeStory("s3");
  repo.transitionStoryStatus(s1.id, "ready_to_publish");
  repo.transitionStoryStatus(s2.id, "ready_to_publish");
  // s3 stays in "new" — should not be archived

  const app = createApp({ repository: repo, clock: () => "2026-05-01T15:30:00.000Z" });
  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/archive-daily-remainder",
    query: {},
    body: "",
    headers: {}
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.equal(body.archived, 2);
  assert.equal(repo.getStory(s1.id).status, "archived");
  assert.equal(repo.getStory(s2.id).status, "archived");
  assert.equal(repo.getStory(s3.id).status, "new");
});

test("POST /api/audiences/:id/archive-daily-remainder resolves audience by key", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });
  const s = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "s-key", title: "t", story_text: "text", summary: "sum", source_kind: "rss"
  });
  repo.transitionStoryStatus(s.id, "ready_to_publish");

  const app = createApp({ repository: repo, clock: () => "2026-05-01T15:30:00.000Z" });
  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/barcelona-family/archive-daily-remainder",
    query: {},
    body: "",
    headers: {}
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.archived, 1);
  assert.equal(repo.getStory(s.id).status, "archived");
});

test("POST /api/audiences/:id/post-telegram returns 503 when story has no ready video asset", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "tg-story", title: "Big Tech News",
    story_text: "Something important happened in China tech today.",
    summary: "China tech", source_kind: "rss",
    primary_source_url: "https://example.com/news"
  });

  const tgRequests = [];
  const fakeFetch = async (url, opts = {}) => {
    tgRequests.push({ url: String(url), body: JSON.parse(opts.body ?? "{}") });
    return { ok: true, async json() { return { ok: true }; }, async text() { return '{"ok":true}'; } };
  };

  const audienceRuntimeConfig = {
    "barcelona-family": {
      telegram_bot_token: "bot123:TOKEN",
      telegram_chat_id: "@test_channel"
    }
  };

  const app = createApp({ repository: repo, fetchImpl: fakeFetch, audienceRuntimeConfig });
  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/post-telegram",
    query: {},
    body: JSON.stringify({ story_id: story.id }),
    headers: {}
  });

  assert.equal(response.status, 503);
  assert.equal(tgRequests.length, 0);
  const body = JSON.parse(response.body);
  assert.ok(body.error.includes("No ready video asset"));
});

test("POST /api/audiences/:id/post-telegram uses sendVideo when a ready video asset is present", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "tg-video", title: "Video Story",
    story_text: "Something with a video.", summary: "video", source_kind: "rss"
  });
  repo.transitionStoryStatus(story.id, "ready_to_publish");

  const tgRequests = [];
  const fakeFetch = async (url, opts = {}) => {
    tgRequests.push({ url: String(url), body: JSON.parse(opts.body ?? "{}") });
    return { ok: true, async json() { return { ok: true, result: { message_id: 99 } }; }, async text() { return '{"ok":true}'; } };
  };

  const audienceRuntimeConfig = {
    "barcelona-family": { telegram_bot_token: "bot123:TOKEN", telegram_chat_id: "@test_channel" }
  };

  const videoDownloadUrl = "https://storage.example.com/reel.mp4";
  const repoWithVideo = {
    ...repo,
    getStory(id) {
      const s = repo.getStory(id);
      if (!s) return null;
      return {
        ...s,
        assets: [{ asset_type: "video", status: "ready", is_selected: true, download_url: videoDownloadUrl }]
      };
    }
  };

  const app = createApp({ repository: repoWithVideo, fetchImpl: fakeFetch, audienceRuntimeConfig });
  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/post-telegram",
    query: {},
    body: JSON.stringify({ story_id: story.id }),
    headers: {}
  });

  assert.equal(response.status, 200);
  assert.equal(tgRequests.length, 1);
  assert.ok(tgRequests[0].url.includes("sendVideo"));
  assert.equal(tgRequests[0].body.video, videoDownloadUrl);
  assert.ok(tgRequests[0].body.caption.includes("Video Story"));
});

test("POST /api/audiences/:id/post-telegram returns 503 when Telegram not configured", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });
  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "tg-nocred", title: "Test", story_text: "text", summary: "s", source_kind: "rss"
  });

  const app = createApp({ repository: repo });
  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/post-telegram",
    query: {},
    body: JSON.stringify({ story_id: story.id }),
    headers: {}
  });

  assert.equal(response.status, 503);
});

test("POST /api/audiences/:id/flush-marble-feedback sends storeDecision for engaged published stories", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const now = new Date();
  const recentTs = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1h ago

  const storyA = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "fb-a", title: "Story A", story_text: "A", summary: "A", source_kind: "rss"
  });
  const storyB = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "fb-b", title: "Story B", story_text: "B", summary: "B", source_kind: "rss"
  });
  const storyC = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "fb-c", title: "Story C", story_text: "C", summary: "C", source_kind: "rss"
  });

  // Transition all to published with recent timestamps
  for (const s of [storyA, storyB, storyC]) {
    repo.transitionStoryStatus(s.id, "ready_to_publish");
    repo.transitionStoryStatus(s.id, "published");
    repo.updateStory(s.id, { metadata: { published_at: recentTs } });
  }
  // A: clicked tracking link → "up"
  repo.updateStory(storyA.id, { metadata: { published_at: recentTs, chon_clicked_at: recentTs } });
  // B: high read depth → "up"
  repo.updateStory(storyB.id, { metadata: { published_at: recentTs, chon_read_pct: 90, chon_read_seconds: 60 } });
  // C: no engagement at all → skip

  const storeDecisionCalls = [];
  const profileClientFactory = () => ({
    async storeDecision(d) { storeDecisionCalls.push(d); }
  });

  const app = createApp({ repository: repo, profileClientFactory, clock: () => new Date().toISOString() });
  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/flush-marble-feedback",
    query: {},
    body: "",
    headers: {}
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.equal(body.fed, 2);
  assert.equal(storeDecisionCalls.length, 2);
  assert.equal(storeDecisionCalls.find(d => d.content.id === storyA.id)?.reaction, "up");
  assert.equal(storeDecisionCalls.find(d => d.content.id === storyB.id)?.reaction, "up");
});

test("POST /api/audiences/:id/flush-marble-feedback returns 400 when no profile client configured", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const app = createApp({ repository: repo });
  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/flush-marble-feedback",
    query: {},
    body: "",
    headers: {}
  });

  assert.equal(response.status, 400);
  assert.match(response.body, /profile client/i);
});

test("POST /api/audiences/:id/telegram-webhook stores reaction emoji in metadata without calling storeDecision", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const story = repo.createStory({
    factory_id: "factory-1", audience_id: "aud-1", instance_id: "inst-1",
    story_key: "tg-react", title: "Reaction Story", story_text: "text", summary: "s", source_kind: "rss"
  });
  repo.updateStory(story.id, { metadata: { telegram_message_id: 42 } });

  const storeDecisionCalls = [];
  const profileClientFactory = () => ({
    async storeDecision(d) { storeDecisionCalls.push(d); }
  });

  const audienceRuntimeConfig = {
    "barcelona-family": { chon_telegram_user_id: "99" }
  };

  const app = createApp({ repository: repo, profileClientFactory, audienceRuntimeConfig, clock: () => "2026-05-01T10:00:00.000Z" });
  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/telegram-webhook",
    query: {},
    body: JSON.stringify({
      message_reaction: {
        user: { id: 99 },
        message_id: 42,
        new_reaction: [{ emoji: "👍" }]
      }
    }),
    headers: {}
  });

  assert.equal(response.status, 200);
  assert.equal(storeDecisionCalls.length, 0);
  assert.equal(repo.getStory(story.id).metadata.chon_reaction, "👍");
});

test("GET /api/audiences/:id/daily-readiness counts ready-with-video stories by type and sets needs_fetch", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const mockStories = [
    { id: "dr-1", audience_id: "aud-1", status: "ready_to_publish", metadata: { story_type: "news" },
      assets: [{ asset_type: "video", status: "ready" }] },
    { id: "dr-2", audience_id: "aud-1", status: "ready_to_publish", metadata: { story_type: "news" },
      assets: [] },
    { id: "dr-3", audience_id: "aud-1", status: "ready_to_publish", metadata: { story_type: "local_event" },
      assets: [{ asset_type: "video", status: "ready" }] },
    { id: "dr-4", audience_id: "aud-1", status: "asset_generating", metadata: { story_type: "news" },
      assets: [] }
  ];
  const repoWithMock = { ...repo, listStories: () => mockStories };

  const app = createApp({ repository: repoWithMock });
  const response = await app.handle({
    method: "GET",
    pathname: "/api/audiences/aud-1/daily-readiness",
    query: {},
    body: "",
    headers: {}
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.ready, { news: 1, local_event: 1, product: 0 });
  assert.equal(body.in_pipeline, 1);
  assert.deepEqual(body.target, { news: 5, local_event: 3, product: 2 });
  assert.deepEqual(body.gaps, { news: 4, local_event: 2, product: 2 });
  assert.equal(body.total_ready, 2);
  assert.equal(body.total_target, 10);
  assert.equal(body.needs_fetch, true);
});

const DOMAINS = ["topics", "personal", "health", "career", "family", "social", "heritage", "wealth"];
const HORIZONS = ["today", "this_week", "this_month", "this_year", "lifetime"];

function makeCell(domain, horizon, opts = {}) {
  return {
    horizon,
    domain,
    goals: [{ text: `goal for ${domain}/${horizon}`, confidence: 0.8, synthesis_basis: "test" }],
    desires: [],
    fears: [],
    anti_goals: [],
    needs: [],
    relevant_to_know: [],
    status: opts.status ?? "normal"
  };
}

test("POST /api/audiences/:id/extract-intent writes 40 cells and diffs to repository", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const extractedAt = "2026-05-04T03:00:00.000Z";
  const fakeCells = DOMAINS.flatMap(d => HORIZONS.map(h => makeCell(d, h)));

  const userIntentService = {
    async extractFullMatrix(audience, profileClient, repository) {
      const date = extractedAt.slice(0, 10);
      for (const cell of fakeCells) {
        repository.createIntentCell(audience.id, { ...cell, extracted_at: extractedAt });
      }
      repository.createIntentDiff(audience.id, {
        computed_at: extractedAt,
        horizon: "today",
        domain: "career",
        diff: { goals: { added: ["new goal"] } },
        significance_score: 0.7
      });
      return { cells: 40, data_sparse: 0, diffs: 1, elapsed_ms: 120 };
    }
  };

  const app = createApp({
    repository: repo,
    userIntentService,
    profileClientFactory: () => ({})
  });

  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/extract-intent",
    query: {},
    body: "",
    headers: {}
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.equal(body.cells, 40);
  assert.equal(body.diffs, 1);

  const stored = repo.listIntentMatrix("aud-1", { date: "2026-05-04" });
  assert.equal(stored.length, 40);
  assert.ok(stored.every(c => c.audience_id === "aud-1"));

  const diffs = repo.listIntentDiffs("aud-1", {});
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].significance_score, 0.7);
});

test("GET /api/audiences/:id/intent-matrix returns all cells for given date", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const extractedAt = "2026-05-04T03:00:00.000Z";
  for (const domain of DOMAINS) {
    for (const horizon of HORIZONS) {
      repo.createIntentCell("aud-1", {
        extracted_at: extractedAt,
        horizon,
        domain,
        goals: [{ text: `${domain}/${horizon} goal`, confidence: 0.9, synthesis_basis: "test" }],
        desires: [],
        fears: [],
        anti_goals: [],
        needs: [],
        relevant_to_know: [],
        status: "normal"
      });
    }
  }

  const app = createApp({ repository: repo });
  const response = await app.handle({
    method: "GET",
    pathname: "/api/audiences/aud-1/intent-matrix",
    query: { date: "2026-05-04" },
    body: "",
    headers: {}
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.equal(body.cells.length, 40);
  assert.ok(body.cells.every(c => c.audience_id === "aud-1"));
  assert.ok(body.cells.every(c => DOMAINS.includes(c.domain)));
  assert.ok(body.cells.every(c => HORIZONS.includes(c.horizon)));
});

test("POST /api/audiences/:id/extract-intent records data-sparse cells to vivo_data_gaps", async () => {
  const { createRepository, createApp } = await loadModules();
  const seed = createSeed();
  const repo = createRepository({ audiences: seed.audiences, instances: seed.instances });

  const extractedAt = "2026-05-04T03:00:00.000Z";

  const userIntentService = {
    async extractFullMatrix(audience, profileClient, repository) {
      for (const domain of DOMAINS) {
        for (const horizon of HORIZONS) {
          const isSparse = domain === "wealth" && horizon === "lifetime";
          repository.createIntentCell(audience.id, {
            extracted_at: extractedAt,
            horizon,
            domain,
            goals: [],
            desires: [],
            fears: [],
            anti_goals: [],
            needs: [],
            relevant_to_know: [],
            status: isSparse ? "data_sparse" : "normal"
          });
          if (isSparse) {
            repository.createDataGap(audience.id, {
              field_path: `${domain}/${horizon}`,
              gap_description: "No KG signal for this cell"
            });
          }
        }
      }
      return { cells: 40, data_sparse: 1, diffs: 0, elapsed_ms: 95 };
    }
  };

  const app = createApp({
    repository: repo,
    userIntentService,
    profileClientFactory: () => ({})
  });

  const response = await app.handle({
    method: "POST",
    pathname: "/api/audiences/aud-1/extract-intent",
    query: {},
    body: "",
    headers: {}
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.data_sparse, 1);

  const sparseCell = repo.listIntentMatrix("aud-1", { date: "2026-05-04" })
    .find(c => c.domain === "wealth" && c.horizon === "lifetime");
  assert.ok(sparseCell, "data_sparse cell should be stored");
  assert.equal(sparseCell.status, "data_sparse");

  const gaps = repo.state ? repo.state.dataGaps : null;
  const allCells = repo.listIntentMatrix("aud-1", {});
  assert.equal(allCells.length, 40);

  // Verify data gap was recorded by re-seeding from exported state
  const exported = repo.exportState();
  assert.equal(exported.dataGaps.length, 1);
  assert.equal(exported.dataGaps[0].field_path, "wealth/lifetime");
  assert.equal(exported.dataGaps[0].resolution_status, "open");
});

// ── Phase 4: Editor pipeline tests ──────────────────────────────────────────

test("assignRegister — rule-based register from marble dimension scores", async () => {
  const { assignRegister } = await import("../src/story-enrichment.js");

  assert.equal(assignRegister("local_event", null), "actionable");
  assert.equal(assignRegister("product", null), "actionable");
  assert.equal(assignRegister("product", { dimension_scores: { surprise_score: 0.8 } }), "curious");

  // High surprise → curious
  assert.equal(assignRegister("news", { dimension_scores: { surprise_score: 0.7, personalization_depth: 0.3 } }), "curious");

  // High temporal + depth → alert
  assert.equal(assignRegister("news", { dimension_scores: { surprise_score: 0.1, temporal_relevance: 0.8, personalization_depth: 0.6 } }), "alert");

  // High insight → reflective
  assert.equal(assignRegister("news", { dimension_scores: { surprise_score: 0.1, temporal_relevance: 0.3, insight_density: 0.7, personalization_depth: 0.3 } }), "reflective");

  // High depth → inspiring
  assert.equal(assignRegister("news", { dimension_scores: { surprise_score: 0.1, temporal_relevance: 0.3, insight_density: 0.3, personalization_depth: 0.8 } }), "inspiring");

  // Default → informative
  assert.equal(assignRegister("news", { dimension_scores: {} }), "informative");
});

test("runGuardrails — hard violations are detected, excluded topics flagged", async () => {
  const { runGuardrails } = await import("../src/story-enrichment.js");

  assert.deepEqual(runGuardrails("You should invest in NVDA right now"), ["financial_advice"]);
  assert.deepEqual(runGuardrails("This supplement cures diabetes"), ["medical_claim"]);
  assert.deepEqual(runGuardrails("Clean content with no violations"), []);
  assert.deepEqual(runGuardrails("This is about cycling in the park", ["cycling"]), ["excluded_topic:cycling"]);
  assert.deepEqual(runGuardrails("results are guaranteed and risk-free"), ["false_claim"]);
});
