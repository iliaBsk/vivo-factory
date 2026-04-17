import test from "node:test";
import assert from "node:assert/strict";
import { createRepository, createFileRepository } from "../src/repository.js";

const SEED_MERCHANTS = [
  {
    merchant_id: "zara-es",
    name: "Zara Spain",
    domain: "zara.com",
    country: "ES",
    currency: "EUR",
    network: "awin",
    network_merchant_code: "13623",
    affiliate_url_template: "https://www.awin1.com/cread.php?awinmid=13623&awinaffid={{publisher_id}}&ued={{url}}",
    publisher_id: null,
    needs_setup: true,
    enabled: true,
    categories: ["fashion", "casualwear"],
    disclosure_text: "Affiliate links included.",
    created_at: "2026-04-17T00:00:00.000Z",
    updated_at: "2026-04-17T00:00:00.000Z"
  },
  {
    merchant_id: "decathlon-es",
    name: "Decathlon ES",
    domain: "decathlon.es",
    country: "ES",
    currency: "EUR",
    network: "awin",
    network_merchant_code: "16558",
    affiliate_url_template: "https://www.awin1.com/cread.php?awinmid=16558&awinaffid={{publisher_id}}&ued={{url}}",
    publisher_id: "999888",
    needs_setup: false,
    enabled: true,
    categories: ["sports"],
    disclosure_text: "Affiliate links included.",
    created_at: "2026-04-17T00:00:00.000Z",
    updated_at: "2026-04-17T00:00:00.000Z"
  }
];

const SEED_OVERRIDES = [
  {
    merchant_id: "zara-es",
    audience_id: "bald-barcelona",
    enabled: true,
    boost_tags: [{ tag: "beachwear", weight: 3 }]
  }
];

function makeRepo() {
  return createRepository({ merchants: SEED_MERCHANTS, merchantOverrides: SEED_OVERRIDES });
}

test("listMerchants returns all merchants sorted by name", () => {
  const repo = makeRepo();
  const merchants = repo.listMerchants();
  assert.equal(merchants.length, 2);
  assert.equal(merchants[0].merchant_id, "decathlon-es");
  assert.equal(merchants[1].merchant_id, "zara-es");
});

test("getMerchant returns null for unknown id", () => {
  const repo = makeRepo();
  assert.equal(repo.getMerchant("no-such-merchant"), null);
});

test("getMerchant returns merchant object for known id", () => {
  const repo = makeRepo();
  const merchant = repo.getMerchant("zara-es");
  assert.equal(merchant.merchant_id, "zara-es");
  assert.equal(merchant.name, "Zara Spain");
  assert.equal(merchant.needs_setup, true);
});

test("updateMerchant patches fields and sets needs_setup=false when publisher_id provided", () => {
  const repo = makeRepo();
  const updated = repo.updateMerchant("zara-es", { publisher_id: "123456" });
  assert.equal(updated.publisher_id, "123456");
  assert.equal(updated.needs_setup, false);
});

test("updateMerchant sets needs_setup=true when publisher_id cleared", () => {
  const repo = makeRepo();
  const updated = repo.updateMerchant("decathlon-es", { publisher_id: "" });
  assert.equal(updated.publisher_id, "");
  assert.equal(updated.needs_setup, true);
});

test("updateMerchant patches enabled without affecting other fields", () => {
  const repo = makeRepo();
  const updated = repo.updateMerchant("zara-es", { enabled: false });
  assert.equal(updated.enabled, false);
  assert.equal(updated.needs_setup, true);
  assert.equal(updated.name, "Zara Spain");
});

test("updateMerchant throws for unknown merchant_id", () => {
  const repo = makeRepo();
  assert.throws(() => repo.updateMerchant("no-such-merchant", { enabled: false }), /not found/i);
});

test("listMerchantOverrides returns overrides for a given merchant", () => {
  const repo = makeRepo();
  const overrides = repo.listMerchantOverrides("zara-es");
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].audience_id, "bald-barcelona");
});

test("listMerchantOverrides returns empty array for merchant with no overrides", () => {
  const repo = makeRepo();
  const overrides = repo.listMerchantOverrides("decathlon-es");
  assert.deepEqual(overrides, []);
});

test("upsertMerchantOverride creates new override", () => {
  const repo = makeRepo();
  const override = repo.upsertMerchantOverride("decathlon-es", "aleks-barcelona", { enabled: false });
  assert.equal(override.merchant_id, "decathlon-es");
  assert.equal(override.audience_id, "aleks-barcelona");
  assert.equal(override.enabled, false);
});

test("upsertMerchantOverride updates existing override", () => {
  const repo = makeRepo();
  repo.upsertMerchantOverride("zara-es", "bald-barcelona", { enabled: false });
  const overrides = repo.listMerchantOverrides("zara-es");
  assert.equal(overrides[0].enabled, false);
  assert.deepEqual(overrides[0].boost_tags, [{ tag: "beachwear", weight: 3 }]);
});

test("upsertMerchantOverride preserves existing boost_tags when only enabled is patched", () => {
  const repo = makeRepo();
  // zara-es/bald-barcelona already has boost_tags in seed
  repo.upsertMerchantOverride("zara-es", "bald-barcelona", { enabled: false });
  const overrides = repo.listMerchantOverrides("zara-es");
  assert.equal(overrides[0].enabled, false);
  assert.deepEqual(overrides[0].boost_tags, [{ tag: "beachwear", weight: 3 }]);
});

test("FileRepository persists merchant updates across instances", async () => {
  const filePath = `/tmp/test-merchants-${Date.now()}.json`;
  const repo1 = createFileRepository(filePath, { merchants: SEED_MERCHANTS, merchantOverrides: SEED_OVERRIDES });
  repo1.updateMerchant("zara-es", { publisher_id: "777777" });

  const repo2 = createFileRepository(filePath);
  const merchant = repo2.getMerchant("zara-es");
  assert.equal(merchant.publisher_id, "777777");
  assert.equal(merchant.needs_setup, false);
});

// ─── Supabase mock tests ───────────────────────────────────────────────────

function makeSupabaseRepo() {
  return import("../src/repository.js").then(({ createSupabaseRepository }) => {
    const store = {
      vivo_merchants: SEED_MERCHANTS.map((m) => ({ ...m })),
      vivo_merchant_audience_overrides: SEED_OVERRIDES.map((o) => ({ ...o }))
    };

    const fakeFetch = async (urlOrString, opts = {}) => {
      const urlStr = typeof urlOrString === "string" ? urlOrString : urlOrString.toString();
      const table = urlStr.match(/\/rest\/v1\/([^?]+)/)?.[1];
      const method = opts.method ?? "GET";
      const prefer = opts.headers?.prefer ?? "";

      let rows = store[table] ? [...store[table]] : [];

      if (method === "GET" || !method) {
        const params = new URLSearchParams(urlStr.split("?")[1] ?? "");
        const midFilter = params.get("merchant_id");
        if (midFilter?.startsWith("eq.")) {
          rows = rows.filter((r) => r.merchant_id === midFilter.slice(3));
        }
        return { ok: true, json: async () => rows, text: async () => JSON.stringify(rows) };
      }

      const body = JSON.parse(opts.body ?? "{}");

      if (method === "PATCH") {
        const params = new URLSearchParams(urlStr.split("?")[1] ?? "");
        const midFilter = params.get("merchant_id");
        if (midFilter?.startsWith("eq.")) {
          const val = midFilter.slice(3);
          store[table] = store[table].map((r) => r.merchant_id === val ? { ...r, ...body } : r);
          const updated = store[table].filter((r) => r.merchant_id === val);
          return { ok: true, json: async () => updated, text: async () => JSON.stringify(updated) };
        }
      }

      if (method === "POST" && prefer.includes("merge-duplicates")) {
        const existingIdx = store[table].findIndex(
          (r) => r.merchant_id === body.merchant_id && r.audience_id === body.audience_id
        );
        if (existingIdx >= 0) {
          store[table][existingIdx] = { ...store[table][existingIdx], ...body };
          return { ok: true, json: async () => [store[table][existingIdx]], text: async () => JSON.stringify([store[table][existingIdx]]) };
        }
        store[table].push(body);
        return { ok: true, json: async () => [body], text: async () => JSON.stringify([body]) };
      }

      return { ok: true, json: async () => [], text: async () => "[]" };
    };

    return createSupabaseRepository({
      url: "http://fake-supabase.local",
      serviceRoleKey: "fake-key",
      fetchImpl: fakeFetch
    });
  });
}

test("Supabase: listMerchants returns all merchants", async () => {
  const repo = await makeSupabaseRepo();
  const merchants = await repo.listMerchants();
  assert.equal(merchants.length, 2);
});

test("Supabase: getMerchant returns null for unknown", async () => {
  const repo = await makeSupabaseRepo();
  const result = await repo.getMerchant("no-such");
  assert.equal(result, null);
});

test("Supabase: getMerchant returns merchant for known id", async () => {
  const repo = await makeSupabaseRepo();
  const merchant = await repo.getMerchant("zara-es");
  assert.equal(merchant.merchant_id, "zara-es");
});

test("Supabase: updateMerchant sets needs_setup=false when publisher_id given", async () => {
  const repo = await makeSupabaseRepo();
  const updated = await repo.updateMerchant("zara-es", { publisher_id: "555555" });
  assert.equal(updated.publisher_id, "555555");
  assert.equal(updated.needs_setup, false);
});

test("Supabase: upsertMerchantOverride creates new override", async () => {
  const repo = await makeSupabaseRepo();
  const override = await repo.upsertMerchantOverride("decathlon-es", "aleks-barcelona", { enabled: false });
  assert.equal(override.merchant_id, "decathlon-es");
  assert.equal(override.audience_id, "aleks-barcelona");
  assert.equal(override.enabled, false);
});

test("Supabase: listMerchantOverrides returns overrides for merchant", async () => {
  const repo = await makeSupabaseRepo();
  const overrides = await repo.listMerchantOverrides("zara-es");
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].audience_id, "bald-barcelona");
});
