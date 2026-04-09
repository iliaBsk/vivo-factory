import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(".");

test("Dockerfile exists and starts the dashboard server", () => {
  const dockerfilePath = path.join(rootDir, "Dockerfile");
  assert.ok(fs.existsSync(dockerfilePath), `expected Dockerfile at ${dockerfilePath}`);

  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  assert.match(dockerfile, /from node:22-alpine/i);
  assert.match(dockerfile, /workdir \/app/i);
  assert.match(dockerfile, /expose 4310/i);
  assert.match(dockerfile, /cmd \["node",\s*"src\/server\.js"\]/i);
});

test(".dockerignore excludes local and generated noise", () => {
  const dockerignorePath = path.join(rootDir, ".dockerignore");
  assert.ok(fs.existsSync(dockerignorePath), `expected .dockerignore at ${dockerignorePath}`);

  const dockerignore = fs.readFileSync(dockerignorePath, "utf8");
  for (const entry of ["node_modules", ".git", ".superpowers", "tmp", "data", ".env"]) {
    assert.match(dockerignore, new RegExp(`^${escapePattern(entry)}$`, "m"));
  }
});

test("staging runbook documents full dockerized deployment", () => {
  const runbookPath = path.join(rootDir, "docs/staging-runbook.md");
  const runbook = fs.readFileSync(runbookPath, "utf8");

  assert.match(runbook, /docker compose -f generated\/docker-compose\.yml up -d --build/i);
  assert.match(runbook, /vivo-factory-dashboard/i);
  assert.match(runbook, /\.env/i);
});

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
