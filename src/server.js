import http from "node:http";
import path from "node:path";

import { createApp } from "./app.js";
import { createInstanceManager } from "./instance-manager.js";
import { createFileRepository, createSupabaseRepository } from "./repository.js";
import { loadEnvConfig, loadJsonConfig } from "./runtime-config.js";

const runtimeConfig = loadJsonConfig("config/runtime.json", {});
const envConfig = {
  ...loadEnvConfig(".env"),
  ...process.env
};
const repository = createDashboardRepository(runtimeConfig, envConfig);
const instanceManager = Object.keys(runtimeConfig.audiences ?? {}).length > 0 ? createInstanceManager(runtimeConfig) : null;

const app = createApp({
  repository,
  instanceManager,
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
const host = envConfig.HOST ?? runtimeConfig.server_host ?? "127.0.0.1";
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
