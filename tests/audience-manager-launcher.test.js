import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadAudienceManagerLauncherModule() {
  try {
    return await import("../src/audience-manager-launcher.js");
  } catch (error) {
    assert.fail(`expected src/audience-manager-launcher.js to exist: ${error.message}`);
  }
}

test("createAudienceManagerLauncher writes per-audience env and compose files and launches only selected services", async () => {
  const { createAudienceManagerLauncher } = await loadAudienceManagerLauncherModule();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivo-audience-launcher-"));
  const execCalls = [];
  const launcher = createAudienceManagerLauncher({
    cwd: tmpDir,
    runtimeConfig: {
      openclaw_image: "ghcr.io/openclaw/openclaw:latest",
      profile_plugin_path: "/plugins/user-profile",
      profile_engine_image: "ghcr.io/openclaw/marble-profile-service:latest",
      profile_engine_command: "node api/profile-server.js",
      profile_storage_path: "/srv/marble-profile",
      audiences: {
        "barcelona-family": {
          plugin_base_url: "http://127.0.0.1:5401",
          openclaw_admin_url: "http://127.0.0.1:7601",
          telegram_bot_token: "bot-token",
          telegram_chat_id: "-1001111111111",
          telegram_report_chat_id: "-1002222222222"
        }
      }
    },
    llmDefaults: {
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1"
    },
    execImpl: async (command, args) => {
      execCalls.push({ command, args });
      return { exitCode: 0, stdout: "started", stderr: "" };
    }
  });

  const result = await launcher.launchAudienceManager({
    id: "aud-1",
    audience_key: "barcelona-family",
    label: "Barcelona Family"
  }, {
    id: "inst-1",
    audience_id: "aud-1",
    instance_key: "barcelona-family-openclaw",
    service_name: "barcelona-family-openclaw",
    runtime_config: {
      llm_model: "gpt-4.1"
    }
  });

  assert.equal(result.services.openclaw, "barcelona-family-openclaw");
  assert.match(result.paths.env_file, /barcelona-family\.env$/);
  assert.match(fs.readFileSync(result.paths.env_file, "utf8"), /OPENAI_API_KEY=sk-test/);
  assert.match(fs.readFileSync(result.paths.env_file, "utf8"), /LLM_MODEL=gpt-4\.1/);
  assert.match(fs.readFileSync(result.paths.compose_file, "utf8"), /barcelona-family-openclaw:/);
  assert.match(fs.readFileSync(result.paths.compose_file, "utf8"), /image: ghcr\.io\/openclaw\/marble-profile-service:latest/);
  assert.match(fs.readFileSync(result.paths.compose_file, "utf8"), /command: \["sh", "-lc", "node api\/profile-server\.js"\]/);
  assert.match(fs.readFileSync(result.paths.compose_file, "utf8"), /- \/srv\/marble-profile:\/data\/user-profile/);
  assert.deepEqual(execCalls[0], {
    command: "docker",
    args: [
      "compose",
      "-f",
      result.paths.compose_file,
      "up",
      "-d",
      "barcelona-family-openclaw",
      "barcelona-family-profile"
    ]
  });
});

test("createAudienceManagerLauncher launches newly created audiences without static runtime config", async () => {
  const { createAudienceManagerLauncher } = await loadAudienceManagerLauncherModule();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivo-audience-launcher-dynamic-"));
  const launcher = createAudienceManagerLauncher({
    cwd: tmpDir,
    runtimeConfig: {
      openclaw_image: "ghcr.io/openclaw/openclaw:latest"
    },
    llmDefaults: {
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1"
    },
    execImpl: async () => ({ exitCode: 0, stdout: "started", stderr: "" })
  });

  const result = await launcher.launchAudienceManager({
    id: "aud-1",
    audience_key: "new-audience",
    label: "New Audience"
  }, {
    id: "inst-1",
    audience_id: "aud-1",
    instance_key: "new-audience-openclaw",
    service_name: "new-audience-openclaw",
    runtime_config: {}
  });

  const env = fs.readFileSync(result.paths.env_file, "utf8");
  assert.match(env, /AUDIENCE_ID=new-audience/);
  assert.match(env, /OPENAI_API_KEY=sk-test/);
  assert.match(env, /OPENAI_MODEL=gpt-4\.1-mini/);
  assert.equal(result.exitCode, 0);
});

test("createAudienceManagerLauncher writes launch-time telegram and LLM runtime into the env file", async () => {
  const { createAudienceManagerLauncher } = await loadAudienceManagerLauncherModule();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivo-audience-launcher-runtime-"));
  const launcher = createAudienceManagerLauncher({
    cwd: tmpDir,
    runtimeConfig: {
      openclaw_image: "ghcr.io/openclaw/openclaw:latest"
    },
    llmDefaults: {
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1"
    },
    execImpl: async () => ({ exitCode: 0, stdout: "started", stderr: "" })
  });

  const result = await launcher.launchAudienceManager({
    id: "aud-1",
    audience_key: "approved-audience",
    label: "Approved Audience"
  }, {
    id: "inst-1",
    audience_id: "aud-1",
    instance_key: "approved-audience-openclaw",
    service_name: "approved-audience-openclaw",
    runtime_config: {}
  }, {
    runtime_config: {
      telegram_bot_token: "launch-bot-token",
      telegram_chat_id: "-1003333333333",
      telegram_report_chat_id: "-1004444444444",
      openclaw_admin_url: "http://127.0.0.1:7610",
      plugin_base_url: "http://127.0.0.1:5410",
      llm_provider: "openai",
      llm_model: "gpt-4.1",
      llm_base_url: "https://api.openai.com/v1"
    }
  });

  const env = fs.readFileSync(result.paths.env_file, "utf8");
  assert.match(env, /TELEGRAM_BOT_TOKEN=launch-bot-token/);
  assert.match(env, /TELEGRAM_CHAT_ID=-1003333333333/);
  assert.match(env, /TELEGRAM_REPORT_CHAT_ID=-1004444444444/);
  assert.match(env, /OPENCLAW_ADMIN_URL=http:\/\/127\.0\.0\.1:7610/);
  assert.match(env, /LLM_MODEL=gpt-4\.1/);
  assert.equal(result.instance_update.openclaw_admin_url, "http://127.0.0.1:7610");
  assert.equal(result.instance_update.profile_base_url, "http://127.0.0.1:5410");
  assert.equal(result.instance_update.runtime_config.telegram_chat_id, "-1003333333333");
  assert.match(result.instance_update.runtime_config.commands.openclaw_shell, /approved-audience-openclaw/);
});

test("createAudienceManagerLauncher carries profile engine runtime config into instance metadata", async () => {
  const { createAudienceManagerLauncher } = await loadAudienceManagerLauncherModule();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivo-audience-launcher-profile-engine-"));
  const launcher = createAudienceManagerLauncher({
    cwd: tmpDir,
    runtimeConfig: {
      openclaw_image: "ghcr.io/openclaw/openclaw:latest",
      profile_engine_image: "ghcr.io/openclaw/marble-profile-service:latest",
      profile_engine_command: "node api/profile-server.js",
      profile_engine_health_path: "/healthz",
      profile_storage_path: "/srv/marble-profile"
    },
    llmDefaults: {
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1"
    },
    execImpl: async () => ({ exitCode: 0, stdout: "started", stderr: "" })
  });

  const result = await launcher.launchAudienceManager({
    id: "aud-1",
    audience_key: "approved-audience",
    label: "Approved Audience"
  }, {
    id: "inst-1",
    audience_id: "aud-1",
    instance_key: "approved-audience-openclaw",
    service_name: "approved-audience-openclaw",
    runtime_config: {}
  });

  assert.equal(result.instance_update.runtime_config.profile_engine_image, "ghcr.io/openclaw/marble-profile-service:latest");
  assert.equal(result.instance_update.runtime_config.profile_engine_command, "node api/profile-server.js");
  assert.equal(result.instance_update.runtime_config.profile_engine_health_path, "/healthz");
  assert.equal(result.instance_update.runtime_config.profile_storage_path, "/srv/marble-profile");
});

test("createAudienceManagerLauncher writes vivoFactoryUrl into openclaw.json extensions when configDir is set", async () => {
  const { createAudienceManagerLauncher } = await loadAudienceManagerLauncherModule();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivo-audience-launcher-plugin-cfg-"));
  const launcher = createAudienceManagerLauncher({
    cwd: tmpDir,
    vivoFactoryUrl: "http://host.docker.internal:4310",
    runtimeConfig: {
      openclaw_image: "ghcr.io/openclaw/openclaw:latest",
      openclaw_config_dir: "generated/audience-managers",
      audiences: {
        "test-audience": {
          plugin_base_url: "http://127.0.0.1:5401",
          openclaw_admin_url: "http://127.0.0.1:18801",
          telegram_bot_token: "tok",
          telegram_chat_id: "-1001"
        }
      }
    },
    llmDefaults: {
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1"
    },
    execImpl: async () => ({ exitCode: 0, stdout: "started", stderr: "" })
  });

  await launcher.launchAudienceManager(
    { id: "aud-1", audience_key: "test-audience", label: "Test" },
    { id: "inst-1", audience_id: "aud-1", service_name: "test-audience-openclaw", runtime_config: {} }
  );

  const configFile = path.join(tmpDir, "generated/audience-managers/test-audience-openclaw-config/openclaw.json");
  assert.ok(fs.existsSync(configFile), "openclaw.json was not written");
  const written = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(written.plugins?.entries?.["user-profile"]?.config?.vivoFactoryUrl, "http://host.docker.internal:4310");
});

test("createAudienceManagerLauncher merges vivoFactoryUrl into existing openclaw.json without overwriting other keys", async () => {
  const { createAudienceManagerLauncher } = await loadAudienceManagerLauncherModule();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivo-audience-launcher-plugin-merge-"));

  const configDir = path.join(tmpDir, "generated/audience-managers/merge-audience-openclaw-config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "openclaw.json"), JSON.stringify({
    gateway: { auth: { mode: "token", token: "existing-token" } },
    plugins: { entries: { "user-profile": { config: { baseUrl: "http://127.0.0.1:5400" } } } }
  }));

  const launcher = createAudienceManagerLauncher({
    cwd: tmpDir,
    vivoFactoryUrl: "http://host.docker.internal:4310",
    runtimeConfig: {
      openclaw_image: "ghcr.io/openclaw/openclaw:latest",
      openclaw_config_dir: "generated/audience-managers",
      audiences: {
        "merge-audience": {
          plugin_base_url: "http://127.0.0.1:5401",
          openclaw_admin_url: "http://127.0.0.1:18801",
          telegram_bot_token: "tok",
          telegram_chat_id: "-1001"
        }
      }
    },
    llmDefaults: {
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1"
    },
    execImpl: async () => ({ exitCode: 0, stdout: "started", stderr: "" })
  });

  await launcher.launchAudienceManager(
    { id: "aud-1", audience_key: "merge-audience", label: "Merge" },
    { id: "inst-1", audience_id: "aud-1", service_name: "merge-audience-openclaw", runtime_config: {} }
  );

  const configFile = path.join(configDir, "openclaw.json");
  const written = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(written.gateway?.auth?.token, "existing-token", "existing gateway token was overwritten");
  assert.equal(written.plugins?.entries?.["user-profile"]?.config?.baseUrl, "http://127.0.0.1:5400", "existing baseUrl was dropped");
  assert.equal(written.plugins?.entries?.["user-profile"]?.config?.vivoFactoryUrl, "http://host.docker.internal:4310", "vivoFactoryUrl not written");
});
