# Vivo Factory

Greenfield control plane for Telegram micro-channels backed by OpenClaw, a per-audience profile sidecar, curated affiliate products, and an operator dashboard.

## Commands

```bash
npm test
npm run bootstrap
npm run generate:stacks
npm run deploy:stacks
npm start
```

## Dockerized Deployment

The generated deployment now includes:

- one `vivo-factory-dashboard` container built from this repo
- no audience OpenClaw containers until an approved audience is launched from the dashboard
- one generated env and compose file per launched audience under `generated/audience-managers/`

Remote host flow:

```bash
npm test
npm run generate:stacks
docker compose -f generated/docker-compose.yml up -d --build
```

Set real Supabase and global LLM credentials in `.env`. Add Telegram channel IDs, Telegram bot token, OpenClaw admin URL, and optional per-audience LLM values in the Audiences screen when launching a deployment.

Profile sidecars can now be configured independently from the OpenClaw image with:

- `profile_engine_image`
- `profile_engine_command`
- `profile_engine_health_path`
- `profile_storage_path`

## Files

- `audience_group.md`: bootstrap audience definitions, one `<audience>` block per group
- `config/runtime.json`: dashboard/runtime settings and plugin base URLs
- `config/merchant-registry.json`: curated merchant allowlist and affiliate templates
- `supabase/migrations/20260330140000_vivo_story_pipeline.sql`: Supabase schema for `vivo_*` pipeline tables, triggers, and storage bucket setup
- `supabase/migrations/20260402110000_vivo_story_reel_history.sql`: append-only reel-generation history tables for storing all generated reel candidates per story
- `docs/vivo-supabase-agent-spec.md`: operational spec for coding agents using the `vivo_*` pipeline tables
- `docs/ui-framework.md`: Tremor Raw-compatible dashboard rendering boundary
- `generated/bootstrap-summary.json`: output from bootstrap, including factory, audience, and instance provisioning IDs
- `generated/stacks.json`: dashboard deployment manifest list; empty until static runtime audiences are explicitly configured
- `generated/docker-compose.yml`: generated compose template for the factory dashboard
- `generated/audience-managers/*.env`: launch-time OpenClaw runtime config for approved audiences
- `data/dashboard-state.json`: persisted approval, audit, feedback, and profile update state

## Notes

- `npm run bootstrap` now seeds both the per-audience profile graph and the Supabase provisioning tables for `vivo_factories`, `vivo_audiences`, and `vivo_instances` when real Supabase credentials are configured.
- The dashboard runs on loopback by default, but the containerized deployment binds it to `0.0.0.0` inside the dashboard container.
- Audience deployments are created only after the audience exists in Supabase and an operator launches it with Telegram and LLM runtime config.
- The dashboard exposes generated env paths and canonical `docker compose exec` command launchers for launched audiences.

## Deployment

For staging deployment instructions, see:

- `docs/staging-runbook.md`
