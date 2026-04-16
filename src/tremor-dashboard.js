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
