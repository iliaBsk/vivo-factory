import test from "node:test";
import assert from "node:assert/strict";

async function loadSetupModule() {
  try {
    return await import("../src/setup-service.js");
  } catch (error) {
    assert.fail(`expected src/setup-service.js to exist: ${error.message}`);
  }
}

test("createSetupService reports missing Supabase and LLM configuration without crashing", async () => {
  const { createSetupService } = await loadSetupModule();
  const service = createSetupService({
    envConfig: {}
  });

  const status = await service.getStatus();

  assert.equal(status.ready, false);
  assert.equal(status.checks.supabase_config.ok, false);
  assert.equal(status.checks.llm_config.ok, false);
  assert.equal(status.checks.story_admin.ok, true);
});

test("createSetupService verifies remote Supabase and global LLM defaults", async () => {
  const { createSetupService } = await loadSetupModule();
  const fetchCalls = [];
  const service = createSetupService({
    envConfig: {
      SUPABASE_URL: "https://supabase.example.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-4.1-mini"
    },
    fetchImpl: async (input) => {
      fetchCalls.push(String(input));
      return {
        ok: true,
        async text() {
          return "[]";
        }
      };
    }
  });

  const status = await service.getStatus();

  assert.equal(status.ready, true);
  assert.equal(status.llm.provider, "openai");
  assert.equal(status.llm.model, "gpt-4.1-mini");
  assert.equal(status.checks.supabase_connection.ok, true);
  assert.ok(fetchCalls[0].includes("/rest/v1/vivo_audiences"));
});
