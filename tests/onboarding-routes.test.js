import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createOnboardingRelay } from "../src/onboarding-relay.js";

function makeApp(overrides = {}) {
  const relay = createOnboardingRelay();
  const app = createApp({
    repository: null,
    onboardingRelay: relay,
    n8nConfig: {
      onboarding_photo_webhook: "http://localhost:19999/photo",
      onboarding_handle_webhook: "http://localhost:19999/handle",
      onboarding_upload_webhook: "http://localhost:19999/upload",
      onboarding_manual_webhook: "http://localhost:19999/manual",
      character_map_webhook: "http://localhost:19999/character-map"
    },
    vivoFactoryUrl: "http://localhost:4310",
    fetchImpl: overrides.fetchImpl ?? (async () => {
      throw new Error("fetch not expected");
    }),
    ...overrides
  });
  return { app, relay };
}

test("POST /api/onboarding/photo — returns 400 when image_base64 missing", async () => {
  const { app } = makeApp();
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/photo",
    body: JSON.stringify({ mime_type: "image/jpeg" })
  });
  assert.equal(result.status, 400);
  assert.ok(JSON.parse(result.body).error.includes("image_base64"));
});

test("POST /api/onboarding/photo — returns 400 for disallowed mime_type", async () => {
  const { app } = makeApp();
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/photo",
    body: JSON.stringify({ image_base64: "abc", mime_type: "image/gif" })
  });
  assert.equal(result.status, 400);
});

test("POST /api/onboarding/photo — proxies N8N response on success", async () => {
  const photoContext = { gender_presentation: "male", age_range: "40s" };
  const { app } = makeApp({
    fetchImpl: async () => ({
      ok: true,
      json: async () => photoContext
    })
  });
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/photo",
    body: JSON.stringify({ image_base64: "abc", mime_type: "image/jpeg" })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), photoContext);
});

test("POST /api/onboarding/start — returns 400 for invalid mode", async () => {
  const { app } = makeApp();
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/start",
    body: JSON.stringify({ mode: "unknown" })
  });
  assert.equal(result.status, 400);
  assert.ok(JSON.parse(result.body).error.includes("mode"));
});

test("POST /api/onboarding/start — creates job and returns job_id", async () => {
  const { app } = makeApp({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  });
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/start",
    body: JSON.stringify({ mode: "handle", payload: { handle: "andrewchen" } })
  });
  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.ok(typeof body.job_id === "string" && body.job_id.length > 0);
});

test("GET /api/onboarding/stream/:id — returns SSE hijack sentinel", async () => {
  const { app, relay } = makeApp();
  relay.startJob("test-job-999");
  const result = await app.handle({
    method: "GET", pathname: "/api/onboarding/stream/test-job-999", body: ""
  });
  assert.equal(result.__hijack, true);
  assert.equal(result.type, "sse");
  assert.equal(result.jobId, "test-job-999");
  relay.cancelJob("test-job-999");
});

test("POST /api/onboarding/jobs/:id/event — returns 200 ok", async () => {
  const { app, relay } = makeApp();
  relay.startJob("ev-job");

  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/jobs/ev-job/event",
    body: JSON.stringify({ label: "Fetching profile…" })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
  relay.cancelJob("ev-job");
});

test("POST /api/onboarding/character-map — returns 400 when image_base64 missing", async () => {
  const { app } = makeApp();
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/character-map",
    body: JSON.stringify({ mime_type: "image/jpeg" })
  });
  assert.equal(result.status, 400);
  assert.ok(JSON.parse(result.body).error.includes("image_base64"));
});

test("POST /api/onboarding/character-map — returns 503 when webhook not configured", async () => {
  const relay = createOnboardingRelay();
  const app = createApp({
    repository: null, onboardingRelay: relay,
    n8nConfig: {},
    fetchImpl: async () => { throw new Error("should not be called"); }
  });
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/character-map",
    body: JSON.stringify({ image_base64: "abc", mime_type: "image/jpeg" })
  });
  assert.equal(result.status, 503);
});

test("POST /api/onboarding/character-map — proxies N8N response on success", async () => {
  const charMap = { character_map_base64: "base64data==", format: "jpeg", grid: "3x3" };
  const { app } = makeApp({
    fetchImpl: async () => ({ ok: true, json: async () => charMap })
  });
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/character-map",
    body: JSON.stringify({ image_base64: "abc", mime_type: "image/png", photo_context: { description: "woman, 30s" } })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), charMap);
});

test("POST /api/onboarding/jobs/:id/complete — returns 200 ok", async () => {
  const { app, relay } = makeApp();
  relay.startJob("comp-job");

  const persona = { biographical: { name: { value: "Test" } } };
  const result = await app.handle({
    method: "POST", pathname: "/api/onboarding/jobs/comp-job/complete",
    body: JSON.stringify({ persona })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
});
