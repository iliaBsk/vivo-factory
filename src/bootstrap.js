import { bootstrapAudiences } from "./bootstrap-lib.js";
import { createProfileClient } from "./profile-client.js";
import { loadJsonConfig, loadTextFile, writeJsonFile } from "./runtime-config.js";

const runtimeConfig = loadJsonConfig("config/runtime.json", {});
const markdown = loadTextFile("audience_group.md");

const result = await bootstrapAudiences(markdown, {
  profileClientFactory(audience) {
    const baseUrl = runtimeConfig.audiences?.[audience.audience_id]?.plugin_base_url ?? runtimeConfig.plugin_base_url_default ?? "http://127.0.0.1:5400";
    return createProfileClient({ baseUrl });
  }
});

writeJsonFile("generated/bootstrap-summary.json", result);
console.log(`Bootstrapped ${result.audiences.length} audiences into user-profile-plugin knowledge graphs.`);
