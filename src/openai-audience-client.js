export function createOpenAiAudienceClient(options = {}) {
  const apiKey = options.apiKey ?? "";
  const model = options.model ?? "";
  const baseUrl = String(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!apiKey || !model) {
    return {
      async expandAudience({ normalized }) {
        return normalized;
      }
    };
  }

  return {
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
