export function generateStackManifests(audiences, options) {
  const manifests = audiences.map((audience, index) => {
    const runtimeConfig = options.audienceRuntimeConfig?.[audience.audience_id];
    if (!runtimeConfig?.telegram_bot_token || !runtimeConfig?.telegram_chat_id || !runtimeConfig?.openclaw_admin_url) {
      throw new Error(`Missing runtime config for audience ${audience.audience_id}`);
    }
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
          port: 7200 + index,
          data_volume: `${audience.audience_id}-profile-data`,
          secret_name: `${audience.audience_id}-profile-secret`
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
    image: ${manifest.runtime.openclaw.image}
    command: ["profile-engine"]
    network_mode: "service:${openClawService}"
    volumes:
      - ${manifest.runtime.profile.data_volume}:/data/user-profile`;
    })
    .join("\n");

  const volumes = manifests
    .map((manifest) => `  ${manifest.runtime.profile.data_volume}:`)
    .join("\n");

  return `services:\n${dashboardService}\n${services}\nvolumes:\n${volumes}\n`;
}
