# Personal Dashboard — Plan 3: vivo-factory Deployment + N8N Workflows

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the vault-engine container into every audience's Docker stack, add vivo-factory relay endpoints, and create the 3 N8N workflows (media enrichment, catalog deals, weekly gaps).

**Architecture:** `stacks.js` gains vault container generation. `app.js` gains 3 relay endpoints that proxy to the audience's vault-engine. `runtime.json` gains `vault_base_url` per audience. Three N8N workflows are created via the n8n MCP.

**Tech Stack:** Node.js, Docker Compose, N8N (SERP + OpenAI credentials already in N8N). All vivo-factory code lives in `/srv/projects/vivo-factory/`.

**Depends on:** Plan 1 (vault engine) and Plan 2 (Marble dashboard) must be deployed in their containers before this plan's Docker stacks are built.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/stacks.js` | Modify | Add vault-engine container to each audience manifest |
| `src/runtime-config.js` | Modify | Add `vault_base_url` + `vault_port` per audience |
| `src/app.js` | Modify | Add 3 relay endpoints for vault |
| `config/runtime.json` | Modify | Add vault ports for existing audiences |
| `tests/stacks.test.js` | Modify | Add vault container assertion |
| N8N: `vivo-media-enrich` | Create | SERP + OpenAI vision image enrichment |
| N8N: `vivo-deals-catalog` | Create | Daily catalog RSS deal extraction |
| N8N: `vivo-gaps-weekly` | Create | Weekly gap analysis trigger |

---

## Task 1: Add vault-engine to stacks.js

**Files:**
- Modify: `src/stacks.js`
- Modify: `tests/stacks.test.js`

- [ ] **Step 1: Read the existing stacks test to understand the pattern**

```bash
cat /srv/projects/vivo-factory/tests/stacks.test.js 2>/dev/null | head -60
```

- [ ] **Step 2: Add vault assertion to stacks test**

In `tests/stacks.test.js`, find the test that checks the rendered docker-compose YAML and add:

```javascript
assert.ok(yaml.includes('-vault:'), 'vault service should be present in compose');
assert.ok(yaml.includes('4876'), 'vault port should be present');
assert.ok(yaml.includes('vault-data'), 'vault data volume should be present');
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /srv/projects/vivo-factory
npm test -- --test-name-pattern="stacks" 2>&1 | tail -20
```

Expected: FAIL — vault assertions fail

- [ ] **Step 4: Update generateStackManifests in stacks.js**

In `src/stacks.js`, update the `return` block inside `audiences.map(...)` to add vault:

```javascript
    return {
      audience_id: audience.audience_id,
      runtime: {
        openclaw: {
          image: options.openClawImage,
          plugin_path: options.profilePluginPath,
          admin_url: runtimeConfig.openclaw_admin_url
        },
        telegram: {
          port: 7100 + index,
          bot_token: runtimeConfig.telegram_bot_token,
          chat_id: runtimeConfig.telegram_chat_id,
          report_chat_id: runtimeConfig.telegram_report_chat_id ?? runtimeConfig.telegram_chat_id
        },
        profile: {
          image: options.profileEngineImage ?? options.openClawImage,
          command: options.profileEngineCommand ?? "profile-engine",
          health_path: options.profileEngineHealthPath ?? "/healthz",
          storage_path: options.profileStoragePath ?? "/data/user-profile",
          port: 7200 + index,
          data_volume: `${audience.audience_id}-profile-data`,
          secret_name: `${audience.audience_id}-profile-secret`
        },
        vault: {
          image: options.vaultEngineImage ?? "ghcr.io/openclaw/vault-engine:latest",
          command: options.vaultEngineCommand ?? "python -m user_profile_engine.main",
          health_path: "/healthz",
          storage_path: "/data/vault",
          port: 4876 + index,
          data_volume: `${audience.audience_id}-vault-data`
        }
      }
    };
```

- [ ] **Step 5: Add vault service to renderDockerCompose in stacks.js**

In the `services` map inside `renderDockerCompose`, after the profile service string, append the vault service. Find the closing template literal of the per-audience services and add:

```javascript
      const vaultService = `${manifest.audience_id}-vault`;
      const vaultYaml = `  ${vaultService}:
    image: ${manifest.runtime.vault.image}
    command: ${manifest.runtime.vault.command}
    environment:
      OPENAI_API_KEY: \${OPENAI_API_KEY}
      OPENAI_MODEL: \${OPENAI_MODEL:-gpt-4o-mini}
      STORAGE_PATH: ${manifest.runtime.vault.storage_path}
      PORT: "${manifest.runtime.vault.port}"
    ports:
      - "${manifest.runtime.vault.port}:${manifest.runtime.vault.port}"
    volumes:
      - "${manifest.audience_id}-vault-data:${manifest.runtime.vault.storage_path}"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${manifest.runtime.vault.port}/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3`;
```

Append `vaultYaml` to the return value of the services map (alongside `openClawService` YAML and `profileService` YAML).

Also add vault volume to the volumes section:
```javascript
      `${manifest.audience_id}-vault-data: {}`,
```

- [ ] **Step 6: Run stacks tests**

```bash
cd /srv/projects/vivo-factory
npm test -- --test-name-pattern="stacks" 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/stacks.js tests/stacks.test.js
git commit -m "feat: add vault-engine container to per-audience Docker stacks"
```

---

## Task 2: Add vault_base_url to runtime config

**Files:**
- Modify: `src/runtime-config.js`
- Modify: `config/runtime.json`

- [ ] **Step 1: Read runtime-config.js**

```bash
cat /srv/projects/vivo-factory/src/runtime-config.js
```

- [ ] **Step 2: Add vault_base_url and vault_port to the per-audience config schema**

In `src/runtime-config.js`, wherever the per-audience config is read or validated, add `vault_base_url` and `vault_port` as optional fields (they default based on the index if not set).

If `runtime-config.js` simply reads/writes JSON, just ensure the new fields pass through without being stripped. If there is validation, add:

```javascript
vault_base_url: runtimeConfig.vault_base_url ?? `http://127.0.0.1:${4876 + index}`,
vault_port: runtimeConfig.vault_port ?? (4876 + index),
```

- [ ] **Step 3: Add vault fields to existing audiences in config/runtime.json**

For each audience entry in `config/runtime.json`, add (adjust the host IP to match the existing `plugin_base_url` pattern):

For `bald-high-man-early-40s-barcelona` (index 0):
```json
"vault_base_url": "http://192.168.1.79:4876",
"vault_port": 4876
```

For `aleks-barcelona-tech-ai-30s` (index 1):
```json
"vault_base_url": "http://192.168.1.79:4877",
"vault_port": 4877
```

For `chontang` (index 2):
```json
"vault_base_url": "http://192.168.1.79:4878",
"vault_port": 4878
```

For `andrew-chen-unknown` (index 3):
```json
"vault_base_url": "http://192.168.1.79:4879",
"vault_port": 4879
```

- [ ] **Step 4: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/runtime-config.js config/runtime.json
git commit -m "feat: add vault_base_url and vault_port to runtime config per audience"
```

---

## Task 3: Add relay endpoints to app.js

**Files:**
- Modify: `src/app.js`
- Modify: `tests/repository-supabase.test.js` (if relay endpoints need tests; otherwise add to existing app test)

- [ ] **Step 1: Read existing relay pattern in app.js**

```bash
grep -n "relay\|proxy\|pipe\|fetch\|onboarding" /srv/projects/vivo-factory/src/app.js | head -20
```

- [ ] **Step 2: Add vault relay endpoints to app.js**

Find where other relay endpoints live (e.g., SSE relay for onboarding) and add the three vault relay routes alongside them:

```javascript
  // Vault relay — upload mbox
  app.post('/api/audiences/:id/upload-mbox', async (req, res) => {
    const audience = req.params.id;
    const runtimeCfg = runtimeConfig.getAudienceConfig(audience);
    if (!runtimeCfg?.vault_base_url) {
      return res.status(404).json({ ok: false, error: 'Vault not configured for this audience' });
    }
    try {
      // Stream the multipart upload directly to vault
      const vaultUrl = `${runtimeCfg.vault_base_url}/personal/upload-mbox`;
      const upstream = await fetch(vaultUrl, {
        method: 'POST',
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(([k]) =>
            ['content-type', 'content-length'].includes(k.toLowerCase())
          )
        ),
        body: req,
        duplex: 'half',
      });
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  // Vault relay — job SSE stream
  app.get('/api/audiences/:id/vault-status/:jobId', async (req, res) => {
    const audience = req.params.id;
    const { jobId } = req.params;
    const runtimeCfg = runtimeConfig.getAudienceConfig(audience);
    if (!runtimeCfg?.vault_base_url) {
      return res.status(404).json({ ok: false, error: 'Vault not configured' });
    }
    try {
      const upstream = await fetch(`${runtimeCfg.vault_base_url}/personal/job/${jobId}/stream`);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      upstream.body.pipeTo(
        new WritableStream({
          write(chunk) { res.write(chunk); },
          close() { res.end(); },
        })
      );
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  // Vault relay — register discovered sources
  app.post('/api/audiences/:id/vault-sources', async (req, res) => {
    const audience = req.params.id;
    const runtimeCfg = runtimeConfig.getAudienceConfig(audience);
    if (!runtimeCfg?.vault_base_url) {
      return res.status(404).json({ ok: false, error: 'Vault not configured' });
    }
    // Sources from vault are forwarded to the existing sources catalog
    const sources = req.body?.sources ?? [];
    try {
      await sourcesCatalog.addSources(audience, sources);
      res.json({ ok: true, data: { added: sources.length } });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });
```

- [ ] **Step 3: Smoke-test relay endpoints**

```bash
cd /srv/projects/vivo-factory
npm start &
sleep 2
curl -s http://localhost:4310/api/audiences/aleks-barcelona-tech-ai-30s/vault-status/nonexistent-job 2>&1 | head -5
kill %1
```

Expected: JSON response (404 or 502, not a crash)

- [ ] **Step 4: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/app.js
git commit -m "feat: vault relay endpoints — upload-mbox, vault-status SSE, vault-sources"
```

---

## Task 4: Regenerate stacks and verify compose

- [ ] **Step 1: Regenerate docker-compose**

```bash
cd /srv/projects/vivo-factory
npm run generate:stacks 2>&1 | tail -10
```

- [ ] **Step 2: Verify vault services in generated compose**

```bash
grep -A 10 "vault:" generated/docker-compose.yml | head -40
```

Expected: 4 vault service blocks (one per audience), each with correct port and volume.

- [ ] **Step 3: Verify volumes section**

```bash
grep "vault-data" generated/docker-compose.yml
```

Expected: 4 vault-data volume entries.

- [ ] **Step 4: Commit generated files if tracked**

```bash
cd /srv/projects/vivo-factory
git add generated/ 2>/dev/null; git diff --cached --stat
git commit -m "chore: regenerate stacks with vault-engine containers" 2>/dev/null || true
```

---

## Task 5: N8N — vivo-media-enrich workflow

This workflow is triggered by a webhook from the vault-engine. It receives a batch of items missing media, searches for images via SERP, validates with OpenAI vision, and POSTs results back to vault.

- [ ] **Step 1: Create the workflow via N8N MCP**

Use the `mcp__n8n__n8n_create_workflow` tool with this workflow definition:

```json
{
  "name": "vivo-media-enrich",
  "nodes": [
    {
      "id": "webhook-trigger",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "path": "vivo-media-enrich",
        "httpMethod": "POST",
        "responseMode": "responseNode"
      }
    },
    {
      "id": "split-items",
      "name": "Split Items",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [460, 300],
      "parameters": { "batchSize": 1, "options": {} }
    },
    {
      "id": "serp-search",
      "name": "SERP Image Search",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [680, 300],
      "parameters": {
        "method": "GET",
        "url": "https://serpapi.com/search",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpQueryAuth",
        "queryParameters": {
          "parameters": [
            { "name": "engine", "value": "google_images" },
            { "name": "q", "value": "={{ $json.merchant + ' ' + $json.item_name + ' product photo' }}" },
            { "name": "num", "value": "5" },
            { "name": "api_key", "value": "={{ $credentials.serpApiKey }}" }
          ]
        }
      }
    },
    {
      "id": "openai-pick",
      "name": "OpenAI Pick Best Image",
      "type": "@n8n/n8n-nodes-langchain.openAi",
      "typeVersion": 1,
      "position": [900, 300],
      "parameters": {
        "resource": "chat",
        "model": "gpt-4o-mini",
        "messages": {
          "values": [{
            "role": "user",
            "content": "=Pick the best product photo URL from this list. Return ONLY a JSON object {\"url\": \"chosen_url\"} or {\"url\": null} if none are suitable (logos/stock art rejected). URLs: {{ $json.images_results?.slice(0,5).map(r => r.original).join(', ') }}"
          }]
        }
      }
    },
    {
      "id": "post-result",
      "name": "Post to Vault",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [1120, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $('Webhook').item.json.vault_callback_url }}",
        "sendBody": true,
        "contentType": "json",
        "body": "={{ JSON.stringify({ item_id: $('Split Items').item.json.item_id, media_url: JSON.parse($json.message.content).url }) }}"
      }
    },
    {
      "id": "respond",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [1340, 300],
      "parameters": { "respondWith": "json", "responseBody": "{\"ok\": true}" }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Split Items", "type": "main", "index": 0 }]] },
    "Split Items": { "main": [[{ "node": "SERP Image Search", "type": "main", "index": 0 }]] },
    "SERP Image Search": { "main": [[{ "node": "OpenAI Pick Best Image", "type": "main", "index": 0 }]] },
    "OpenAI Pick Best Image": { "main": [[{ "node": "Post to Vault", "type": "main", "index": 0 }]] },
    "Post to Vault": { "main": [[{ "node": "Respond to Webhook", "type": "main", "index": 0 }]] }
  },
  "active": true
}
```

- [ ] **Step 2: Note the webhook URL from the created workflow**

The N8N response will include the webhook URL. Save it — it goes into vault-engine's environment as `MEDIA_ENRICH_WEBHOOK_URL`.

- [ ] **Step 3: Add `MEDIA_ENRICH_WEBHOOK_URL` to vault service in stacks.js**

In the vault service environment block in `src/stacks.js`, add:

```javascript
      MEDIA_ENRICH_WEBHOOK_URL: options.mediaEnrichWebhookUrl ?? '',
```

And update `config/runtime.json` to include:
```json
"media_enrich_webhook_url": "https://your-n8n-host/webhook/vivo-media-enrich"
```

- [ ] **Step 4: Add media enrichment trigger to ingestion_job.py**

In `engine/py/user_profile_engine/jobs/ingestion_job.py`, after the job completes, add:

```python
import os, httpx

async def _trigger_media_enrichment(items: list[dict], vault_base_url: str) -> None:
    webhook_url = os.environ.get("MEDIA_ENRICH_WEBHOOK_URL", "")
    if not webhook_url or not items:
        return
    payload = {
        "items": [{"item_id": i["item_id"], "merchant": i["merchant"],
                   "item_name": i["item_name"], "category": i["category"]} for i in items],
        "vault_callback_url": f"{vault_base_url}/personal/media/update",
    }
    try:
        async with httpx.AsyncClient() as client:
            await client.post(webhook_url, json=payload, timeout=10)
    except Exception:
        pass  # media enrichment is best-effort
```

Call it at the end of `run_ingestion_job`:

```python
        missing = store.items_missing_media(limit=200)
        if missing:
            vault_base_url = os.environ.get("VAULT_BASE_URL", "http://localhost:4876")
            await _trigger_media_enrichment(missing, vault_base_url)
```

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/vivo-factory
git add src/stacks.js config/runtime.json
git commit -m "feat: wire MEDIA_ENRICH_WEBHOOK_URL into vault container env"

cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/jobs/ingestion_job.py
git commit -m "feat: trigger N8N media enrichment after ingestion completes"
```

---

## Task 6: N8N — vivo-deals-catalog workflow (daily cron)

This workflow runs daily, fetches deal pages from the vivo sources catalog per audience, extracts deals via LLM, and POSTs them to vault.

- [ ] **Step 1: Create the workflow via N8N MCP**

Use `mcp__n8n__n8n_create_workflow` with:

```json
{
  "name": "vivo-deals-catalog",
  "nodes": [
    {
      "id": "cron",
      "name": "Daily Cron",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "rule": { "interval": [{ "field": "hours", "minutesInterval": 1440 }] }
      }
    },
    {
      "id": "fetch-audiences",
      "name": "Fetch Audiences",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [460, 300],
      "parameters": {
        "method": "GET",
        "url": "=http://{{ $env.VIVO_FACTORY_HOST ?? 'vivo-factory:4310' }}/api/audiences"
      }
    },
    {
      "id": "split-audiences",
      "name": "Split Audiences",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [680, 300],
      "parameters": { "batchSize": 1, "options": {} }
    },
    {
      "id": "fetch-sources",
      "name": "Fetch Sources",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [900, 300],
      "parameters": {
        "method": "GET",
        "url": "=http://{{ $env.VIVO_FACTORY_HOST ?? 'vivo-factory:4310' }}/api/audiences/{{ $json.audience_id }}/sources"
      }
    },
    {
      "id": "fetch-deals-page",
      "name": "Fetch Deal Page",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [1120, 300],
      "parameters": {
        "method": "GET",
        "url": "={{ $json.url }}",
        "options": { "response": { "response": { "responseFormat": "text" } } }
      }
    },
    {
      "id": "extract-deals",
      "name": "Extract Deals via LLM",
      "type": "@n8n/n8n-nodes-langchain.openAi",
      "typeVersion": 1,
      "position": [1340, 300],
      "parameters": {
        "resource": "chat",
        "model": "gpt-4o-mini",
        "messages": {
          "values": [{
            "role": "user",
            "content": "=Extract current deals from this page. Return JSON: {\"deals\": [{\"title\": \"...\", \"merchant\": \"...\", \"discount\": \"...\", \"promo_code\": \"...\", \"url\": \"...\", \"expires_at\": \"YYYY-MM-DD or null\"}]}. Page content (truncated):\n{{ $json.data?.slice(0, 3000) }}"
          }]
        }
      }
    },
    {
      "id": "post-to-vault",
      "name": "Post Deals to Vault",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [1560, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $('Split Audiences').item.json.vault_base_url }}/personal/deals/ingest",
        "sendBody": true,
        "contentType": "json",
        "body": "={{ JSON.stringify({ deals: JSON.parse($json.message.content).deals, source_type: 'catalog_rss' }) }}"
      }
    }
  ],
  "connections": {
    "Daily Cron": { "main": [[{ "node": "Fetch Audiences", "type": "main", "index": 0 }]] },
    "Fetch Audiences": { "main": [[{ "node": "Split Audiences", "type": "main", "index": 0 }]] },
    "Split Audiences": { "main": [[{ "node": "Fetch Sources", "type": "main", "index": 0 }]] },
    "Fetch Sources": { "main": [[{ "node": "Fetch Deal Page", "type": "main", "index": 0 }]] },
    "Fetch Deal Page": { "main": [[{ "node": "Extract Deals via LLM", "type": "main", "index": 0 }]] },
    "Extract Deals via LLM": { "main": [[{ "node": "Post Deals to Vault", "type": "main", "index": 0 }]] }
  },
  "active": true
}
```

- [ ] **Step 2: Add `/personal/deals/ingest` endpoint to vault server.py**

In `/srv/projects/vivo-user-profile-vault/engine/py/user_profile_engine/api/server.py`, add before `return app`:

```python
    @app.post("/personal/deals/ingest")
    def ingest_deals(payload: dict[str, object]) -> dict[str, object]:
        import hashlib, json as _json
        now = datetime.now(timezone.utc)
        deals = payload.get("deals", []) or []
        source_type = str(payload.get("source_type", "catalog_rss"))
        inserted = 0
        for deal in deals:
            if not deal.get("title"):
                continue
            deal_id = hashlib.sha1(
                f"{source_type}:{deal.get('url','')}:{deal.get('title','')}".encode()
            ).hexdigest()
            runtime.store.upsert_personal_deal({
                "deal_id": deal_id,
                "source_type": source_type,
                "category": deal.get("category", "shopping"),
                "merchant": deal.get("merchant", ""),
                "title": deal.get("title", "")[:200],
                "discount": deal.get("discount"),
                "promo_code": deal.get("promo_code"),
                "expires_at": None,
                "url": deal.get("url"),
                "media_url": None,
                "marble_score": 0.0,
                "raw_json": _json.dumps(deal),
                "ingested_at": now,
                "archived_at": None,
            })
            inserted += 1
        return runtime._ok({"inserted": inserted})
```

- [ ] **Step 3: Commit vault change**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/api/server.py
git commit -m "feat: add /personal/deals/ingest endpoint for N8N catalog workflow"
```

---

## Task 7: N8N — vivo-gaps-weekly workflow (weekly cron)

This workflow triggers weekly gap analysis for each active audience by calling vault's gaps refresh endpoint.

- [ ] **Step 1: Add `/personal/gaps/refresh` endpoint to vault server.py**

In `server.py`, add before `return app`:

```python
    @app.post("/personal/gaps/refresh")
    async def refresh_gaps(background_tasks: BackgroundTasks) -> dict[str, object]:
        job_id = str(uuid.uuid4())

        async def _run():
            from user_profile_engine.jobs.gaps_job import run_gaps_job
            await run_gaps_job(job_id, runtime.store, _openai_llm)

        background_tasks.add_task(asyncio.create_task, _run())
        return runtime._ok({"job_id": job_id, "status": "queued"})
```

- [ ] **Step 2: Create gaps_job.py**

```python
# engine/py/user_profile_engine/jobs/gaps_job.py
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable

from user_profile_engine.storage.duckdb_store import DuckDBStore

LlmFn = Callable[[str], Awaitable[str]]


async def run_gaps_job(job_id: str, store: DuckDBStore, llm: LlmFn) -> None:
    now = datetime.now(timezone.utc)
    items = store.list_personal_items(limit=500)
    if not items:
        return

    # Build condensed history for LLM
    history_lines = [
        f"- {i['category']}: {i['merchant']} · {i['item_name']} · "
        f"{i['currency'] or ''}{i['amount'] or ''} · {i['item_date']}"
        for i in items[:200]
    ]
    history_text = "\n".join(history_lines)

    prompt = (
        "Analyse this purchase/entertainment/travel history and identify:\n"
        "1. Overdue replacements (items past typical lifespan)\n"
        "2. Missing accessories (complementary items never bought)\n"
        "3. Lapsed subscriptions or habits\n"
        "4. Broken patterns (regular activities that stopped)\n\n"
        "Return JSON: {\"gaps\": [{\"gap_type\": \"overdue|accessory|lapsed|pattern_break\", "
        "\"category\": \"shopping|entertainment|travel\", \"title\": \"...\", "
        "\"rationale\": \"...\", \"confidence\": 0.0-1.0, "
        "\"suggested_action\": \"...\", \"related_merchant\": \"...\"}]}\n\n"
        f"History:\n{history_text}"
    )

    try:
        raw = await llm(prompt)
        parsed = json.loads(raw)
        gaps = parsed.get("gaps", [])
    except Exception:
        return

    expires_at = now + timedelta(days=7)
    for gap in gaps:
        if not gap.get("title"):
            continue
        gap_id = hashlib.sha1(
            f"{gap.get('gap_type')}:{gap.get('title')}".encode()
        ).hexdigest()
        store.upsert_personal_gap({
            "gap_id": gap_id,
            "gap_type": gap.get("gap_type", "overdue"),
            "category": gap.get("category", "shopping"),
            "title": gap.get("title", "")[:200],
            "rationale": gap.get("rationale", ""),
            "confidence": float(gap.get("confidence", 0.5)),
            "suggested_action": gap.get("suggested_action", ""),
            "related_merchant": gap.get("related_merchant", ""),
            "expires_at": expires_at,
            "created_at": now,
        })
```

- [ ] **Step 3: Create the N8N workflow via MCP**

```json
{
  "name": "vivo-gaps-weekly",
  "nodes": [
    {
      "id": "weekly-cron",
      "name": "Weekly Cron",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "rule": { "interval": [{ "field": "weeks", "weeksInterval": 1 }] }
      }
    },
    {
      "id": "fetch-audiences",
      "name": "Fetch Audiences",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [460, 300],
      "parameters": {
        "method": "GET",
        "url": "=http://{{ $env.VIVO_FACTORY_HOST ?? 'vivo-factory:4310' }}/api/audiences"
      }
    },
    {
      "id": "split-audiences",
      "name": "Split Audiences",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [680, 300],
      "parameters": { "batchSize": 1, "options": {} }
    },
    {
      "id": "trigger-gaps",
      "name": "Trigger Gap Refresh",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [900, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $json.vault_base_url }}/personal/gaps/refresh",
        "sendBody": true,
        "contentType": "json",
        "body": "{}"
      }
    }
  ],
  "connections": {
    "Weekly Cron": { "main": [[{ "node": "Fetch Audiences", "type": "main", "index": 0 }]] },
    "Fetch Audiences": { "main": [[{ "node": "Split Audiences", "type": "main", "index": 0 }]] },
    "Split Audiences": { "main": [[{ "node": "Trigger Gap Refresh", "type": "main", "index": 0 }]] }
  },
  "active": true
}
```

- [ ] **Step 4: Commit vault changes**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/jobs/gaps_job.py engine/py/user_profile_engine/api/server.py
git commit -m "feat: gaps_job.py + /personal/gaps/refresh endpoint for weekly N8N trigger"
```

---

## Task 8: Bootstrap your own audience + end-to-end test

- [ ] **Step 1: Add yourself to audience_group.md**

Open `/srv/projects/vivo-factory/audience_group.md` and add a new `<audience>` block:

```xml
<audience id="ilia-barcelona">
  <name>Ilia</name>
  <location>Barcelona</location>
  <description>Product owner, vivo-factory creator</description>
</audience>
```

- [ ] **Step 2: Run bootstrap**

```bash
cd /srv/projects/vivo-factory
npm run bootstrap 2>&1 | tail -20
```

Expected: New audience row created in Supabase.

- [ ] **Step 3: Regenerate stacks**

```bash
npm run generate:stacks
grep "ilia-barcelona" generated/docker-compose.yml | head -5
```

Expected: 3 services for ilia-barcelona (openclaw, profile, vault).

- [ ] **Step 4: Start the new audience stack**

```bash
docker compose -f generated/docker-compose.yml up -d ilia-barcelona-vault ilia-barcelona-profile ilia-barcelona-openclaw
sleep 5
curl -s http://localhost:4880/healthz  # adjust port to ilia-barcelona's vault port
```

Expected: `{"ok":true,...}`

- [ ] **Step 5: Download your mbox from Google Takeout and upload it**

1. Go to takeout.google.com → select Mail → export as mbox
2. Upload via the dashboard at `http://localhost:5405/personal/` (adjust port)
3. Watch the SSE progress bar

- [ ] **Step 6: Verify data appears**

```bash
curl -s http://localhost:4880/personal/items?category=shopping | python3 -m json.tool | head -30
curl -s http://localhost:4880/personal/deals | python3 -m json.tool | head -20
```

Expected: Items and deals populated from your Gmail archive.

- [ ] **Step 7: Final commit**

```bash
cd /srv/projects/vivo-factory
git add audience_group.md generated/
git commit -m "feat: add ilia-barcelona audience + personal dashboard stack"
```

---

**Plan 3 complete.** All three plans together deliver the full Personal Dashboard MVP: vault engine (Plan 1) + Marble UI (Plan 2) + Docker deployment + N8N automation (Plan 3).
