import test from "node:test";
import assert from "node:assert/strict";

async function loadProfileClientModule() {
  try {
    return await import("../src/profile-client.js");
  } catch (error) {
    assert.fail(`expected src/profile-client.js to exist: ${error.message}`);
  }
}

test("createProfileClient writes audience facts to the user-profile plugin route", async () => {
  const { createProfileClient } = await loadProfileClientModule();
  const requests = [];
  const client = createProfileClient({
    baseUrl: "http://127.0.0.1:5400",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { ok: true, data: { summary: "stored" }, warnings: [], errors: [] };
        }
      };
    }
  });

  const response = await client.updateFacts({ audience_id: "aud-1", location: "Barcelona" });

  assert.equal(response.data.summary, "stored");
  assert.deepEqual(requests[0], {
    url: "http://127.0.0.1:5400/user-profile/profile/facts",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audience_id: "aud-1", location: "Barcelona" })
    }
  });
});

test("createProfileClient stores decisions and reads graph summary", async () => {
  const { createProfileClient } = await loadProfileClientModule();
  const requests = [];
  const client = createProfileClient({
    baseUrl: "http://127.0.0.1:5400",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          if (url.endsWith("/summary")) {
            return { ok: true, data: { profile: { tone: "helpful" } }, warnings: [], errors: [] };
          }
          return { ok: true, data: { status: "ok" }, warnings: [], errors: [] };
        }
      };
    }
  });

  await client.storeDecision({ decisionId: "d1", decisionType: "audience_bootstrap", content: { audience_id: "aud-1" } });
  const summary = await client.getSummary();

  assert.equal(requests[0].url, "http://127.0.0.1:5400/user-profile/profile/decisions");
  assert.equal(requests[1].url, "http://127.0.0.1:5400/user-profile/graph/summary");
  assert.deepEqual(summary.data.profile, { tone: "helpful" });
});

test("createProfileClient rejects non-loopback plugin endpoints", async () => {
  const { createProfileClient } = await loadProfileClientModule();

  assert.throws(() => createProfileClient({ baseUrl: "http://plugin:5400" }), /loopback/);
});
