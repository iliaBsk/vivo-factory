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
