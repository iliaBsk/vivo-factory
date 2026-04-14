import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadAudienceImportModule() {
  try {
    return await import("../src/audience-import.js");
  } catch (error) {
    assert.fail(`expected src/audience-import.js to exist: ${error.message}`);
  }
}

test("createAudienceImportService prefers audience.md and previews enriched imports before writing", async () => {
  const { createAudienceImportService } = await loadAudienceImportModule();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivo-audience-import-"));
  fs.writeFileSync(path.join(tmpDir, "audience.md"), `
<audience>
Creative single woman in early 30s living in Madrid. Loves yoga, running, and premium casual style.
</audience>
`);
  fs.writeFileSync(path.join(tmpDir, "audience_group.md"), `
<audience>
This file should be ignored because audience.md exists.
</audience>
`);

  const writes = [];
  const service = createAudienceImportService({
    cwd: tmpDir,
    repository: {
      async listAudiences() {
        return [];
      }
    },
    llmClient: {
      async expandAudience({ normalized }) {
        return {
          label: `${normalized.label} Expanded`,
          interests: [...normalized.interests, "wellness"],
          tone: "confident"
        };
      }
    },
    provisioningClient: {
      async ensureFactory(factory) {
        return { id: "factory-1", ...factory };
      },
      async upsertAudience(factory, audience) {
        writes.push({ type: "audience", factory, audience });
        return { id: "aud-1", ...audience };
      },
      async upsertInstance(factory, audience, instance) {
        writes.push({ type: "instance", factory, audience, instance });
        return { id: "inst-1", audience_id: audience.id, ...instance };
      }
    },
    factory: {
      factory_key: "vivo-factory",
      name: "Vivo Factory",
      description: "Audience manager control plane"
    },
    audienceRuntimeConfig: {}
  });

  const preview = await service.previewImport();

  assert.equal(preview.source_file_name, "audience.md");
  assert.equal(preview.import_required, true);
  assert.equal(preview.items.length, 1);
  assert.equal(preview.items[0].expanded.label.includes("Expanded"), true);
  assert.equal(writes.length, 0);

  const confirmed = await service.confirmImport(preview.items);

  assert.equal(confirmed.audiences.length, 1);
  assert.equal(writes.length, 2);
});
