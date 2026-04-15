import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createApp } from "./app.js";
import { createAudienceImportService } from "./audience-import.js";
import { createAudienceManagerLauncher } from "./audience-manager-launcher.js";
import { createSupabaseProvisioningClient } from "./bootstrap-provisioning.js";
import { createInstanceManager } from "./instance-manager.js";
import { createOpenAiAudienceClient } from "./openai-audience-client.js";
import { createFileRepository, createSupabaseRepository } from "./repository.js";
import { createSetupService, resolveLlmDefaults } from "./setup-service.js";
import { loadEnvConfig, loadJsonConfig } from "./runtime-config.js";

const execFileAsync = promisify(execFile);

const runtimeConfig = loadJsonConfig("config/runtime.json", {});
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
const audienceManagerLauncher = createAudienceManagerLauncher({
  cwd: process.cwd(),
  runtimeConfig,
  llmDefaults,
  execImpl: defaultExec
});

const app = createApp({
  repository,
  instanceManager,
  setupService,
  audienceImportService,
  audienceManagerLauncher,
  publicationTargetResolver(audience) {
    if (!audience?.audience_key) {
      return null;
    }
    const configured = runtimeConfig.audiences?.[audience.audience_key];
    if (!configured?.telegram_chat_id) {
      return null;
    }
    return {
      channel: "telegram",
      target_identifier: configured.telegram_chat_id
    };
  },
  clock: () => new Date().toISOString()
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
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

const port = Number(envConfig.PORT ?? runtimeConfig.server_port ?? 4310);
const host = envConfig.HOST ?? runtimeConfig.server_host ?? "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Vivo Factory dashboard listening on http://${host}:${port}`);
});

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

  if (isConfiguredValue(supabaseUrl) && isConfiguredValue(serviceRoleKey)) {
    return createSupabaseRepository({
      url: supabaseUrl,
      serviceRoleKey,
      storageBucket,
      fetchImpl: globalThis.fetch
    });
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
