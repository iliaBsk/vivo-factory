import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.resolve("supabase/migrations");

function readMigrations() {
  assert.ok(fs.existsSync(migrationsDir), `expected migrations directory to exist at ${migrationsDir}`);
  const migrationPaths = fs
    .readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()
    .map((entry) => path.join(migrationsDir, entry));

  assert.ok(migrationPaths.length > 0, `expected at least one migration in ${migrationsDir}`);

  return migrationPaths
    .map((migrationPath) => fs.readFileSync(migrationPath, "utf8"))
    .join("\n\n");
}

test("supabase migration defines vivo tables and enums", () => {
  const sql = readMigrations();

  for (const tableName of [
    "vivo_factories",
    "vivo_audiences",
    "vivo_instances",
    "vivo_stories",
    "vivo_story_reviews",
    "vivo_story_sources",
    "vivo_story_classifications",
    "vivo_story_assets",
    "vivo_story_asset_decisions",
    "vivo_story_reel_generation_runs",
    "vivo_story_reel_candidates",
    "vivo_storage_objects",
    "vivo_pipeline_jobs",
    "vivo_story_publications",
    "vivo_feedback_events",
    "vivo_audit_events"
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${tableName}`, "i"));
  }

  for (const typeName of [
    "vivo_story_status",
    "vivo_asset_decision",
    "vivo_asset_status",
    "vivo_job_status",
    "vivo_publication_status",
    "vivo_operator_review_status"
  ]) {
    assert.match(sql, new RegExp(`create type public\\.${typeName} as enum`, "i"));
  }
});

test("supabase migration enforces ready_to_publish asset requirements", () => {
  const sql = readMigrations();

  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.vivo_validate_story_ready_to_publish/i);
  assert.match(sql, /if\s+new\.status\s*=\s*'ready_to_publish'/i);
  assert.match(sql, /asset_type\s+in\s+\('image',\s*'video'\)/i);
  assert.match(sql, /is_required\s*=\s*true/i);
  assert.match(sql, /status\s*<>\s*'ready'/i);
  assert.match(sql, /create\s+trigger\s+vivo_stories_validate_ready_to_publish/i);
});

test("supabase migration configures indexes, foreign keys, and storage bucket", () => {
  const sql = readMigrations();

  assert.match(sql, /latest_classification_id uuid/i);
  assert.match(sql, /constraint vivo_stories_latest_classification_fk/i);
  assert.match(sql, /on delete cascade/i);
  assert.match(sql, /create index if not exists vivo_stories_status_created_at_idx/i);
  assert.match(sql, /create index if not exists vivo_pipeline_jobs_status_queued_at_idx/i);
  assert.match(sql, /create index if not exists vivo_story_reel_generation_runs_story_created_at_idx/i);
  assert.match(sql, /create index if not exists vivo_story_reel_candidates_run_selected_rank_idx/i);
  assert.match(sql, /operator_review_status/i);
  assert.match(sql, /is_selected boolean not null default false/i);
  assert.match(sql, /create unique index if not exists vivo_story_assets_story_selected_uidx/i);
  assert.match(sql, /insert into storage\.buckets/i);
  assert.match(sql, /'vivo-content'/i);
});
