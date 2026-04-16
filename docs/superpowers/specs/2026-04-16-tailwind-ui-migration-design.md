# Tailwind UI Migration Design

**Date:** 2026-04-16  
**Scope:** Full CSS migration from custom inline styles to Tailwind CSS with Tailwind UI component patterns  
**Approach:** Tailwind CLI + static build (no CDN, no framework change)

---

## Goals

- Replace the 850-line inline `<style>` block in `app.js` with Tailwind CSS utility classes
- Use Tailwind UI component HTML patterns throughout (table, badges, slide-over, inputs, buttons, stats)
- Dark sidebar application shell replacing the current top-nav + pill tabs
- Retain the existing light/dark theme toggle (no change to the JS mechanism)
- Zero changes to server logic, routing, data loading, or client-side JS

---

## Build Setup

### Dependencies

Add to `package.json`:
```json
{
  "devDependencies": {
    "tailwindcss": "^3"
  },
  "scripts": {
    "build:css": "tailwindcss -i src/input.css -o public/styles.css --minify",
    "dev": "npm run build:css && node src/server.js",
    "start": "node src/server.js"
  }
}
```

`start` remains unchanged (assumes `public/styles.css` is pre-built). `dev` builds CSS then starts the server.

### New files

**`tailwind.config.js`**
```js
export default {
  content: ['./src/**/*.js'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: { extend: {} },
  plugins: [],
}
```

`content` scans all render functions in `src/` for Tailwind class names.  
`darkMode: ['selector', '[data-theme="dark"]']` makes every `dark:` variant activate when `<html data-theme="dark">` — preserving the existing JS theme toggle without any changes.

**`src/input.css`**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**`public/styles.css`** — generated output, gitignored.

### Static file serving

`src/server.js` adds one route before existing routes:
```js
if (request.pathname === '/styles.css') {
  const css = await fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  return { status: 200, headers: { 'content-type': 'text/css' }, body: css };
}
```

### HTML `<head>` change

Remove the entire `<style>…</style>` block from `renderDashboard()`.  
Add: `<link rel="stylesheet" href="/styles.css" />`

---

## Application Shell

The current single `<main>` layout is replaced with a flex container:

```html
<div class="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
  <aside class="flex w-44 flex-col bg-gray-900 flex-shrink-0">
    <!-- logo, nav, footer -->
  </aside>
  <div class="flex flex-1 flex-col overflow-hidden">
    <main class="flex-1 overflow-y-auto">
      <!-- page header + workspace content -->
    </main>
  </div>
</div>
```

### Sidebar structure

```html
<aside class="flex w-44 flex-col bg-gray-900 flex-shrink-0">
  <!-- Logo -->
  <div class="px-4 py-5 border-b border-gray-800">
    <div class="text-sm font-bold text-gray-100 tracking-tight">Vivo Factory</div>
    <div class="text-xs text-gray-500 mt-0.5">Control Plane</div>
  </div>

  <!-- Nav -->
  <nav class="flex-1 px-2 py-3 space-y-0.5">
    <!-- inactive item -->
    <a class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-gray-400
              hover:bg-gray-800 hover:text-white transition-colors">
      <!-- icon + label -->
    </a>
    <!-- active item -->
    <a class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium
              bg-gray-800 text-white">
      <!-- icon + label -->
    </a>
  </nav>

  <!-- Footer: theme toggle -->
  <div class="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
    <span class="text-xs text-gray-500">operator</span>
    <button id="theme-toggle"
            class="rounded px-2 py-1 text-xs bg-gray-800 text-gray-300
                   hover:bg-gray-700 hover:text-white transition-colors">
      Theme
    </button>
  </div>
</aside>
```

### Page header (per tab)

Replaces the Georgia serif `<h1>` with a clean page header inside `<main>`:

```html
<div class="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-4">
  <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Stories</h1>
  <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
    Review, approve, and publish story assets
  </p>
</div>
```

### `renderTremorTabs()` → `renderSidebarNav()`

`renderTremorTabs()` in `tremor-dashboard.js` is renamed `renderSidebarNav(activeTab)` and emits the full sidebar HTML instead of a tab nav. `renderWorkspaceTabs()` in `app.js` is removed — the shell template calls `renderSidebarNav(activeTab)` directly to produce the sidebar. The function signature stays the same (takes `activeTab`).

---

## Component Map

### Cards / Panels

`.panel`, `.tremor-card`:
```html
<div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
```

### Table

`.tremor-table`:
```html
<table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
  <thead class="bg-gray-50 dark:bg-gray-800/50">
    <tr>
      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400
                 uppercase tracking-wide">Column</th>
    </tr>
  </thead>
  <tbody class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
      <td class="px-6 py-3 text-sm text-gray-900 dark:text-gray-100">…</td>
    </tr>
  </tbody>
</table>
```

### Badges

`.badge` (neutral):
```html
<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
             bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
```

`.badge.ready` / `.badge.approved` (success):
```html
<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
             bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
```

`.badge.warning`:
```html
<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
             bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
```

### Slide-over Drawer

`.story-detail-drawer` → Tailwind UI slide-over:
```html
<!-- Scrim -->
<div class="fixed inset-0 bg-gray-900/50 dark:bg-gray-900/70 backdrop-blur-sm z-40"></div>

<!-- Panel -->
<div class="fixed inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white dark:bg-gray-800
            shadow-xl z-50 transform transition-transform duration-300
            translate-x-full [&.open]:translate-x-0">
  <!-- Sticky header -->
  <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b
              border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90
              backdrop-blur px-6 py-4">
  </div>
  <!-- Scrollable body -->
  <div class="flex-1 overflow-y-auto px-6 py-5 space-y-6">
  </div>
</div>
```

The existing JS already toggles `.open` class — no JS changes needed.

### Buttons

Primary:
```html
<button class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium
               text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200
               transition-colors">
```

Secondary:
```html
<button class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium
               text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300
               dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
```

### Form Inputs / Selects

```html
<input class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900
              dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300
              dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500
              focus:outline-none">
```

### Labels

```html
<label class="block text-xs font-medium uppercase tracking-wide text-gray-500
              dark:text-gray-400 mb-1.5">
```

### Stats Row

`.stat-row` / `.stat`:
```html
<dl class="grid grid-cols-4 divide-x divide-gray-200 dark:divide-gray-700
           border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-5">
  <div class="bg-white dark:bg-gray-800 px-5 py-4">
    <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
      Label
    </dt>
    <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
      Value
    </dd>
  </div>
</dl>
```

### Pill Tags

`.pill`:
```html
<span class="inline-flex items-center rounded-full border border-gray-200
             dark:border-gray-700 px-2.5 py-0.5 text-xs text-gray-500 dark:text-gray-400">
```

### Section Headers

`.section-title`:
```html
<div class="flex items-start justify-between gap-3 mb-4">
  <div>
    <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Title</h2>
    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Description</p>
  </div>
  <!-- optional action -->
</div>
```

---

## Dark Mode

Tailwind's `darkMode: ['selector', '[data-theme="dark"]']` means every `dark:` variant activates when the root element has `data-theme="dark"`. The existing client-side JS sets this via `document.documentElement.dataset.theme = theme` — no changes required to the JS or the localStorage persistence.

---

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `tailwindcss` devDep, add `build:css` and `dev` scripts |
| `tailwind.config.js` | New file |
| `src/input.css` | New file (3 lines) |
| `public/styles.css` | Generated (add `public/` to `.gitignore`) |
| `src/server.js` | Add `/styles.css` static route |
| `src/app.js` | Remove `<style>` block, add `<link>`, replace all CSS classes with Tailwind utilities, restructure shell HTML |
| `src/tremor-dashboard.js` | Rename `renderWorkspaceTabs` → `renderSidebarNav`, update all component functions to emit Tailwind classes |

## Files Unchanged

- All route handlers in `app.js`
- All data-loading logic
- `renderDashboardScript()` — all client-side JS stays identical
- `src/server.js` — all existing routes
- All other `src/` files

---

## Out of Scope

- Extracting render functions into `src/views/` (a separate refactor)
- Adding Headless UI JS library (drawer open/close already works via plain class toggle)
- Any changes to API endpoints or data models
