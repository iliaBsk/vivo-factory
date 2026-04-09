import test from "node:test";
import assert from "node:assert/strict";

async function loadCatalogModule() {
  try {
    return await import("../src/catalog.js");
  } catch (error) {
    assert.fail(`expected src/catalog.js to exist: ${error.message}`);
  }
}

test("loadMerchantRegistry validates merchant templates and audience overrides", async () => {
  const { loadMerchantRegistry } = await loadCatalogModule();

  const registry = loadMerchantRegistry({
    merchants: [
      {
        merchant_id: "zara-es",
        domain: "zara.com",
        country: "ES",
        currency: "EUR",
        categories: ["beachwear", "sportswear"],
        adapter_type: "html",
        discovery_config: { listing_url: "https://www.zara.com/es/" },
        product_extractors: { title: ".title" },
        affiliate_url_template: "https://aff.example.com?target={{url}}",
        disclosure_template: "Affiliate selection from Zara",
        enabled: true
      }
    ],
    audienceOverrides: [
      {
        audience_id: "bald-high-man-early-40s-barcelona",
        allowed_merchants: ["zara-es"],
        blocked_merchants: [],
        category_weights: { beachwear: 3, sportswear: 2 },
        price_band: "mid-range",
        style_bias: ["sport", "beach"]
      }
    ]
  });

  assert.equal(registry.merchants[0].merchant_id, "zara-es");
  assert.equal(registry.overrides[0].audience_id, "bald-high-man-early-40s-barcelona");
});

test("loadMerchantRegistry rejects invalid affiliate templates", async () => {
  const { loadMerchantRegistry } = await loadCatalogModule();

  assert.throws(
    () =>
      loadMerchantRegistry({
        merchants: [
          {
            merchant_id: "bad",
            domain: "example.com",
            country: "ES",
            currency: "EUR",
            categories: [],
            adapter_type: "html",
            discovery_config: {},
            product_extractors: {},
            affiliate_url_template: "https://aff.example.com",
            disclosure_template: "ad",
            enabled: true
          }
        ],
        audienceOverrides: []
      }),
    /affiliate_url_template/
  );
});

test("normalizeProduct and rankProducts favor audience-matching style tags", async () => {
  const { normalizeProduct, rankProducts } = await loadCatalogModule();
  const merchant = {
    merchant_id: "zara-es",
    affiliate_url_template: "https://aff.example.com?target={{url}}"
  };
  const audience = {
    audience_id: "bald-high-man-early-40s-barcelona",
    location: "Barcelona",
    interests: ["beachwear", "sportswear"],
    shopping_bias: "mid-range"
  };

  const products = [
    normalizeProduct(merchant, {
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
    }),
    normalizeProduct(merchant, {
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
    })
  ];

  const ranked = rankProducts({
    audience,
    products,
    context: { season: "summer", occasion: "weekend", location: "Barcelona" }
  });

  assert.equal(ranked[0].product_id, "p1");
  assert.match(ranked[0].affiliate_url, /target=https%3A%2F%2Fwww\.zara\.com%2Fitem1/);
});

test("buildContentBrief and validateCandidate enforce approval data", async () => {
  const { buildContentBrief, validateCandidate } = await loadCatalogModule();
  const audience = {
    audience_id: "bald-high-man-early-40s-barcelona",
    label: "Barcelona family style",
    location: "Barcelona"
  };
  const products = [
    {
      product_id: "p1",
      title: "Beach Linen Shirt",
      affiliate_url: "https://aff.example.com/1",
      canonical_url: "https://www.zara.com/item1"
    }
  ];

  const brief = buildContentBrief({
    audience,
    topic: "Summer beachwear for family weekends",
    products,
    sourceLinks: ["https://weather.example.com/barcelona"],
    format: "image"
  });

  assert.deepEqual(brief.selected_products, ["p1"]);
  assert.match(brief.visual_prompt, /Beach Linen Shirt/);

  await assert.rejects(
    validateCandidate(brief, async () => ({ ok: false, reason: "stale offer" })),
    /stale offer/
  );
});
