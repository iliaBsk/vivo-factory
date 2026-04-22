import fs from "node:fs";
import path from "node:path";

import { writeTextFile, writeJsonFile } from "./runtime-config.js";

export function createAudienceManagerLauncher(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const runtimeConfig = options.runtimeConfig ?? {};
  const llmDefaults = options.llmDefaults ?? {};
  const execImpl = options.execImpl ?? defaultExec;
  const vivoFactoryUrl = (options.vivoFactoryUrl ?? "").replace(/\/$/, "");

  return {
    async launchAudienceManager(audience, instance, launchOptions = {}) {
      const audienceKey = audience.audience_key ?? audience.audience_id ?? audience.id;
      const runtime = compactObject({
        ...(runtimeConfig.audiences?.[audienceKey] ?? {}),
        ...(instance?.runtime_config ?? {}),
        ...(launchOptions.runtime_config ?? {})
      });

      const effectiveLlm = resolveEffectiveLlmConfig(llmDefaults, runtime);
      if (!effectiveLlm.provider || !effectiveLlm.model || !effectiveLlm.apiKey) {
        throw new Error("Missing effective LLM configuration for audience manager launch.");
      }

      const serviceNames = {
        openclaw: instance?.service_name ?? `${audienceKey}-openclaw`,
        profile: instance?.runtime_config?.profile_service_name ?? `${audienceKey}-profile`
      };
      const profileEngine = {
        image: runtime.profile_engine_image ?? runtimeConfig.profile_engine_image ?? runtimeConfig.openclaw_image ?? "ghcr.io/openclaw/openclaw:latest",
        command: runtime.profile_engine_command ?? runtimeConfig.profile_engine_command ?? "profile-engine",
        healthPath: runtime.profile_engine_health_path ?? runtimeConfig.profile_engine_health_path ?? "/healthz",
        storagePath: runtime.profile_storage_path ?? runtimeConfig.profile_storage_path ?? "/data/user-profile"
      };
      const dir = path.resolve(cwd, "generated/audience-managers");
      const envFile = path.join(dir, `${audienceKey}.env`);
      const composeFile = path.join(dir, `${audienceKey}.compose.yml`);

      writeTextFile(envFile, renderEnvFile({
        audienceKey,
        runtime,
        effectiveLlm,
        pluginPath: runtimeConfig.profile_plugin_path ?? "/plugins/user-profile",
        vivoFactoryUrl
      }));
      const pluginSourcePath = runtimeConfig.profile_plugin_source_path ?? path.resolve(cwd, "src/plugins/user-profile");
      const appSourcePath = runtimeConfig.profile_app_source_path ?? null;
      const configDir = runtimeConfig.openclaw_config_dir
        ? path.resolve(cwd, runtimeConfig.openclaw_config_dir, `${audienceKey}-openclaw-config`)
        : null;

      writeTextFile(composeFile, renderComposeFile({
        openClawImage: runtimeConfig.openclaw_image ?? "ghcr.io/openclaw/openclaw:latest",
        profileEngine,
        envFile,
        serviceNames,
        ports: runtimeConfig.audience_ports?.[audienceKey] ?? [],
        configDir,
        pluginSourcePath,
        appSourcePath
      }));

      if (configDir && vivoFactoryUrl) {
        writePluginConfig(configDir, vivoFactoryUrl);
      }

      const commands = buildCommands(composeFile, serviceNames);
      const result = await execImpl("docker", [
        "compose",
        "-f",
        composeFile,
        "up",
        "-d",
        serviceNames.openclaw,
        serviceNames.profile
      ]);

      return {
        audience_id: audience.id ?? null,
        instance_id: instance?.id ?? null,
        services: serviceNames,
        llm: {
          provider: effectiveLlm.provider,
          model: effectiveLlm.model,
          base_url: effectiveLlm.baseUrl
        },
        paths: {
          env_file: envFile,
          compose_file: composeFile
        },
        commands,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        instance_update: {
          runtime_config: {
            ...(instance?.runtime_config ?? {}),
            ...runtime,
            llm_provider: effectiveLlm.provider,
            llm_model: effectiveLlm.model,
            llm_base_url: effectiveLlm.baseUrl,
            profile_engine_image: profileEngine.image,
            profile_engine_command: profileEngine.command,
            profile_engine_health_path: profileEngine.healthPath,
            profile_storage_path: profileEngine.storagePath,
            profile_service_name: serviceNames.profile,
            generated_env_file: envFile,
            generated_compose_file: composeFile,
            commands
          },
          service_name: serviceNames.openclaw,
          openclaw_admin_url: runtime.openclaw_admin_url ?? instance?.openclaw_admin_url ?? "",
          profile_base_url: runtime.plugin_base_url ?? instance?.profile_base_url ?? "",
          status: result.exitCode === 0 ? "active" : "launch_failed",
          last_heartbeat_at: result.exitCode === 0 ? launchOptions.timestamp ?? new Date().toISOString() : null
        }
      };
    }
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function renderEnvFile({ audienceKey, runtime, effectiveLlm, pluginPath, vivoFactoryUrl }) {
  const lines = [
    `AUDIENCE_ID=${audienceKey}`,
    `OPENCLAW_ADMIN_URL=${runtime.openclaw_admin_url ?? ""}`,
    `USER_PROFILE_PLUGIN_PATH=${pluginPath}`,
    `TELEGRAM_BOT_TOKEN=${runtime.telegram_bot_token ?? ""}`,
    `TELEGRAM_CHAT_ID=${runtime.telegram_chat_id ?? ""}`,
    `TELEGRAM_REPORT_CHAT_ID=${runtime.telegram_report_chat_id ?? runtime.telegram_chat_id ?? ""}`,
    `LLM_PROVIDER=${effectiveLlm.provider}`,
    `LLM_MODEL=${effectiveLlm.model}`,
    `LLM_BASE_URL=${effectiveLlm.baseUrl ?? ""}`,
    `OPENAI_API_KEY=${effectiveLlm.apiKey}`,
    `OPENAI_BASE_URL=${effectiveLlm.baseUrl ?? ""}`,
    `OPENAI_MODEL=${effectiveLlm.model}`,
    `MARBLE_ONBOARDING_DEEP_RESEARCH=${runtime.marble_onboarding_deep_research ?? "true"}`,
    `OPENAI_DEEP_RESEARCH_MODEL=${runtime.openai_deep_research_model ?? "gpt-4o"}`
  ];
  if (vivoFactoryUrl) lines.push(`VIVO_FACTORY_URL=${vivoFactoryUrl}`);
  return lines.join("\n");
}

function writePluginConfig(configDir, vivoFactoryUrl) {
  const configFile = path.join(configDir, "openclaw.json");
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {
    // file doesn't exist or is invalid — start from empty
  }
  const existingEntries = existing.plugins?.entries ?? {};
  const existingPluginEntry = existingEntries["user-profile"] ?? {};
  writeJsonFile(configFile, {
    ...existing,
    plugins: {
      ...(existing.plugins ?? {}),
      entries: {
        ...existingEntries,
        "user-profile": {
          ...existingPluginEntry,
          config: {
            ...(existingPluginEntry.config ?? {}),
            vivoFactoryUrl
          }
        }
      }
    }
  });
}

function renderComposeFile({ openClawImage, profileEngine, envFile, serviceNames, ports, configDir, pluginSourcePath, appSourcePath }) {
  const profileDataVolume = `${serviceNames.openclaw}-profile-data`;
  const portLines = (ports ?? []).map((p) => `      - "${p}"`).join("\n");
  const portSection = portLines ? `    ports:\n${portLines}\n` : "";
  const configMount = configDir ? `      - ${configDir}:/home/node/.openclaw\n` : "";
  const pluginMount = pluginSourcePath ? `      - ${pluginSourcePath}:/home/node/.openclaw/extensions/user-profile:ro\n` : "";
  const appMount = appSourcePath ? `      - ${appSourcePath}:/app:ro\n` : "";

  return `services:
  ${serviceNames.openclaw}:
    image: ${openClawImage}
    env_file:
      - ${envFile}
${portSection}    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
${configMount}${pluginMount}  ${serviceNames.profile}:
    image: ${profileEngine.image}
    command: ["sh", "-lc", "${escapeComposeCommand(profileEngine.command)}"]
    env_file:
      - ${envFile}
    network_mode: "service:${serviceNames.openclaw}"
    healthcheck:
      disable: true
    volumes:
      - ${profileDataVolume}:${profileEngine.storagePath}
${appMount}
volumes:
  ${profileDataVolume}:
`;
}

function buildCommands(composeFile, serviceNames) {
  const prefix = `docker compose -f ${composeFile}`;
  return {
    openclaw_shell: `${prefix} exec ${serviceNames.openclaw} /bin/sh`,
    profile_shell: `${prefix} exec ${serviceNames.profile} /bin/sh`,
    openclaw_env: `${prefix} exec ${serviceNames.openclaw} env`,
    openclaw_logs: `${prefix} logs --tail 200 ${serviceNames.openclaw}`,
    profile_logs: `${prefix} logs --tail 200 ${serviceNames.profile}`
  };
}

function resolveEffectiveLlmConfig(defaults, runtimeConfig) {
  return {
    provider: runtimeConfig.llm_provider ?? defaults.provider ?? "",
    model: runtimeConfig.llm_model ?? defaults.model ?? "",
    apiKey: defaults.apiKey ?? "",
    baseUrl: runtimeConfig.llm_base_url ?? defaults.baseUrl ?? "https://api.openai.com/v1"
  };
}

async function defaultExec() {
  throw new Error("execImpl is required for audience manager launch");
}

function escapeComposeCommand(command) {
  return String(command ?? "profile-engine").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
