# Vivo Factory Staging Runbook

## 1. What This Repo Currently Runs

This repository currently provides:

- audience bootstrap from `audience_group.md`
- stack manifest generation for 5 isolated audience runtimes
- Docker deployment CLI for generated audience stacks
- operator dashboard server for:
  - approval queue
  - published post history
  - analytics snapshot
  - audit log
  - audience profile editing through `user-profile-plugin`
  - live instance deploy controls
  - live instance health checks
  - live instance report fetch
  - live instance log fetch
  - operator chat console per instance

This repository does **not** yet run a full production OpenClaw posting pipeline by itself. It is the control-plane scaffold and operator surface around that future runtime.

## 2. Staging Prerequisites

Install on the staging host:

- Node.js 22+
- npm 10+
- Docker and Docker Compose
- one reachable `user-profile-plugin` endpoint per audience, or one shared loopback endpoint for local testing

Current `user-profile-plugin` integration is loopback-only by design. The factory client enforces `127.0.0.1` or `localhost` plugin URLs. For staging, run the plugin endpoint on the same host/network namespace as the factory process, or front it locally on loopback.

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
  "compose_file": "generated/docker-compose.yml",
  "plugin_base_url_default": "http://127.0.0.1:5400",
  "openclaw_image": "ghcr.io/openclaw/openclaw:latest",
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

Before running the dashboard in staging, make sure the configured `user-profile-plugin` endpoint is already up and reachable on loopback.

Then run:

```bash
npm run bootstrap
```

Expected result:

- `generated/bootstrap-summary.json` is created
- audience facts are written through `user-profile-plugin`
- audience bootstrap decisions are recorded

If this fails:

- verify `config/runtime.json`
- verify the plugin endpoint is reachable on `127.0.0.1` or `localhost`
- verify the plugin exposes:
  - `/user-profile/profile/facts`
  - `/user-profile/profile/decisions`
  - `/user-profile/graph/summary`

## 9. Generate Staging Runtime Manifests

Run:

```bash
npm run generate:stacks
```

Expected files:

- `generated/stacks.json`
- `generated/docker-compose.yml`

The generated compose file models one OpenClaw container and one profile engine container per audience, with the profile engine sharing the OpenClaw network namespace. That matches the current loopback-only constraint in `user-profile-plugin`.

Treat this compose file as a staging template. Review it before using it directly in infrastructure automation.

The generated OpenClaw service environment now includes:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_REPORT_CHAT_ID`
- `OPENCLAW_ADMIN_URL`
- `USER_PROFILE_PLUGIN_PATH`

## 10. Deploy The Stacks

After generating the compose file:

```bash
npm run deploy:stacks
```

This runs:

- `docker compose -f generated/docker-compose.yml up -d ...`

This repository does not yet implement advanced rollout logic, health-gated deployment, or Docker cleanup. It performs direct compose deployment for the generated audience services.

## 11. Start The Dashboard

Run:

```bash
npm start
```

Expected result:

- dashboard listens on `http://127.0.0.1:4310` unless changed in `config/runtime.json`

Dashboard capabilities:

- review pending posts
- inspect published posts
- inspect audit log
- inspect analytics snapshot
- edit audience profile facts and persist them through `user-profile-plugin`
- deploy all instances or a single instance
- fetch per-instance health
- fetch per-instance report
- fetch per-instance logs
- send operator chat messages to a specific OpenClaw instance

## 12. Smoke Test The Dashboard

Open:

```text
http://127.0.0.1:4310
```

Verify:

- page renders
- approval queue section renders
- published posts section renders
- profile edit form renders
- live instances section renders
- operator console section renders

API smoke checks:

```bash
curl http://127.0.0.1:4310/api/queue
curl http://127.0.0.1:4310/api/instances
curl http://127.0.0.1:4310/api/published
curl http://127.0.0.1:4310/api/audit
curl http://127.0.0.1:4310/api/analytics
curl http://127.0.0.1:4310/api/instances/<audience-id>/health
curl http://127.0.0.1:4310/api/instances/<audience-id>/report
curl "http://127.0.0.1:4310/api/instances/<audience-id>/logs?tail=100"
```

Operator chat smoke check:

```bash
curl -X POST http://127.0.0.1:4310/api/instances/<audience-id>/chat \
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

Audience/profile memory itself is intended to live in `user-profile-plugin` storage, not in this repo.

## 14. Suggested Staging Order

Run in this order:

```bash
npm test
npm run bootstrap
npm run generate:stacks
npm run deploy:stacks
npm start
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
