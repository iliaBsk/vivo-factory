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

## Files

- `audience_group.md`: bootstrap audience definitions, one `<audience>` block per group
- `config/runtime.json`: dashboard/runtime settings and plugin base URLs
- `config/runtime.json`: dashboard/runtime settings, OpenClaw admin URLs, Telegram bot tokens, and Telegram chat/report IDs
- `config/merchant-registry.json`: curated merchant allowlist and affiliate templates
- `supabase/migrations/20260330140000_vivo_story_pipeline.sql`: Supabase schema for `vivo_*` pipeline tables, triggers, and storage bucket setup
- `supabase/migrations/20260402110000_vivo_story_reel_history.sql`: append-only reel-generation history tables for storing all generated reel candidates per story
- `docs/vivo-supabase-agent-spec.md`: operational spec for coding agents using the `vivo_*` pipeline tables
- `generated/bootstrap-summary.json`: output from graph bootstrap
- `generated/stacks.json`: per-audience runtime manifests
- `generated/docker-compose.yml`: generated compose template for five isolated audience stacks
- `data/dashboard-state.json`: persisted approval, audit, feedback, and profile update state

## Notes

- Audience/profile data is written through `user-profile-plugin` routes and intended to land in its knowledge graph.
- The dashboard runs on loopback and assumes loopback plugin endpoints by default, matching the current `user-profile-plugin` restrictions.
- The generated compose file models the profile engine in the same network namespace as the OpenClaw runtime to stay compatible with the plugin’s loopback-only engine access.
- The dashboard exposes live instance controls for deploy, health, report fetch, log fetch, and operator chat when `config/runtime.json` contains per-audience instance config.

## Deployment

For staging deployment instructions, see:

- `docs/staging-runbook.md`
