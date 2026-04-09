import { extractAudiences, normalizeAudience } from "./audience.js";
import { generateStackManifests, renderDockerCompose } from "./stacks.js";
import { loadJsonConfig, loadTextFile, writeJsonFile, writeTextFile } from "./runtime-config.js";

const runtimeConfig = loadJsonConfig("config/runtime.json", {});
const markdown = loadTextFile("audience_group.md");
const audiences = extractAudiences(markdown).map((entry) => normalizeAudience(entry));

const manifests = generateStackManifests(audiences, {
  openClawImage: runtimeConfig.openclaw_image ?? "ghcr.io/openclaw/openclaw:latest",
  profilePluginPath: runtimeConfig.profile_plugin_path ?? "/plugins/user-profile",
  dashboard: {
    serviceName: runtimeConfig.dashboard_service_name ?? "vivo-factory-dashboard",
    imageName: runtimeConfig.dashboard_image_name ?? "vivo-factory-dashboard",
    containerPort: runtimeConfig.server_port ?? 4310,
    hostPort: runtimeConfig.server_port ?? 4310
  },
  audienceRuntimeConfig: runtimeConfig.audiences ?? {}
});

writeJsonFile("generated/stacks.json", manifests);
writeTextFile("generated/docker-compose.yml", renderDockerCompose(manifests));

console.log(`Generated ${manifests.length} audience stack manifests.`);
