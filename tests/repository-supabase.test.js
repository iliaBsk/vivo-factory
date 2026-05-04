import test from "node:test";
import assert from "node:assert/strict";

async function loadRepositoryModule() {
  try {
    return await import("../src/repository.js");
  } catch (error) {
    assert.fail(`expected src/repository.js to exist: ${error.message}`);
  }
}

test("createSupabaseRepository hydrates instance summaries and signed asset URLs", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const calls = [];
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    storageBucket: "vivo-content",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      calls.push({ url: url.pathname, method: options.method ?? "GET" });

      if (url.pathname === "/rest/v1/vivo_stories") {
        return jsonResponse([
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
            operator_review_status: "approved",
            created_at: "2026-03-21T10:00:00.000Z",
            updated_at: "2026-03-21T10:00:00.000Z"
          }
        ]);
      }

      if (url.pathname === "/rest/v1/vivo_audiences") {
        return jsonResponse([
          {
            id: "aud-1",
            audience_key: "barcelona-family",
            label: "Barcelona Family"
          }
        ]);
      }

      if (url.pathname === "/rest/v1/vivo_instances") {
        return jsonResponse([
          {
            id: "inst-1",
            audience_id: "aud-1",
            instance_key: "barcelona-family-openclaw",
            service_name: "barcelona-family-openclaw",
            openclaw_admin_url: "http://127.0.0.1:7601"
          }
        ]);
      }

      if (url.pathname === "/rest/v1/vivo_story_assets") {
        return jsonResponse([
          {
            id: "asset-1",
            story_id: "story-1",
            asset_slot: "hero",
            asset_type: "image",
            status: "ready",
            is_selected: true,
            storage_object_id: "storage-1",
            source_asset_url: null
          }
        ]);
      }

      if (url.pathname === "/rest/v1/vivo_story_reviews" || url.pathname === "/rest/v1/vivo_story_publications") {
        return jsonResponse([]);
      }

      if (url.pathname === "/rest/v1/vivo_storage_objects") {
        return jsonResponse([
          {
            id: "storage-1",
            bucket_name: "vivo-content",
            object_path: "stories/story-1/hero.png",
            file_name: "hero.png",
            mime_type: "image/png"
          }
        ]);
      }

      if (url.pathname === "/storage/v1/object/sign/vivo-content/stories/story-1/hero.png") {
        return jsonResponse({
          signedURL: "/object/sign/vivo-content/stories/story-1/hero.png?token=abc123"
        });
      }

      throw new Error(`unexpected request ${options.method ?? "GET"} ${url.pathname}`);
    }
  });

  const stories = await repository.listStories();

  assert.equal(stories.length, 1);
  assert.equal(stories[0].instance.service_name, "barcelona-family-openclaw");
  assert.equal(
    stories[0].assets[0].download_url,
    "https://supabase.example.co/storage/v1/object/sign/vivo-content/stories/story-1/hero.png?token=abc123"
  );
  assert.ok(calls.some((call) => call.url === "/rest/v1/vivo_instances"));
  assert.ok(calls.some((call) => call.url === "/storage/v1/object/sign/vivo-content/stories/story-1/hero.png"));
});

test("getProtagonistImages returns a Map of category → {storage_object_id, url}", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([
          { id: "pi-1", audience_id: "aud-1", category: "news", storage_object_id: "so-news" }
        ]);
      }
      if (url.pathname === "/rest/v1/vivo_storage_objects") {
        return jsonResponse([
          { id: "so-news", bucket_name: "vivo-audiences", object_path: "aud-1/protagonist/news.jpg" }
        ]);
      }
      if (url.pathname === "/storage/v1/object/sign/vivo-audiences/aud-1/protagonist/news.jpg") {
        return jsonResponse({ signedURL: "/object/sign/vivo-audiences/aud-1/protagonist/news.jpg?token=xyz" });
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });

  const images = await repository.getProtagonistImages("aud-1");
  assert.ok(images instanceof Map);
  assert.ok(images.has("news"));
  assert.equal(images.get("news").storage_object_id, "so-news");
  assert.ok(images.get("news").url.includes("news.jpg"));
});

test("upsertProtagonistImage uploads to storage and upserts both tables", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const calls = [];
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      calls.push({ method: options.method ?? "GET", path: url.pathname });
      if (url.pathname.startsWith("/storage/v1/object/vivo-audiences/")) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.pathname === "/rest/v1/vivo_storage_objects") {
        return jsonResponse([{ id: "so-new", bucket_name: "vivo-audiences", object_path: "aud-1/protagonist/tech.jpg" }]);
      }
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([{ id: "pi-new", audience_id: "aud-1", category: "tech", storage_object_id: "so-new" }]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });

  const buf = Buffer.from("fake-image-data");
  const storageId = await repository.upsertProtagonistImage("aud-1", "tech", {
    file_data_base64: buf.toString("base64"),
    mime_type: "image/jpeg",
    file_name: "tech.jpg",
    size_bytes: buf.length
  });
  assert.equal(storageId, "so-new");
  assert.ok(calls.some(c => c.method === "POST" && c.path.includes("/storage/v1/object/vivo-audiences/")));
  assert.ok(calls.some(c => c.path === "/rest/v1/vivo_audience_protagonist_images"));
});

test("upsertProtagonistImage throws on invalid category", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async () => { throw new Error("fetch not expected"); }
  });
  await assert.rejects(
    () => repository.upsertProtagonistImage("aud-1", "invalid-cat", {
      file_data_base64: "abc",
      mime_type: "image/jpeg",
      file_name: "x.jpg",
      size_bytes: 3
    }),
    /Invalid category/
  );
});

test("deleteProtagonistImage returns false when no row exists", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });
  const result = await repository.deleteProtagonistImage("aud-1", "news");
  assert.equal(result, false);
});

test("deleteProtagonistImage returns true and DELETEs when row exists", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const calls = [];
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      calls.push({ method: options.method ?? "GET", path: url.pathname });
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        if ((options.method ?? "GET") === "DELETE") return jsonResponse([]);
        return jsonResponse([{ id: "pi-1" }]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });
  const result = await repository.deleteProtagonistImage("aud-1", "news");
  assert.equal(result, true);
  assert.ok(calls.some(c => c.method === "DELETE"));
});

test("getEffectiveProtagonistStorageId returns per-category id when set", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([{ id: "pi-1", storage_object_id: "so-tech" }]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });
  const id = await repository.getEffectiveProtagonistStorageId("aud-1", "tech");
  assert.equal(id, "so-tech");
});

test("getEffectiveProtagonistStorageId falls back to audience hero_image_asset_storage_id", async () => {
  const { createSupabaseRepository } = await loadRepositoryModule();
  const repository = createSupabaseRepository({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/vivo_audience_protagonist_images") {
        return jsonResponse([]);
      }
      if (url.pathname === "/rest/v1/vivo_audiences") {
        return jsonResponse([{ id: "aud-1", hero_image_asset_storage_id: "so-hero" }]);
      }
      throw new Error(`unexpected ${options.method ?? "GET"} ${url.pathname}`);
    }
  });
  const id = await repository.getEffectiveProtagonistStorageId("aud-1", "tech");
  assert.equal(id, "so-hero");
});

function jsonResponse(payload) {
  return {
    ok: true,
    async text() {
      return JSON.stringify(payload);
    }
  };
}
