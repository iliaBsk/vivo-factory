import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

import { createApp } from "./app.js";
import { createAudienceImportService } from "./audience-import.js";
import { createAudienceManagerLauncher } from "./audience-manager-launcher.js";
import { createSupabaseProvisioningClient } from "./bootstrap-provisioning.js";
import { createInstanceManager } from "./instance-manager.js";
import { createOpenAiAudienceClient } from "./openai-audience-client.js";
import { createProfileClient } from "./profile-client.js";
import { createFileRepository, createSupabaseRepository, createSQLiteRepository } from "./repository.js";
import { createSetupService, resolveLlmDefaults } from "./setup-service.js";
import { loadEnvConfig, loadJsonConfig } from "./runtime-config.js";
import { createContentFetcher } from "./content-fetcher.js";

const execFileAsync = promisify(execFile);

const runtimeConfig = loadJsonConfig("config/runtime.json", {});
const serverPort = Number(process.env.PORT ?? runtimeConfig.server_port ?? 4310);
const sourcesConfig = loadJsonConfig("config/sources.json", { sources: [] });
const envConfig = {
  ...loadEnvConfig(".env"),
  ...process.env
};
const repository = createDashboardRepository(runtimeConfig, envConfig);
const instanceManager = Object.keys(runtimeConfig.audiences ?? {}).length > 0 ? createInstanceManager(runtimeConfig) : null;
const setupService = createSetupService({
  envConfig,
  fetchImpl: globalThis.fetch
});
const provisioningClient = isConfiguredValue(envConfig.SUPABASE_URL) && isConfiguredValue(envConfig.SUPABASE_SERVICE_ROLE_KEY)
  ? createSupabaseProvisioningClient({
      url: envConfig.SUPABASE_URL,
      serviceRoleKey: envConfig.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: globalThis.fetch
    })
  : null;
const audienceImportService = createAudienceImportService({
  cwd: process.cwd(),
  repository,
  llmClient: createOpenAiAudienceClient({
    apiKey: envConfig.OPENAI_API_KEY,
    model: envConfig.OPENAI_MODEL ?? envConfig.LLM_MODEL,
    baseUrl: envConfig.OPENAI_BASE_URL ?? envConfig.LLM_BASE_URL,
    fetchImpl: globalThis.fetch
  }),
  provisioningClient,
  factory: {
    factory_key: runtimeConfig.factory_key ?? envConfig.VIVO_FACTORY_KEY ?? "vivo-factory",
    name: runtimeConfig.factory_name ?? envConfig.VIVO_FACTORY_NAME ?? "Vivo Factory",
    description: runtimeConfig.factory_description ?? "Audience manager control plane"
  },
  audienceRuntimeConfig: runtimeConfig.audiences ?? {}
});
const llmDefaults = resolveLlmDefaults(envConfig);
const vivoFactoryUrl = runtimeConfig.vivo_factory_base_url ?? `http://host.docker.internal:${serverPort}`;
const audienceManagerLauncher = createAudienceManagerLauncher({
  cwd: process.cwd(),
  runtimeConfig,
  llmDefaults,
  vivoFactoryUrl,
  execImpl: defaultExec
});
const profileClientFactory = createDashboardProfileClientFactory(runtimeConfig);
const contentFetcher = createContentFetcher({
  sourcesConfig,
  profileClientFactory,
  repository,
  fetchImpl: globalThis.fetch,
  factoryId: runtimeConfig.factory_id ?? null,
  clock: () => new Date().toISOString()
});

async function dispatchFetch(audience, instance, jobId, fetchOptions = {}) {
  await repository.updateJob(jobId, { status: "running" });
  try {
    const result = await contentFetcher.fetchForAudience(audience, instance, fetchOptions);
    await repository.updateJob(jobId, { status: "done", stories_created: result.stories_created });
  } catch (err) {
    await repository.updateJob(jobId, { status: "failed", error: String(err.message ?? err).slice(0, 500) });
  }
}

const app = createApp({
  repository,
  instanceManager,
  profileClientFactory,
  setupService,
  audienceImportService,
  audienceManagerLauncher,
  dispatchFetch,
  fetchImpl: globalThis.fetch,
  publicationTargetResolver(audience, story) {
    if (!audience?.audience_key) {
      return null;
    }
    const instanceRuntimeConfig = story?.instance?.runtime_config ?? {};
    const configured = runtimeConfig.audiences?.[audience.audience_key];
    const telegramChatId = instanceRuntimeConfig.telegram_chat_id ?? configured?.telegram_chat_id;
    if (!telegramChatId) {
      return null;
    }
    return {
      channel: "telegram",
      target_identifier: telegramChatId
    };
  },
  clock: () => new Date().toISOString()
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (url.pathname === "/styles.css") {
    try {
      const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
      response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      response.end(css);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("styles.css not found — run npm run build:css");
    }
    return;
  }

  const body = await readRequestBody(request);
  const result = await app.handle({
    method: request.method ?? "GET",
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  response.writeHead(result.status, result.headers);
  response.end(result.body);
});

const port = serverPort;
const host = envConfig.HOST ?? runtimeConfig.server_host ?? "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Vivo Factory dashboard listening on http://${host}:${port}`);
});

const RECAP_HOUR_UTC = parseInt(runtimeConfig.recap_hour_utc ?? "8", 10);
let lastCronDay = "";

setInterval(async () => {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  if (now.getUTCHours() === RECAP_HOUR_UTC && now.getUTCMinutes() < 2 && todayKey !== lastCronDay) {
    lastCronDay = todayKey;
    console.log(`[cron] Starting daily recap fetch for all audiences (${todayKey})`);
    try {
      const audiences = await repository.listAudiences();
      for (const audience of audiences) {
        const instance = typeof repository.getInstanceByAudience === "function"
          ? await repository.getInstanceByAudience(audience.id).catch(() => null)
          : null;
        const job = await repository.createJob({ audience_id: audience.id });
        dispatchFetch(audience, instance, job.id, { limit: 20 }).catch(console.error);
      }
    } catch (err) {
      console.error("[cron] Daily recap failed:", err.message);
    }
  }
}, 60 * 1000);

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body || "";
}

function createDashboardRepository(runtimeConfig, envConfig) {
  const supabaseUrl = envConfig.SUPABASE_URL ?? "";
  const serviceRoleKey = envConfig.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const storageBucket = envConfig.SUPABASE_STORAGE_BUCKET ?? "vivo-content";
  const sqliteDbPath = envConfig.SQLITE_DB_PATH ?? "";

  if (isConfiguredValue(supabaseUrl) && isConfiguredValue(serviceRoleKey)) {
    return createSupabaseRepository({
      url: supabaseUrl,
      serviceRoleKey,
      storageBucket,
      fetchImpl: globalThis.fetch
    });
  }

  if (isConfiguredValue(sqliteDbPath)) {
    const stateFilePath = runtimeConfig.dashboard_state_file ?? "data/dashboard-state.json";
    return createSQLiteRepository(sqliteDbPath, stateFilePath);
  }

  return createFileRepository(path.resolve(runtimeConfig.dashboard_state_file ?? "data/dashboard-state.json"));
}

function isConfiguredValue(value) {
  if (!value) {
    return false;
  }
  return !String(value).includes("replace-me");
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

function createDashboardProfileClientFactory(runtimeConfig) {
  return ({ audience, instance }) => {
    const audienceKey = audience?.audience_key ?? audience?.audience_id ?? audience?.id ?? "";
    const configuredAudience = audienceKey ? runtimeConfig.audiences?.[audienceKey] ?? {} : {};
    const baseUrl = instance?.profile_base_url
      ?? instance?.runtime_config?.profile_base_url
      ?? instance?.runtime_config?.plugin_base_url
      ?? configuredAudience.profile_base_url
      ?? configuredAudience.plugin_base_url
      ?? runtimeConfig.profile_base_url_default
      ?? runtimeConfig.plugin_base_url_default
      ?? "";

    if (!String(baseUrl).trim()) {
      return null;
    }

    return createProfileClient({
      baseUrl,
      fetchImpl: globalThis.fetch
    });
  };
}
