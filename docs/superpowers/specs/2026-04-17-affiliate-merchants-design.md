# Affiliate Merchants Management — Design Spec

**Goal:** Move merchant and affiliate data from `config/merchant-registry.json` into Supabase and add an admin dashboard tab for managing merchants and their per-audience overrides.

**Architecture:** Two new Supabase tables (`vivo_merchants`, `vivo_merchant_audience_overrides`) replace the JSON config file. `catalog.js` loads from Supabase at startup (memory-cached). The dashboard gets a new "Merchants" tab with a table + 40%-width slide-out drawer, matching the Stories tab pattern.

**Tech Stack:** Node.js, Supabase (PostgreSQL), Tremor dashboard (server-side HTML), existing `src/app.js` + `src/tremor-dashboard.js` patterns.

---

## Database Schema

### `vivo_merchants`

```sql
CREATE TABLE vivo_merchants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id           text UNIQUE NOT NULL,
  name                  text NOT NULL,
  domain                text NOT NULL,
  country               text NOT NULL DEFAULT 'ES',
  currency              text NOT NULL DEFAULT 'EUR',
  network               text,
  network_merchant_code text,
  affiliate_url_template text,
  publisher_id          text,
  needs_setup           boolean NOT NULL DEFAULT true,
  enabled               boolean NOT NULL DEFAULT true,
  categories            text[] DEFAULT '{}',
  disclosure_text       text DEFAULT 'Affiliate links included.',
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
```

- `network`: `'awin'` | `'cj'` | `'tradedoubler'` | `'direct'` | `null` (no program)
- `affiliate_url_template`: pre-filled per network with `{{url}}` placeholder; `publisher_id` is substituted at link-build time
- `needs_setup`: `true` until admin has entered their `publisher_id`

### `vivo_merchant_audience_overrides`

```sql
CREATE TABLE vivo_merchant_audience_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id text NOT NULL REFERENCES vivo_merchants(merchant_id) ON DELETE CASCADE,
  audience_id text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  boost_tags  jsonb NOT NULL DEFAULT '[]',
  UNIQUE(merchant_id, audience_id)
);
```

- `boost_tags`: array of `{"tag": "beachwear", "weight": 3}` objects
- One row per (merchant, audience) pair; absent row = inherits merchant default

---

## Seed Data (15 merchants)

| Merchant | Domain | Network | Template pre-filled | needs_setup |
|---|---|---|---|---|
| Zara Spain | zara.com | awin | yes | true |
| H&M Spain | hm.com | awin | yes | true |
| Uniqlo EU | uniqlo.com | awin | yes | true |
| IKEA ES | ikea.com/es | awin | yes | true |
| Decathlon ES | decathlon.es | awin | yes | true |
| Mango ES | mango.com | awin | yes | true |
| El Corte Inglés | elcorteingles.es | awin | yes | true |
| Nike ES | nike.com | awin | yes | true |
| Adidas ES | adidas.es | awin | yes | true |
| Amazon ES | amazon.es | awin | yes | true |
| Booking.com | booking.com | awin | yes | true |
| GetYourGuide | getyourguide.es | awin | yes | true |
| Fever | fever.com | direct | no (manual) | true |
| Ticketmaster ES | ticketmaster.es | cj | yes | true |
| Live Nation ES | livenation.es | null | — | false (no program) |

Affiliate URL template patterns by network:
- **Awin**: `https://www.awin1.com/cread.php?awinmid={{MERCHANT_CODE}}&awinaffid={{publisher_id}}&ued={{url}}`
- **CJ**: `https://www.anrdoezrs.net/click-{{publisher_id}}-{{MERCHANT_CODE}}?url={{url}}`
- **Direct**: filled in manually by admin

---

## API Endpoints

All endpoints added to `src/app.js`. Auth: same session-token check used by all existing admin endpoints.

```
GET  /api/merchants
     → array of all merchants with override_count

GET  /api/merchants/:merchant_id
     → single merchant object + overrides array

PUT  /api/merchants/:merchant_id
     body: { publisher_id?, enabled?, disclosure_text?, categories? }
     → updated merchant; sets needs_setup=false when publisher_id provided

GET  /api/merchants/:merchant_id/overrides
     → array of audience override rows

PUT  /api/merchants/:merchant_id/overrides/:audience_id
     body: { enabled?, boost_tags? }
     → upserts override row
```

---

## Repository Layer

New methods on both `FileRepository` and `SupabaseRepository` (maintaining dual-backend pattern):

```
listMerchants()                                   → Merchant[]
getMerchant(merchantId)                           → Merchant | null
updateMerchant(merchantId, patch)                 → Merchant
listMerchantOverrides(merchantId)                 → Override[]
upsertMerchantOverride(merchantId, audienceId, patch) → Override
```

`FileRepository` stores merchants in `data/dashboard-state.json` under `merchants` key (dev fallback).
`SupabaseRepository` queries `vivo_merchants` and `vivo_merchant_audience_overrides`.

---

## `catalog.js` Changes

- Remove `fs.readFileSync("config/merchant-registry.json")` call
- Accept `repository` as a constructor argument (injected from `server.js`)
- On `buildCatalog()`: call `repository.listMerchants()`, filter `enabled=true && publisher_id != null`
- Build affiliate URL: substitute `{{url}}` and `{{publisher_id}}` in template
- Cache result in memory; invalidate on `PUT /api/merchants/:id` save

---

## Dashboard UI

New "Merchants" tab, consistent with Stories tab pattern.

### Table columns
`Merchant | Domain | Network | Categories | Status | (click row → drawer)`

Status badge values:
- `⚠ Needs Setup` (yellow) — `needs_setup=true`
- `✓ Active` (green) — `enabled=true, needs_setup=false`
- `Disabled` (gray) — `enabled=false`
- `No program` (muted) — `network=null`

### Drawer (40% width, slides in from right)

Sections in order:
1. **Header**: merchant name, domain · country · currency, status badge, enabled toggle
2. **Affiliate Setup** (yellow card, shown when `needs_setup=true`): network name, link to merchant's affiliate portal, publisher ID input, merchant code, URL template preview
3. **Categories**: tag pills (editable)
4. **Audience Overrides**: table of all known audiences with enabled toggle per row and boost_tags hint text
5. **Disclosure text**: single-line text input
6. **Save Changes** button

All text in drawer uses explicit dark color (`#1e293b`) to prevent white-on-white rendering.

---

## Migration from JSON

1. New Supabase migration file inserts seed merchant rows (idempotent: `ON CONFLICT (merchant_id) DO NOTHING`)
2. Existing `config/merchant-registry.json` `audienceOverrides` entries are inserted into `vivo_merchant_audience_overrides` in the same migration
3. `catalog.js` falls back to empty merchant list if Supabase unavailable (does not read JSON)
4. `config/merchant-registry.json` is kept in place but no longer read by application code

---

## Testing

- Unit tests for `catalog.js` with fake repository returning merchant fixtures
- Unit tests for new repository methods (fake Supabase client)
- Unit tests for `PUT /api/merchants/:id` — verify `needs_setup` cleared on publisher_id save
- Existing catalog tests updated to inject merchants via repository rather than JSON file
