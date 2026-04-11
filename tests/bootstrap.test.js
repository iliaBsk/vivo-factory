import test from "node:test";
import assert from "node:assert/strict";

async function loadBootstrapModule() {
  try {
    return await import("../src/bootstrap-lib.js");
  } catch (error) {
    assert.fail(`expected src/bootstrap-lib.js to exist: ${error.message}`);
  }
}

test("bootstrapAudiences seeds normalized audience facts into the profile graph", async () => {
  const { bootstrapAudiences } = await loadBootstrapModule();
  const calls = [];
  const markdown = `
<audience>
Bald high man in early 40s living in Barcelona, married with 8-10 year old boy. Loves beachwear and sportswear.
</audience>
<audience>
Creative single woman in her early 30s in Madrid, into yoga, running, summer festivals.
</audience>
`;

  const fallbackClient = {
    async updateFacts(facts) {
      calls.push({ type: "facts", facts });
      return { ok: true };
    },
    async storeDecision(decision) {
      calls.push({ type: "decision", decision });
      return { ok: true };
    }
  };

  const result = await bootstrapAudiences(markdown, {
    profileClientFactory(audience) {
      return {
        audienceId: audience.audience_id,
        ...fallbackClient
      };
    }
  });

  assert.equal(result.audiences.length, 2);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0], {
    type: "facts",
    facts: {
      audience_id: "bald-high-man-early-40s-barcelona",
      label: "Bald high man in early 40s living in Barcelona",
      language: "en",
      location: "Barcelona",
      family_context: "Married with a boy aged 8-10",
      interests: ["beachwear", "sportswear"],
      shopping_bias: "mid-range",
      content_pillars: ["shopping", "family", "style", "local_life"],
      excluded_topics: [],
      tone: "helpful",
      posting_schedule: "0 9,18 * * *"
    }
  });
  assert.equal(calls[1].type, "decision");
  assert.equal(calls[1].decision.decisionType, "audience_bootstrap");
});

test("bootstrapAudiences rejects markdown without audience tags", async () => {
  const { bootstrapAudiences } = await loadBootstrapModule();

  await assert.rejects(
    bootstrapAudiences("# No audiences here", {
      profileClientFactory() {
        return {
          async updateFacts() {},
          async storeDecision() {}
        };
      }
    }),
    /No audience definitions found/
  );
});

test("bootstrapAudiences provisions factory, audiences, and instances into the control plane", async () => {
  const { bootstrapAudiences } = await loadBootstrapModule();
  const provisioningCalls = [];
  const markdown = `
<audience>
Bald high man in early 40s living in Barcelona, married with 8-10 year old boy. Loves beachwear and sportswear.
</audience>
<audience>
Creative single woman in her early 30s in Madrid, into yoga, running, summer festivals.
</audience>
`;

  const result = await bootstrapAudiences(markdown, {
    factory: {
      factory_key: "vivo-factory",
      name: "Vivo Factory",
      description: "Audience manager control plane"
    },
    audienceRuntimeConfig: {
      "bald-high-man-early-40s-barcelona": {
        plugin_base_url: "http://127.0.0.1:5401",
        openclaw_admin_url: "http://127.0.0.1:7601"
      },
      "creative-single-woman-in-early-30s-madrid": {
        plugin_base_url: "http://127.0.0.1:5402",
        openclaw_admin_url: "http://127.0.0.1:7602"
      }
    },
    profileClientFactory() {
      return {
        async updateFacts() {
          return { ok: true };
        },
        async storeDecision() {
          return { ok: true };
        }
      };
    },
    provisioningClient: {
      async ensureFactory(factory) {
        provisioningCalls.push({ type: "factory", factory });
        return { id: "factory-1", ...factory };
      },
      async upsertAudience(factory, audience) {
        provisioningCalls.push({ type: "audience", factory, audience });
        return {
          id: `aud-${audience.audience_key}`,
          audience_key: audience.audience_key,
          label: audience.label
        };
      },
      async upsertInstance(factory, audience, instance) {
        provisioningCalls.push({ type: "instance", factory, audience, instance });
        return {
          id: `inst-${audience.audience_key}`,
          audience_id: audience.id,
          instance_key: instance.instance_key,
          service_name: instance.service_name
        };
      }
    }
  });

  assert.equal(provisioningCalls.length, 5);
  assert.deepEqual(provisioningCalls[0], {
    type: "factory",
    factory: {
      factory_key: "vivo-factory",
      name: "Vivo Factory",
      description: "Audience manager control plane"
    }
  });
  assert.equal(provisioningCalls[1].audience.audience_key, "bald-high-man-early-40s-barcelona");
  assert.equal(provisioningCalls[2].instance.service_name, "bald-high-man-early-40s-barcelona-openclaw");
  assert.equal(result.factory.id, "factory-1");
  assert.equal(result.audiences[0].id, "aud-bald-high-man-early-40s-barcelona");
  assert.equal(result.instances[1].instance_key, "creative-single-woman-in-early-30s-madrid-openclaw");
});
