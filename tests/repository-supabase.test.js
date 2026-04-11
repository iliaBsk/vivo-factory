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
          signedURL: "/storage/v1/object/sign/vivo-content/stories/story-1/hero.png?token=abc123"
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

function jsonResponse(payload) {
  return {
    ok: true,
    async text() {
      return JSON.stringify(payload);
    }
  };
}
