import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createRepository } from "../src/repository.js";

const SEED = {
  audiences: [{
    id: "aud-1",
    audience_key: "test-audience",
    label: "Test Audience",
    language: "en",
    location: "Barcelona",
    family_context: "",
    interests: [],
    content_pillars: [],
    excluded_topics: [],
    tone: "direct",
    profile_snapshot: {},
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z"
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
};

function makeApp(repoOverrides = {}) {
  const baseRepo = createRepository(SEED);
  const repository = { ...baseRepo, ...repoOverrides };
  return createApp({ repository, fetchImpl: async () => { throw new Error("unexpected fetch"); } });
}

async function handle(app, method, pathname, body = null) {
  return app.handle({
    method,
    pathname,
    body: body ? JSON.stringify(body) : null,
    query: {}
  });
}

test("GET /api/audiences/:id/protagonist-images — returns 404 for unknown audience", async () => {
  const app = makeApp();
  const res = await handle(app, "GET", "/api/audiences/no-such-id/protagonist-images");
  assert.equal(res.status, 404);
});

test("GET /api/audiences/:id/protagonist-images — returns empty images map", async () => {
  const app = makeApp();
  const res = await handle(app, "GET", "/api/audiences/aud-1/protagonist-images");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.success, true);
  assert.deepEqual(body.data.images, {});
});

test("GET /api/audiences/:id/protagonist-images — returns set images", async () => {
  const app = makeApp({
    getProtagonistImages: async () => new Map([
      ["news", { storage_object_id: "so-1", url: "https://example.com/news.jpg" }]
    ])
  });
  const res = await handle(app, "GET", "/api/audiences/aud-1/protagonist-images");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.data.images.news.url, "https://example.com/news.jpg");
});

test("POST /api/audiences/:id/protagonist-images/:category — returns 400 for invalid category", async () => {
  const app = makeApp();
  const res = await handle(app, "POST", "/api/audiences/aud-1/protagonist-images/invalid-cat", {
    photo: { file_data_base64: "abc", mime_type: "image/jpeg", file_name: "x.jpg", size_bytes: 3 }
  });
  assert.equal(res.status, 400);
  assert.ok(JSON.parse(res.body).error.includes("Invalid category"));
});

test("POST /api/audiences/:id/protagonist-images/:category — returns 400 for invalid mime_type", async () => {
  const app = makeApp();
  const res = await handle(app, "POST", "/api/audiences/aud-1/protagonist-images/news", {
    photo: { file_data_base64: "abc", mime_type: "image/bmp", file_name: "x.bmp", size_bytes: 3 }
  });
  assert.equal(res.status, 400);
  assert.ok(JSON.parse(res.body).error.includes("mime_type"));
});

test("POST /api/audiences/:id/protagonist-images/:category — returns 400 when photo exceeds 5 MB", async () => {
  const app = makeApp();
  const res = await handle(app, "POST", "/api/audiences/aud-1/protagonist-images/news", {
    photo: { file_data_base64: "abc", mime_type: "image/jpeg", file_name: "x.jpg", size_bytes: 6 * 1024 * 1024 }
  });
  assert.equal(res.status, 400);
  assert.ok(JSON.parse(res.body).error.includes("5 MB"));
});

test("POST /api/audiences/:id/protagonist-images/:category — returns 200 on success", async () => {
  const app = makeApp({
    upsertProtagonistImage: async () => "so-new"
  });
  const buf = Buffer.from("fake-image");
  const res = await handle(app, "POST", "/api/audiences/aud-1/protagonist-images/news", {
    photo: { file_data_base64: buf.toString("base64"), mime_type: "image/jpeg", file_name: "news.jpg", size_bytes: buf.length }
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).data.storage_object_id, "so-new");
});

test("DELETE /api/audiences/:id/protagonist-images/:category — returns 404 when no image set", async () => {
  const app = makeApp({
    deleteProtagonistImage: async () => false
  });
  const res = await handle(app, "DELETE", "/api/audiences/aud-1/protagonist-images/news");
  assert.equal(res.status, 404);
});

test("DELETE /api/audiences/:id/protagonist-images/:category — returns 200 on success", async () => {
  const app = makeApp({
    deleteProtagonistImage: async () => true
  });
  const res = await handle(app, "DELETE", "/api/audiences/aud-1/protagonist-images/news");
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).success, true);
});

test("POST /api/audiences/:id/photo — returns 404 for unknown audience", async () => {
  const app = makeApp();
  const buf = Buffer.from("img");
  const res = await handle(app, "POST", "/api/audiences/no-such/photo", {
    photo: { file_data_base64: buf.toString("base64"), mime_type: "image/jpeg", file_name: "x.jpg", size_bytes: buf.length }
  });
  assert.equal(res.status, 404);
});

test("POST /api/audiences/:id/photo — returns 200 on success", async () => {
  const app = makeApp({
    storeAudiencePhoto: async () => "storage-id"
  });
  const buf = Buffer.from("img");
  const res = await handle(app, "POST", "/api/audiences/aud-1/photo", {
    photo: { file_data_base64: buf.toString("base64"), mime_type: "image/jpeg", file_name: "x.jpg", size_bytes: buf.length }
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).success, true);
});
