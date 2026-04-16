import { generateStackManifests, renderDockerCompose } from "./stacks.js";
import { loadJsonConfig, writeJsonFile, writeTextFile } from "./runtime-config.js";

const runtimeConfig = loadJsonConfig("config/runtime.json", {});
const audiences = Object.keys(runtimeConfig.audiences ?? {}).map((audienceId) => ({
  audience_id: audienceId
}));

const manifests = generateStackManifests(audiences, {
  openClawImage: runtimeConfig.openclaw_image ?? "ghcr.io/openclaw/openclaw:latest",
  profilePluginPath: runtimeConfig.profile_plugin_path ?? "/plugins/user-profile",
  profileEngineImage: runtimeConfig.profile_engine_image ?? runtimeConfig.openclaw_image ?? "ghcr.io/openclaw/openclaw:latest",
  profileEngineCommand: runtimeConfig.profile_engine_command ?? "profile-engine",
  profileEngineHealthPath: runtimeConfig.profile_engine_health_path ?? "/healthz",
  profileStoragePath: runtimeConfig.profile_storage_path ?? "/data/user-profile",
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
