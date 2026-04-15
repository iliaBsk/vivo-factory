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
  assert.match(response.body, /workspace-tab active[^>]*>Setup/);
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
  assert.match(response.body, /workspace-tab active[^>]*>Stories/);
  assert.match(response.body, /data-ui-framework="tremor-raw-dashboard"/);
  assert.match(response.body, /name="ui-framework" content="tremor-raw-dashboard"/);
  assert.match(response.body, /data-tremor-component="TabNavigation"/);
  assert.match(response.body, /Stories Table/);
  assert.match(response.body, /data-tremor-component="Table"/);
  assert.match(response.body, /data-theme="light"/);
  assert.match(response.body, /\[data-theme="dark"\]/);
  assert.match(response.body, /id="theme-toggle"/);
  assert.match(response.body, /data-theme-toggle/);
  assert.match(response.body, /<th>Story<\/th>/);
  assert.match(response.body, /<th>Status<\/th>/);
  assert.match(response.body, /<th>Review<\/th>/);
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
  assert.match(response.body, /story-detail-drawer open/);
  assert.match(response.body, /data-tremor-component="Drawer"/);
  assert.match(response.body, /Story Details/);
  assert.match(response.body, /Asset Panel/);
  assert.match(response.body, /Publication Queue/);
  assert.match(response.body, /Channel Target/);
  assert.match(response.body, /<img /);
});

test("audiences workspace renders audience data and launch controls after audience creation", async () => {
  const { createRepository, createApp } = await loadModules();
  const repository = createRepository(createSeed());
  const app = createApp({
    repository,
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
  assert.match(response.body, /workspace-tab active[^>]*>Audiences/);
  assert.match(response.body, /Barcelona Family/);
  assert.match(response.body, /Launch Audience Manager/);
  assert.match(response.body, /Live Instances/);
  assert.match(response.body, /docker compose -f generated\/docker-compose\.yml exec/);
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
