# Tailwind UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 850-line inline `<style>` block and all custom CSS classes in `app.js` and `tremor-dashboard.js` with Tailwind CSS utility classes and Tailwind UI component patterns, using a dark sidebar application shell.

**Architecture:** Tailwind CLI generates `public/styles.css` from `src/input.css`, scanning `src/**/*.js` for class names. `server.js` serves the CSS as a static file. `app.js` and `tremor-dashboard.js` are updated in-place — no router or logic changes.

**Tech Stack:** tailwindcss ^3, Node.js built-in test runner, no additional runtime dependencies.

---

## Shared class reference (read before each task)

These patterns repeat everywhere. Memorize them once:

```
CARD:      bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden
SECTION-HDR:  flex items-start justify-between gap-3 mb-4
TITLE:     text-sm font-semibold text-gray-900 dark:text-gray-100
SUBTITLE:  text-xs text-gray-500 dark:text-gray-400 mt-0.5
LABEL:     block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5
INPUT:     block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none
BTN-PRIMARY:   rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors cursor-pointer
BTN-SECONDARY: rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors cursor-pointer
BADGE-NEUTRAL: inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300
BADGE-SUCCESS: inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400
BADGE-WARNING: inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400
MUTED:     text-sm text-gray-500 dark:text-gray-400
COMPACT-LIST: divide-y divide-gray-100 dark:divide-gray-700
COMPACT-LI:   flex items-start justify-between gap-3 py-2.5 text-sm
EMPTY:     rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400
PILL:      inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 px-2.5 py-0.5 text-xs text-gray-500 dark:text-gray-400
```

---

## Task 1: Build infrastructure

**Files:**
- Modify: `package.json`
- Create: `tailwind.config.js`
- Create: `src/input.css`
- Modify: `.gitignore`

- [ ] **Step 1: Install tailwindcss**

```bash
cd /srv/projects/vivo-factory
npm install --save-dev tailwindcss
```

Expected: `node_modules/tailwindcss` exists, `package.json` has `"tailwindcss"` in `devDependencies`.

- [ ] **Step 2: Add build scripts to package.json**

Open `package.json`. Replace the `"scripts"` block with:

```json
"scripts": {
  "test": "node --test",
  "build:css": "tailwindcss -i src/input.css -o public/styles.css --minify",
  "dev": "npm run build:css && node src/server.js",
  "start": "node src/server.js",
  "bootstrap": "node src/bootstrap.js",
  "generate:stacks": "node src/generate-stacks.js",
  "deploy:stacks": "node src/deploy-stacks.js"
}
```

- [ ] **Step 3: Create tailwind.config.js**

```js
export default {
  content: ['./src/**/*.js'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 4: Create src/input.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Update .gitignore**

Check if `.gitignore` exists:

```bash
cat /srv/projects/vivo-factory/.gitignore 2>/dev/null || echo "(no .gitignore)"
```

If it exists, append `public/styles.css` to it. If it doesn't exist, create it:

```
public/styles.css
```

- [ ] **Step 6: Create public/ directory**

```bash
mkdir -p /srv/projects/vivo-factory/public
```

- [ ] **Step 7: Run initial build to verify Tailwind CLI works**

```bash
cd /srv/projects/vivo-factory && npm run build:css
```

Expected output: `Done in Xms` (or similar). `public/styles.css` should now exist and contain minified CSS.

```bash
ls -lh /srv/projects/vivo-factory/public/styles.css
```

Expected: file exists, probably small (only base styles, no utilities yet since no classes are in src/ yet — that's fine).

- [ ] **Step 8: Commit**

```bash
cd /srv/projects/vivo-factory
git add package.json tailwind.config.js src/input.css .gitignore public/
git commit -m "chore: add Tailwind CSS build infrastructure"
```

---

## Task 2: Static CSS route + HTML head

**Files:**
- Modify: `src/server.js` (add static CSS handler before app.handle)
- Modify: `src/app.js` (lines 730–1557: replace HTML head, remove `<style>` block, restructure body into sidebar shell)

- [ ] **Step 1: Add /styles.css static route to server.js**

In `src/server.js`, add this import at the top (after existing imports):

```js
import { readFile } from "node:fs/promises";
```

Then, inside the `http.createServer` callback, add this block **before** the call to `app.handle(...)`:

```js
if (url.pathname === "/styles.css") {
  try {
    const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(css);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("styles.css not found — run npm run build:css");
  }
  return;
}
```

- [ ] **Step 2: Update renderDashboard() — HTML head**

In `src/app.js`, find `renderDashboard(model)` at line 649. The function builds a template literal starting at line 730. Replace everything from the opening backtick/doctype through the closing `</style>` tag (lines 730–1557) with the new head that loads the external stylesheet.

Replace this block (lines 730–1557 up to and including `</style>`):

```js
  return `<!doctype html>
<html lang="en"${drawerOpen ? ' class="drawer-open"' : ""} data-theme="light">
  <head>
    <meta charset="utf-8" />
    ${renderTremorFrameworkMeta()}
    <title>Vivo Factory Story Operations</title>
    <script>
      (() => {
        try {
          const stored = localStorage.getItem("vivo-theme");
          const preferred = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
          document.documentElement.dataset.theme = stored || preferred;
        } catch {
          document.documentElement.dataset.theme = "light";
        }
      })();
    </script>
    <style>
```

...and all 800+ lines of CSS through `</style>\n  </head>` with:

```js
  return `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    ${renderTremorFrameworkMeta()}
    <title>Vivo Factory</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/styles.css" />
    <script>
      (() => {
        try {
          const stored = localStorage.getItem("vivo-theme");
          const preferred = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
          document.documentElement.dataset.theme = stored || preferred;
        } catch {
          document.documentElement.dataset.theme = "light";
        }
      })();
    </script>
  </head>
```

- [ ] **Step 3: Update renderDashboard() — body/shell structure**

After the head, replace the `<body>` / `<main>` / `<header>` structure. Find the existing body block (currently around line 1559–1579):

```js
  <body${drawerOpen ? ' class="drawer-open"' : ""} data-ui-framework="${TREMOR_DASHBOARD_FRAMEWORK}">
    <main data-ui-framework="${TREMOR_DASHBOARD_FRAMEWORK}">
      <header class="topbar">
        <div>
          <h1>Vivo Factory</h1>
          <p>Setup, story review, and audience manager launch in one restrained operations surface.</p>
        </div>
        <div class="topbar-actions">
          ${renderWorkspaceTabs(activeTab)}
          <button type="button" class="theme-toggle" id="theme-toggle" data-theme-toggle aria-label="Toggle color theme">Theme</button>
        </div>
      </header>
      <section class="workspace">
        ${workspace}
      </section>
    </main>
    ${drawerPortal}

    ${renderDashboardScript()}
  </body>
</html>`;
```

Replace with:

```js
  <body class="h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
    <div class="flex h-full overflow-hidden">

      ${renderSidebarNav(activeTab)}

      <div class="flex flex-1 flex-col overflow-hidden min-w-0">
        <main class="flex-1 overflow-y-auto" data-ui-framework="${TREMOR_DASHBOARD_FRAMEWORK}">
          <div class="workspace px-6 py-6">
            ${workspace}
          </div>
        </main>
      </div>
    </div>

    ${drawerPortal}
    ${renderDashboardScript()}
  </body>
</html>`;
```

- [ ] **Step 4: Update the import line at the top of app.js**

The current import (line 1–8) imports `renderTremorTabs`. Replace with `renderSidebarNav`:

```js
import {
  TREMOR_DASHBOARD_FRAMEWORK,
  renderTremorBadge,
  renderTremorCard,
  renderTremorFrameworkMeta,
  renderTremorMetric,
  renderSidebarNav
} from "./tremor-dashboard.js";
```

- [ ] **Step 5: Remove renderWorkspaceTabs() from app.js**

Find and delete the entire `renderWorkspaceTabs` function (lines 2183–2189):

```js
function renderWorkspaceTabs(activeTab) {
  return renderTremorTabs(activeTab, ["setup", "stories", "audiences"].map((tab) => ({
    id: tab,
    label: tab[0].toUpperCase() + tab.slice(1),
    href: tab === "setup" ? "/" : `/?tab=${tab}`
  })));
}
```

Delete those 7 lines entirely.

- [ ] **Step 6: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/server.js src/app.js
git commit -m "feat: add CSS static route and restructure HTML shell to sidebar layout"
```

---

## Task 3: Update tremor-dashboard.js

**Files:**
- Modify: `tests/tremor-dashboard.test.js` (update to new contracts first)
- Modify: `src/tremor-dashboard.js` (update all 5 exports)

- [ ] **Step 1: Update tests/tremor-dashboard.test.js to match new contracts**

Replace the entire file with:

```js
import test from "node:test";
import assert from "node:assert/strict";

test("tremor dashboard primitives expose framework metadata and component contracts", async () => {
  const {
    TREMOR_DASHBOARD_FRAMEWORK,
    renderTremorFrameworkMeta,
    renderSidebarNav,
    renderTremorBadge,
    renderTremorCard,
    renderTremorMetric
  } = await import("../src/tremor-dashboard.js");

  assert.equal(TREMOR_DASHBOARD_FRAMEWORK, "tremor-raw-dashboard");
  assert.match(renderTremorFrameworkMeta(), /name="ui-framework" content="tremor-raw-dashboard"/);

  const sidebar = renderSidebarNav("stories");
  assert.match(sidebar, /Stories/);
  assert.match(sidebar, /Setup/);
  assert.match(sidebar, /Audiences/);
  assert.match(sidebar, /aria-current="page"/);
  assert.match(sidebar, /id="theme-toggle"/);

  const badgeNeutral = renderTremorBadge("draft", { tone: "neutral" });
  assert.match(badgeNeutral, /data-tremor-component="Badge"/);
  assert.match(badgeNeutral, /draft/);

  const badgeSuccess = renderTremorBadge("ready_to_publish", { tone: "success" });
  assert.match(badgeSuccess, /data-tremor-component="Badge"/);
  assert.match(badgeSuccess, /bg-green/);

  const badgeWarning = renderTremorBadge("failed", { tone: "warning" });
  assert.match(badgeWarning, /bg-yellow/);

  const badgeApproved = renderTremorBadge("approved", { tone: "approved" });
  assert.match(badgeApproved, /bg-green/);

  const card = renderTremorCard({ title: "Stories", description: "Review queue.", children: "Table" });
  assert.match(card, /data-tremor-component="Card"/);
  assert.match(card, /Stories/);
  assert.match(card, /Table/);

  const metric = renderTremorMetric({ value: "42", label: "Total Stories" });
  assert.match(metric, /42/);
  assert.match(metric, /Total Stories/);
  assert.match(metric, /data-tremor-component="Metric"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /srv/projects/vivo-factory && node --test tests/tremor-dashboard.test.js
```

Expected: FAIL — `renderSidebarNav` does not exist yet.

- [ ] **Step 3: Rewrite src/tremor-dashboard.js**

Replace the entire file with:

```js
export const TREMOR_DASHBOARD_FRAMEWORK = "tremor-raw-dashboard";

export function renderTremorFrameworkMeta() {
  return `<meta name="ui-framework" content="${TREMOR_DASHBOARD_FRAMEWORK}" />`;
}

export function renderSidebarNav(activeTab) {
  const tabs = [
    { id: "setup", label: "Setup", href: "/" },
    { id: "stories", label: "Stories", href: "/?tab=stories" },
    { id: "audiences", label: "Audiences", href: "/?tab=audiences" }
  ];

  const navItems = tabs.map((tab) => {
    const isActive = tab.id === activeTab;
    const baseClasses = "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors";
    const stateClasses = isActive
      ? "bg-gray-800 text-white font-medium"
      : "text-gray-400 hover:bg-gray-800 hover:text-white";
    return `<a class="${baseClasses} ${stateClasses}"
        href="${escapeAttribute(tab.href)}"
        ${isActive ? 'aria-current="page"' : ""}
      >${escapeHtml(tab.label)}</a>`;
  }).join("");

  return `<aside class="flex w-44 flex-col bg-gray-900 flex-shrink-0">
    <div class="px-4 py-5 border-b border-gray-800">
      <div class="text-sm font-bold text-gray-100 tracking-tight">Vivo Factory</div>
      <div class="text-xs text-gray-500 mt-0.5">Control Plane</div>
    </div>
    <nav class="flex-1 px-2 py-3 space-y-0.5" aria-label="Workspace">
      ${navItems}
    </nav>
    <div class="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
      <span class="text-xs text-gray-500">operator</span>
      <button id="theme-toggle"
              class="rounded px-2 py-1 text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
              aria-label="Toggle color theme">Theme</button>
    </div>
  </aside>`;
}

export function renderTremorCard({ title, description = "", action = "", children = "", className = "" }) {
  const header = title || description || action
    ? `<div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-start justify-between gap-3">
          <div>
            ${title ? `<h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(title)}</h2>` : ""}
            ${description ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(description)}</p>` : ""}
          </div>
          ${action}
        </div>
      </div>`
    : "";
  return `<section class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden${className ? ` ${escapeAttribute(className)}` : ""}" data-tremor-component="Card">
    ${header}
    ${children}
  </section>`;
}

export function renderTremorBadge(value, { tone = "neutral" } = {}) {
  const normalized = value ?? "unknown";
  const colorClasses = tone === "success" || tone === "approved"
    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    : tone === "warning"
      ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
      : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClasses}" data-tremor-component="Badge">${escapeHtml(normalized)}</span>`;
}

export function renderTremorMetric({ value, label }) {
  return `<div data-tremor-component="Metric">
    <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">${escapeHtml(label)}</dt>
    <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(value)}</dd>
  </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /srv/projects/vivo-factory && node --test tests/tremor-dashboard.test.js
```

Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/tremor-dashboard.js tests/tremor-dashboard.test.js
git commit -m "feat: replace Tremor tabs with sidebar nav, update all component classes to Tailwind UI"
```

---

## Task 4: Stories workspace

**Files:**
- Modify: `src/app.js` — update `renderStoriesWorkspace`, `renderStoryTableRows`, `renderStoryDetailDrawer`, `renderAssetCard`

- [ ] **Step 1: Replace renderStoriesWorkspace()**

Find `function renderStoriesWorkspace(context)` (around line 1620) and replace the entire function body with:

```js
function renderStoriesWorkspace(context) {
  const {
    model,
    storyTableRows,
    audienceOptions,
    auditItems,
    analyticsItems
  } = context;

  const storiesTable = renderTremorCard({
    title: "Stories",
    description: "Select a row to open details, assets, approval, and publication controls.",
    action: `<span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(String(model.stories.length))} stories</span>`,
    children: `
      <form method="GET" class="flex flex-wrap items-end gap-3 px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <input type="hidden" name="tab" value="stories" />
        <label class="flex flex-col gap-1 min-w-[120px]">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</span>
          <select name="status" class="block rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none">${renderStatusOptions(model.filters.status)}</select>
        </label>
        <label class="flex flex-col gap-1 min-w-[120px]">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Review</span>
          <select name="review_status" class="block rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none">${renderReviewOptions(model.filters.review_status)}</select>
        </label>
        <label class="flex flex-col gap-1 min-w-[120px]">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Audience</span>
          <select name="audience_id" class="block rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none">
            <option value="">All audiences</option>
            ${audienceOptions}
          </select>
        </label>
        <label class="flex flex-col gap-1 flex-1 min-w-[160px]">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Search</span>
          <input type="text" name="search" value="${escapeAttribute(model.filters.search ?? "")}" placeholder="Search title or story text"
                 class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        </label>
        <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors cursor-pointer">Apply</button>
      </form>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700" data-tremor-component="Table">
          <thead class="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Story</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Audience</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Review</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Asset</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Channel</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Updated</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
            ${storyTableRows || `<tr><td colspan="7" class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">No stories match these filters.</td></tr>`}
          </tbody>
        </table>
      </div>`
  });

  return `<div class="space-y-5">
    ${storiesTable}
    <div class="grid grid-cols-2 gap-5">
      <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Audit Log</h2>
        </div>
        <ul class="divide-y divide-gray-100 dark:divide-gray-700 px-5">${auditItems}</ul>
      </div>
      <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Analytics Snapshot</h2>
        </div>
        <ul class="divide-y divide-gray-100 dark:divide-gray-700 px-5">${analyticsItems}</ul>
      </div>
    </div>
  </div>`;
}
```

- [ ] **Step 2: Replace renderStoryTableRows()**

Find `function renderStoryTableRows(stories, filters, activeStoryId)` (around line 1682) and replace the function body:

```js
function renderStoryTableRows(stories, filters, activeStoryId) {
  return stories.map((story) => {
    const href = buildDashboardHref(filters, story.id);
    const targetLabel = story.publication_target
      ? `${story.publication_target.channel}:${story.publication_target.target_identifier}`
      : "unconfigured";
    const isActive = story.id === activeStoryId;
    return `<tr class="${isActive ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-700/50"} transition-colors cursor-pointer" data-story-href="${escapeAttribute(href)}">
      <td class="px-6 py-3">
        <a class="block" href="${escapeAttribute(href)}">
          <div class="text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(story.title)}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(truncateText(story.summary ?? story.story_text ?? "", 86))}</div>
        </a>
      </td>
      <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(story.audience?.label ?? "Unknown audience")}</td>
      <td class="px-4 py-3">${renderStatusBadge(story.status)}</td>
      <td class="px-4 py-3">${renderReviewBadge(story.operator_review_status)}</td>
      <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">${escapeHtml(story.selected_asset_id ?? "none")}</td>
      <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(targetLabel)}</td>
      <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(formatShortDate(story.updated_at ?? story.created_at))}</td>
    </tr>`;
  }).join("");
}
```

- [ ] **Step 3: Replace renderStoryDetailDrawer()**

Find `function renderStoryDetailDrawer(...)` (around line 1705) and replace the entire function body:

```js
function renderStoryDetailDrawer({ story, assetCards, publicationItems, reviewItems, metadataJson, selectedAssetId, publicationTarget, closeHref }) {
  return `<div class="fixed inset-0 z-40" data-tremor-component="DrawerPortal">
  <a class="fixed inset-0 bg-gray-900/50 dark:bg-gray-900/70 backdrop-blur-sm z-40"
     href="${escapeAttribute(closeHref)}" aria-label="Close story details"></a>
  <aside class="fixed inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white dark:bg-gray-800
                shadow-xl z-50 overflow-hidden"
         data-tremor-component="Drawer" aria-label="Story details">
    <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b
                border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90
                backdrop-blur px-6 py-4">
      <div>
        <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">Story Details</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(story.audience?.label ?? "Unknown audience")}</p>
      </div>
      <a class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors"
         href="${escapeAttribute(closeHref)}">Close</a>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-5 space-y-6">

      <dl class="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        ${[
          ["Pipeline", story.status],
          ["Review", story.operator_review_status],
          ["Asset", selectedAssetId || "none"],
          ["Instance", story.instance?.service_name ?? "unassigned"],
          ["Channel", publicationTarget ? `${publicationTarget.channel}:${publicationTarget.target_identifier}` : "unconfigured"]
        ].map(([k, v]) => `<div class="bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
          <dt class="text-xs font-medium text-gray-500 dark:text-gray-400">${escapeHtml(k)}</dt>
          <dd class="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100 break-all">${escapeHtml(v)}</dd>
        </div>`).join("")}
      </dl>

      <section>
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Story Copy</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Edit story text and metadata.</p>
          </div>
        </div>
        <form id="story-form" data-story-id="${escapeAttribute(story.id)}" class="space-y-3">
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Title</span>
            <input name="title" value="${escapeAttribute(story.title)}"
                   class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </label>
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Story Text</span>
            <textarea name="story_text" rows="5"
                      class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y">${escapeHtml(story.story_text)}</textarea>
          </label>
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Summary</span>
            <textarea name="summary" rows="3"
                      class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y">${escapeHtml(story.summary ?? "")}</textarea>
          </label>
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Metadata JSON</span>
            <textarea name="metadata" rows="4"
                      class="block w-full rounded-md border-0 py-1.5 px-3 text-sm font-mono text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y">${metadataJson}</textarea>
          </label>
          <div class="flex gap-2">
            <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors cursor-pointer">Save Story</button>
          </div>
        </form>
      </section>

      <section class="border-t border-gray-200 dark:border-gray-700 pt-5">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Asset Panel</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Select or replace the publish asset.</p>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">${assetCards}</div>
      </section>

      <section class="border-t border-gray-200 dark:border-gray-700 pt-5">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Publication Queue</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Approve with a selected asset before queueing.</p>
          </div>
        </div>
        <dl class="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-4">
          <div class="bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
            <dt class="text-xs font-medium text-gray-500 dark:text-gray-400">Channel</dt>
            <dd class="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(publicationTarget?.channel ?? "unconfigured")}</dd>
          </div>
          <div class="bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
            <dt class="text-xs font-medium text-gray-500 dark:text-gray-400">Target</dt>
            <dd class="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(publicationTarget?.target_identifier ?? "unconfigured")}</dd>
          </div>
        </dl>
        <form id="review-form" data-story-id="${escapeAttribute(story.id)}" class="space-y-3">
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Review Notes</span>
            <textarea name="review_notes" placeholder="What changed or why is this ready?" rows="3"
                      class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y"></textarea>
          </label>
          <input type="hidden" name="selected_asset_id" value="${escapeAttribute(selectedAssetId)}" />
          <div class="flex flex-wrap gap-2">
            <button type="button" data-review-status="approved"
                    class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Approve</button>
            <button type="button" data-review-status="changes_requested"
                    class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Request Changes</button>
            <button type="button" data-review-status="rejected"
                    class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Reject</button>
          </div>
        </form>
        <div class="mt-4 flex gap-2">
          <button type="button" id="queue-publication-button" data-story-id="${escapeAttribute(story.id)}"
                  class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Queue Channel Publication</button>
        </div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-5 mb-2">Queued Publications</h3>
        <ul class="divide-y divide-gray-100 dark:divide-gray-700">${publicationItems}</ul>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-5 mb-2">Review History</h3>
        <ul class="divide-y divide-gray-100 dark:divide-gray-700">${reviewItems}</ul>
      </section>

    </div>
  </aside>
</div>`;
}
```

- [ ] **Step 4: Replace renderAssetCard()**

Find `function renderAssetCard(story, asset)` (around line 2480) and replace:

```js
function renderAssetCard(story, asset) {
  const replaceUrl = `/api/stories/${story.id}/assets/${asset.id}/replace`;
  const selectUrl = `/api/stories/${story.id}/assets/${asset.id}/select`;
  const previewUrl = asset.preview_url ?? asset.download_url ?? asset.source_asset_url ?? "";
  const preview = previewUrl
    ? renderAssetPreview(asset, previewUrl)
    : `<div class="flex items-center justify-center h-24 text-xs text-gray-400 dark:text-gray-500">${escapeHtml(asset.storage_object?.file_name ?? asset.source_asset_url ?? `${asset.asset_type} asset`)}</div>`;
  const isSelected = asset.is_selected;

  return `<article class="rounded-lg border ${isSelected ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-200 dark:border-gray-700"} bg-white dark:bg-gray-800 p-3 space-y-2" data-asset-card>
    <div class="rounded-md overflow-hidden bg-gray-100 dark:bg-gray-700 min-h-[96px] flex items-center justify-center">${preview}</div>
    <p class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(asset.asset_type)} · ${escapeHtml(asset.status)} · ${isSelected ? "selected" : "not selected"}</p>
    <button type="button" data-asset-select="${escapeAttribute(selectUrl)}"
            class="w-full rounded-md bg-white dark:bg-gray-700 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Select</button>
    <label class="block">
      <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Replace Asset</span>
      <input type="file" accept="image/*,video/mp4"
             class="block w-full text-xs text-gray-500 dark:text-gray-400 file:mr-2 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-gray-700 dark:file:bg-gray-700 dark:file:text-gray-300" />
    </label>
    <button type="button" data-asset-replace="${escapeAttribute(replaceUrl)}"
            class="w-full rounded-md bg-gray-900 dark:bg-gray-100 px-2 py-1 text-xs font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Upload Replacement</button>
  </article>`;
}
```

- [ ] **Step 5: Update audit/review/publication list items in renderDashboard()**

Inside `renderDashboard()`, find the `publicationItems`, `reviewItems`, `auditItems`, and `analyticsItems` map calls (around lines 666–677). Replace all four with versions that use Tailwind list styles:

```js
  const publicationItems = model.activeStory?.publications?.length
    ? model.activeStory.publications.map((publication) => `<li class="flex items-start justify-between gap-3 py-2.5 text-sm"><strong class="text-gray-900 dark:text-gray-100">${escapeHtml(publication.channel)}</strong> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(publication.status)}</span> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(publication.target_identifier)}</span></li>`).join("")
    : `<li class="py-2.5 text-sm text-gray-500 dark:text-gray-400">No queued publications</li>`;
  const reviewItems = model.activeStory?.reviews?.length
    ? model.activeStory.reviews.map((review) => `<li class="flex items-start justify-between gap-3 py-2.5 text-sm"><strong class="text-gray-900 dark:text-gray-100">${escapeHtml(review.review_status)}</strong> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(review.actor_id)}</span> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(review.review_notes ?? "")}</span></li>`).join("")
    : `<li class="py-2.5 text-sm text-gray-500 dark:text-gray-400">No review history</li>`;
  const auditItems = model.auditItems.length
    ? model.auditItems.map((item) => `<li class="flex items-start justify-between gap-3 py-2.5 text-sm"><strong class="text-gray-900 dark:text-gray-100">${escapeHtml(item.type)}</strong> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(item.timestamp ?? "")}</span></li>`).join("")
    : `<li class="py-2.5 text-sm text-gray-500 dark:text-gray-400">No audit events</li>`;
  const analyticsItems = model.analyticsItems.length
    ? model.analyticsItems.map((item) => `<li class="flex items-start justify-between gap-3 py-2.5 text-sm"><strong class="text-gray-900 dark:text-gray-100">${escapeHtml(item.story_id ?? item.topic ?? "feedback")}</strong> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(String(item.engagement_score ?? 0))}</span></li>`).join("")
    : `<li class="py-2.5 text-sm text-gray-500 dark:text-gray-400">No analytics snapshots</li>`;
```

Also update the `assetCards` fallback:
```js
  const assetCards = model.activeStory
    ? model.activeStory.assets.map((asset) => renderAssetCard(model.activeStory, asset)).join("")
    : `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">Select a story to review assets.</div>`;
```

- [ ] **Step 6: Rebuild CSS**

```bash
cd /srv/projects/vivo-factory && npm run build:css
```

- [ ] **Step 7: Run tests**

```bash
cd /srv/projects/vivo-factory && npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/app.js
git commit -m "feat: migrate stories workspace to Tailwind UI components"
```

---

## Task 5: Setup workspace

**Files:**
- Modify: `src/app.js` — update `renderSetupWorkspace`, `renderSetupChecklist`, `renderAudienceImportPanel`, `renderLaunchConfigForm`

- [ ] **Step 1: Replace renderSetupWorkspace()**

Find `function renderSetupWorkspace(...)` (around line 1582) and replace:

```js
function renderSetupWorkspace({ model, setupChecklist, audienceImportPanel }) {
  return `<div class="grid grid-cols-2 gap-6 items-start">
    <div class="space-y-5">
      <dl class="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div class="bg-white dark:bg-gray-800 px-5 py-4">
          <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Setup state</dt>
          <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(model.setupStatus?.ready ? "Ready" : "Open")}</dd>
        </div>
        <div class="bg-white dark:bg-gray-800 px-5 py-4">
          <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Audiences</dt>
          <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(String(model.audiences.length))}</dd>
        </div>
        <div class="bg-white dark:bg-gray-800 px-5 py-4">
          <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">LLM model</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 truncate">${escapeHtml(model.setupStatus?.llm?.model ?? "unset")}</dd>
        </div>
      </dl>
      <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Setup Checklist</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Supabase, schema, LLM, and dashboard readiness.</p>
          </div>
          <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(model.setupStatus?.ready ? "ready" : "action required")}</span>
        </div>
        <div class="px-5 py-4">${setupChecklist}</div>
      </div>
    </div>
    <div class="space-y-5">
      <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Create Audiences</h2>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Import audience.md or create one investigated profile. Instances are not prepared until launch.</p>
        </div>
        <div class="px-5 py-4 space-y-5">
          ${audienceImportPanel}
          <div class="border-t border-gray-200 dark:border-gray-700 pt-5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Create One Audience</h3>
            <form id="create-audience-form" class="space-y-3">
              <label class="block">
                <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Raw audience brief, sources, photos, accounts</span>
                <textarea name="raw_text" rows="5" placeholder="Describe the audience. Add Twitter accounts, similar photos, references, and constraints."
                          class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y"></textarea>
              </label>
              <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Run LLM Investigation</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
```

- [ ] **Step 2: Replace renderSetupChecklist()**

Find `function renderSetupChecklist(setupStatus)` (around line 2504) and replace:

```js
function renderSetupChecklist(setupStatus) {
  const checks = setupStatus?.checks ?? {};
  return `<ul class="divide-y divide-gray-100 dark:divide-gray-700">
    ${Object.entries(checks).map(([key, value]) => `<li class="flex items-start justify-between gap-3 py-2.5">
      <span class="text-sm text-gray-900 dark:text-gray-100 capitalize">${escapeHtml(humanizeCheckName(key))}</span>
      <div class="flex items-center gap-2 text-right">
        <span class="${value?.ok ? "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}">${escapeHtml(value?.ok ? "ok" : "missing")}</span>
        <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(value?.message ?? "")}</span>
      </div>
    </li>`).join("")}
  </ul>`;
}
```

- [ ] **Step 3: Replace renderAudienceImportPanel()**

Find `function renderAudienceImportPanel(preview)` (around line 2511) and replace:

```js
function renderAudienceImportPanel(preview) {
  if (!preview) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-5 text-sm text-gray-500 dark:text-gray-400">Audience import is not configured.</div>`;
  }
  const sourceLabel = preview.source_file_name ?? "No audience source";
  const itemCount = preview.items?.length ?? preview.item_count ?? 0;
  const summary = preview.error
    ? escapeHtml(preview.error)
    : preview.import_required
      ? `${itemCount} audience updates ready to import`
      : "No audience import required";
  return `<div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
    <p class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Source</p>
    <p class="text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(sourceLabel)}</p>
    <p class="text-xs text-gray-500 dark:text-gray-400">LLM expansion runs before Supabase write.</p>
    <p class="text-xs text-gray-500 dark:text-gray-400">${summary}</p>
    ${preview.import_required ? `<div class="pt-1"><button type="button" id="import-audience-file-button" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Import ${escapeHtml(sourceLabel)}</button></div>` : ""}
  </div>`;
}
```

- [ ] **Step 4: Replace renderLaunchConfigForm()**

Find `function renderLaunchConfigForm(audience, instance)` (around line 2531) and replace:

```js
function renderLaunchConfigForm(audience, instance) {
  const runtime = instance?.runtime_config ?? {};
  const value = (key, fallback = "") => escapeAttribute(runtime[key] ?? instance?.[key] ?? fallback);
  const inputClass = "block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5";
  return `<form class="space-y-4" data-launch-audience-id="${escapeAttribute(audience.id)}">
    <div class="grid grid-cols-2 gap-3">
      <label class="block"><span class="${labelClass}">Telegram Bot Token</span><input name="telegram_bot_token" value="${value("telegram_bot_token")}" autocomplete="off" required class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Telegram Channel ID</span><input name="telegram_chat_id" value="${value("telegram_chat_id")}" placeholder="-100..." required class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Telegram Report ID</span><input name="telegram_report_chat_id" value="${value("telegram_report_chat_id", runtime.telegram_chat_id ?? "")}" placeholder="-100..." class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">OpenClaw Admin URL</span><input name="openclaw_admin_url" value="${value("openclaw_admin_url")}" placeholder="http://127.0.0.1:7610" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Base URL</span><input name="plugin_base_url" value="${value("plugin_base_url", instance?.profile_base_url ?? "")}" placeholder="http://127.0.0.1:5410" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Engine Image</span><input name="profile_engine_image" value="${value("profile_engine_image")}" placeholder="ghcr.io/openclaw/marble-profile-service:latest" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Engine Command</span><input name="profile_engine_command" value="${value("profile_engine_command")}" placeholder="node api/profile-server.js" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Health Path</span><input name="profile_engine_health_path" value="${value("profile_engine_health_path", "/healthz")}" placeholder="/healthz" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Storage Path</span><input name="profile_storage_path" value="${value("profile_storage_path")}" placeholder="/srv/marble-profile" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">LLM Provider</span><input name="llm_provider" value="${value("llm_provider", "openai")}" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">LLM Model</span><input name="llm_model" value="${value("llm_model")}" placeholder="global default" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">LLM Base URL</span><input name="llm_base_url" value="${value("llm_base_url")}" placeholder="global default" class="${inputClass}" /></label>
    </div>
    <div class="flex justify-end">
      <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Launch Deployment</button>
    </div>
  </form>`;
}
```

- [ ] **Step 5: Rebuild CSS and run tests**

```bash
cd /srv/projects/vivo-factory && npm run build:css && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/app.js
git commit -m "feat: migrate setup workspace to Tailwind UI components"
```

---

## Task 6: Audiences workspace

**Files:**
- Modify: `src/app.js` — update all audience-related render functions

- [ ] **Step 1: Replace renderAudiencesWorkspace()**

Find `function renderAudiencesWorkspace(...)` (around line 1779) and replace:

```js
function renderAudiencesWorkspace({ model, deployments, selectedAudience, selectedAudienceInstance, selectedProfileState, selectedDeployment }) {
  return `<div class="grid gap-6" style="grid-template-columns: 200px minmax(0,1fr) 280px; align-items: start;">
    <div class="sticky top-0 space-y-0.5">
      <div class="flex items-start justify-between gap-2 mb-3">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Audience Directory</h2>
        <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(String(model.audiences.length))}</span>
      </div>
      ${renderAudienceDirectory(model.audiences ?? [], deployments, model.audienceProfiles ?? new Map(), selectedAudience?.id ?? "")}
    </div>
    <div>
      <div class="flex items-start justify-between gap-3 mb-4">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Audience Workspace</h2>
      </div>
      ${renderAudienceWorkspaceCanvas(selectedAudience, selectedAudienceInstance, selectedProfileState)}
    </div>
    <div class="sticky top-0 space-y-5">
      ${renderAudienceInspector(selectedAudience, selectedDeployment, deployments)}
    </div>
  </div>`;
}
```

- [ ] **Step 2: Replace renderAudienceDirectory()**

Find `function renderAudienceDirectory(...)` (around line 1866) and replace:

```js
function renderAudienceDirectory(audiences, deployments, audienceProfiles, selectedAudienceId) {
  if (!audiences.length) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">No audiences are configured.</div>`;
  }

  return `<div class="divide-y divide-gray-100 dark:divide-gray-700">
    ${audiences.map((audience) => {
      const deployment = deployments.find((item) => deploymentMatchesAudience(item, audience)) ?? null;
      const summary = audienceProfiles.get(audience.id)?.summary?.profile ?? {};
      const href = buildAudienceWorkspaceHref(audience.id);
      const isActive = audience.id === selectedAudienceId;
      return `<a class="block py-3 px-2 rounded-md transition-colors ${isActive ? "bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500 pl-3" : "hover:bg-gray-50 dark:hover:bg-gray-800 border-l-2 border-transparent pl-3"}"
           href="${escapeAttribute(href)}" data-audience-link="${escapeAttribute(audience.id)}">
        <div class="flex items-start justify-between gap-1 mb-0.5">
          <span class="text-xs font-semibold text-gray-900 dark:text-gray-100 leading-tight">${escapeHtml(audience.label ?? audience.audience_key ?? audience.id)}</span>
          ${renderTremorBadge(deployment?.status ?? audience.status ?? "draft", { tone: deployment?.status === "active" ? "success" : "neutral" })}
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 leading-snug line-clamp-2">${escapeHtml(formatStructuredText(summary.reasoning_summary ?? audience.family_context, "No summary."))}</p>
      </a>`;
    }).join("")}
  </div>`;
}
```

- [ ] **Step 3: Replace renderAudienceWorkspaceCanvas()**

Find `function renderAudienceWorkspaceCanvas(audience, instance, profileState = {})` (around line 1893) and replace. This is a large function — replace with:

```js
function renderAudienceWorkspaceCanvas(audience, instance, profileState = {}) {
  if (!audience) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-8 text-sm text-gray-500 dark:text-gray-400 text-center">Create an audience to unlock Marble profile editing and runtime launch controls.</div>`;
  }

  const summary = profileState.summary?.profile ?? {};
  const debug = profileState.debug ?? null;
  const error = profileState.error ?? "";
  const merged = {
    label: formatStructuredText(summary.label ?? audience.label, audience.label ?? ""),
    location: formatStructuredText(summary.location ?? audience.location, audience.location ?? ""),
    family_context: formatStructuredText(summary.family_context ?? audience.family_context, audience.family_context ?? ""),
    interests: normalizeAudienceList(summary.interests ?? audience.interests ?? []),
    content_pillars: normalizeAudienceList(summary.content_pillars ?? audience.content_pillars ?? []),
    excluded_topics: normalizeAudienceList(summary.excluded_topics ?? audience.excluded_topics ?? []),
    tone: formatStructuredText(summary.tone ?? audience.tone, audience.tone ?? ""),
    shopping_bias: formatStructuredText(summary.shopping_bias ?? audience.shopping_bias, audience.shopping_bias ?? ""),
    posting_schedule: formatStructuredText(debug?.metadata?.posting_schedule ?? audience.posting_schedule, audience.posting_schedule ?? ""),
    reasoning_summary: formatStructuredText(summary.reasoning_summary, ""),
    updated_at: summary.updated_at ?? "",
    extra_metadata: debug?.metadata?.extra_metadata ?? audience.profile_snapshot?.extra_metadata ?? {}
  };
  const interestCount = debug?.memory_nodes?.interests ?? merged.interests.length;
  const preferenceCount = debug?.memory_nodes?.preferences ?? debug?.memory_nodes?.preference_count ?? 0;
  const decisionCount = Array.isArray(debug?.decisions) ? debug.decisions.length : 0;
  const debugJson = error ? "" : escapeHtml(JSON.stringify(debug ?? { profile: summary, metadata: merged.extra_metadata }, null, 2));

  const inputClass = "block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5";

  return `<div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden space-y-0">

    <div class="grid gap-6 p-6" style="grid-template-columns: minmax(0,1fr) 200px;">
      <div class="space-y-2">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Selected Audience</p>
        <h2 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(merged.label || audience.label || audience.audience_key || audience.id)}</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">${escapeHtml(merged.family_context || "Family context is not set yet.")}</p>
      </div>
      <div class="space-y-3">
        ${renderAudienceHeroFact("Audience Key", audience.audience_key ?? audience.id)}
        ${renderAudienceHeroFact("Location", merged.location || "Location unset")}
        ${renderAudienceHeroFact("Language", formatStructuredText(audience.language, "Language unset"))}
        ${renderAudienceHeroFact("Runtime", instance?.status ?? "not launched")}
      </div>
    </div>

    <dl class="grid grid-cols-4 divide-x divide-gray-200 dark:divide-gray-700 border-t border-gray-200 dark:border-gray-700">
      <div class="px-5 py-4">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Tracked Interests</dt>
        <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(String(merged.interests.length || 0))}</dd>
      </div>
      <div class="px-5 py-4">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Preferences</dt>
        <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(String(preferenceCount || 0))}</dd>
      </div>
      <div class="px-5 py-4">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Decision Events</dt>
        <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(String(decisionCount || 0))}</dd>
      </div>
      <div class="px-5 py-4">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Last Sync</dt>
        <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 text-base">${escapeHtml(merged.updated_at ? formatShortDate(merged.updated_at) : "never")}</dd>
      </div>
    </dl>

    <div class="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Profile Canvas</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Current Marble interpretation, summarized for operator review.</p>
        </div>
        ${renderTremorBadge(error ? "Marble unavailable" : "Marble connected", { tone: error ? "warning" : "success" })}
      </div>
      ${error ? `<div class="rounded-lg border border-dashed border-yellow-200 dark:border-yellow-800 p-4 text-sm text-yellow-700 dark:text-yellow-400">${escapeHtml(error)}</div>` : ""}
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-2">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Reasoning Summary</span>
          <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">${escapeHtml(merged.reasoning_summary || "No Marble summary stored.")}</p>
        </div>
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-2">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Audience Shape</span>
          <ul class="space-y-2 text-sm">
            <li class="flex justify-between gap-2"><strong class="text-gray-900 dark:text-gray-100">Tone</strong><span class="text-gray-500 dark:text-gray-400">${escapeHtml(merged.tone || "unset")}</span></li>
            <li class="flex justify-between gap-2"><strong class="text-gray-900 dark:text-gray-100">Shopping Bias</strong><span class="text-gray-500 dark:text-gray-400">${escapeHtml(merged.shopping_bias || "unset")}</span></li>
            <li class="flex justify-between gap-2"><strong class="text-gray-900 dark:text-gray-100">Posting Schedule</strong><span class="text-gray-500 dark:text-gray-400">${escapeHtml(merged.posting_schedule || "unset")}</span></li>
            <li class="flex justify-between gap-2"><strong class="text-gray-900 dark:text-gray-100">Memory Nodes</strong><span class="text-gray-500 dark:text-gray-400">${escapeHtml(String(interestCount))} interests</span></li>
          </ul>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3">
        ${renderAudienceTagBlock("Interests", merged.interests)}
        ${renderAudienceTagBlock("Content Pillars", merged.content_pillars)}
        ${renderAudienceTagBlock("Excluded Topics", merged.excluded_topics)}
      </div>
    </div>

    <div class="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Knowledge Inputs</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Edit the seeded facts that shape future Marble reads and delivery decisions.</p>
      </div>
      <form class="space-y-3" data-profile-facts-audience-id="${escapeAttribute(audience.id)}">
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><span class="${labelClass}">Label</span><input name="label" value="${escapeAttribute(merged.label)}" required class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Location</span><input name="location" value="${escapeAttribute(merged.location)}" required class="${inputClass}" /></label>
          <label class="block col-span-2"><span class="${labelClass}">Family Context</span><textarea name="family_context" rows="3" class="${inputClass} resize-y">${escapeHtml(merged.family_context)}</textarea></label>
          <label class="block"><span class="${labelClass}">Posting Schedule</span><input name="posting_schedule" value="${escapeAttribute(merged.posting_schedule)}" placeholder="weekday mornings" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Tone</span><input name="tone" value="${escapeAttribute(merged.tone)}" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Interests</span><input name="interests" value="${escapeAttribute((merged.interests ?? []).join(", "))}" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Content Pillars</span><input name="content_pillars" value="${escapeAttribute((merged.content_pillars ?? []).join(", "))}" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Excluded Topics</span><input name="excluded_topics" value="${escapeAttribute((merged.excluded_topics ?? []).join(", "))}" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Shopping Bias</span><input name="shopping_bias" value="${escapeAttribute(merged.shopping_bias)}" placeholder="quality-first" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Operator</span><input name="operator" value="operator@example.com" class="${inputClass}" /></label>
        </div>
        <label class="block"><span class="${labelClass}">Extra Metadata</span><textarea name="extra_metadata" rows="6" placeholder='{"shopping_data":["Maremagnum"]}' class="${inputClass} resize-y font-mono">${escapeHtml(JSON.stringify(merged.extra_metadata ?? {}, null, 2))}</textarea></label>
        <div class="flex justify-end">
          <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Sync Marble KG</button>
        </div>
      </form>
    </div>

    <div class="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Enrichment Feed</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Append shopping data, venues, event sites, and operator judgments as structured Marble events.</p>
      </div>
      <form class="space-y-3" data-profile-decision-audience-id="${escapeAttribute(audience.id)}">
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><span class="${labelClass}">Decision Type</span><input name="decision_type" value="operator_enrichment" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Source</span><input name="source" value="dashboard" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Operator</span><input name="operator" value="operator@example.com" class="${inputClass}" /></label>
        </div>
        <label class="block"><span class="${labelClass}">Content JSON</span><textarea name="content" rows="6" placeholder='{"shopping_data":["Passeig de Gracia"]}' class="${inputClass} resize-y font-mono">{}</textarea></label>
        <div class="flex justify-end">
          <button type="submit" class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Store Enrichment Event</button>
        </div>
      </form>
      <details class="group">
        <summary class="cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 select-none">Graph Debug</summary>
        <pre class="mt-2 rounded-md bg-gray-100 dark:bg-gray-900 p-3 text-xs font-mono overflow-x-auto leading-relaxed">${debugJson || "No Marble debug payload available."}</pre>
      </details>
    </div>

    <div class="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Runtime Controls</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Telegram, sidecar, and runtime overrides written at launch time.</p>
      </div>
      ${renderLaunchConfigForm(audience, instance)}
    </div>

  </div>`;
}
```

- [ ] **Step 4: Replace renderAudienceTagBlock()**

Find `function renderAudienceTagBlock(label, values)` (around line 2059) and replace:

```js
function renderAudienceTagBlock(label, values) {
  const items = normalizeAudienceList(values);
  return `<div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-2">
    <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">${escapeHtml(label)}</span>
    <div class="flex flex-wrap gap-1.5">${items.length
      ? items.map((v) => `<span class="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 px-2.5 py-0.5 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(v)}</span>`).join("")
      : `<span class="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 px-2.5 py-0.5 text-xs text-gray-400 dark:text-gray-500">None</span>`
    }</div>
  </div>`;
}
```

- [ ] **Step 5: Replace renderAudienceHeroFact()**

Find `function renderAudienceHeroFact(label, value)` (around line 2067) and replace:

```js
function renderAudienceHeroFact(label, value) {
  return `<div class="border-t border-gray-200 dark:border-gray-700 pt-2 first:border-0 first:pt-0">
    <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">${escapeHtml(label)}</span>
    <span class="block text-sm text-gray-900 dark:text-gray-100 mt-0.5 break-all">${escapeHtml(formatStructuredText(value, "unset"))}</span>
  </div>`;
}
```

- [ ] **Step 6: Replace renderAudienceInspector()**

Find `function renderAudienceInspector(audience, selectedDeployment, deployments)` (around line 2074) and replace:

```js
function renderAudienceInspector(audience, selectedDeployment, deployments) {
  return `
    <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
      <div class="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Runtime Snapshot</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Current deployment status and service endpoints.</p>
      </div>
      <div class="px-4 py-4">${renderSelectedDeployment(selectedDeployment)}</div>
    </div>
    <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
      <div class="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Manager Console</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Send direct operator feedback to the selected OpenClaw audience manager.</p>
      </div>
      <div class="px-4 py-4">${renderOperatorConsole(audience, selectedDeployment)}</div>
    </div>
    <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
      <div class="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Live Deployments</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Instance index across the factory.</p>
      </div>
      <div class="px-4 py-4">${renderDeploymentIndex(deployments)}</div>
    </div>`;
}
```

- [ ] **Step 7: Replace renderSelectedDeployment()**

Find `function renderSelectedDeployment(instance)` (around line 2102) and replace:

```js
function renderSelectedDeployment(instance) {
  if (!instance) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">No deployment selected.</div>`;
  }

  const actions = instance.source === "static"
    ? `<div class="flex flex-wrap gap-2 mt-3">
        <button type="button" data-instance-action="deploy" data-audience-id="${escapeAttribute(instance.audience_id)}" class="rounded-md bg-gray-900 dark:bg-gray-100 px-2.5 py-1 text-xs font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Deploy</button>
        <button type="button" data-instance-action="health" data-audience-id="${escapeAttribute(instance.audience_id)}" class="rounded-md bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Health</button>
        <button type="button" data-instance-action="report" data-audience-id="${escapeAttribute(instance.audience_id)}" class="rounded-md bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Report</button>
        <button type="button" data-instance-action="logs" data-audience-id="${escapeAttribute(instance.audience_id)}" class="rounded-md bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Logs</button>
      </div>`
    : "";

  return `<div class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <strong class="text-sm font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(instance.service_name ?? instance.audience_id)}</strong>
      ${renderTremorBadge(instance.status ?? "configured", { tone: instance.status === "active" ? "success" : "neutral" })}
    </div>
    <dl class="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
      <div class="flex justify-between gap-2"><dt>Audience</dt><dd class="text-gray-700 dark:text-gray-300 break-all">${escapeHtml(instance.audience_key ?? instance.audience_id)}</dd></div>
      <div class="flex justify-between gap-2"><dt>Chat</dt><dd class="text-gray-700 dark:text-gray-300">${escapeHtml(instance.telegram_chat_id || "unset")}</dd></div>
      <div class="flex justify-between gap-2"><dt>Report</dt><dd class="text-gray-700 dark:text-gray-300">${escapeHtml(instance.telegram_report_chat_id || "unset")}</dd></div>
      <div class="flex justify-between gap-2"><dt>Admin</dt><dd class="text-gray-700 dark:text-gray-300 break-all">${escapeHtml(instance.openclaw_admin_url || "unset")}</dd></div>
      <div class="flex justify-between gap-2"><dt>Profile</dt><dd class="text-gray-700 dark:text-gray-300">${escapeHtml(instance.profile_service_name || "unset")}</dd></div>
      <div class="flex justify-between gap-2"><dt>LLM</dt><dd class="text-gray-700 dark:text-gray-300">${escapeHtml(instance.llm_model || "default")}</dd></div>
      ${instance.env_file ? `<div class="flex justify-between gap-2"><dt>Env</dt><dd class="text-gray-700 dark:text-gray-300 break-all">${escapeHtml(instance.env_file)}</dd></div>` : ""}
    </dl>
    ${actions}
    <details class="group">
      <summary class="cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 select-none">Runtime Commands</summary>
      <div class="mt-2 space-y-2">
        ${renderCommandBlock("OpenClaw Shell", instance.commands?.openclaw_shell)}
        ${renderCommandBlock("Profile Shell", instance.commands?.profile_shell)}
        ${renderCommandBlock("OpenClaw Env", instance.commands?.openclaw_env)}
        ${renderCommandBlock("OpenClaw Logs", instance.commands?.openclaw_logs)}
        ${renderCommandBlock("Profile Logs", instance.commands?.profile_logs)}
      </div>
    </details>
  </div>`;
}
```

- [ ] **Step 8: Replace renderOperatorConsole()**

Find `function renderOperatorConsole(audience, selectedDeployment)` (around line 2144) and replace:

```js
function renderOperatorConsole(audience, selectedDeployment) {
  const audienceId = audience?.id ?? selectedDeployment?.audience_id ?? "";
  const audienceKey = audience?.audience_key ?? selectedDeployment?.audience_key ?? audienceId;
  if (!audienceId) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">Select an audience or launch a deployment to send operator feedback.</div>`;
  }
  const inputClass = "block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5";
  return `<form class="space-y-3" data-instance-chat-form="${escapeAttribute(audienceId)}">
    <label class="block"><span class="${labelClass}">Audience ID</span><input name="audience_id" value="${escapeAttribute(audienceId)}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Audience Key</span><input value="${escapeAttribute(audienceKey)}" disabled class="${inputClass} opacity-60" /></label>
    <label class="block"><span class="${labelClass}">Message</span><textarea name="message" rows="4" placeholder="Use the new Marble enrichment data when refining venue and product selections." class="${inputClass} resize-y"></textarea></label>
    <label class="block"><span class="${labelClass}">Operator</span><input name="operator" value="operator@example.com" class="${inputClass}" /></label>
    <div class="flex justify-end">
      <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Send To Instance</button>
    </div>
  </form>`;
}
```

- [ ] **Step 9: Replace renderDeploymentIndex()**

Find `function renderDeploymentIndex(deployments)` (around line 2169) and replace:

```js
function renderDeploymentIndex(deployments) {
  if (!deployments.length) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">No deployments</div>`;
  }
  return `<div class="divide-y divide-gray-100 dark:divide-gray-700">
    ${deployments.map((instance) => `<div class="flex items-center justify-between gap-2 py-2.5">
      <div>
        <strong class="block text-xs font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(instance.audience_key ?? instance.audience_id)}</strong>
        <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(instance.service_name ?? "unset")}</span>
      </div>
      ${renderTremorBadge(instance.status ?? "configured", { tone: instance.status === "active" ? "success" : "neutral" })}
    </div>`).join("")}
  </div>`;
}
```

- [ ] **Step 10: Replace renderCommandBlock()**

Find `function renderCommandBlock(label, command)` (around line 2639) and replace:

```js
function renderCommandBlock(label, command) {
  if (!command) {
    return "";
  }
  return `<div class="space-y-1">
    <span class="block text-xs font-medium text-gray-500 dark:text-gray-400">${escapeHtml(label)}</span>
    <code class="block rounded-md bg-gray-100 dark:bg-gray-900 px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-300 overflow-x-auto">${escapeHtml(command)}</code>
  </div>`;
}
```

- [ ] **Step 11: Replace renderAudienceFields()**

Find `function renderAudienceFields(audience)` (around line 2646) and replace:

```js
function renderAudienceFields(audience) {
  const inputClass = "block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5";
  return `
    <label class="block"><span class="${labelClass}">Label</span><input name="label" value="${escapeAttribute(audience.label ?? "")}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Language</span><input name="language" value="${escapeAttribute(audience.language ?? "")}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Location</span><input name="location" value="${escapeAttribute(audience.location ?? "")}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Family Context</span><textarea name="family_context" class="${inputClass} resize-y">${escapeHtml(audience.family_context ?? "")}</textarea></label>
    <label class="block"><span class="${labelClass}">Interests</span><input name="interests" value="${escapeAttribute((audience.interests ?? []).join(", "))}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Content Pillars</span><input name="content_pillars" value="${escapeAttribute((audience.content_pillars ?? []).join(", "))}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Excluded Topics</span><input name="excluded_topics" value="${escapeAttribute((audience.excluded_topics ?? []).join(", "))}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Tone</span><input name="tone" value="${escapeAttribute(audience.tone ?? "")}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Status</span><input name="status" value="${escapeAttribute(audience.status ?? "")}" class="${inputClass}" /></label>
  `;
}
```

- [ ] **Step 12: Rebuild CSS and run tests**

```bash
cd /srv/projects/vivo-factory && npm run build:css && npm test
```

Expected: all tests pass.

- [ ] **Step 13: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/app.js
git commit -m "feat: migrate audiences workspace to Tailwind UI components"
```

---

## Task 7: Add page headers, remove drawerOpen class, clean up remaining inline styles

**Files:**
- Modify: `src/app.js` — add page headers per workspace, remove `drawerOpen` html class, clean inline `style=` attributes

- [ ] **Step 1: Add page header to each workspace render function**

In `renderStoriesWorkspace()`, prepend a page header before the `space-y-5` div:

```js
  return `<div>
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Stories</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Review, approve, and publish story assets to Telegram channels.</p>
    </div>
    <div class="space-y-5">
      ...existing content...
    </div>
  </div>`;
```

In `renderSetupWorkspace()`, wrap with:

```js
  return `<div>
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Setup</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Supabase, LLM configuration, and audience provisioning.</p>
    </div>
    ...existing grid...
  </div>`;
```

In `renderAudiencesWorkspace()`, wrap with:

```js
  return `<div>
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Audiences</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Marble profile state, enrichment, and runtime delivery.</p>
    </div>
    ...existing grid...
  </div>`;
```

- [ ] **Step 2: Remove drawerOpen html/body class usage**

In `renderDashboard()`, the `drawerOpen` variable is used to add a `class="drawer-open"` to `<html>` and `<body>`. Since the drawer is now a fixed-position overlay that doesn't need `overflow: hidden` on the root (the sidebar layout already handles scroll containment within `<main>`), simplify:

Remove `${drawerOpen ? ' class="drawer-open"' : ""}` from the `<html>` tag.
Remove `class="h-screen overflow-hidden..."` reference to `drawerOpen` from `<body>` (the body already has `class="h-screen overflow-hidden bg-gray-50 dark:bg-gray-900"` unconditionally — confirm this is the case after Task 2 Step 3).

- [ ] **Step 3: Remove unused variables from renderDashboard()**

The new `renderStoriesWorkspace()` no longer uses `audienceFields` or `profileJson`. Remove these two lines from `renderDashboard()`:

```js
  const audienceFields = audience ? renderAudienceFields(audience) : `<p class="muted">No audience loaded.</p>`;
  // ...
  const profileJson = escapeHtml(JSON.stringify(audience?.profile_snapshot ?? {}, null, 2));
```

Also remove `audienceFields`, `profileJson` from the context object passed to `renderStoriesWorkspace(...)`.

- [ ] **Step 5: Find and remove any remaining inline style= attributes**

Search for leftover inline `style=` attributes in the render functions:

```bash
grep -n 'style=' /srv/projects/vivo-factory/src/app.js | grep -v '^\s*//'
```

For any remaining `style="margin-top:..."`, `style="margin-bottom:..."`, replace with the equivalent Tailwind spacing utilities (e.g., `style="margin-top:22px"` → `class="mt-5"`, `style="margin-top:10px"` → `class="mt-2.5"`). The `renderAudiencesWorkspace` grid uses an inline `style=` for the 3-column layout — this is fine to keep as Tailwind's `grid-cols` doesn't support arbitrary pixel column widths without safelist config.

- [ ] **Step 4: Final CSS build**

```bash
cd /srv/projects/vivo-factory && npm run build:css
```

Check the output file size:

```bash
ls -lh /srv/projects/vivo-factory/public/styles.css
```

Expected: somewhere between 20KB–60KB minified (all scanned utility classes).

- [ ] **Step 5: Run full test suite**

```bash
cd /srv/projects/vivo-factory && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/app.js public/styles.css
git commit -m "feat: add page headers, finalize Tailwind UI migration"
```

---

## Task 8: Verify the UI in a browser

- [ ] **Step 1: Start the server**

```bash
cd /srv/projects/vivo-factory && npm start
```

Navigate to `http://localhost:4310`. Verify:
- Dark sidebar renders with Setup / Stories / Audiences nav items
- Active tab is highlighted
- Theme toggle button in sidebar footer works (switches between light/dark)
- Stories tab shows filter bar + table with Tailwind UI badges
- Clicking a story row opens the slide-over drawer
- Audiences tab shows the 3-column layout
- Setup tab shows the stats row + checklist

- [ ] **Step 2: Verify dark mode**

Click the Theme toggle. Verify:
- Background switches to `bg-gray-900`
- Cards switch to `bg-gray-800`
- Text switches to `text-gray-100`
- All `dark:` variants activate correctly

- [ ] **Step 3: Final commit if any visual fixes were needed**

```bash
cd /srv/projects/vivo-factory && git add -p && git commit -m "fix: visual adjustments after browser review"
```
