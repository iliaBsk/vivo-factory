import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createInstanceManager(runtimeConfig, options = {}) {
  const config = validateRuntimeConfig(runtimeConfig ?? {});
  const execImpl = options.execImpl ?? defaultExec;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    listInstances() {
      return Object.entries(config.audiences).map(([audienceId, audienceConfig]) => sanitizeInstanceConfig(audienceId, audienceConfig, config.compose_file));
    },
    getInstanceCommands(audienceId) {
      return buildInstanceCommands(config.compose_file, getInstanceConfig(config, audienceId));
    },
    async deployAll() {
      const services = this.listInstances().flatMap((instance) => [instance.service_name, instance.profile_service_name]);
      return execImpl("docker", ["compose", "-f", config.compose_file, "up", "-d", ...services]);
    },
    async deployInstance(audienceId) {
      const instance = getInstanceConfig(config, audienceId);
      return execImpl("docker", ["compose", "-f", config.compose_file, "up", "-d", instance.service_name, instance.profile_service_name]);
    },
    async getInstanceLogs(audienceId, options = {}) {
      const instance = getInstanceConfig(config, audienceId);
      const tail = String(options.tail ?? 200);
      return execImpl("docker", ["compose", "-f", config.compose_file, "logs", "--tail", tail, instance.service_name]);
    },
    async getInstanceHealth(audienceId) {
      const instance = getInstanceConfig(config, audienceId);
      return fetchJson(fetchImpl, `${instance.openclaw_admin_url}${instance.openclaw_health_path}`);
    },
    async getInstanceReport(audienceId) {
      const instance = getInstanceConfig(config, audienceId);
      return fetchJson(fetchImpl, `${instance.openclaw_admin_url}${instance.openclaw_report_path}`);
    },
    async chatWithInstance(audienceId, payload) {
      const instance = getInstanceConfig(config, audienceId);
      return fetchJson(fetchImpl, `${instance.openclaw_admin_url}${instance.openclaw_chat_path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    }
  };
}

async function defaultExec(command, args) {
  try {
    const result = await execFileAsync(command, args, { encoding: "utf8" });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message
    };
  }
}

function validateRuntimeConfig(runtimeConfig) {
  const audiences = runtimeConfig.audiences ?? {};
  for (const [audienceId, config] of Object.entries(audiences)) {
    if (!config.telegram_bot_token || !config.telegram_chat_id) {
      throw new Error(`Audience ${audienceId} must define telegram_bot_token and telegram_chat_id`);
    }
    if (!config.openclaw_admin_url) {
      throw new Error(`Audience ${audienceId} must define openclaw_admin_url`);
    }
  }
  return {
    compose_file: runtimeConfig.compose_file ?? "generated/docker-compose.yml",
    audiences
  };
}

function getInstanceConfig(runtimeConfig, audienceId) {
  const audienceConfig = runtimeConfig.audiences[audienceId];
  if (!audienceConfig) {
    throw new Error(`Unknown audience instance: ${audienceId}`);
  }
  return {
    compose_file: runtimeConfig.compose_file,
    audience_id: audienceId,
    audience_key: audienceId,
    service_name: `${audienceId}-openclaw`,
    profile_service_name: `${audienceId}-profile`,
    plugin_base_url: audienceConfig.plugin_base_url,
    openclaw_admin_url: audienceConfig.openclaw_admin_url.replace(/\/$/, ""),
    openclaw_chat_path: audienceConfig.openclaw_chat_path ?? "/operator/chat",
    openclaw_report_path: audienceConfig.openclaw_report_path ?? "/operator/report",
    openclaw_health_path: audienceConfig.openclaw_health_path ?? "/healthz",
    telegram_bot_token: audienceConfig.telegram_bot_token,
    telegram_chat_id: audienceConfig.telegram_chat_id,
    telegram_report_chat_id: audienceConfig.telegram_report_chat_id ?? audienceConfig.telegram_chat_id
  };
}

function sanitizeInstanceConfig(audienceId, audienceConfig, composeFile) {
  const instance = getInstanceConfig({
    compose_file: composeFile,
    audiences: { [audienceId]: audienceConfig }
  }, audienceId);
  return {
    audience_id: instance.audience_id,
    audience_key: instance.audience_key,
    service_name: instance.service_name,
    profile_service_name: instance.profile_service_name,
    plugin_base_url: instance.plugin_base_url,
    openclaw_admin_url: instance.openclaw_admin_url,
    telegram_chat_id: instance.telegram_chat_id,
    telegram_report_chat_id: instance.telegram_report_chat_id,
    telegram_bot_token_masked: maskToken(instance.telegram_bot_token),
    commands: buildInstanceCommands(instance.compose_file ?? undefined, instance)
  };
}

function buildInstanceCommands(composeFile, instance) {
  const composeTarget = composeFile ?? "generated/docker-compose.yml";
  const prefix = `docker compose -f ${composeTarget}`;
  return {
    openclaw_shell: `${prefix} exec ${instance.service_name} /bin/sh`,
    profile_shell: `${prefix} exec ${instance.profile_service_name} /bin/sh`,
    openclaw_env: `${prefix} exec ${instance.service_name} env`,
    openclaw_logs: `${prefix} logs --tail 200 ${instance.service_name}`,
    profile_logs: `${prefix} logs --tail 200 ${instance.profile_service_name}`
  };
}

function maskToken(value) {
  if (value.length <= 10) {
    return `${value.slice(0, 2)}...${value.slice(-2)}`;
  }
  return `${value.slice(0, 11)}...${value.slice(-4)}`;
}

async function fetchJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    throw new Error(`Instance request failed: ${url}`);
  }
  return response.json();
}
