# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vivo Factory is a control plane for Telegram micro-channels. It manages audience segmentation, story personalization, asset review, and publication workflows. Audiences are defined in `audience_group.md`, provisioned into Supabase, and each audience gets an isolated OpenClaw (Telegram bot) container.

## Commands

```bash
npm test                  # Run all tests (Node.js built-in runner, TAP format)
node --test tests/<file>  # Run a single test file
npm start                 # Start dashboard HTTP server (port 4310)
npm run bootstrap         # Parse audience_group.md → normalize → provision Supabase + profile graphs
npm run generate:stacks   # Generate per-audience docker-compose manifests into generated/
npm run deploy:stacks     # Deploy the generated Docker Compose stack
```

Full deployment sequence: `npm test → npm run bootstrap → npm run generate:stacks → docker compose -f generated/docker-compose.yml up -d --build`

No linter is configured.

## Architecture

### Entry Points

- `src/server.js` — wires all dependencies (repository, services, clients) via constructor injection and starts the HTTP server
- `src/app.js` — request router with 19+ REST endpoints; receives all dependencies as constructor arguments
- `src/bootstrap.js` — CLI entry point for the provisioning pipeline

### Key Patterns

**Dual-backend repository** (`src/repository.js`): All state (stories, audiences, instances, reviews, audit log) goes through a common interface. `createFileRepository()` persists to `data/dashboard-state.json` (dev); `createSupabaseRepository()` persists to Supabase (production). Selected at startup in `server.js` based on env vars.

**Factory / dependency injection**: Every major service is a `create*()` function that receives its dependencies (fetch, exec, repository, config) as arguments. This is what makes the test suite work without mocking modules — tests pass fake implementations directly.

**Per-audience Docker isolation**: Each audience gets its own OpenClaw container, profile-plugin volume, and port range (Telegram: 7100+index, profiles: 5400+offset). `src/instance-manager.js` shells out to `docker compose` to start/stop/restart individual audience stacks. `src/stacks.js` generates the manifests.

**Audit log**: Every mutation appends an event to the repository audit log (e.g. `story_updated`, `audience_updated`). History tables in Supabase are insert-only.

### Story Status Lifecycle

```
new → classifying → classified → media_decided → asset_generating → ready_to_publish → published
                                                                                      ↘ failed / archived
```

### Service Map

| File | Role |
|------|------|
| `src/audience.js` | Parses `audience_group.md` XML blocks; normalizes demographics |
| `src/audience-import.js` | Markdown→audience import with OpenAI enrichment |
| `src/audience-manager-launcher.js` | Starts/stops per-audience manager services |
| `src/bootstrap-lib.js` | Orchestrates the full bootstrap sequence |
| `src/bootstrap-provisioning.js` | Supabase-side provisioning (creates vivo_factories, vivo_audiences, vivo_instances rows) |
| `src/catalog.js` | Merchant registry + affiliate product ranking for content briefs |
| `src/content-pipeline.js` | Generates content candidates using audience facts + catalog |
| `src/instance-manager.js` | Docker Compose wrapper per audience |
| `src/openai-audience-client.js` | OpenAI calls for audience enrichment (gpt-5.1) |
| `src/profile-client.js` | HTTP client for the user-profile-plugin graph engine |
| `src/runtime-config.js` | Reads/writes `config/runtime.json` |
| `src/setup-service.js` | Validates LLM configuration on startup |
| `src/stacks.js` | Generates per-audience docker-compose YAML manifests |

### Configuration Files

- `.env` — Supabase URL/key, OpenAI API key, factory identity (loaded at runtime)
- `config/runtime.json` — Per-audience Telegram bot tokens, OpenClaw URLs, profile-plugin base URLs, posting schedules
- `config/merchant-registry.json` — Curated merchant allowlist with affiliate link templates
- `audience_group.md` — Source of truth for audience definitions (5 `<audience>` XML blocks); re-parse with `npm run bootstrap`

### Generated Outputs (not committed)

- `generated/docker-compose.yml` — Orchestration manifest for all audiences
- `generated/stacks.json` — Per-audience stack manifests
- `generated/bootstrap-summary.json` — Result of last bootstrap run
- `data/dashboard-state.json` — File-backend state (dev only)

### Database

Three Supabase migrations in `supabase/migrations/`:
1. `20260330140000` — Core `vivo_*` tables (factories, audiences, instances, stories, assets, pipelines)
2. `20260402110000` — Append-only reel generation history
3. `20260408120000` — Operator review workflows

Schema and table ownership rules are documented in `docs/vivo-supabase-agent-spec.md`.

### Testing Approach

Tests use only Node.js built-ins (`node:test`, `node:assert/strict`). All external I/O (HTTP fetch, shell exec, Supabase client) is injected, so tests pass fake implementations — no network calls, no disk I/O. When adding a new service, follow the same constructor-injection pattern so it remains testable without module mocking.
