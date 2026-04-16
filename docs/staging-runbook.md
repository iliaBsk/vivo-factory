# Vivo Factory Staging Runbook

## 1. What This Repo Currently Runs

This repository currently provides:

- audience bootstrap from `audience_group.md`
- Supabase provisioning for `vivo_factories`, `vivo_audiences`, and `vivo_instances` during bootstrap
- stack manifest generation for 5 isolated audience runtimes
- a generated full-stack Docker Compose deployment with:
  - one `vivo-factory-dashboard` container
  - one OpenClaw container per audience
  - one profile sidecar per audience
- operator dashboard for:
  - approval queue
  - story editor
  - asset review and replacement
  - audience drawer editing
  - queued Telegram publications
  - channel target visibility in the story workspace
  - analytics snapshot
  - audit log
  - live instance deploy controls
  - live instance health checks
  - live instance report fetch
  - live instance log fetch
  - operator chat console per instance
  - exact `docker compose exec` launcher commands for each audience container

This repository does **not** yet run a full production OpenClaw posting pipeline by itself. It is the control-plane scaffold and operator surface around that future runtime.

## 2. Staging Prerequisites

Install on the staging host:

- Node.js 22+
- npm 10+
- Docker and Docker Compose

The generated deployment already places one profile sidecar next to each OpenClaw audience container. The operator dashboard is built from this repo and joins the same compose deployment.

## 3. Copy The Repo

Deploy the repo to the staging host, then enter the project directory:

```bash
cd /path/to/vivo-factory
```

## 4. Configure Audiences

Edit:

- `audience_group.md`

Rules:

- keep one `<audience></audience>` block per audience
- v1 expects 5 audience blocks
- use clear demographic, lifestyle, and shopping traits

Example:

```md
<audience>
Bald high man in early 40s living in Barcelona, married with 8-10 year old boy. Loves beachwear, sportswear, football, and practical family weekend plans.
</audience>
```

## 5. Configure Runtime

Edit:

- `config/runtime.json`

Minimum required fields:

```json
{
  "server_port": 4310,
  "server_host": "0.0.0.0",
  "compose_file": "generated/docker-compose.yml",
  "plugin_base_url_default": "http://127.0.0.1:5400",
  "openclaw_image": "ghcr.io/openclaw/openclaw:latest",
  "profile_engine_image": "ghcr.io/openclaw/marble-profile-service:latest",
  "profile_engine_command": "node api/profile-server.js",
  "profile_engine_health_path": "/healthz",
  "profile_storage_path": "/data/user-profile",
  "profile_plugin_path": "/plugins/user-profile",
  "audiences": {
    "bald-high-man-early-40s-barcelona": {
      "plugin_base_url": "http://127.0.0.1:5401",
      "openclaw_admin_url": "http://127.0.0.1:7601",
      "openclaw_chat_path": "/operator/chat",
      "openclaw_report_path": "/operator/report",
      "openclaw_health_path": "/healthz",
      "telegram_bot_token": "replace-me",
      "telegram_chat_id": "-1001234567890",
      "telegram_report_chat_id": "-1001234567891"
    }
  }
}
```

Required per audience:

- `plugin_base_url`
- `openclaw_admin_url`
- `telegram_bot_token`
- `telegram_chat_id`

Recommended per audience:

- `telegram_report_chat_id`
- `openclaw_chat_path`
- `openclaw_report_path`
- `openclaw_health_path`

Recommended global profile sidecar fields:

- `profile_engine_image`
- `profile_engine_command`
- `profile_engine_health_path`
- `profile_storage_path`

If these fields are missing, stack generation and live instance management will fail.

## 6. Configure Merchant Registry

Edit:

- `config/merchant-registry.json`

Use only curated merchants. Each merchant must include:

- `merchant_id`
- `domain`
- `affiliate_url_template`
- `disclosure_template`
- extraction metadata

The affiliate URL template must contain `{{url}}`.

## 7. Verify The Repo

Run:

```bash
npm test
```

Expected result:

- all tests pass

## 8. Bootstrap Audience Profiles Into The Knowledge Graph

Before bringing the stack up, make sure `.env` contains real Supabase credentials:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=vivo-content
```

Then bootstrap audience profiles into the per-audience profile sidecars and provision the Supabase control-plane rows used by the story pipeline.

Then run:

```bash
npm run bootstrap
```

Expected result:

- `generated/bootstrap-summary.json` is created
- audience facts are written through the configured profile sidecar
- audience bootstrap decisions are recorded
- factory, audience, and instance rows are upserted in Supabase when credentials are configured

If this fails:

- verify `config/runtime.json`
- verify the target profile engine or plugin path is reachable from the generated deployment

## 9. Generate Staging Runtime Manifests

Run:

```bash
npm run generate:stacks
```

Expected files:

- `generated/stacks.json`
- `generated/docker-compose.yml`

The generated compose file now models:

- one `vivo-factory-dashboard` service built from this repo
- one OpenClaw container per audience
- one profile sidecar container per audience, sharing the OpenClaw network namespace

The generated OpenClaw service environment now includes:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_REPORT_CHAT_ID`
- `OPENCLAW_ADMIN_URL`
- `USER_PROFILE_PLUGIN_PATH`

The generated dashboard service includes:

- `env_file: .env`
- mounted `config/`, `generated/`, and `data/`
- mounted Docker socket for runtime deploy/log controls
- published dashboard port from `config/runtime.json`

## 10. Deploy The Stacks

After generating the compose file:

```bash
docker compose -f generated/docker-compose.yml up -d --build
```

Equivalent wrapper:

```bash
npm run deploy:stacks
```

This runs the same `docker compose -f generated/docker-compose.yml up -d --build` command.

## 11. Start The Dashboard

Expected result:

- dashboard container listens on `http://<host>:4310` unless changed in `config/runtime.json`

Dashboard capabilities:

- review story queues
- edit story content
- select and replace assets
- edit audiences in the drawer
- queue Telegram publications
- inspect audit log
- inspect analytics snapshot
- deploy all instances or a single instance
- fetch per-instance health
- fetch per-instance report
- fetch per-instance logs
- send operator chat messages to a specific OpenClaw instance

## 12. Smoke Test The Dashboard

Open:

```text
http://<host>:4310
```

Verify:

- page renders
- story queue section renders
- story editor section renders
- asset panel renders
- audience drawer toggle renders
- publication queue section renders
- live instances section renders
- operator console section renders

API smoke checks:

```bash
curl http://<host>:4310/api/stories
curl http://<host>:4310/api/audiences
curl http://127.0.0.1:4310/api/instances
curl http://<host>:4310/api/audit
curl http://<host>:4310/api/analytics
curl http://<host>:4310/api/instances/<audience-id>/health
curl http://<host>:4310/api/instances/<audience-id>/report
curl "http://<host>:4310/api/instances/<audience-id>/logs?tail=100"
```

Operator chat smoke check:

```bash
curl -X POST http://<host>:4310/api/instances/<audience-id>/chat \
  -H 'content-type: application/json' \
  -d '{"operator":"operator@example.com","message":"status report"}'
```

## 13. Data Locations

Runtime files produced by this repo:

- `generated/bootstrap-summary.json`
- `generated/stacks.json`
- `generated/docker-compose.yml`
- `data/dashboard-state.json`

The dashboard state file stores:

- post review state
- audit entries
- feedback events
- profile update records
- instance reports
- operator chat transcripts
- deployment history

Audience/profile memory itself is intended to live in the profile sidecar storage volume, not in this repo.

## 14. Suggested Staging Order

Run in this order:

```bash
npm test
npm run bootstrap
npm run generate:stacks
docker compose -f generated/docker-compose.yml up -d --build
```

## 15. Known Staging Limits

Current implementation limits:

- no live merchant scraping jobs yet
- no real image/video generation orchestration yet
- OpenClaw admin/report/chat endpoints must already exist on each configured `openclaw_admin_url`
- generated Docker Compose is still a staging scaffold, not a full production deployment system

This means staging can validate:

- audience parsing
- graph bootstrap flow
- dashboard operation
- profile editing
- stack manifest generation
- Docker compose deployment dispatch
- per-instance health/report/log polling
- operator-to-instance chat routing

It does not yet validate:

- end-to-end autonomous posting
- Telegram engagement collection
- external affiliate ingestion jobs
- correctness of the downstream OpenClaw admin APIs beyond request routing
