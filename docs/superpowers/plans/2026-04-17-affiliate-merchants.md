# Affiliate Merchants Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move merchant and affiliate data from `config/merchant-registry.json` into Supabase, expose CRUD API endpoints, and add a Merchants tab to the admin dashboard with a table + 40%-width slide-out drawer.

**Architecture:** Two new Supabase tables (`vivo_merchants`, `vivo_merchant_audience_overrides`) replace the static JSON config. `src/repository.js` gains five new merchant methods (both File and Supabase backends). `src/content-fetcher.js` loads active merchants from the repository at runtime. `src/app.js` gets five new API routes and a new `renderMerchantsWorkspace` function.

**Tech Stack:** Node.js (ESM), Supabase PostgREST, node:test + node:assert/strict, Tailwind CSS (server-rendered HTML in app.js + tremor-dashboard.js).

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/20260417200000_vivo_merchants.sql` | Create (new tables + seed) |
| `src/repository.js` | Modify (merchant methods in all 3 backends) |
| `tests/repository-merchants.test.js` | Create (tests for File + Supabase backends) |
| `src/catalog.js` | Modify (`normalizeProduct` handles `{{publisher_id}}`) |
| `tests/catalog.test.js` | Modify (add publisher_id substitution test) |
| `src/content-fetcher.js` | Modify (load merchants from repository) |
| `tests/content-fetcher.test.js` | Modify (pass listMerchants stub) |
| `src/server.js` | Modify (remove merchantRegistryConfig) |
| `src/app.js` | Modify (5 API routes + merchants workspace + drawer) |
| `src/tremor-dashboard.js` | Modify (add Merchants tab to sidebar) |

---

## Task 1: Supabase Migration

**Files:**
- Create: `supabase/migrations/20260417200000_vivo_merchants.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260417200000_vivo_merchants.sql

create table if not exists public.vivo_merchants (
  id                    uuid primary key default gen_random_uuid(),
  merchant_id           text unique not null,
  name                  text not null,
  domain                text not null,
  country               text not null default 'ES',
  currency              text not null default 'EUR',
  network               text,
  network_merchant_code text,
  affiliate_url_template text,
  publisher_id          text,
  needs_setup           boolean not null default true,
  enabled               boolean not null default true,
  categories            text[] not null default '{}',
  disclosure_text       text not null default 'Affiliate links included.',
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

create table if not exists public.vivo_merchant_audience_overrides (
  id          uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.vivo_merchants(merchant_id) on delete cascade,
  audience_id text not null,
  enabled     boolean not null default true,
  boost_tags  jsonb not null default '[]',
  unique(merchant_id, audience_id)
);

create index if not exists vivo_merchants_enabled_idx
  on public.vivo_merchants (enabled, needs_setup);

create index if not exists vivo_merchant_audience_overrides_merchant_idx
  on public.vivo_merchant_audience_overrides (merchant_id);

-- Seed: 15 merchants. All marked needs_setup=true — admin must enter publisher_id.
-- Awin template: awinmid=MERCHANT_CODE, awinaffid=PUBLISHER_ID
-- CJ template: click-PUBLISHER_ID-MERCHANT_CODE

insert into public.vivo_merchants
  (merchant_id, name, domain, country, currency, network, network_merchant_code, affiliate_url_template, needs_setup, enabled, categories)
values
  ('zara-es',          'Zara Spain',         'zara.com',           'ES', 'EUR', 'awin', '13623',  'https://www.awin1.com/cread.php?awinmid=13623&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{fashion,casualwear,beachwear}'),
  ('hm-es',            'H&M Spain',          'hm.com',             'ES', 'EUR', 'awin', '6614',   'https://www.awin1.com/cread.php?awinmid=6614&awinaffid={{publisher_id}}&ued={{url}}',    true, true, '{fashion,casualwear}'),
  ('uniqlo-eu',        'Uniqlo EU',          'uniqlo.com',         'EU', 'EUR', 'awin', '15192',  'https://www.awin1.com/cread.php?awinmid=15192&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{fashion,casualwear,sportswear}'),
  ('ikea-es',          'IKEA Spain',         'ikea.com',           'ES', 'EUR', 'awin', '6678',   'https://www.awin1.com/cread.php?awinmid=6678&awinaffid={{publisher_id}}&ued={{url}}',    true, true, '{home,furniture}'),
  ('decathlon-es',     'Decathlon ES',       'decathlon.es',       'ES', 'EUR', 'awin', '16558',  'https://www.awin1.com/cread.php?awinmid=16558&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{sports,outdoors,sportswear}'),
  ('mango-es',         'Mango ES',           'mango.com',          'ES', 'EUR', 'awin', '13608',  'https://www.awin1.com/cread.php?awinmid=13608&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{fashion,womenswear}'),
  ('elcorteingles-es', 'El Corte Inglés',    'elcorteingles.es',   'ES', 'EUR', 'awin', '10680',  'https://www.awin1.com/cread.php?awinmid=10680&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{fashion,home,electronics}'),
  ('nike-es',          'Nike ES',            'nike.com',           'ES', 'EUR', 'awin', '13660',  'https://www.awin1.com/cread.php?awinmid=13660&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{sports,sportswear,footwear}'),
  ('adidas-es',        'Adidas ES',          'adidas.es',          'ES', 'EUR', 'awin', '9585',   'https://www.awin1.com/cread.php?awinmid=9585&awinaffid={{publisher_id}}&ued={{url}}',    true, true, '{sports,sportswear,footwear}'),
  ('amazon-es',        'Amazon ES',          'amazon.es',          'ES', 'EUR', 'awin', '13557',  'https://www.awin1.com/cread.php?awinmid=13557&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{general,electronics,books}'),
  ('booking-com',      'Booking.com',        'booking.com',        'ES', 'EUR', 'awin', '596',    'https://www.awin1.com/cread.php?awinmid=596&awinaffid={{publisher_id}}&ued={{url}}',     true, true, '{travel,hotels}'),
  ('getyourguide-es',  'GetYourGuide ES',    'getyourguide.es',    'ES', 'EUR', 'awin', '19404',  'https://www.awin1.com/cread.php?awinmid=19404&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{travel,experiences,entertainment}'),
  ('fever-es',         'Fever ES',           'fever.com',          'ES', 'EUR', 'direct', null,   null,                                                                                     true, true, '{entertainment,events,nightlife}'),
  ('ticketmaster-es',  'Ticketmaster ES',    'ticketmaster.es',    'ES', 'EUR', 'cj',   '5361948','https://www.anrdoezrs.net/click-{{publisher_id}}-5361948?url={{url}}',                  true, true, '{entertainment,events,concerts}'),
  ('livenation-es',    'Live Nation ES',     'livenation.es',      'ES', 'EUR', null,    null,    null,                                                                                     false, true, '{entertainment,events,concerts}')
on conflict (merchant_id) do nothing;
```

- [ ] **Step 2: Verify the file was created**

```bash
ls supabase/migrations/ | sort
```

Expected: `20260417200000_vivo_merchants.sql` is in the list.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417200000_vivo_merchants.sql
git commit -m "feat: add vivo_merchants and vivo_merchant_audience_overrides migration with seed data"
```

---

## Task 2: FileRepository Merchant Methods (TDD)

**Files:**
- Create: `tests/repository-merchants.test.js`
- Modify: `src/repository.js`

- [ ] **Step 1: Write failing tests**

Create `tests/repository-merchants.test.js`:

```javascript
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

test("FileRepository persists merchant updates across instances", async () => {
  const filePath = `/tmp/test-merchants-${Date.now()}.json`;
  const repo1 = createFileRepository(filePath, { merchants: SEED_MERCHANTS, merchantOverrides: SEED_OVERRIDES });
  repo1.updateMerchant("zara-es", { publisher_id: "777777" });

  const repo2 = createFileRepository(filePath);
  const merchant = repo2.getMerchant("zara-es");
  assert.equal(merchant.publisher_id, "777777");
  assert.equal(merchant.needs_setup, false);
});
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
node --test tests/repository-merchants.test.js 2>&1 | tail -20
```

Expected: `TypeError: repo.listMerchants is not a function` or similar.

- [ ] **Step 3: Add merchants to `normalizeState()` in `src/repository.js`**

Find the `function normalizeState(seed)` block (around line 1009) and add two lines:

```javascript
function normalizeState(seed) {
  return {
    audiences: new Map((seed.audiences ?? []).map((item) => [item.id, { ...item }])),
    instances: new Map((seed.instances ?? []).map((item) => [item.id, { ...item }])),
    stories: new Map((seed.stories ?? []).map((item) => [item.id, { ...item }])),
    storyAssets: new Map((seed.storyAssets ?? []).map((item) => [item.id, { ...item }])),
    storageObjects: new Map((seed.storageObjects ?? []).map((item) => [item.id, { ...item }])),
    contentFetchJobs: new Map((seed.contentFetchJobs ?? []).map((item) => [item.id, { ...item }])),
    merchants: new Map((seed.merchants ?? []).map((item) => [item.merchant_id, { ...item }])),
    merchantOverrides: new Map((seed.merchantOverrides ?? []).map((item) => [`${item.merchant_id}:${item.audience_id}`, { ...item }])),
    storyReviews: [...(seed.storyReviews ?? [])],
    storyPublications: [...(seed.storyPublications ?? [])],
    auditEvents: [...(seed.auditEvents ?? seed.auditLog ?? [])].map(normalizeAuditEvent),
    feedbackEvents: [...(seed.feedbackEvents ?? [])],
    instanceReports: [...(seed.instanceReports ?? [])],
    operatorChats: [...(seed.operatorChats ?? [])],
    deployments: [...(seed.deployments ?? [])],
    conversations: Object.fromEntries(
      Object.entries(seed.conversations ?? {}).map(([k, v]) => [k, { ...v, _messages: [] }])
    )
  };
}
```

- [ ] **Step 4: Add merchants to `exportState()` in `src/repository.js`**

Find the `function exportState(state)` block (around line 1030) and add two lines:

```javascript
function exportState(state) {
  return {
    audiences: [...state.audiences.values()],
    instances: [...state.instances.values()],
    stories: [...state.stories.values()],
    storyAssets: [...state.storyAssets.values()],
    storageObjects: [...state.storageObjects.values()],
    contentFetchJobs: [...state.contentFetchJobs.values()],
    merchants: [...state.merchants.values()],
    merchantOverrides: [...state.merchantOverrides.values()],
    storyReviews: [...state.storyReviews],
    storyPublications: [...state.storyPublications],
    auditEvents: [...state.auditEvents],
    feedbackEvents: [...state.feedbackEvents],
    instanceReports: [...state.instanceReports],
    operatorChats: [...state.operatorChats],
    deployments: [...state.deployments],
    conversations: Object.fromEntries(
      Object.entries(state.conversations).map(([k, { _messages, ...rest }]) => [k, rest])
    )
  };
}
```

- [ ] **Step 5: Add merchant methods to `createRepository()` in `src/repository.js`**

Find the `return {` block inside `createRepository()` (around line 11) and add these methods before the closing `};`:

```javascript
    listMerchants() {
      return [...state.merchants.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    },
    getMerchant(merchantId) {
      return state.merchants.get(merchantId) ?? null;
    },
    updateMerchant(merchantId, patch) {
      const merchant = state.merchants.get(merchantId);
      if (!merchant) {
        throw new Error(`Merchant not found: ${merchantId}`);
      }
      const publisherId = patch.publisher_id !== undefined ? patch.publisher_id : merchant.publisher_id;
      const updated = {
        ...merchant,
        ...(patch.publisher_id !== undefined && { publisher_id: patch.publisher_id }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.disclosure_text !== undefined && { disclosure_text: patch.disclosure_text }),
        ...(patch.categories !== undefined && { categories: patch.categories }),
        needs_setup: !publisherId,
        updated_at: nowIso()
      };
      state.merchants.set(merchantId, updated);
      return updated;
    },
    listMerchantOverrides(merchantId) {
      return [...state.merchantOverrides.values()].filter((o) => o.merchant_id === merchantId);
    },
    upsertMerchantOverride(merchantId, audienceId, patch) {
      const key = `${merchantId}:${audienceId}`;
      const existing = state.merchantOverrides.get(key) ?? { merchant_id: merchantId, audience_id: audienceId, enabled: true, boost_tags: [] };
      const updated = {
        ...existing,
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.boost_tags !== undefined && { boost_tags: patch.boost_tags })
      };
      state.merchantOverrides.set(key, updated);
      return updated;
    },
```

- [ ] **Step 6: Add `updateMerchant` and `upsertMerchantOverride` to `withPersistence()` method list**

Find the `for (const methodName of [` array in `withPersistence()` (around line 1198) and add the two new method names:

```javascript
  for (const methodName of [
    "createStory",
    "transitionStoryStatus",
    "createJob",
    "updateJob",
    "updateStory",
    "updateAudience",
    "createInstanceForAudience",
    "updateInstance",
    "selectStoryAsset",
    "replaceStoryAsset",
    "submitStoryReview",
    "queueStoryPublication",
    "saveFeedbackEvent",
    "saveInstanceReport",
    "saveOperatorChat",
    "saveDeploymentResult",
    "updateMerchant",
    "upsertMerchantOverride"
  ]) {
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
node --test tests/repository-merchants.test.js 2>&1 | tail -20
```

Expected: All 12 tests pass with `ok` status.

- [ ] **Step 8: Run full test suite to check for regressions**

```bash
npm test 2>&1 | tail -20
```

Expected: Same number of failures as before (no new failures).

- [ ] **Step 9: Commit**

```bash
git add src/repository.js tests/repository-merchants.test.js
git commit -m "feat: add merchant methods to FileRepository (listMerchants, getMerchant, updateMerchant, listMerchantOverrides, upsertMerchantOverride)"
```

---

## Task 3: SupabaseRepository Merchant Methods

**Files:**
- Modify: `src/repository.js` (add upsert to client + merchant methods to createSupabaseRepository)
- Modify: `tests/repository-merchants.test.js` (add Supabase backend tests)

- [ ] **Step 1: Add `upsert` to `createSupabaseClient()` in `src/repository.js`**

Find the `return {` block inside `createSupabaseClient()` (around line 1260). After the `update` method, add:

```javascript
    async upsert(table, body) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          ...createSupabaseHeaders(serviceRoleKey),
          "content-type": "application/json",
          prefer: "return=representation,resolution=merge-duplicates"
        },
        body: JSON.stringify(body)
      });
      return parseSupabaseResponse(response);
    },
```

- [ ] **Step 2: Add merchant methods to `createSupabaseRepository()` in `src/repository.js`**

Find the `return {` block inside `createSupabaseRepository()` (around line 600). Add these methods at the end, before the closing `};`:

```javascript
    async listMerchants() {
      const rows = await client.select("vivo_merchants", { select: "*", order: "name.asc" });
      return rows;
    },
    async getMerchant(merchantId) {
      const rows = await client.select("vivo_merchants", { select: "*", merchant_id: `eq.${merchantId}` });
      return rows[0] ?? null;
    },
    async updateMerchant(merchantId, patch) {
      const existing = await this.getMerchant(merchantId);
      if (!existing) {
        throw new Error(`Merchant not found: ${merchantId}`);
      }
      const publisherId = patch.publisher_id !== undefined ? patch.publisher_id : existing.publisher_id;
      const body = {
        ...(patch.publisher_id !== undefined && { publisher_id: patch.publisher_id || null }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.disclosure_text !== undefined && { disclosure_text: patch.disclosure_text }),
        ...(patch.categories !== undefined && { categories: patch.categories }),
        needs_setup: !publisherId,
        updated_at: new Date().toISOString()
      };
      const rows = await client.update("vivo_merchants", { merchant_id: `eq.${merchantId}` }, body);
      return rows[0];
    },
    async listMerchantOverrides(merchantId) {
      return client.select("vivo_merchant_audience_overrides", { select: "*", merchant_id: `eq.${merchantId}` });
    },
    async upsertMerchantOverride(merchantId, audienceId, patch) {
      const body = {
        merchant_id: merchantId,
        audience_id: audienceId,
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.boost_tags !== undefined && { boost_tags: JSON.stringify(patch.boost_tags) })
      };
      const rows = await client.upsert("vivo_merchant_audience_overrides", body);
      return rows[0];
    },
```

- [ ] **Step 3: Add Supabase mock tests to `tests/repository-merchants.test.js`**

Append to the end of `tests/repository-merchants.test.js`:

```javascript
function makeSupabaseRepo({ mockData = {} } = {}) {
  const { createSupabaseRepository } = require === undefined
    ? { createSupabaseRepository: null }
    : { createSupabaseRepository: null };
  // We test the Supabase repo by supplying a fake fetch that returns PostgREST-shaped responses.
  // Import is done inline to avoid top-level await issues.
  return import("../src/repository.js").then(({ createSupabaseRepository }) => {
    const store = {
      vivo_merchants: [...SEED_MERCHANTS].map((m) => ({ ...m })),
      vivo_merchant_audience_overrides: [...SEED_OVERRIDES].map((o) => ({ ...o }))
    };

    const fakeFetch = async (urlOrString, opts = {}) => {
      const url = typeof urlOrString === "string" ? urlOrString : urlOrString.toString();
      const table = url.match(/\/rest\/v1\/([^?]+)/)?.[1];
      const method = opts.method ?? "GET";
      const prefer = opts.headers?.prefer ?? "";

      let rows = store[table] ? [...store[table]] : [];

      if (method === "GET" || !method) {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const merchantIdFilter = params.get("merchant_id");
        if (merchantIdFilter?.startsWith("eq.")) {
          const val = merchantIdFilter.slice(3);
          rows = rows.filter((r) => r.merchant_id === val);
        }
        return { ok: true, json: async () => rows, text: async () => JSON.stringify(rows) };
      }

      const body = JSON.parse(opts.body ?? "{}");

      if (method === "PATCH") {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const merchantIdFilter = params.get("merchant_id");
        if (merchantIdFilter?.startsWith("eq.")) {
          const val = merchantIdFilter.slice(3);
          rows = store[table].map((r) => r.merchant_id === val ? { ...r, ...body } : r);
          store[table] = rows;
          const updated = rows.filter((r) => r.merchant_id === val);
          return { ok: true, json: async () => updated, text: async () => JSON.stringify(updated) };
        }
      }

      if (method === "POST" && prefer.includes("merge-duplicates")) {
        const existing = store[table].findIndex(
          (r) => r.merchant_id === body.merchant_id && r.audience_id === body.audience_id
        );
        if (existing >= 0) {
          store[table][existing] = { ...store[table][existing], ...body };
          return { ok: true, json: async () => [store[table][existing]], text: async () => JSON.stringify([store[table][existing]]) };
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

test("Supabase: listMerchants returns merchants sorted by name", async () => {
  const repo = await makeSupabaseRepo();
  const merchants = await repo.listMerchants();
  assert.ok(merchants.length >= 1);
  assert.equal(merchants[0].merchant_id, "decathlon-es");
});

test("Supabase: getMerchant returns null for unknown", async () => {
  const repo = await makeSupabaseRepo();
  const result = await repo.getMerchant("no-such");
  assert.equal(result, null);
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
```

- [ ] **Step 4: Run the tests**

```bash
node --test tests/repository-merchants.test.js 2>&1 | tail -30
```

Expected: All tests pass (file backend + Supabase mock backend).

- [ ] **Step 5: Commit**

```bash
git add src/repository.js tests/repository-merchants.test.js
git commit -m "feat: add merchant methods to SupabaseRepository and upsert to Supabase client"
```

---

## Task 4: catalog.js — Handle `{{publisher_id}}` Substitution (TDD)

**Files:**
- Modify: `src/catalog.js`
- Modify: `tests/catalog.test.js`

- [ ] **Step 1: Write a failing test in `tests/catalog.test.js`**

Append to the end of `tests/catalog.test.js`:

```javascript
test("normalizeProduct substitutes {{publisher_id}} in affiliate URL template", async () => {
  const { normalizeProduct } = await loadCatalogModule();
  const merchant = {
    merchant_id: "zara-es",
    publisher_id: "123456",
    affiliate_url_template: "https://www.awin1.com/cread.php?awinmid=13623&awinaffid={{publisher_id}}&ued={{url}}"
  };
  const product = normalizeProduct(merchant, {
    product_id: "p1",
    title: "Linen Shirt",
    brand: "Zara",
    category: "fashion",
    price: 29.99,
    currency: "EUR",
    availability: "in_stock",
    canonical_url: "https://www.zara.com/es/linen-shirt",
    image_urls: [],
    style_tags: [],
    gender_fit: "unisex",
    occasion_tags: [],
    season_tags: [],
    locale_tags: []
  });
  assert.match(product.affiliate_url, /awinaffid=123456/);
  assert.match(product.affiliate_url, /ued=https%3A%2F%2Fwww\.zara\.com/);
});

test("normalizeProduct handles merchant with no affiliate template gracefully", async () => {
  const { normalizeProduct } = await loadCatalogModule();
  const merchant = {
    merchant_id: "fever-es",
    publisher_id: null,
    affiliate_url_template: null
  };
  const product = normalizeProduct(merchant, {
    product_id: "p2",
    title: "Concert ticket",
    brand: "Fever",
    category: "entertainment",
    price: 45.0,
    currency: "EUR",
    availability: "in_stock",
    canonical_url: "https://fever.com/event/123",
    image_urls: [],
    style_tags: [],
    gender_fit: "unisex",
    occasion_tags: [],
    season_tags: [],
    locale_tags: []
  });
  assert.equal(product.affiliate_url, "https://fever.com/event/123");
});
```

- [ ] **Step 2: Run tests to see them fail**

```bash
node --test tests/catalog.test.js 2>&1 | tail -15
```

Expected: The two new tests fail (affiliate_url doesn't contain `awinaffid=123456`).

- [ ] **Step 3: Update `normalizeProduct()` in `src/catalog.js`**

Replace the current `affiliate_url` line:

```javascript
export function normalizeProduct(merchant, rawProduct) {
  const template = merchant.affiliate_url_template;
  const affiliateUrl = template
    ? template
        .replace("{{publisher_id}}", merchant.publisher_id ?? "")
        .replace("{{url}}", encodeURIComponent(rawProduct.canonical_url))
    : rawProduct.canonical_url;
  return {
    product_id: rawProduct.product_id,
    merchant_id: merchant.merchant_id,
    title: rawProduct.title,
    brand: rawProduct.brand,
    category: rawProduct.category,
    price: rawProduct.price,
    currency: rawProduct.currency,
    availability: rawProduct.availability,
    canonical_url: rawProduct.canonical_url,
    affiliate_url: affiliateUrl,
    image_urls: rawProduct.image_urls ?? [],
    style_tags: rawProduct.style_tags ?? [],
    gender_fit: rawProduct.gender_fit ?? "unisex",
    occasion_tags: rawProduct.occasion_tags ?? [],
    season_tags: rawProduct.season_tags ?? [],
    locale_tags: rawProduct.locale_tags ?? [],
    last_checked_at: rawProduct.last_checked_at ?? new Date(0).toISOString()
  };
}
```

- [ ] **Step 4: Run all catalog tests to verify**

```bash
node --test tests/catalog.test.js 2>&1 | tail -15
```

Expected: All tests pass including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/catalog.js tests/catalog.test.js
git commit -m "feat: normalizeProduct substitutes {{publisher_id}} in affiliate URL template"
```

---

## Task 5: content-fetcher.js — Load Merchants from Repository (TDD)

**Files:**
- Modify: `src/content-fetcher.js`
- Modify: `tests/content-fetcher.test.js`

- [ ] **Step 1: Read `src/content-fetcher.js` to find where `merchantRegistry` is used**

Look for `merchantRegistry` usages. You will find that it's passed to `fetchSources(localSources, fetchImpl, merchantRegistry, limit)`. The `fetchSources` function uses `merchantRegistry.merchants` internally to build affiliate product links.

- [ ] **Step 2: Write a failing test in `tests/content-fetcher.test.js`**

Find the file and append after the existing tests:

```javascript
test("fetchForAudience uses repository.listMerchants when available", async () => {
  const { createContentFetcher } = await import("../src/content-fetcher.js?bust2=" + Date.now());
  const { createRepository } = await import("../src/repository.js?bust2=" + Date.now());

  const repo = createRepository({
    audiences: [{
      id: "aud-1", audience_key: "bcn", label: "Barcelona", language: "en",
      location: "Barcelona", family_context: "", interests: [], content_pillars: [],
      excluded_topics: [], tone: "helpful", profile_snapshot: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }],
    instances: [{
      id: "inst-1", factory_id: "f-1", audience_id: "aud-1",
      instance_key: "bcn-oc", service_name: "bcn-oc",
      openclaw_admin_url: "http://127.0.0.1:18801",
      profile_base_url: "http://127.0.0.1:5401",
      runtime_config: {}, status: "active",
      created_at: "2026-04-17T00:00:00.000Z", updated_at: "2026-04-17T00:00:00.000Z"
    }],
    merchants: [{
      merchant_id: "zara-es",
      name: "Zara Spain",
      domain: "zara.com",
      country: "ES",
      currency: "EUR",
      network: "awin",
      network_merchant_code: "13623",
      affiliate_url_template: "https://awin1.com/cread.php?awinaffid={{publisher_id}}&ued={{url}}",
      publisher_id: "999111",
      needs_setup: false,
      enabled: true,
      categories: ["fashion"],
      disclosure_text: "Affiliate links included.",
      created_at: "2026-04-17T00:00:00.000Z",
      updated_at: "2026-04-17T00:00:00.000Z"
    }]
  });

  let merchantRegistryCalled = false;
  let listMerchantsCalled = false;
  const origListMerchants = repo.listMerchants.bind(repo);
  repo.listMerchants = () => { listMerchantsCalled = true; return origListMerchants(); };

  const fetcher = createContentFetcher({
    sourcesConfig: { sources: [] },
    repository: repo,
    fetchImpl: async () => ({ ok: true, text: async () => "<rss><channel></channel></rss>" }),
    factoryId: "f-1",
    clock: () => "2026-04-17T09:00:00.000Z"
  });

  const audience = await repo.getAudience("aud-1");
  await fetcher.fetchForAudience(audience, null, {});
  assert.equal(listMerchantsCalled, true, "should call repository.listMerchants()");
});
```

- [ ] **Step 3: Run test to see it fail**

```bash
node --test tests/content-fetcher.test.js 2>&1 | grep -A3 "listMerchants"
```

Expected: Test fails because content-fetcher doesn't call `repository.listMerchants()`.

- [ ] **Step 4: Update `createContentFetcher` in `src/content-fetcher.js`**

At the top of `fetchForAudience`, after the `const limit` line, add:

```javascript
      const repoMerchants = typeof repository?.listMerchants === "function"
        ? (await Promise.resolve(repository.listMerchants())).filter((m) => m.enabled && m.publisher_id)
        : null;
      const activeMerchantRegistry = repoMerchants !== null
        ? { merchants: repoMerchants, overrides: [] }
        : merchantRegistry;
```

Then replace the two `fetchSources` calls that use `merchantRegistry` with `activeMerchantRegistry`:

```javascript
      const [localCandidates, globalCandidates] = await Promise.all([
        fetchSources(localSources, fetchImpl, activeMerchantRegistry, 40),
        fetchSources(globalSources, fetchImpl, activeMerchantRegistry, 10)
      ]);
```

- [ ] **Step 5: Run all content-fetcher tests**

```bash
node --test tests/content-fetcher.test.js 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/content-fetcher.js tests/content-fetcher.test.js
git commit -m "feat: content-fetcher loads active merchants from repository when available"
```

---

## Task 6: server.js — Remove JSON Merchant Config

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Remove `merchantRegistryConfig` from `src/server.js`**

Find line (around line 24):
```javascript
const merchantRegistryConfig = loadJsonConfig("config/merchant-registry.json", { merchants: [], audienceOverrides: [] });
```
Delete this line.

Find the `createContentFetcher({` call (around line 69) and remove the line:
```javascript
  merchantRegistry: merchantRegistryConfig,
```

- [ ] **Step 2: Verify the server starts without errors**

```bash
node src/server.js &
sleep 2
curl -s http://localhost:4310/api/status | head -5
kill %1
```

Expected: Returns JSON with a status object, no crash.

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: No new failures.

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "chore: remove static merchant-registry.json config in favour of repository-loaded merchants"
```

---

## Task 7: API Endpoints (TDD)

**Files:**
- Modify: `src/app.js`
- Modify: `tests/dashboard.test.js`

- [ ] **Step 1: Write failing API tests in `tests/dashboard.test.js`**

Find `tests/dashboard.test.js` and append the following merchant API tests:

```javascript
// Helper: build a repo with one merchant for API tests
async function makeMerchantRepo() {
  const { createRepository } = await import("../src/repository.js");
  return createRepository({
    merchants: [{
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
      categories: ["fashion"],
      disclosure_text: "Affiliate links included.",
      created_at: "2026-04-17T00:00:00.000Z",
      updated_at: "2026-04-17T00:00:00.000Z"
    }],
    merchantOverrides: [{
      merchant_id: "zara-es",
      audience_id: "bald-bcn",
      enabled: true,
      boost_tags: []
    }]
  });
}

test("GET /api/merchants returns list of merchants", async () => {
  const { createApp } = await import("../src/app.js");
  const repo = await makeMerchantRepo();
  const app = createApp({ repository: repo });

  const response = await app.handle({ method: "GET", pathname: "/api/merchants", query: {}, body: null, headers: {} });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].merchant_id, "zara-es");
});

test("GET /api/merchants/:id returns single merchant", async () => {
  const { createApp } = await import("../src/app.js");
  const repo = await makeMerchantRepo();
  const app = createApp({ repository: repo });

  const response = await app.handle({ method: "GET", pathname: "/api/merchants/zara-es", query: {}, body: null, headers: {} });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.merchant_id, "zara-es");
});

test("GET /api/merchants/:id returns 404 for unknown merchant", async () => {
  const { createApp } = await import("../src/app.js");
  const repo = await makeMerchantRepo();
  const app = createApp({ repository: repo });

  const response = await app.handle({ method: "GET", pathname: "/api/merchants/no-such", query: {}, body: null, headers: {} });
  assert.equal(response.status, 404);
});

test("PUT /api/merchants/:id updates merchant and clears needs_setup", async () => {
  const { createApp } = await import("../src/app.js");
  const repo = await makeMerchantRepo();
  const app = createApp({ repository: repo });

  const response = await app.handle({
    method: "PUT",
    pathname: "/api/merchants/zara-es",
    query: {},
    body: JSON.stringify({ publisher_id: "654321" }),
    headers: {}
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.publisher_id, "654321");
  assert.equal(body.needs_setup, false);
});

test("GET /api/merchants/:id/overrides returns overrides", async () => {
  const { createApp } = await import("../src/app.js");
  const repo = await makeMerchantRepo();
  const app = createApp({ repository: repo });

  const response = await app.handle({ method: "GET", pathname: "/api/merchants/zara-es/overrides", query: {}, body: null, headers: {} });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].audience_id, "bald-bcn");
});

test("PUT /api/merchants/:id/overrides/:audienceId upserts override", async () => {
  const { createApp } = await import("../src/app.js");
  const repo = await makeMerchantRepo();
  const app = createApp({ repository: repo });

  const response = await app.handle({
    method: "PUT",
    pathname: "/api/merchants/zara-es/overrides/bald-bcn",
    query: {},
    body: JSON.stringify({ enabled: false }),
    headers: {}
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.enabled, false);
});
```

- [ ] **Step 2: Run tests to see them fail**

```bash
node --test tests/dashboard.test.js 2>&1 | grep "merchants" | head -10
```

Expected: All merchant API tests fail with 404.

- [ ] **Step 3: Add the 5 merchant API routes to `src/app.js`**

Find the section in `createApp` where API routes are handled (look for the pattern `if (request.method === "GET" && matchPath(...))`). Add these 5 routes before the final `return json(404, ...)` or wherever other routes end:

```javascript
  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/merchants$/)) {
    const items = await safeLoad(() => repository.listMerchants(), []);
    return json(200, { items });
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/merchants\/([^/]+)$/)) {
    const merchantId = request.pathname.split("/")[3];
    const merchant = await safeLoad(() => repository.getMerchant(merchantId), null);
    return merchant ? json(200, merchant) : json(404, { error: "Merchant not found" });
  }

  if (request.method === "PUT" && matchPath(request.pathname, /^\/api\/merchants\/([^/]+)$/)) {
    const merchantId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const merchant = await repository.updateMerchant(merchantId, {
      publisher_id: body.publisher_id,
      enabled: body.enabled,
      disclosure_text: body.disclosure_text,
      categories: body.categories
    });
    return json(200, merchant);
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/merchants\/([^/]+)\/overrides$/)) {
    const merchantId = request.pathname.split("/")[3];
    const items = await safeLoad(() => repository.listMerchantOverrides(merchantId), []);
    return json(200, { items });
  }

  if (request.method === "PUT" && matchPath(request.pathname, /^\/api\/merchants\/([^/]+)\/overrides\/([^/]+)$/)) {
    const parts = request.pathname.split("/");
    const merchantId = parts[3];
    const audienceId = parts[5];
    const body = readBody(request.body);
    const override = await repository.upsertMerchantOverride(merchantId, audienceId, {
      enabled: body.enabled,
      boost_tags: body.boost_tags
    });
    return json(200, override);
  }
```

- [ ] **Step 4: Run merchant API tests**

```bash
node --test tests/dashboard.test.js 2>&1 | grep -E "merchants|ok|fail" | head -20
```

Expected: All 6 merchant API tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: No new failures.

- [ ] **Step 6: Commit**

```bash
git add src/app.js tests/dashboard.test.js
git commit -m "feat: add merchant API endpoints (list, get, update, list overrides, upsert override)"
```

---

## Task 8: Dashboard UI — Merchants Tab

**Files:**
- Modify: `src/tremor-dashboard.js` (add Merchants tab to sidebar)
- Modify: `src/app.js` (add merchants tab handling + renderMerchantsWorkspace + renderMerchantDrawer)

- [ ] **Step 1: Add "Merchants" tab to `renderSidebarNav()` in `src/tremor-dashboard.js`**

Find the `tabs` array in `renderSidebarNav()`:

```javascript
  const tabs = [
    { id: "setup", label: "Setup", href: "/" },
    { id: "stories", label: "Stories", href: "/?tab=stories" },
    { id: "audiences", label: "Audiences", href: "/?tab=audiences" }
  ];
```

Replace with:

```javascript
  const tabs = [
    { id: "setup", label: "Setup", href: "/" },
    { id: "stories", label: "Stories", href: "/?tab=stories" },
    { id: "audiences", label: "Audiences", href: "/?tab=audiences" },
    { id: "merchants", label: "Merchants", href: "/?tab=merchants" }
  ];
```

- [ ] **Step 2: Update `normalizeDashboardTab()` in `src/app.js`**

Find:

```javascript
function normalizeDashboardTab(query = {}) {
  const value = query.tab ?? "setup";
  return ["setup", "stories", "audiences"].includes(value) ? value : "setup";
}
```

Replace with:

```javascript
function normalizeDashboardTab(query = {}) {
  const value = query.tab ?? "setup";
  return ["setup", "stories", "audiences", "merchants"].includes(value) ? value : "setup";
}
```

- [ ] **Step 3: Load merchants data in the dashboard GET handler in `src/app.js`**

Find the dashboard GET handler (the `if (request.method === "GET" && request.pathname === "/")` block). After the `const audiences = ...` line, add:

```javascript
    const merchants = activeTab === "merchants"
      ? await safeLoad(() => repository.listMerchants(), [])
      : [];
    const activeMerchantId = request.query?.merchant_id ?? "";
    const activeMerchant = activeMerchantId && activeTab === "merchants"
      ? await safeLoad(() => repository.getMerchant(activeMerchantId), null)
      : null;
    const activeMerchantOverrides = activeMerchant
      ? await safeLoad(() => repository.listMerchantOverrides(activeMerchantId), [])
      : [];
```

Then add these to the `renderDashboard({...})` call:

```javascript
      merchants,
      activeMerchant,
      activeMerchantOverrides,
```

- [ ] **Step 4: Wire the merchants workspace in `renderDashboard()` in `src/app.js`**

Find the `const workspace = activeTab === "stories" ...` ternary chain. Add the merchants case:

```javascript
  const workspace = activeTab === "stories"
    ? renderStoriesWorkspace({ model, storyTableRows, audienceOptions, auditItems, analyticsItems })
    : activeTab === "audiences"
      ? renderAudiencesWorkspace({ model, deployments, selectedAudience, selectedAudienceInstance, selectedProfileState, selectedDeployment, chatHistory: model.chatHistory ?? [] })
      : activeTab === "merchants"
        ? renderMerchantsWorkspace({ merchants: model.merchants ?? [], activeMerchant: model.activeMerchant ?? null, overrides: model.activeMerchantOverrides ?? [], audiences: model.audiences ?? [] })
        : renderSetupWorkspace({ model, setupChecklist, audienceImportPanel });
```

Also add the merchant drawer portal (alongside the existing `drawerPortal` for stories):

```javascript
  const merchantDrawerPortal = activeTab === "merchants" && model.activeMerchant
    ? renderMerchantDrawer({ merchant: model.activeMerchant, overrides: model.activeMerchantOverrides ?? [], audiences: model.audiences ?? [] })
    : "";
```

Then in the HTML template output inside `renderDashboard`, after `${drawerPortal}`, add `${merchantDrawerPortal}`.

- [ ] **Step 5: Add `renderMerchantsWorkspace()` function to `src/app.js`**

Add this function after `renderSetupWorkspace` or near the other workspace renderers:

```javascript
function renderMerchantsWorkspace({ merchants, activeMerchant, overrides, audiences }) {
  const rows = merchants.map((m) => {
    const statusBadge = !m.network
      ? `<span class="text-xs text-gray-400">No program</span>`
      : m.needs_setup
        ? `<span class="inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-800 ring-1 ring-inset ring-yellow-600/20">⚠ Needs Setup</span>`
        : m.enabled
          ? `<span class="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">✓ Active</span>`
          : `<span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Disabled</span>`;
    const isActive = activeMerchant?.merchant_id === m.merchant_id;
    const href = escapeAttribute(`/?tab=merchants&merchant_id=${m.merchant_id}`);
    return `<tr class="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors${isActive ? " bg-indigo-50 dark:bg-indigo-900/20" : ""}" onclick="window.location.href='${href}'">
      <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(m.name)}</td>
      <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">${escapeHtml(m.domain)}</td>
      <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">${escapeHtml(m.network ?? "—")}</td>
      <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">${(m.categories ?? []).map((c) => `<span class="inline-block mr-1 rounded bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 text-indigo-700 dark:text-indigo-300">${escapeHtml(c)}</span>`).join("")}</td>
      <td class="whitespace-nowrap px-4 py-3">${statusBadge}</td>
    </tr>`;
  }).join("");

  return `<div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Merchants</h2>
      <span class="text-sm text-gray-500">${merchants.length} merchant${merchants.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="overflow-hidden rounded-lg ring-1 ring-gray-200 dark:ring-gray-700 bg-white dark:bg-gray-800">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-700/50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Merchant</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Domain</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Network</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Categories</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
          ${rows || `<tr><td colspan="5" class="px-4 py-8 text-center text-sm text-gray-500">No merchants configured.</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}
```

- [ ] **Step 6: Add `renderMerchantDrawer()` function to `src/app.js`**

Add this function after `renderMerchantsWorkspace`:

```javascript
function renderMerchantDrawer({ merchant, overrides, audiences }) {
  const closeHref = "/?tab=merchants";
  const networkLabel = merchant.network ? merchant.network.toUpperCase() : null;

  const statusBadge = !merchant.network
    ? `<span class="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">No program</span>`
    : merchant.needs_setup
      ? `<span class="rounded bg-yellow-50 px-2 py-0.5 text-xs font-semibold text-yellow-800">⚠ Needs Setup</span>`
      : merchant.enabled
        ? `<span class="rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">✓ Active</span>`
        : `<span class="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Disabled</span>`;

  const affiliateSetupSection = merchant.network && merchant.needs_setup
    ? `<div class="rounded-lg border border-yellow-300 bg-yellow-50 p-4 mb-4">
        <div class="text-xs font-bold text-yellow-900 mb-1">Affiliate Setup · ${escapeHtml(networkLabel)}</div>
        <div class="text-xs text-yellow-800 mb-3 leading-relaxed">
          Join the ${escapeHtml(merchant.name)} program on ${escapeHtml(networkLabel)}, then paste your publisher ID below.
        </div>
        <label class="block text-xs font-semibold text-gray-900 mb-1">Your ${escapeHtml(networkLabel)} Publisher ID</label>
        <input id="drawer-publisher-id"
               class="w-full rounded border border-yellow-400 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400"
               placeholder="e.g. 123456" value="${escapeAttribute(merchant.publisher_id ?? "")}"/>
        ${merchant.network_merchant_code ? `<div class="mt-2 text-xs text-gray-500">Merchant code: <code class="rounded bg-gray-100 px-1 py-0.5 text-gray-800">${escapeHtml(merchant.network_merchant_code)}</code></div>` : ""}
      </div>`
    : merchant.network
      ? `<div class="mb-4">
          <label class="block text-xs font-semibold text-gray-900 mb-1">${escapeHtml(networkLabel)} Publisher ID</label>
          <input id="drawer-publisher-id"
                 class="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                 placeholder="e.g. 123456" value="${escapeAttribute(merchant.publisher_id ?? "")}"/>
        </div>`
      : "";

  const categoriesSection = `<div class="mb-4">
    <div class="text-xs font-semibold text-gray-900 mb-1.5">Categories</div>
    <div class="flex flex-wrap gap-1.5">
      ${(merchant.categories ?? []).map((c) => `<span class="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">${escapeHtml(c)}</span>`).join("") || `<span class="text-xs text-gray-400">None</span>`}
    </div>
  </div>`;

  const overrideRows = audiences.map((aud) => {
    const override = overrides.find((o) => o.audience_id === aud.id);
    const isEnabled = override ? override.enabled : true;
    const boostHint = override?.boost_tags?.length
      ? override.boost_tags.map((b) => `${b.tag} ×${b.weight}`).join(", ")
      : "—";
    return `<div class="grid grid-cols-[1fr_auto_auto] gap-2 items-center px-3 py-2 border-b border-gray-100 last:border-0">
      <span class="text-xs font-medium text-gray-900">${escapeHtml(aud.audience_key ?? aud.id)}</span>
      <span class="text-xs text-gray-500">${escapeHtml(boostHint)}</span>
      <label class="flex items-center gap-1 text-xs text-gray-700 cursor-pointer whitespace-nowrap">
        <input type="checkbox" class="override-toggle" data-audience-id="${escapeAttribute(aud.id)}"${isEnabled ? " checked" : ""}/>
        on
      </label>
    </div>`;
  }).join("");

  return `<div class="fixed inset-0 z-40" data-tremor-component="DrawerPortal">
    <a class="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-40"
       href="${escapeAttribute(closeHref)}" aria-label="Close merchant details"></a>
    <aside class="fixed inset-y-0 right-0 flex w-2/5 flex-col bg-white dark:bg-gray-800 shadow-xl z-50 overflow-hidden"
           data-tremor-component="Drawer" aria-label="Merchant details">

      <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4">
        <div>
          <div class="text-sm font-bold text-gray-900 dark:text-gray-100">${escapeHtml(merchant.name)}</div>
          <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(merchant.domain)} · ${escapeHtml(merchant.country)} · ${escapeHtml(merchant.currency)}</div>
        </div>
        <div class="flex items-center gap-2">
          ${statusBadge}
          <label class="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer whitespace-nowrap">
            <input type="checkbox" id="drawer-enabled" ${merchant.enabled ? "checked" : ""}/>
            Enabled
          </label>
          <a href="${escapeAttribute(closeHref)}" class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700" aria-label="Close">✕</a>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4">
        ${affiliateSetupSection}
        ${categoriesSection}
        ${audiences.length > 0 ? `<div class="mb-4">
          <div class="text-xs font-semibold text-gray-900 mb-2">Audience Overrides</div>
          <div class="rounded-lg border border-gray-200 overflow-hidden bg-white">
            ${overrideRows || `<div class="px-3 py-3 text-xs text-gray-400">No audiences configured.</div>`}
          </div>
        </div>` : ""}
        <div class="mb-5">
          <label class="block text-xs font-semibold text-gray-900 mb-1">Disclosure text</label>
          <input id="drawer-disclosure"
                 class="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                 value="${escapeAttribute(merchant.disclosure_text ?? "")}"/>
        </div>
        <button id="drawer-save-btn"
                class="w-full rounded-md bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                data-merchant-id="${escapeAttribute(merchant.merchant_id)}">
          Save Changes
        </button>
        <div id="drawer-save-msg" class="mt-2 text-center text-xs text-gray-500 hidden"></div>
      </div>

    </aside>
    <script>
    (function() {
      const btn = document.getElementById('drawer-save-btn');
      const merchantId = btn.dataset.merchantId;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const msg = document.getElementById('drawer-save-msg');
        msg.classList.add('hidden');
        try {
          const publisherInput = document.getElementById('drawer-publisher-id');
          const enabledInput = document.getElementById('drawer-enabled');
          const disclosureInput = document.getElementById('drawer-disclosure');
          const body = {};
          if (publisherInput) body.publisher_id = publisherInput.value.trim();
          if (enabledInput) body.enabled = enabledInput.checked;
          if (disclosureInput) body.disclosure_text = disclosureInput.value;
          const res = await fetch('/api/merchants/' + encodeURIComponent(merchantId), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!res.ok) throw new Error(await res.text());

          const overrideToggles = document.querySelectorAll('.override-toggle');
          await Promise.all([...overrideToggles].map(toggle =>
            fetch('/api/merchants/' + encodeURIComponent(merchantId) + '/overrides/' + encodeURIComponent(toggle.dataset.audienceId), {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ enabled: toggle.checked })
            })
          ));

          msg.textContent = 'Saved!';
          msg.className = 'mt-2 text-center text-xs text-green-600';
          msg.classList.remove('hidden');
          setTimeout(() => window.location.reload(), 800);
        } catch(e) {
          msg.textContent = 'Error: ' + e.message;
          msg.className = 'mt-2 text-center text-xs text-red-600';
          msg.classList.remove('hidden');
          btn.disabled = false;
        }
      });
    })();
    </script>
  </div>`;
}
```

- [ ] **Step 7: Run the test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: No new failures.

- [ ] **Step 8: Manual smoke test — start the server and open the Merchants tab**

```bash
node src/server.js &
```

Open `http://localhost:4310/?tab=merchants` in a browser.

Verify:
- "Merchants" appears in the left sidebar
- The merchants table renders (empty or with data depending on backend)
- Clicking a row opens the 40%-width drawer from the right
- The drawer shows merchant name, status badge, affiliate setup section (if needs_setup)
- The save button triggers the fetch calls without JS errors

```bash
kill %1
```

- [ ] **Step 9: Commit**

```bash
git add src/app.js src/tremor-dashboard.js
git commit -m "feat: add Merchants tab to dashboard with table, slide-out drawer, and save-via-fetch"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `vivo_merchants` table — Task 1
- ✅ `vivo_merchant_audience_overrides` table — Task 1
- ✅ 15 seed merchants — Task 1
- ✅ Awin/CJ URL templates pre-filled — Task 1
- ✅ `needs_setup` flag logic — Tasks 2, 3, 7
- ✅ FileRepository merchant methods — Task 2
- ✅ SupabaseRepository merchant methods — Task 3
- ✅ Tests for both backends — Tasks 2, 3
- ✅ `catalog.js` `{{publisher_id}}` substitution — Task 4
- ✅ `content-fetcher.js` loads from repository — Task 5
- ✅ `server.js` removes JSON config — Task 6
- ✅ 5 API endpoints — Task 7
- ✅ Merchants sidebar tab — Task 8
- ✅ Table with status badges — Task 8
- ✅ 40%-width drawer (`w-2/5`) — Task 8
- ✅ Drawer: affiliate setup section (yellow card when needs_setup) — Task 8
- ✅ Drawer: audience overrides with per-audience toggles — Task 8
- ✅ Drawer: disclosure text input — Task 8
- ✅ Drawer: save via fetch() — Task 8
- ✅ Black text (explicit color classes, not white-on-white) — Task 8

**Method name consistency:**
- `listMerchants()` / `getMerchant(id)` / `updateMerchant(id, patch)` / `listMerchantOverrides(id)` / `upsertMerchantOverride(id, audienceId, patch)` — consistent across Tasks 2, 3, 7, 8.
- `normalizeProduct` parameter shape (merchant with `.publisher_id`, `.affiliate_url_template`) — consistent between Tasks 4 and 5.
