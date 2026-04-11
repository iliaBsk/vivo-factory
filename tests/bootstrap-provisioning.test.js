import test from "node:test";
import assert from "node:assert/strict";

async function loadProvisioningModule() {
  try {
    return await import("../src/bootstrap-provisioning.js");
  } catch (error) {
    assert.fail(`expected src/bootstrap-provisioning.js to exist: ${error.message}`);
  }
}

test("createSupabaseProvisioningClient upserts factory, audience, and instance rows", async () => {
  const { createSupabaseProvisioningClient } = await loadProvisioningModule();
  const requests = [];
  const client = createSupabaseProvisioningClient({
    url: "https://supabase.example.co",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      requests.push({
        method: options.method ?? "GET",
        pathname: url.pathname,
        search: url.search,
        body: options.body ? JSON.parse(options.body) : null
      });

      if (url.pathname === "/rest/v1/vivo_factories") {
        return jsonResponse([
          {
            id: "factory-1",
            factory_key: "vivo-factory",
            name: "Vivo Factory"
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
            service_name: "barcelona-family-openclaw"
          }
        ]);
      }

      throw new Error(`unexpected request ${url.pathname}`);
    }
  });

  const factory = await client.ensureFactory({
    factory_key: "vivo-factory",
    name: "Vivo Factory",
    description: "Audience manager control plane"
  });
  const audience = await client.upsertAudience(factory, {
    audience_key: "barcelona-family",
    label: "Barcelona Family",
    language: "en",
    location: "Barcelona",
    family_context: "Married with one child",
    interests: ["beachwear"],
    content_pillars: ["family"],
    excluded_topics: [],
    tone: "helpful",
    profile_snapshot: { mood: "practical" },
    status: "active"
  });
  const instance = await client.upsertInstance(factory, audience, {
    instance_key: "barcelona-family-openclaw",
    service_name: "barcelona-family-openclaw",
    profile_service_name: "barcelona-family-profile",
    openclaw_admin_url: "http://127.0.0.1:7601",
    profile_base_url: "http://127.0.0.1:5401"
  });

  assert.equal(factory.id, "factory-1");
  assert.equal(audience.id, "aud-1");
  assert.equal(instance.id, "inst-1");
  assert.equal(requests.length, 3);
  assert.match(requests[0].search, /on_conflict=factory_key/);
  assert.match(requests[1].search, /on_conflict=audience_key/);
  assert.match(requests[2].search, /on_conflict=audience_id/);
});

function jsonResponse(payload) {
  return {
    ok: true,
    async text() {
      return JSON.stringify(payload);
    }
  };
}
