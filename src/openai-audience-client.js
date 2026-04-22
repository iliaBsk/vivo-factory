export function createOpenAiAudienceClient(options = {}) {
  const apiKey = options.apiKey ?? "";
  const model = options.model ?? "";
  const baseUrl = String(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!apiKey || !model) {
    return {
      async expandAudience({ normalized }) {
        return normalized;
      },
      async inferPersonalityFromPosts({ twitterHandle }) {
        const handle = twitterHandle ? `@${twitterHandle}` : "this user";
        return { raw_text: `Audience inferred from social posts of ${handle}.` };
      }
    };
  }

  return {
    async inferPersonalityFromPosts({ twitterHandle, postsText }) {
      const parts = [];
      if (twitterHandle) parts.push(`Twitter handle: @${twitterHandle}`);
      if (postsText) parts.push(`Posts:\n${String(postsText).slice(0, 40000)}`);

      const response = await fetchImpl(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content: [{
                type: "input_text",
                text: "Analyze the social media posts and infer a detailed audience personality profile. Return JSON only with these fields: raw_text (2–3 paragraph rich description of this person as an audience segment — age range, location, lifestyle, values, interests, content preferences), label (3–5 word audience label), location (city/country or null), interests (array of 5–10 interests), content_pillars (array of 3–6 content categories), tone (helpful/casual/inspirational/informative), shopping_bias (budget/mid-range/premium/luxury), family_context (family situation or null), excluded_topics (array of topics to avoid). Return JSON only, no markdown."
              }]
            },
            {
              role: "user",
              content: [{ type: "input_text", text: parts.join("\n\n") }]
            }
          ]
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const outputText = extractOutputText(payload);
      if (!outputText) return { raw_text: parts.join("\n\n") };
      try {
        return JSON.parse(outputText);
      } catch {
        return { raw_text: outputText };
      }
    },
    async expandAudience({ rawText, normalized }) {
      const response = await fetchImpl(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: "Expand the audience description into concise JSON for label, language, location, family_context, interests, content_pillars, excluded_topics, tone, and shopping_bias. Return JSON only."
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    raw_text: rawText,
                    normalized
                  })
                }
              ]
            }
          ]
        })
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = await response.json();
      const outputText = extractOutputText(payload);
      return outputText ? JSON.parse(outputText) : normalized;
    }
  };
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text) {
    return payload.output_text;
  }
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
    }
  }
  return "";
}
