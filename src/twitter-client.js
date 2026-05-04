import { createHmac, randomBytes } from "node:crypto";

function addUtmParams(rawUrl, contentType = "news") {
  try {
    const u = new URL(rawUrl);
    u.searchParams.set("utm_source", "twitter");
    u.searchParams.set("utm_medium", "social");
    u.searchParams.set("utm_campaign", "chontang-daily");
    u.searchParams.set("utm_content", contentType);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

function buildOAuthHeader({ method, url, apiKey, apiSecret, accessToken, accessTokenSecret, bodyParams = {} }) {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const parsedUrl = new URL(url);
  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
  const queryParams = Object.fromEntries(parsedUrl.searchParams);
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0"
  };
  const allParams = { ...queryParams, ...bodyParams, ...oauthParams };
  const paramString = Object.keys(allParams).sort()
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");
  const signatureBase = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(paramString)].join("&");
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(signatureBase).digest("base64");
  const withSig = { ...oauthParams, oauth_signature: signature };
  const headerParts = Object.keys(withSig).sort()
    .map(k => `${percentEncode(k)}="${percentEncode(withSig[k])}"`).join(", ");
  return `OAuth ${headerParts}`;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export function createTwitterClient({
  apiKey = "", apiSecret = "", accessToken = "", accessTokenSecret = "",
  fetchImpl = globalThis.fetch,
  openaiApiKey = "", openaiModel = "", openaiBaseUrl = "https://api.openai.com/v1"
} = {}) {
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  const base = String(openaiBaseUrl).replace(/\/+$/, "");
  const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

  async function pollMediaStatus(mediaId, checkAfterSecs) {
    await new Promise(r => setTimeout(r, checkAfterSecs * 1000));
    const statusUrl = `${UPLOAD_URL}?command=STATUS&media_id=${mediaId}`;
    const auth = buildOAuthHeader({ method: "GET", url: statusUrl, apiKey, apiSecret, accessToken, accessTokenSecret });
    const res = await fetchImpl(statusUrl, { headers: { authorization: auth } });
    if (!res.ok) throw new Error(`Twitter media STATUS failed: ${res.status}`);
    const data = await res.json();
    const state = data.processing_info?.state;
    if (state === "succeeded") return;
    if (state === "failed") throw new Error(`Twitter media processing failed: ${JSON.stringify(data.processing_info?.error ?? {})}`);
    await pollMediaStatus(mediaId, data.processing_info?.check_after_secs ?? 5);
  }

  return {
    async generateTweet(story) {
      if (!openaiApiKey) throw new Error("openaiApiKey is required for generateTweet");
      if (!openaiModel) throw new Error("openaiModel is required for generateTweet");
      const narration = story.story_text ?? story.summary ?? "";
      const whyToday = story.metadata?.why_today ?? "";
      const trackedUrl = story.primary_source_url
        ? addUtmParams(story.primary_source_url, story.metadata?.story_type ?? "news")
        : null;
      const context = [
        `Title: ${story.title}`,
        narration ? `Narration: ${narration.slice(0, 400)}` : "",
        whyToday ? `Why today: ${whyToday.slice(0, 200)}` : "",
        trackedUrl ? `URL: ${trackedUrl}` : ""
      ].filter(Boolean).join("\n");
      const systemPrompt = `You write tweets for a Suzhou-based VC and tech insider. Voice: dry, specific, no hype. Reads like an insider observation not a headline rewrite. No emoji. No exclamation marks. Include the URL on its own line if provided. Max 280 characters total. Return only the tweet text.`;
      const response = await fetchImpl(`${base}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${openaiApiKey}` },
        body: JSON.stringify({
          model: openaiModel,
          max_output_tokens: 120,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: systemPrompt }]
            },
            { role: "user", content: [{ type: "input_text", text: context }] }
          ]
        })
      });
      if (!response.ok) {
        const err = await response.text().catch(() => "");
        throw new Error(`OpenAI tweet generation failed: ${response.status} ${err.slice(0, 100)}`);
      }
      const payload = await response.json();
      const text = extractOutputText(payload);
      if (!text) throw new Error("OpenAI returned empty response for tweet generation");
      return text.slice(0, 280);
    },

    async uploadMedia(videoBuffer, mimeType = "video/mp4") {
      const totalBytes = videoBuffer.length;

      const initBodyParams = { command: "INIT", media_type: mimeType, media_category: "tweet_video", total_bytes: String(totalBytes) };
      const initAuth = buildOAuthHeader({ method: "POST", url: UPLOAD_URL, apiKey, apiSecret, accessToken, accessTokenSecret, bodyParams: initBodyParams });
      const initRes = await fetchImpl(UPLOAD_URL, {
        method: "POST",
        headers: { authorization: initAuth, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(initBodyParams).toString()
      });
      if (!initRes.ok) {
        const err = await initRes.text().catch(() => "");
        throw new Error(`Twitter media INIT failed: ${initRes.status} ${err.slice(0, 200)}`);
      }
      const { media_id_string: mediaId } = await initRes.json();

      const CHUNK = 5 * 1024 * 1024;
      for (let offset = 0, seg = 0; offset < totalBytes; offset += CHUNK, seg++) {
        const chunk = videoBuffer.slice(offset, offset + CHUNK);
        const form = new FormData();
        form.append("command", "APPEND");
        form.append("media_id", mediaId);
        form.append("segment_index", String(seg));
        form.append("media", new Blob([chunk], { type: mimeType }));
        const appendAuth = buildOAuthHeader({ method: "POST", url: UPLOAD_URL, apiKey, apiSecret, accessToken, accessTokenSecret });
        const appendRes = await fetchImpl(UPLOAD_URL, { method: "POST", headers: { authorization: appendAuth }, body: form });
        if (!appendRes.ok) {
          const err = await appendRes.text().catch(() => "");
          throw new Error(`Twitter media APPEND failed (segment ${seg}): ${appendRes.status} ${err.slice(0, 200)}`);
        }
      }

      const finalizeBodyParams = { command: "FINALIZE", media_id: mediaId };
      const finalizeAuth = buildOAuthHeader({ method: "POST", url: UPLOAD_URL, apiKey, apiSecret, accessToken, accessTokenSecret, bodyParams: finalizeBodyParams });
      const finalizeRes = await fetchImpl(UPLOAD_URL, {
        method: "POST",
        headers: { authorization: finalizeAuth, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(finalizeBodyParams).toString()
      });
      if (!finalizeRes.ok) {
        const err = await finalizeRes.text().catch(() => "");
        throw new Error(`Twitter media FINALIZE failed: ${finalizeRes.status} ${err.slice(0, 200)}`);
      }
      const finalizeData = await finalizeRes.json();
      if (finalizeData.processing_info) {
        await pollMediaStatus(mediaId, finalizeData.processing_info.check_after_secs ?? 5);
      }
      return mediaId;
    },

    async postTweet(text, mediaId = null) {
      if (!text || typeof text !== "string") throw new Error("postTweet: text must be a non-empty string");
      const url = "https://api.twitter.com/2/tweets";
      const authHeader = buildOAuthHeader({ method: "POST", url, apiKey, apiSecret, accessToken, accessTokenSecret });
      const tweetBody = { text };
      if (mediaId) tweetBody.media = { media_ids: [mediaId] };
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify(tweetBody)
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Twitter postTweet failed: ${response.status} ${errText.slice(0, 100)}`);
      }
      return response.json();
    }
  };
}
