# Twitter/X Integration Design

**Date:** 2026-04-22  
**Status:** Approved  

## Overview

Add Twitter/X as a second publish channel alongside Telegram. When a story is published, it posts to Twitter first (LLM-generated tweet), then to Telegram. Both must succeed or the publish rolls back to `failed`.

## Architecture

### New Files

**`src/twitter-client.js`**  
Factory: `createTwitterClient({ apiKey, apiSecret, accessToken, accessTokenSecret, fetchImpl, llmClient })`

- `generateTweet(story)` — calls OpenAI to produce a ≤280-char tweet from the story's title, summary, and source URL
- `postTweet(text)` — signs and POSTs to `https://api.twitter.com/2/tweets` using OAuth 1.0a (HMAC-SHA1 via Node.js built-in `crypto`, no new dependencies)
- Returns a no-op client when credentials are missing (all four must be present)

**`src/publish-service.js`**  
Factory: `createPublishService({ telegramFetch, twitterClient, repository, clock })`

- `publishStory(story, audienceConfig)` — orchestrates the full publish sequence (see below)
- All dependencies injected; independently testable with fakes

### Modified Files

**`src/app.js`**  
`publish-recap` handler delegates to `publishService.publishStory(...)` instead of inlining Telegram logic. Response shape unchanged.

**`src/server.js`**  
Constructs `twitterClient` and `publishService`, injects into `createApp(...)`.

## Publish Flow

Twitter is attempted before Telegram to avoid a state where Telegram has sent but Twitter failed with no recovery path.

```
1. generateTweet(story)          ← LLM; skip if no Twitter credentials
2. postTweet(text)               ← Twitter API v2; skip if no credentials
3. sendMessage to Telegram       ← Telegram Bot API
4. transitionStoryStatus → "published"
5. updateStory metadata.published_at
```

**Rollback:** Any failure in steps 1–3 → `transitionStoryStatus → "failed"`, re-throw. Steps after the failure point are never executed.

**No Twitter credentials:** Steps 1–2 are skipped. Telegram-only path proceeds normally.

## Configuration

### `config/runtime.json`

Four new optional fields per audience entry:

```json
"chontang": {
  "telegram_bot_token": "...",
  "telegram_chat_id": "@vivo_chon",
  "twitter_api_key": "...",
  "twitter_api_secret": "...",
  "twitter_access_token": "...",
  "twitter_access_token_secret": "..."
}
```

### Audience `.env` files

Four matching env vars added to each audience `.env` (e.g. `chontang.env`):

```
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_TOKEN_SECRET=
```

## Dashboard UI

### Setup Wizard (new audience flow)
New optional step after the Telegram step with four input fields for Twitter credentials. Marked optional — audiences can be created without Twitter.

### Audience Settings Panel
Four new fields alongside existing `telegram_bot_token` / `telegram_chat_id` inputs. Saved via existing `PUT /api/audiences/:id` + instance update flow. No new endpoints required.

## Testing

All tests use Node.js built-in runner (`node:test`). All I/O injected as fakes — no real network calls.

**`tests/twitter-client.test.js`**
- `generateTweet` returns ≤280 chars
- `generateTweet` handles LLM failure
- `postTweet` builds correct OAuth 1.0a signature headers and calls correct endpoint
- No-op client returned when credentials absent

**`tests/publish-service.test.js`**
- Happy path: Twitter → Telegram → `published`
- Twitter fails → `failed`, Telegram never called
- Telegram fails → `failed`
- No Twitter credentials → Telegram-only path succeeds
- All fakes injected

**`tests/app.test.js`** (extend existing)
- `publish-recap` delegates to `publishService` with correct args
- Response shape unchanged

## Constraints & Notes

- No new npm dependencies — OAuth 1.0a signing uses Node.js `crypto` built-in
- Twitter/X accounts must be created manually and API credentials obtained via X Developer Portal
- Free tier: 1,500 tweets/month. Basic tier ($100/month): 50M tweets/month
- Each audience requires its own Twitter account with per-account OAuth 1.0a user tokens
- One X Developer App can generate tokens for multiple accounts
