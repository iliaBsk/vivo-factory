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
