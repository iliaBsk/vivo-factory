import { createHmac, randomBytes } from "node:crypto";

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

function buildOAuthHeader({ method, url, apiKey, apiSecret, accessToken, accessTokenSecret }) {
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
  const allParams = { ...queryParams, ...oauthParams };
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

  return {
    async generateTweet(story) {
      if (!openaiApiKey) throw new Error("openaiApiKey is required for generateTweet");
      if (!openaiModel) throw new Error("openaiModel is required for generateTweet");
      const context = [story.title, story.summary ?? "", story.primary_source_url ?? ""]
        .filter(Boolean).join(" — ");
      const response = await fetchImpl(`${base}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${openaiApiKey}` },
        body: JSON.stringify({
          model: openaiModel,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: "Write a single tweet (max 280 characters) for this story. Include the URL if provided. Return only the tweet text, no quotes, no markdown." }]
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

    async postTweet(text) {
      if (!text || typeof text !== "string") throw new Error("postTweet: text must be a non-empty string");
      const url = "https://api.twitter.com/2/tweets";
      const authHeader = buildOAuthHeader({ method: "POST", url, apiKey, apiSecret, accessToken, accessTokenSecret });
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({ text })
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Twitter postTweet failed: ${response.status} ${errText.slice(0, 100)}`);
      }
      return response.json();
    }
  };
}
