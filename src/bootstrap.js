import { bootstrapAudiences } from "./bootstrap-lib.js";
import { createSupabaseProvisioningClient } from "./bootstrap-provisioning.js";
import { createProfileClient } from "./profile-client.js";
import { loadEnvConfig, loadJsonConfig, loadTextFile, writeJsonFile } from "./runtime-config.js";

const runtimeConfig = loadJsonConfig("config/runtime.json", {});
const envConfig = {
  ...loadEnvConfig(".env"),
  ...process.env
};
const markdown = loadTextFile("audience_group.md");
const provisioningClient = isConfiguredValue(envConfig.SUPABASE_URL) && isConfiguredValue(envConfig.SUPABASE_SERVICE_ROLE_KEY)
  ? createSupabaseProvisioningClient({
      url: envConfig.SUPABASE_URL,
      serviceRoleKey: envConfig.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: globalThis.fetch
    })
  : null;

const result = await bootstrapAudiences(markdown, {
  factory: {
    factory_key: runtimeConfig.factory_key ?? envConfig.VIVO_FACTORY_KEY ?? "vivo-factory",
    name: runtimeConfig.factory_name ?? envConfig.VIVO_FACTORY_NAME ?? "Vivo Factory",
    description: runtimeConfig.factory_description ?? "Audience manager control plane"
  },
  audienceRuntimeConfig: runtimeConfig.audiences ?? {},
  profileClientFactory(audience) {
    const baseUrl = runtimeConfig.audiences?.[audience.audience_id]?.plugin_base_url ?? runtimeConfig.plugin_base_url_default ?? "http://127.0.0.1:5400";
    return createProfileClient({ baseUrl });
  },
  provisioningClient
});

writeJsonFile("generated/bootstrap-summary.json", result);
console.log(`Bootstrapped ${result.audiences.length} audiences into user-profile-plugin and control-plane provisioning.`);

function isConfiguredValue(value) {
  if (!value) {
    return false;
  }
  return !String(value).includes("replace-me");
}
