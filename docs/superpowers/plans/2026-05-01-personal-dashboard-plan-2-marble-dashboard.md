# Personal Dashboard — Plan 2: Marble Dashboard UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/personal/*` routes to Marble's `profile-server.js` that serve a server-rendered Tailwind dashboard (Shopping / Entertainment / Travel × Bought / Gaps+Advices / Deals tabs) with mbox upload + SSE progress.

**Architecture:** A new `api/personal-dashboard.js` module exports an Express router that is mounted into the existing `profile-server.js`. HTML templates are plain strings (no template engine dependency). The dashboard fetches data from the vault-engine sidecar (configured via `VAULT_BASE_URL` env var) and from Marble's own `marble.select()` for deal ranking.

**Tech Stack:** Node.js, Express, Tailwind CDN (no build step), htmx (CDN), node:test (tests). All new code lives in `/srv/projects/marble/`.

**Depends on:** Plan 1 vault endpoints must be deployed and reachable at `VAULT_BASE_URL` (default: `http://localhost:4876`).
**Required by:** Plan 3 wires this into the per-audience Docker stack.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `api/personal-dashboard.js` | Create | Express router — all `/personal/*` routes |
| `api/profile-server.js` | Modify | Mount personal-dashboard router |
| `test/personal-dashboard.test.mjs` | Create | Route and rendering tests |

---

## Task 1: Create personal-dashboard router skeleton

**Files:**
- Create: `api/personal-dashboard.js`
- Create: `test/personal-dashboard.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// test/personal-dashboard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mountPersonalDashboard } from '../api/personal-dashboard.js';

function makeApp(vaultBaseUrl = 'http://localhost:9999') {
  const app = express();
  const marble = { select: async (items) => items };
  mountPersonalDashboard(app, { marble, vaultBaseUrl });
  return app;
}

async function get(app, path) {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      fetch(`http://localhost:${port}${path}`)
        .then(async (res) => {
          const text = await res.text();
          server.close();
          resolve({ status: res.status, body: text });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test('GET /personal/ redirects to /personal/shopping', async () => {
  const app = makeApp();
  const res = await get(app, '/personal/');
  assert.equal(res.status, 302);
});

test('GET /personal/shopping returns HTML with category tabs', async () => {
  const app = makeApp();
  const res = await get(app, '/personal/shopping');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('Shopping'));
  assert.ok(res.body.includes('Entertainment'));
  assert.ok(res.body.includes('Travel'));
});

test('GET /personal/entertainment returns HTML', async () => {
  const app = makeApp();
  const res = await get(app, '/personal/entertainment');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('Entertainment'));
});

test('GET /personal/travel returns HTML', async () => {
  const app = makeApp();
  const res = await get(app, '/personal/travel');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('Travel'));
});

test('GET /personal/unknown-category returns 404', async () => {
  const app = makeApp();
  const res = await get(app, '/personal/foobar');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /srv/projects/marble
node --test test/personal-dashboard.test.mjs 2>&1 | head -20
```

Expected: FAIL — `Cannot find module '../api/personal-dashboard.js'`

- [ ] **Step 3: Create personal-dashboard.js skeleton**

```javascript
// api/personal-dashboard.js
import express from 'express';

const CATEGORIES = ['shopping', 'entertainment', 'travel'];
const CATEGORY_ICONS = { shopping: '🛍', entertainment: '🎬', travel: '✈' };

export function mountPersonalDashboard(app, { marble, vaultBaseUrl }) {
  const router = express.Router();

  router.get('/', (_req, res) => res.redirect(302, '/personal/shopping'));

  router.get('/:category', async (req, res) => {
    const { category } = req.params;
    if (!CATEGORIES.includes(category)) return res.status(404).send('Not found');
    const html = renderLayout({ category, marble, vaultBaseUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await html);
  });

  app.use('/personal', router);
}

async function renderLayout({ category, marble, vaultBaseUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Personal Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <div class="max-w-5xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Personal Dashboard</h1>
      <button onclick="document.getElementById('upload-modal').classList.remove('hidden')"
        class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
        ↑ Upload mbox
      </button>
    </div>

    <!-- Category tabs -->
    <div class="flex gap-2 mb-4">
      ${CATEGORIES.map(cat => `
        <a href="/personal/${cat}"
           class="px-4 py-2 rounded-lg text-sm font-medium ${cat === category
             ? 'bg-blue-600 text-white'
             : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}">
          ${CATEGORY_ICONS[cat]} ${cat.charAt(0).toUpperCase() + cat.slice(1)}
        </a>`).join('')}
    </div>

    <!-- Section tabs -->
    <div class="flex gap-1 mb-6 border-b border-gray-200">
      ${['bought','gaps','deals'].map(tab => `
        <button
          hx-get="/personal/${category}/${tab}"
          hx-target="#tab-content"
          hx-swap="innerHTML"
          class="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 border-b-2 border-transparent hover:border-blue-500 transition-colors">
          ${tab === 'bought' ? 'Bought' : tab === 'gaps' ? 'Gaps + Advices' : 'Deals'}
        </button>`).join('')}
    </div>

    <!-- Tab content (loaded via htmx) -->
    <div id="tab-content"
      hx-get="/personal/${category}/bought"
      hx-trigger="load"
      hx-swap="innerHTML"
      class="min-h-64">
      <div class="text-gray-400 text-sm">Loading…</div>
    </div>

    <!-- Upload modal -->
    <div id="upload-modal" class="hidden fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h2 class="text-lg font-semibold mb-4">Upload Gmail Archive</h2>
        <p class="text-sm text-gray-500 mb-4">
          Export your email from <a href="https://takeout.google.com" target="_blank" class="text-blue-600 underline">Google Takeout</a>,
          select Mail in mbox format, then upload the .mbox file here.
        </p>
        <form id="upload-form" enctype="multipart/form-data">
          <input type="file" name="file" accept=".mbox" required
            class="block w-full text-sm text-gray-600 border border-gray-300 rounded-lg p-2 mb-4"/>
          <div class="flex gap-2 justify-end">
            <button type="button"
              onclick="document.getElementById('upload-modal').classList.add('hidden')"
              class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit"
              class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Upload</button>
          </div>
        </form>
        <div id="upload-progress" class="hidden mt-4">
          <div class="text-sm text-gray-600 mb-2" id="progress-label">Uploading…</div>
          <div class="w-full bg-gray-200 rounded-full h-2">
            <div id="progress-bar" class="bg-blue-600 h-2 rounded-full transition-all" style="width:0%"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  ${uploadScript(vaultBaseUrl)}
</body>
</html>`;
}

function uploadScript(vaultBaseUrl) {
  return `<script>
document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const progressEl = document.getElementById('upload-progress');
  const labelEl = document.getElementById('progress-label');
  const barEl = document.getElementById('progress-bar');
  progressEl.classList.remove('hidden');
  labelEl.textContent = 'Uploading file…';

  const uploadResp = await fetch('${vaultBaseUrl}/personal/upload-mbox', {
    method: 'POST', body: formData,
  });
  const { data } = await uploadResp.json();
  const jobId = data.job_id;

  labelEl.textContent = 'Processing emails…';
  const sse = new EventSource('${vaultBaseUrl}/personal/job/' + jobId + '/stream');
  sse.onmessage = (event) => {
    const job = JSON.parse(event.data);
    const pct = job.total_emails > 0
      ? Math.round((job.processed_emails / job.total_emails) * 100)
      : 0;
    barEl.style.width = pct + '%';
    labelEl.textContent = job.status === 'completed'
      ? 'Done! Reload the page to see your data.'
      : 'Processing: ' + job.processed_emails + ' emails…';
    if (job.status === 'completed' || job.status === 'failed') {
      sse.close();
      if (job.status === 'completed') setTimeout(() => location.reload(), 1500);
    }
  };
});
</script>`;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /srv/projects/marble
node --test test/personal-dashboard.test.mjs 2>&1 | tail -15
```

Expected: All 5 PASS

- [ ] **Step 5: Mount router in profile-server.js**

In `/srv/projects/marble/api/profile-server.js`, add after the existing imports:

```javascript
import { mountPersonalDashboard } from './personal-dashboard.js';
```

And after `await marble.init()` (find where the app is set up, before `app.listen`):

```javascript
const VAULT_BASE_URL = process.env.VAULT_BASE_URL ?? 'http://localhost:4876';
mountPersonalDashboard(app, { marble, vaultBaseUrl: VAULT_BASE_URL });
```

- [ ] **Step 6: Commit**

```bash
cd /srv/projects/marble
git add api/personal-dashboard.js api/profile-server.js test/personal-dashboard.test.mjs
git commit -m "feat: mount /personal/* dashboard routes in Marble profile-server"
```

---

## Task 2: Bought tab

**Files:**
- Modify: `api/personal-dashboard.js`
- Modify: `test/personal-dashboard.test.mjs`

- [ ] **Step 1: Add tests for Bought tab**

Append to `test/personal-dashboard.test.mjs`:

```javascript
test('GET /personal/shopping/bought returns item cards', async () => {
  const stubFetch = async (url) => ({
    ok: true,
    json: async () => ({
      data: {
        items: [
          { item_id: 'i1', merchant: 'Nike', item_name: 'Air Max 270',
            amount: 129, currency: 'EUR', item_date: '2024-03-01T00:00:00Z',
            subcategory: 'footwear', media_url: null }
        ],
        count: 1
      }
    })
  });
  const app = express();
  mountPersonalDashboard(app, { marble: { select: async (i) => i }, vaultBaseUrl: 'http://vault', fetchFn: stubFetch });
  const res = await get(app, '/personal/shopping/bought');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('Nike'));
  assert.ok(res.body.includes('Air Max 270'));
  assert.ok(res.body.includes('€129'));
});

test('GET /personal/shopping/bought shows empty state', async () => {
  const stubFetch = async () => ({ ok: true, json: async () => ({ data: { items: [], count: 0 } }) });
  const app = express();
  mountPersonalDashboard(app, { marble: { select: async (i) => i }, vaultBaseUrl: 'http://vault', fetchFn: stubFetch });
  const res = await get(app, '/personal/shopping/bought');
  assert.ok(res.body.includes('No items') || res.body.includes('empty'));
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /srv/projects/marble
node --test test/personal-dashboard.test.mjs 2>&1 | grep -E "FAIL|pass|fail" | tail -10
```

Expected: 2 new tests FAIL (route returns 404)

- [ ] **Step 3: Update `mountPersonalDashboard` to accept `fetchFn` and add Bought route**

In `api/personal-dashboard.js`, update the function signature and add the tab route:

```javascript
export function mountPersonalDashboard(app, { marble, vaultBaseUrl, fetchFn = fetch }) {
  const router = express.Router();

  router.get('/', (_req, res) => res.redirect(302, '/personal/shopping'));

  router.get('/:category', async (req, res) => {
    const { category } = req.params;
    if (!CATEGORIES.includes(category)) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await renderLayout({ category, vaultBaseUrl }));
  });

  router.get('/:category/bought', async (req, res) => {
    const { category } = req.params;
    if (!CATEGORIES.includes(category)) return res.status(404).send('Not found');
    try {
      const resp = await fetchFn(`${vaultBaseUrl}/personal/items?category=${category}`);
      const { data } = await resp.json();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderBoughtTab(data.items ?? []));
    } catch {
      res.send('<p class="text-red-500 text-sm">Failed to load items.</p>');
    }
  });

  app.use('/personal', router);
}

function renderBoughtTab(items) {
  if (!items.length) {
    return '<p class="text-gray-400 text-sm py-8 text-center">No items found. Upload your mbox to get started.</p>';
  }
  return `<div class="grid gap-3">
    ${items.map(item => `
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex gap-4 items-start">
        <div class="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
          ${item.media_url
            ? `<img src="${item.media_url}" class="w-full h-full object-cover rounded-lg" alt="${item.item_name}"/>`
            : '<span class="text-2xl">🛍</span>'}
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-gray-900 truncate">${escHtml(item.item_name ?? '')}</div>
          <div class="text-sm text-gray-500">
            ${escHtml(item.merchant ?? '')}
            ${item.amount != null ? ` · ${item.currency ?? ''}${item.amount}` : ''}
            ${item.item_date ? ` · ${new Date(item.item_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''}
          </div>
          ${item.subcategory ? `<span class="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">${escHtml(item.subcategory)}</span>` : ''}
        </div>
      </div>`).join('')}
  </div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

- [ ] **Step 4: Run tests**

```bash
cd /srv/projects/marble
node --test test/personal-dashboard.test.mjs 2>&1 | tail -15
```

Expected: All 7 PASS

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/marble
git add api/personal-dashboard.js test/personal-dashboard.test.mjs
git commit -m "feat: Bought tab — item cards with thumbnail, merchant, amount, date"
```

---

## Task 3: Gaps + Advices tab

**Files:**
- Modify: `api/personal-dashboard.js`
- Modify: `test/personal-dashboard.test.mjs`

- [ ] **Step 1: Add test**

Append to `test/personal-dashboard.test.mjs`:

```javascript
test('GET /personal/shopping/gaps returns gap cards', async () => {
  const stubFetch = async (url) => ({
    ok: true,
    json: async () => ({
      data: {
        gaps: [{
          gap_id: 'g1', gap_type: 'overdue', title: 'Running shoes overdue',
          rationale: 'Last bought 18 months ago', confidence: 0.87,
          suggested_action: 'Replace before winter', category: 'shopping',
          related_merchant: 'Nike',
        }],
        count: 1,
      }
    })
  });
  const app = express();
  mountPersonalDashboard(app, { marble: { select: async (i) => i }, vaultBaseUrl: 'http://vault', fetchFn: stubFetch });
  const res = await get(app, '/personal/shopping/gaps');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('Running shoes overdue'));
  assert.ok(res.body.includes('87%'));
  assert.ok(res.body.includes('Replace before winter'));
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /srv/projects/marble
node --test test/personal-dashboard.test.mjs 2>&1 | grep -E "FAIL|✗" | tail -5
```

- [ ] **Step 3: Add Gaps route to router and `renderGapsTab` function**

Inside `mountPersonalDashboard`, after the `/:category/bought` route:

```javascript
  router.get('/:category/gaps', async (req, res) => {
    const { category } = req.params;
    if (!CATEGORIES.includes(category)) return res.status(404).send('Not found');
    try {
      const resp = await fetchFn(`${vaultBaseUrl}/personal/gaps?category=${category}`);
      const { data } = await resp.json();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderGapsTab(data.gaps ?? [], category));
    } catch {
      res.send('<p class="text-red-500 text-sm">Failed to load gaps.</p>');
    }
  });
```

Add `renderGapsTab` function:

```javascript
function renderGapsTab(gaps, category) {
  if (!gaps.length) {
    return '<p class="text-gray-400 text-sm py-8 text-center">No gaps detected yet. Upload your mbox to analyse your history.</p>';
  }
  const typeIcon = { overdue: '⏰', accessory: '🔧', lapsed: '📭', pattern_break: '📊' };
  return `<div class="grid gap-3">
    ${gaps.map(gap => `
      <div class="bg-white rounded-xl border border-amber-200 p-4">
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="text-lg">${typeIcon[gap.gap_type] ?? '⚠️'}</span>
            <span class="font-medium text-gray-900">${escHtml(gap.title)}</span>
          </div>
          <span class="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
            ${Math.round((gap.confidence ?? 0) * 100)}% confidence
          </span>
        </div>
        <p class="text-sm text-gray-600 mb-2">${escHtml(gap.rationale ?? '')}</p>
        ${gap.suggested_action ? `<p class="text-sm text-blue-700 font-medium">→ ${escHtml(gap.suggested_action)}</p>` : ''}
        ${gap.related_merchant ? `
          <div class="mt-3">
            <a href="/personal/${category}/deals"
               hx-get="/personal/${category}/deals"
               hx-target="#tab-content"
               class="text-xs text-blue-600 hover:underline cursor-pointer">
              See deals for ${escHtml(gap.related_merchant)} →
            </a>
          </div>` : ''}
      </div>`).join('')}
  </div>`;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /srv/projects/marble
node --test test/personal-dashboard.test.mjs 2>&1 | tail -15
```

Expected: All 8 PASS

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/marble
git add api/personal-dashboard.js test/personal-dashboard.test.mjs
git commit -m "feat: Gaps + Advices tab with confidence scores and deal links"
```

---

## Task 4: Deals tab with Marble ranking

**Files:**
- Modify: `api/personal-dashboard.js`
- Modify: `test/personal-dashboard.test.mjs`

- [ ] **Step 1: Add test**

Append to `test/personal-dashboard.test.mjs`:

```javascript
test('GET /personal/shopping/deals returns ranked deal cards', async () => {
  const stubFetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        deals: [{
          deal_id: 'd1', merchant: 'Nike', title: 'Summer Sale 30%',
          discount: '30%', promo_code: 'SUMMER30', source_type: 'mbox_promo',
          media_url: null, url: 'https://nike.com/sale', marble_score: 0.9,
          category: 'shopping',
        }],
        count: 1,
      }
    })
  });
  const marbleRanker = { select: async (items) => items.sort((a, b) => (b.marble_score ?? 0) - (a.marble_score ?? 0)) };
  const app = express();
  mountPersonalDashboard(app, { marble: marbleRanker, vaultBaseUrl: 'http://vault', fetchFn: stubFetch });
  const res = await get(app, '/personal/shopping/deals');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('Nike'));
  assert.ok(res.body.includes('SUMMER30'));
  assert.ok(res.body.includes('30%'));
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /srv/projects/marble
node --test test/personal-dashboard.test.mjs 2>&1 | grep -E "FAIL|✗" | tail -5
```

- [ ] **Step 3: Add Deals route**

Inside `mountPersonalDashboard`, after the gaps route, add:

```javascript
  router.get('/:category/deals', async (req, res) => {
    const { category } = req.params;
    if (!CATEGORIES.includes(category)) return res.status(404).send('Not found');
    try {
      const resp = await fetchFn(`${vaultBaseUrl}/personal/deals?category=${category}`);
      const { data } = await resp.json();
      const rawDeals = data.deals ?? [];
      const ranked = await marble.select(rawDeals, { category_filter: category }).catch(() => rawDeals);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderDealsTab(ranked.slice(0, 20)));
    } catch {
      res.send('<p class="text-red-500 text-sm">Failed to load deals.</p>');
    }
  });
```

Add `renderDealsTab` function:

```javascript
function renderDealsTab(deals) {
  if (!deals.length) {
    return '<p class="text-gray-400 text-sm py-8 text-center">No deals found. Upload your mbox to discover deals from your inbox.</p>';
  }
  const sourceIcon = { mbox_promo: '📧', catalog_rss: '🌐' };
  return `<div class="grid gap-3">
    ${deals.map((deal, i) => `
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex gap-4 items-start">
        <div class="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
          ${deal.media_url
            ? `<img src="${escHtml(deal.media_url)}" class="w-full h-full object-cover rounded-lg" alt="${escHtml(deal.title)}"/>`
            : '<span class="text-2xl">🏷</span>'}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="font-medium text-gray-900 truncate">${escHtml(deal.title ?? '')}</div>
            <span class="text-xs font-bold text-gray-400 flex-shrink-0">#${i + 1}</span>
          </div>
          <div class="text-sm text-gray-500 mb-1">
            ${escHtml(deal.merchant ?? '')}
            ${deal.discount ? ` · <span class="text-green-600 font-medium">${escHtml(deal.discount)}</span>` : ''}
          </div>
          ${deal.promo_code ? `<code class="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono">${escHtml(deal.promo_code)}</code>` : ''}
          <div class="flex items-center gap-2 mt-2">
            <span class="text-xs text-gray-400">${sourceIcon[deal.source_type] ?? '📌'} ${deal.source_type === 'mbox_promo' ? 'from email' : 'catalog'}</span>
            ${deal.url ? `<a href="${escHtml(deal.url)}" target="_blank" rel="noopener"
               class="ml-auto text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700">
               Open Deal →
            </a>` : ''}
          </div>
        </div>
      </div>`).join('')}
  </div>`;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /srv/projects/marble
node --test test/personal-dashboard.test.mjs 2>&1 | tail -15
```

Expected: All 9 PASS

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/marble
git add api/personal-dashboard.js test/personal-dashboard.test.mjs
git commit -m "feat: Deals tab with Marble select() ranking and source badges"
```

---

## Task 5: Smoke-test the full dashboard locally

- [ ] **Step 1: Start vault-engine**

```bash
cd /srv/projects/vivo-user-profile-vault
source .venv/bin/activate
OPENAI_API_KEY=test python -m user_profile_engine.main --host 127.0.0.1 --port 4876 &
sleep 2
curl -s http://localhost:4876/healthz
```

Expected: `{"ok":true,"data":{"status":"ok"},...}`

- [ ] **Step 2: Start Marble profile-server**

```bash
cd /srv/projects/marble
VAULT_BASE_URL=http://localhost:4876 PROFILE_STORAGE_PATH=/tmp/marble-test node api/profile-server.js &
sleep 2
curl -s http://localhost:5400/healthz
```

Expected: `{"ok":true,...}`

- [ ] **Step 3: Open dashboard in browser**

Navigate to `http://localhost:5400/personal/shopping`. Verify:
- Category tabs render (Shopping / Entertainment / Travel)
- Section tabs render (Bought / Gaps + Advices / Deals)
- Bought tab loads via htmx (empty state visible)
- Upload modal opens on "↑ Upload mbox" click

- [ ] **Step 4: Stop test servers**

```bash
kill %1 %2 2>/dev/null; true
```

- [ ] **Step 5: Commit if any fixes needed**

```bash
cd /srv/projects/marble
git add -A
git commit -m "fix: dashboard smoke-test corrections"
```

---

**Plan 2 complete.** The dashboard is live at `:5401/personal/` per audience. Plan 3 wires it into the Docker stacks.
