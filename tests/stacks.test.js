import test from "node:test";
import assert from "node:assert/strict";

async function loadStacksModule() {
  try {
    return await import("../src/stacks.js");
  } catch (error) {
    assert.fail(`expected src/stacks.js to exist: ${error.message}`);
  }
}

test("generateStackManifests provisions isolated ports, volumes, and secrets per audience", async () => {
  const { generateStackManifests } = await loadStacksModule();
  const audiences = [
    { audience_id: "aud-1" },
    { audience_id: "aud-2" },
    { audience_id: "aud-3" },
    { audience_id: "aud-4" },
    { audience_id: "aud-5" }
  ];

  const manifests = generateStackManifests(audiences, {
    openClawImage: "ghcr.io/openclaw/openclaw:latest",
    profilePluginPath: "/plugins/user-profile",
    audienceRuntimeConfig: {
      "aud-1": {
        telegram_bot_token: "token-1",
        telegram_chat_id: "-1001",
        telegram_report_chat_id: "-1002",
        openclaw_admin_url: "http://127.0.0.1:7601"
      },
      "aud-2": {
        telegram_bot_token: "token-2",
        telegram_chat_id: "-1003",
        telegram_report_chat_id: "-1004",
        openclaw_admin_url: "http://127.0.0.1:7602"
      },
      "aud-3": {
        telegram_bot_token: "token-3",
        telegram_chat_id: "-1005",
        telegram_report_chat_id: "-1006",
        openclaw_admin_url: "http://127.0.0.1:7603"
      },
      "aud-4": {
        telegram_bot_token: "token-4",
        telegram_chat_id: "-1007",
        telegram_report_chat_id: "-1008",
        openclaw_admin_url: "http://127.0.0.1:7604"
      },
      "aud-5": {
        telegram_bot_token: "token-5",
        telegram_chat_id: "-1009",
        telegram_report_chat_id: "-1010",
        openclaw_admin_url: "http://127.0.0.1:7605"
      }
    }
  });

  assert.equal(manifests.length, 5);
  assert.deepEqual(
    manifests.map((manifest) => manifest.runtime.telegram.port),
    [7100, 7101, 7102, 7103, 7104]
  );
  assert.equal(new Set(manifests.map((manifest) => manifest.runtime.profile.data_volume)).size, 5);
  assert.equal(manifests[0].runtime.openclaw.plugin_path, "/plugins/user-profile");
  assert.equal(manifests[0].runtime.telegram.chat_id, "-1001");
  assert.equal(manifests[0].runtime.telegram.bot_token, "token-1");
});

test("renderDockerCompose emits separate services per audience", async () => {
  const { generateStackManifests, renderDockerCompose } = await loadStacksModule();
  const manifests = generateStackManifests([{ audience_id: "aud-1" }, { audience_id: "aud-2" }], {
    openClawImage: "ghcr.io/openclaw/openclaw:latest",
    profilePluginPath: "/plugins/user-profile",
    dashboard: {
      imageName: "vivo-factory-dashboard",
      containerPort: 4310,
      hostPort: 4310
    },
    audienceRuntimeConfig: {
      "aud-1": {
        telegram_bot_token: "token-1",
        telegram_chat_id: "-1001",
        telegram_report_chat_id: "-1002",
        openclaw_admin_url: "http://127.0.0.1:7601"
      },
      "aud-2": {
        telegram_bot_token: "token-2",
        telegram_chat_id: "-1003",
        telegram_report_chat_id: "-1004",
        openclaw_admin_url: "http://127.0.0.1:7602"
      }
    }
  });

  const compose = renderDockerCompose(manifests);

  assert.match(compose, /vivo-factory-dashboard:/);
  assert.match(compose, /build:\s+\./);
  assert.match(compose, /env_file:\s+- \.env/);
  assert.match(compose, /- "\.\/config:\/app\/config:ro"/);
  assert.match(compose, /- "\.\/generated:\/app\/generated"/);
  assert.match(compose, /- "\.\/data:\/app\/data"/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /- "4310:4310"/);
  assert.match(compose, /aud-1-openclaw:/);
  assert.match(compose, /aud-2-openclaw:/);
  assert.match(compose, /network_mode: "service:aud-1-openclaw"/);
  assert.match(compose, /TELEGRAM_CHAT_ID: "-1001"/);
  assert.match(compose, /TELEGRAM_BOT_TOKEN: token-1/);
  assert.match(compose, /OPENCLAW_ADMIN_URL: http:\/\/127\.0\.0\.1:7601/);
});

test("renderDockerCompose emits only the dashboard when no audience manifests exist", async () => {
  const { generateStackManifests, renderDockerCompose } = await loadStacksModule();
  const manifests = generateStackManifests([], {
    openClawImage: "ghcr.io/openclaw/openclaw:latest",
    profilePluginPath: "/plugins/user-profile",
    dashboard: {
      imageName: "vivo-factory-dashboard",
      containerPort: 4310,
      hostPort: 4310
    },
    audienceRuntimeConfig: {}
  });

  const compose = renderDockerCompose(manifests);

  assert.equal(manifests.length, 0);
  assert.match(compose, /vivo-factory-dashboard:/);
  assert.doesNotMatch(compose, /-openclaw:/);
  assert.doesNotMatch(compose, /^volumes:/m);
});

test("generateStackManifests rejects audiences missing telegram runtime config", async () => {
  const { generateStackManifests } = await loadStacksModule();

  assert.throws(
    () =>
      generateStackManifests([{ audience_id: "aud-1" }], {
        openClawImage: "ghcr.io/openclaw/openclaw:latest",
        profilePluginPath: "/plugins/user-profile",
        audienceRuntimeConfig: {}
      }),
    /Missing runtime config/
  );
});
