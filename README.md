# Vivo Factory

Greenfield control plane for Telegram micro-channels backed by OpenClaw, `user-profile-plugin`, curated affiliate products, and an operator dashboard.

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
- one OpenClaw container per audience
- one profile-engine sidecar per audience

Remote host flow:

```bash
npm test
npm run bootstrap
npm run generate:stacks
docker compose -f generated/docker-compose.yml up -d --build
```

Set real Supabase credentials in `.env` and real audience runtime values in `config/runtime.json` before bringing the stack up.

## Files

- `audience_group.md`: bootstrap audience definitions, one `<audience>` block per group
- `config/runtime.json`: dashboard/runtime settings and plugin base URLs
- `config/runtime.json`: dashboard/runtime settings, OpenClaw admin URLs, Telegram bot tokens, and Telegram chat/report IDs
- `config/merchant-registry.json`: curated merchant allowlist and affiliate templates
- `supabase/migrations/20260330140000_vivo_story_pipeline.sql`: Supabase schema for `vivo_*` pipeline tables, triggers, and storage bucket setup
- `supabase/migrations/20260402110000_vivo_story_reel_history.sql`: append-only reel-generation history tables for storing all generated reel candidates per story
- `docs/vivo-supabase-agent-spec.md`: operational spec for coding agents using the `vivo_*` pipeline tables
- `generated/bootstrap-summary.json`: output from bootstrap, including factory, audience, and instance provisioning IDs
- `generated/stacks.json`: per-audience runtime manifests
- `generated/docker-compose.yml`: generated compose template for five isolated audience stacks
- `data/dashboard-state.json`: persisted approval, audit, feedback, and profile update state

## Notes

- `npm run bootstrap` now seeds both the per-audience profile graph and the Supabase provisioning tables for `vivo_factories`, `vivo_audiences`, and `vivo_instances` when real Supabase credentials are configured.
- The dashboard runs on loopback by default, but the containerized deployment binds it to `0.0.0.0` inside the dashboard container.
- The generated compose file models the profile engine in the same network namespace as the OpenClaw runtime to stay compatible with the plugin’s loopback-only engine access.
- The dashboard exposes live instance controls for deploy, health, report fetch, log fetch, operator chat, and canonical `docker compose exec` command launchers when `config/runtime.json` contains per-audience instance config.

## Deployment

For staging deployment instructions, see:

- `docs/staging-runbook.md`
