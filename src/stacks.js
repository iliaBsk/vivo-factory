export function generateStackManifests(audiences, options) {
  const fullyConfigured = audiences.filter((audience) => {
    const runtimeConfig = options.audienceRuntimeConfig?.[audience.audience_id];
    const ready = !!(runtimeConfig?.telegram_bot_token && runtimeConfig?.telegram_chat_id && runtimeConfig?.openclaw_admin_url);
    if (!ready) {
      console.warn(`[stacks] Skipping ${audience.audience_id}: missing telegram_bot_token, telegram_chat_id, or openclaw_admin_url`);
    }
    return ready;
  });
  const manifests = fullyConfigured.map((audience, index) => {
    const runtimeConfig = options.audienceRuntimeConfig?.[audience.audience_id];
    return {
      audience_id: audience.audience_id,
      runtime: {
        openclaw: {
          image: options.openClawImage,
          plugin_path: options.profilePluginPath,
          admin_url: runtimeConfig.openclaw_admin_url
        },
        telegram: {
          port: 7100 + index,
          bot_token: runtimeConfig.telegram_bot_token,
          chat_id: runtimeConfig.telegram_chat_id,
          report_chat_id: runtimeConfig.telegram_report_chat_id ?? runtimeConfig.telegram_chat_id
        },
        profile: {
          image: options.profileEngineImage ?? options.openClawImage,
          command: options.profileEngineCommand ?? "profile-engine",
          health_path: options.profileEngineHealthPath ?? "/healthz",
          storage_path: options.profileStoragePath ?? "/data/user-profile",
          port: 7200 + index,
          data_volume: `${audience.audience_id}-profile-data`,
          secret_name: `${audience.audience_id}-profile-secret`
        },
        vault: {
          image: options.vaultEngineImage ?? "ghcr.io/openclaw/vault-engine:latest",
          command: options.vaultEngineCommand ?? "python -m user_profile_engine.main",
          health_path: "/healthz",
          storage_path: "/data/vault",
          port: 4876 + index,
          data_volume: `${audience.audience_id}-vault-data`
        }
      }
    };
  });

  manifests.dashboard = {
    service_name: options.dashboard?.serviceName ?? "vivo-factory-dashboard",
    image_name: options.dashboard?.imageName ?? "vivo-factory-dashboard",
    container_port: options.dashboard?.containerPort ?? 4310,
    host_port: options.dashboard?.hostPort ?? 4310
  };

  return manifests;
}

export function renderDockerCompose(manifests) {
  const dashboard = manifests.dashboard ?? {
    service_name: "vivo-factory-dashboard",
    image_name: "vivo-factory-dashboard",
    container_port: 4310,
    host_port: 4310
  };
  const dashboardService = `  ${dashboard.service_name}:
    build: .
    image: ${dashboard.image_name}
    env_file:
      - .env
    environment:
      HOST: 0.0.0.0
      PORT: "${dashboard.container_port}"
    ports:
      - "${dashboard.host_port}:${dashboard.container_port}"
    volumes:
      - "./config:/app/config:ro"
      - "./generated:/app/generated"
      - "./data:/app/data"
      - "./.env:/app/.env:ro"
      - "/var/run/docker.sock:/var/run/docker.sock"
    restart: unless-stopped`;

  const services = manifests
    .map((manifest) => {
      const openClawService = `${manifest.audience_id}-openclaw`;
      const profileService = `${manifest.audience_id}-profile`;
      const vaultService = `${manifest.audience_id}-vault`;
      return `  ${openClawService}:
    image: ${manifest.runtime.openclaw.image}
    environment:
      AUDIENCE_ID: ${manifest.audience_id}
      TELEGRAM_PORT: "${manifest.runtime.telegram.port}"
      TELEGRAM_BOT_TOKEN: ${manifest.runtime.telegram.bot_token}
      TELEGRAM_CHAT_ID: "${manifest.runtime.telegram.chat_id}"
      TELEGRAM_REPORT_CHAT_ID: "${manifest.runtime.telegram.report_chat_id}"
      OPENCLAW_ADMIN_URL: ${manifest.runtime.openclaw.admin_url}
      USER_PROFILE_PLUGIN_PATH: ${manifest.runtime.openclaw.plugin_path}
    ports:
      - "${manifest.runtime.telegram.port}:${manifest.runtime.telegram.port}"
    volumes:
      - ${manifest.runtime.profile.data_volume}:/data/user-profile
  ${profileService}:
    image: ${manifest.runtime.profile.image}
    command: ["sh", "-lc", "${escapeComposeCommand(manifest.runtime.profile.command)}"]
    network_mode: "service:${openClawService}"
    volumes:
      - ${manifest.runtime.profile.data_volume}:${manifest.runtime.profile.storage_path}
  ${vaultService}:
    image: ${manifest.runtime.vault.image}
    command: ${manifest.runtime.vault.command}
    environment:
      OPENAI_API_KEY: \${OPENAI_API_KEY}
      OPENAI_MODEL: \${OPENAI_MODEL:-gpt-4o-mini}
      STORAGE_PATH: ${manifest.runtime.vault.storage_path}
      PORT: "${manifest.runtime.vault.port}"
    ports:
      - "${manifest.runtime.vault.port}:${manifest.runtime.vault.port}"
    volumes:
      - "${manifest.audience_id}-vault-data:${manifest.runtime.vault.storage_path}"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${manifest.runtime.vault.port}/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3`;
    })
    .join("\n");

  const volumes = manifests
    .flatMap((manifest) => [
      `  ${manifest.runtime.profile.data_volume}:`,
      `  ${manifest.runtime.vault.data_volume}:`
    ])
    .join("\n");
  const audienceServices = services ? `\n${services}` : "";
  const audienceVolumes = volumes ? `\nvolumes:\n${volumes}\n` : "\n";

  return `services:\n${dashboardService}${audienceServices}${audienceVolumes}`;
}

function escapeComposeCommand(command) {
  return String(command ?? "profile-engine").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
