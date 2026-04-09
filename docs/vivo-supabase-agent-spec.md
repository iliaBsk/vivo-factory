# Vivo Supabase Agent Specification

## Purpose

This specification defines how the coding agent must read and write the `vivo_*` Supabase tables for the story personalization pipeline.

The schema uses two patterns:

- Current-state tables: store the latest operational state and are updated over time.
- History tables: append-only records of classifier runs, media decisions, jobs, publication attempts, feedback snapshots, and audit events.

The agent must preserve both patterns. Do not collapse history into current-state rows.

## Table Ownership

### Current-state tables the agent may update

- `vivo_stories`
- `vivo_story_assets`
- `vivo_pipeline_jobs`
- `vivo_story_publications`
- `vivo_storage_objects`

### Tables that are insert-only

- `vivo_story_sources`
- `vivo_story_classifications`
- `vivo_story_asset_decisions`
- `vivo_story_reel_generation_runs`
- `vivo_story_reel_candidates`
- `vivo_feedback_events`
- `vivo_audit_events`

### Reference tables the agent should usually read, not mutate

- `vivo_factories`
- `vivo_audiences`
- `vivo_instances`

`vivo_factories`, `vivo_audiences`, and `vivo_instances` are provisioning data. The content pipeline should treat them as pre-existing unless the task is explicitly about bootstrap or provisioning.

## Statuses

### Story status: `vivo_stories.status`

- `new`: story was created and has not started processing.
- `classifying`: classifier work has started.
- `classified`: latest classification was saved to the story.
- `media_decided`: asset decisions were created.
- `asset_generating`: one or more required assets are being fetched, edited, or generated.
- `ready_to_publish`: all required assets are `ready` and at least one image or video exists.
- `published`: at least one publication succeeded.
- `failed`: the current processing attempt failed.
- `archived`: terminal inactive state. No new work should be scheduled.

### Asset decision: `vivo_story_assets.decision`

- `take_existing`: use an existing source asset.
- `generate`: create a new asset.
- `edit_image`: transform an existing image.

### Asset status: `vivo_story_assets.status`

- `pending`: asset row exists but work has not started.
- `queued`: work is scheduled.
- `processing`: generation, editing, upload, or ingestion is in progress.
- `ready`: asset is stored and usable.
- `failed`: asset work failed.
- `skipped`: asset is no longer needed.

### Job status: `vivo_pipeline_jobs.status`

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

### Publication status: `vivo_story_publications.status`

- `queued`
- `published`
- `failed`
- `deleted`

## Required Write Rules

### 1. Story creation

When a new personalized story is created:

1. Read `vivo_audiences` and `vivo_instances` to resolve the target `audience_id`, `factory_id`, and `instance_id`.
2. Insert one row into `vivo_stories` with:
   - `story_key`
   - `factory_id`
   - `audience_id`
   - `instance_id`
   - `title`
   - `story_text`
   - `summary` if available
   - `source_kind`
   - `primary_source_url` if available
   - `status = 'new'`
   - `metadata` for any extra source payload
3. Insert one or more rows into `vivo_story_sources`.
4. Insert one `vivo_audit_events` row with `event_type = 'story_created'`.
5. Optionally insert one `vivo_pipeline_jobs` row for `classify_story` with `status = 'queued'`.

Do not create duplicate audiences or instances during story creation.

### 2. Story classification

When classification begins:

1. Update `vivo_stories.status = 'classifying'`.
2. Update or insert the related `vivo_pipeline_jobs` row:
   - `job_type = 'classify_story'`
   - `status = 'running'`
   - set `started_at`
3. Insert one row into `vivo_story_classifications` for the classifier output.
4. Update `vivo_stories` with:
   - `latest_classification_id`
   - `current_category`
   - `current_subcategory`
   - `current_sentiment`
   - `is_local`
   - `is_event`
   - `is_deal`
   - `is_time_sensitive`
   - `one_liner`
   - `status = 'classified'`
5. Mark the classification job `succeeded` with `finished_at`.
6. Insert one `vivo_audit_events` row with `event_type = 'story_classified'`.

If classification fails:

- set the job to `failed`
- set `vivo_stories.status = 'failed'`
- store the error in `vivo_pipeline_jobs.error_message`
- insert `vivo_audit_events` with `event_type = 'story_classification_failed'`

Never overwrite old rows in `vivo_story_classifications`. Each run inserts a new row.

### 3. Media decision step

When deciding how to create content:

1. Insert one or more rows into `vivo_story_assets`.
2. For each asset set:
   - `asset_slot`
   - `asset_type`
   - `decision`
   - `status = 'pending'`
   - `is_required`
   - `personalization_angle`
   - `scene_description`
   - `source_asset_url` if an original asset exists
3. Insert one row per asset into `vivo_story_asset_decisions`.
4. Update `vivo_stories.status = 'media_decided'`.
5. Insert one `vivo_audit_events` row with `event_type = 'media_decided'`.

If the story requires generated or edited assets, move it to `asset_generating` when actual asset work starts.

Never update `vivo_story_assets.decision` silently. If the decision changes, append a new `vivo_story_asset_decisions` row and then update the current asset row.

### 4. Reel generation history for `content_strategy = 'generate'`

When generated video concepts or reel candidates are produced for a story:

1. Insert one row into `vivo_story_reel_generation_runs` with:
   - `story_id`
   - `pipeline_job_id` if the generation work is tied to a pipeline job
   - `content_strategy = 'generate'`
   - `generator_name` and `generator_version` if known
   - `selector_name` and `selector_version` if known
   - `request_payload` for the reel-generation prompt/input envelope
   - `response_payload` for the full raw model response
   - `run_metadata` for extra execution context
2. Insert one row per generated reel payload into `vivo_story_reel_candidates`.
3. Set for each candidate row:
   - `run_id`
   - `candidate_key` such as `creative_reel`, `action_reel`, `blockbuster_reel`, or `main_agent`
   - `candidate_kind = 'reel'` for generated reel variants and `candidate_kind = 'selection'` for selector output
   - `candidate_rank` if the generator returned an ordered list
   - `creative_mode` if present
   - `is_selected = true` only for the final selector output or chosen reel
   - `payload` as the full raw JSON for that candidate

Do not overwrite old reel rows. Each generation attempt must insert a new run row and new candidate rows so later evaluation and fine-tuning can reconstruct the full option set.

### 5. Asset generation, editing, or ingestion

For each asset:

1. Update `vivo_story_assets.status = 'queued'` when work is scheduled.
2. Insert or update a `vivo_pipeline_jobs` row for the asset job.
3. Update `vivo_story_assets.status = 'processing'` when execution begins.
4. Upload the output file to Supabase Storage bucket `vivo-content`.
5. Insert one row into `vivo_storage_objects` with:
   - `bucket_name = 'vivo-content'`
   - `object_path`
   - `file_name`
   - `mime_type`
   - `size_bytes` if known
   - `width`, `height`, `duration_seconds` if known
   - `checksum` if known
6. Update `vivo_story_assets` with:
   - `storage_object_id`
   - `mime_type`
   - `width`
   - `height`
   - `duration_seconds`
   - `checksum`
   - `status = 'ready'`
   - `ready_at`
7. Mark the asset job `succeeded`.

When the first asset job starts, set `vivo_stories.status = 'asset_generating'`.

If an asset job fails:

- set `vivo_story_assets.status = 'failed'`
- set `vivo_story_assets.error_message`
- set the asset job `failed`
- set `vivo_stories.status = 'failed'` if the failed asset is required
- insert `vivo_audit_events` with `event_type = 'asset_failed'`

### 6. Ready-to-publish transition

The agent may set `vivo_stories.status = 'ready_to_publish'` only when:

- at least one related `vivo_story_assets` row exists with `asset_type in ('image', 'video')`
- every `is_required = true` asset has `status = 'ready'`

The database trigger enforces this. The agent should still check before updating to avoid unnecessary failures.

When all required assets are ready:

1. Update `vivo_stories.status = 'ready_to_publish'`.
2. Insert one `vivo_audit_events` row with `event_type = 'story_ready_to_publish'`.

### 7. Publication

When content is sent to a channel:

1. Insert one row into `vivo_story_publications` with:
   - `story_id`
   - `asset_id` if a specific asset was published
   - `channel`
   - `target_identifier`
   - `status = 'queued'`
   - `publish_payload`
2. When publish begins, update the publication row as needed.
3. On success update:
   - `external_message_id`
   - `publish_response`
   - `published_at`
   - `status = 'published'`
4. Update `vivo_stories.status = 'published'` after the first successful publication.
5. Insert one `vivo_audit_events` row with `event_type = 'story_published'`.

On publish failure:

- set `vivo_story_publications.status = 'failed'`
- store `publish_response`
- optionally keep the story as `ready_to_publish` for retry
- insert `vivo_audit_events` with `event_type = 'story_publish_failed'`

## Feedback Sync

Feedback sync is append-only.

For each feedback pull or webhook:

1. Read the matching row in `vivo_story_publications` by channel and external identifier.
2. Insert a new row into `vivo_feedback_events`.
3. Do not overwrite previous feedback rows.
4. Insert one `vivo_audit_events` row with `event_type = 'feedback_synced'` if an audit trail is needed.

Feedback rows are snapshots over time, not mutable counters.

## Retries

Retries must preserve history:

- create new `vivo_pipeline_jobs` rows or update the existing queued/running job for the new attempt
- insert new `vivo_story_classifications` rows for reclassification
- insert new `vivo_story_asset_decisions` rows if media strategy changes
- insert new `vivo_story_reel_generation_runs` and `vivo_story_reel_candidates` rows if reel generation is retried
- update the current `vivo_stories.status` and `vivo_story_assets.status` to reflect the active retry

Recommended retry transitions:

- `failed -> classifying`
- `failed -> media_decided`
- `failed -> asset_generating`
- asset `failed -> queued`

## What The Agent Must Not Do

- Do not delete history rows.
- Do not overwrite old classification rows.
- Do not overwrite old asset decision rows.
- Do not overwrite old reel generation rows.
- Do not overwrite old feedback rows.
- Do not set `ready_to_publish` before required assets are ready.
- Do not create duplicate instance rows for the same audience.
- Do not mutate `vivo_factories`, `vivo_audiences`, or `vivo_instances` during normal content processing.

## Minimal Happy Path

1. Insert `vivo_stories` with `status = 'new'`.
2. Insert `vivo_story_sources`.
3. Update story to `classifying`.
4. Insert `vivo_story_classifications`.
5. Update story to `classified` and set latest classification fields.
6. Insert `vivo_story_assets`.
7. Insert `vivo_story_asset_decisions`.
8. Update story to `media_decided`.
9. Insert `vivo_story_reel_generation_runs` and `vivo_story_reel_candidates` when generated reels are part of the flow.
10. Update asset rows through `queued -> processing -> ready`.
11. Insert `vivo_storage_objects`.
12. Update story to `asset_generating`.
13. Update story to `ready_to_publish`.
14. Insert `vivo_story_publications`.
15. Update publication to `published`.
16. Update story to `published`.
17. Insert `vivo_feedback_events` over time.
