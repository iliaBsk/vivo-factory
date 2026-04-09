import test from "node:test";
import assert from "node:assert/strict";

async function loadContentPipelineModule() {
  try {
    return await import("../src/content-pipeline.js");
  } catch (error) {
    assert.fail(`expected src/content-pipeline.js to exist: ${error.message}`);
  }
}

test("createContentCandidate uses graph-backed profile summary and ranked products", async () => {
  const { createContentCandidate } = await loadContentPipelineModule();
  const profileClient = {
    async getSummary() {
      return {
        ok: true,
        data: {
          profile: {
            interests: ["beachwear", "sportswear"],
            tone: "direct",
            location: "Barcelona",
            label: "Barcelona family style"
          }
        }
      };
    }
  };

  const candidate = await createContentCandidate({
    audience: {
      audience_id: "aud-1",
      label: "Bootstrap label",
      location: "Barcelona"
    },
    profileClient,
    merchant: {
      merchant_id: "zara-es",
      affiliate_url_template: "https://aff.example.com?target={{url}}"
    },
    products: [
      {
        product_id: "p1",
        title: "Beach Linen Shirt",
        brand: "Zara",
        category: "beachwear",
        price: 39.99,
        currency: "EUR",
        availability: "in_stock",
        canonical_url: "https://www.zara.com/item1",
        image_urls: ["https://img.example.com/1.jpg"],
        style_tags: ["beach", "summer"],
        gender_fit: "male",
        occasion_tags: ["weekend"],
        season_tags: ["summer"],
        locale_tags: ["Barcelona"]
      },
      {
        product_id: "p2",
        title: "Formal Wool Coat",
        brand: "Zara",
        category: "formalwear",
        price: 199.99,
        currency: "EUR",
        availability: "in_stock",
        canonical_url: "https://www.zara.com/item2",
        image_urls: ["https://img.example.com/2.jpg"],
        style_tags: ["formal", "winter"],
        gender_fit: "male",
        occasion_tags: ["office"],
        season_tags: ["winter"],
        locale_tags: ["Madrid"]
      }
    ],
    context: {
      season: "summer",
      occasion: "weekend",
      location: "Barcelona"
    },
    sourceLinks: ["https://weather.example.com/barcelona"]
  });

  assert.equal(candidate.audience_id, "aud-1");
  assert.equal(candidate.status, "pending");
  assert.equal(candidate.selected_products[0], "p1");
  assert.match(candidate.visual_prompt, /Barcelona family style/);
});
