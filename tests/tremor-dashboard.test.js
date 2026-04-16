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
