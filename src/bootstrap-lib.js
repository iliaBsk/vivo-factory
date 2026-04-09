import { extractAudiences, normalizeAudience } from "./audience.js";

export async function bootstrapAudiences(markdown, options = {}) {
  const rawAudiences = extractAudiences(markdown);
  if (rawAudiences.length === 0) {
    throw new Error("No audience definitions found");
  }

  const audiences = rawAudiences.map((entry) => normalizeAudience(entry));
  const profileClientFactory = options.profileClientFactory ?? defaultProfileClientFactory;

  for (const audience of audiences) {
    const client = profileClientFactory(audience);
    await client.updateFacts(audience);
    await client.storeDecision({
      decisionId: `bootstrap-${audience.audience_id}`,
      decisionType: "audience_bootstrap",
      content: {
        audience_id: audience.audience_id,
        source: "audience_group.md"
      },
      source: "vivo_factory_bootstrap"
    });
  }

  return { audiences };
}

function defaultProfileClientFactory() {
  throw new Error("profileClientFactory is required");
}
