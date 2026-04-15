import test from "node:test";
import assert from "node:assert/strict";

test("tremor dashboard primitives expose framework metadata and component contracts", async () => {
  const {
    TREMOR_DASHBOARD_FRAMEWORK,
    renderTremorFrameworkMeta,
    renderTremorTabs,
    renderTremorBadge,
    renderTremorCard
  } = await import("../src/tremor-dashboard.js");

  assert.equal(TREMOR_DASHBOARD_FRAMEWORK, "tremor-raw-dashboard");
  assert.match(renderTremorFrameworkMeta(), /name="ui-framework" content="tremor-raw-dashboard"/);

  const tabs = renderTremorTabs("stories", [
    { id: "setup", label: "Setup", href: "/" },
    { id: "stories", label: "Stories", href: "/?tab=stories" }
  ]);
  assert.match(tabs, /data-tremor-component="TabNavigation"/);
  assert.match(tabs, /aria-current="page"/);

  assert.match(renderTremorBadge("ready_to_publish", { tone: "success" }), /data-tremor-component="Badge"/);
  assert.match(renderTremorCard({ title: "Stories", description: "Review queue.", children: "Table" }), /data-tremor-component="Card"/);
});
