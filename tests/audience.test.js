import test from "node:test";
import assert from "node:assert/strict";

async function loadAudienceModule() {
  try {
    return await import("../src/audience.js");
  } catch (error) {
    assert.fail(`expected src/audience.js to exist: ${error.message}`);
  }
}

test("extractAudiences returns 5 audience blocks from markdown", async () => {
  const { extractAudiences } = await loadAudienceModule();
  const markdown = `
# Audience Groups

<audience>
Bald high man in early 40s living in Barcelona, married with 8-10 year old boy.
Loves beachwear, football, weekend family plans.
</audience>

<audience>
Creative single woman in her early 30s in Madrid, into yoga, running, summer festivals.
</audience>

<audience>
Remote-working father in Valencia, late 30s, interested in family tech and casual style.
</audience>

<audience>
Luxury traveler couple in Marbella, early 50s, wants restaurant and resort style inspiration.
</audience>

<audience>
Young parents in Seville with two children, price-sensitive, searching practical family fashion.
</audience>
`;

  const audiences = extractAudiences(markdown);

  assert.equal(audiences.length, 5);
  assert.match(audiences[0], /Barcelona/);
});

test("normalizeAudience converts freeform audience text into canonical fields", async () => {
  const { normalizeAudience } = await loadAudienceModule();

  const audience = normalizeAudience(
    "Bald high man in early 40s living in Barcelona, married with 8-10 year old boy. Loves beachwear and sportswear."
  );

  assert.deepEqual(audience, {
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
  });
});

test("normalizeAudience rejects empty audience descriptions", async () => {
  const { normalizeAudience } = await loadAudienceModule();

  assert.throws(() => normalizeAudience("   "), /Audience description must not be empty/);
});

test("normalizeAudience infers location from broader phrasings without duplicating slugs", async () => {
  const { normalizeAudience } = await loadAudienceModule();

  const audience = normalizeAudience(
    "Creative single woman in early 30s living in Madrid. Interested in yoga, running, summer festivals."
  );

  assert.equal(audience.location, "Madrid");
  assert.equal(audience.audience_id, "creative-single-woman-in-early-30s-madrid");
});
