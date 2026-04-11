import { extractAudiences, normalizeAudience } from "./audience.js";

export async function bootstrapAudiences(markdown, options = {}) {
  const rawAudiences = extractAudiences(markdown);
  if (rawAudiences.length === 0) {
    throw new Error("No audience definitions found");
  }

  const audiences = rawAudiences.map((entry) => normalizeAudience(entry));
  const profileClientFactory = options.profileClientFactory ?? defaultProfileClientFactory;
  const provisioningClient = options.provisioningClient ?? null;
  const factoryInput = normalizeFactory(options.factory);
  const audienceRuntimeConfig = options.audienceRuntimeConfig ?? {};
  const factory = provisioningClient ? await provisioningClient.ensureFactory(factoryInput) : factoryInput;
  const provisionedAudiences = [];
  const instances = [];

  for (const audience of audiences) {
    const audienceKey = audience.audience_id;
    const runtimeConfig = audienceRuntimeConfig[audienceKey] ?? {};
    const client = profileClientFactory(audience);
    await client.updateFacts(audience);
    await client.storeDecision({
      decisionId: `bootstrap-${audienceKey}`,
      decisionType: "audience_bootstrap",
      content: {
        audience_id: audienceKey,
        source: "audience_group.md"
      },
      source: "vivo_factory_bootstrap"
    });

    if (!provisioningClient) {
      provisionedAudiences.push({
        ...audience,
        audience_key: audienceKey
      });
      instances.push(buildInstanceSummary(audienceKey, runtimeConfig));
      continue;
    }

    const provisionedAudience = await provisioningClient.upsertAudience(factory, {
      audience_key: audienceKey,
      label: audience.label,
      language: audience.language,
      location: audience.location,
      family_context: audience.family_context,
      interests: audience.interests,
      content_pillars: audience.content_pillars,
      excluded_topics: audience.excluded_topics,
      tone: audience.tone,
      profile_snapshot: audience,
      status: "active"
    });
    provisionedAudiences.push({
      ...audience,
      ...provisionedAudience,
      audience_key: provisionedAudience.audience_key ?? audienceKey
    });

    const instanceSpec = buildInstanceSummary(audienceKey, runtimeConfig);
    const provisionedInstance = await provisioningClient.upsertInstance(factory, provisionedAudience, instanceSpec);
    instances.push({
      ...instanceSpec,
      ...provisionedInstance
    });
  }

  return {
    factory,
    audiences: provisionedAudiences,
    instances
  };
}

function defaultProfileClientFactory() {
  throw new Error("profileClientFactory is required");
}

function normalizeFactory(factory = {}) {
  return {
    factory_key: factory.factory_key ?? "vivo-factory",
    name: factory.name ?? "Vivo Factory",
    description: factory.description ?? "Audience manager control plane"
  };
}

function buildInstanceSummary(audienceKey, runtimeConfig = {}) {
  return {
    instance_key: `${audienceKey}-openclaw`,
    service_name: `${audienceKey}-openclaw`,
    profile_service_name: `${audienceKey}-profile`,
    openclaw_admin_url: runtimeConfig.openclaw_admin_url ?? "",
    profile_base_url: runtimeConfig.plugin_base_url ?? ""
  };
}
