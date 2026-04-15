export const TREMOR_DASHBOARD_FRAMEWORK = "tremor-raw-dashboard";

export function renderTremorFrameworkMeta() {
  return `<meta name="ui-framework" content="${TREMOR_DASHBOARD_FRAMEWORK}" />`;
}

export function renderTremorCard({ title, description = "", action = "", children = "", className = "" }) {
  const header = title || description || action
    ? `<div class="panel-inner">
        <div class="section-title">
          <div>${title ? `<h2>${escapeHtml(title)}</h2>` : ""}${description ? `<p class="muted">${escapeHtml(description)}</p>` : ""}</div>
          ${action}
        </div>
      </div>`
    : "";
  return `<section class="tremor-card${className ? ` ${escapeAttribute(className)}` : ""}" data-tremor-component="Card">
    ${header}
    ${children}
  </section>`;
}

export function renderTremorTabs(activeTab, tabs) {
  return `<nav class="workspace-tabs" data-tremor-component="TabNavigation" aria-label="Workspace">
    ${tabs.map((tab) => `<a class="workspace-tab${activeTab === tab.id ? " active" : ""}" href="${escapeAttribute(tab.href)}"${activeTab === tab.id ? ' aria-current="page"' : ""}>${escapeHtml(tab.label)}</a>`).join("")}
  </nav>`;
}

export function renderTremorBadge(value, { tone = "neutral" } = {}) {
  const normalized = value ?? "unknown";
  const toneClass = tone === "success"
    ? " ready"
    : tone === "warning"
      ? " warning"
      : tone === "approved"
        ? " approved"
        : "";
  return `<span class="badge${toneClass}" data-tremor-component="Badge">${escapeHtml(normalized)}</span>`;
}

export function renderTremorMetric({ value, label }) {
  return `<div class="stat" data-tremor-component="Metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
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
