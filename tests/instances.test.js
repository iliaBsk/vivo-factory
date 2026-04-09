import test from "node:test";
import assert from "node:assert/strict";

async function loadModules() {
  try {
    const [repositoryModule, appModule, instanceManagerModule] = await Promise.all([
      import("../src/repository.js"),
      import("../src/app.js"),
      import("../src/instance-manager.js")
    ]);
    return { ...repositoryModule, ...appModule, ...instanceManagerModule };
  } catch (error) {
    assert.fail(`expected instance management modules to exist: ${error.message}`);
  }
}

function createRuntimeConfig() {
  return {
    compose_file: "/srv/vivo-factory/generated/docker-compose.yml",
    audiences: {
      "bald-high-man-early-40s-barcelona": {
        plugin_base_url: "http://127.0.0.1:5401",
        openclaw_admin_url: "http://127.0.0.1:7601",
        openclaw_chat_path: "/operator/chat",
        openclaw_report_path: "/operator/report",
        openclaw_health_path: "/healthz",
        telegram_bot_token: "123456:SECRET_TOKEN",
        telegram_chat_id: "-1001111111111",
        telegram_report_chat_id: "-1002222222222"
      }
    }
  };
}

test("createInstanceManager exposes sanitized per-instance config and validates telegram settings", async () => {
  const { createInstanceManager } = await loadModules();
  const manager = createInstanceManager(createRuntimeConfig(), {
    execImpl: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return {};
      }
    })
  });

  const instances = manager.listInstances();

  assert.equal(instances.length, 1);
  assert.deepEqual(instances[0], {
    audience_id: "bald-high-man-early-40s-barcelona",
    service_name: "bald-high-man-early-40s-barcelona-openclaw",
    profile_service_name: "bald-high-man-early-40s-barcelona-profile",
    plugin_base_url: "http://127.0.0.1:5401",
    openclaw_admin_url: "http://127.0.0.1:7601",
    telegram_chat_id: "-1001111111111",
    telegram_report_chat_id: "-1002222222222",
    telegram_bot_token_masked: "123456:SECR...OKEN"
  });
});

test("createInstanceManager deploys and tails logs for a single instance", async () => {
  const { createInstanceManager } = await loadModules();
  const execCalls = [];
  const manager = createInstanceManager(createRuntimeConfig(), {
    execImpl: async (command, args) => {
      execCalls.push({ command, args });
      return {
        exitCode: 0,
        stdout: args.includes("logs") ? "openclaw started" : "created",
        stderr: ""
      };
    },
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return {};
      }
    })
  });

  const deploy = await manager.deployInstance("bald-high-man-early-40s-barcelona");
  const logs = await manager.getInstanceLogs("bald-high-man-early-40s-barcelona", { tail: 50 });

  assert.equal(deploy.exitCode, 0);
  assert.equal(logs.stdout, "openclaw started");
  assert.deepEqual(execCalls[0], {
    command: "docker",
    args: [
      "compose",
      "-f",
      "/srv/vivo-factory/generated/docker-compose.yml",
      "up",
      "-d",
      "bald-high-man-early-40s-barcelona-openclaw",
      "bald-high-man-early-40s-barcelona-profile"
    ]
  });
  assert.deepEqual(execCalls[1], {
    command: "docker",
    args: [
      "compose",
      "-f",
      "/srv/vivo-factory/generated/docker-compose.yml",
      "logs",
      "--tail",
      "50",
      "bald-high-man-early-40s-barcelona-openclaw"
    ]
  });
});

test("app exposes instance health, reports, deploy, and operator chat endpoints", async () => {
  const { createRepository, createApp, createInstanceManager } = await loadModules();
  const repository = createRepository();
  const execCalls = [];
  const fetchCalls = [];
  const manager = createInstanceManager(createRuntimeConfig(), {
    execImpl: async (command, args) => {
      execCalls.push({ command, args });
      return { exitCode: 0, stdout: "deployed", stderr: "" };
    },
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.endsWith("/healthz")) {
        return {
          ok: true,
          async json() {
            return { status: "ok", uptime_seconds: 42 };
          }
        };
      }
      if (url.endsWith("/operator/report")) {
        return {
          ok: true,
          async json() {
            return {
              summary: "1 post published",
              pending_approvals: 0,
              last_publish_at: "2026-03-23T10:00:00.000Z"
            };
          }
        };
      }
      if (url.endsWith("/operator/chat")) {
        return {
          ok: true,
          async json() {
            return {
              reply: "Instance is healthy and ready.",
              conversation_id: "conv-1"
            };
          }
        };
      }
      throw new Error(`unexpected url ${url}`);
    }
  });

  const app = createApp({
    repository,
    instanceManager: manager,
    profileClientFactory() {
      return {
        async updateFacts() {
          return { ok: true };
        },
        async getSummary() {
          return { ok: true, data: { profile: {} } };
        }
      };
    },
    freshnessCheck: async () => ({ ok: true }),
    clock: () => "2026-03-23T10:00:00.000Z"
  });

  const instancesResponse = await app.handle({ method: "GET", pathname: "/api/instances" });
  const healthResponse = await app.handle({
    method: "GET",
    pathname: "/api/instances/bald-high-man-early-40s-barcelona/health"
  });
  const reportResponse = await app.handle({
    method: "GET",
    pathname: "/api/instances/bald-high-man-early-40s-barcelona/report"
  });
  const deployResponse = await app.handle({
    method: "POST",
    pathname: "/api/instances/bald-high-man-early-40s-barcelona/deploy",
    body: JSON.stringify({ operator: "operator@example.com" })
  });
  const chatResponse = await app.handle({
    method: "POST",
    pathname: "/api/instances/bald-high-man-early-40s-barcelona/chat",
    body: JSON.stringify({ operator: "operator@example.com", message: "status report" })
  });

  assert.equal(instancesResponse.status, 200);
  assert.equal(JSON.parse(instancesResponse.body).items[0].telegram_bot_token_masked, "123456:SECR...OKEN");
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(JSON.parse(healthResponse.body), { status: "ok", uptime_seconds: 42 });
  assert.equal(reportResponse.status, 200);
  assert.equal(JSON.parse(reportResponse.body).summary, "1 post published");
  assert.equal(deployResponse.status, 200);
  assert.equal(chatResponse.status, 200);
  assert.equal(JSON.parse(chatResponse.body).reply, "Instance is healthy and ready.");
  assert.equal(execCalls.length, 1);
  assert.equal(fetchCalls.length, 3);
  assert.equal(repository.listInstanceReports().length, 1);
  assert.equal(repository.listOperatorChats().length, 1);
  assert.equal(repository.listDeployments().length, 1);
});

test("dashboard HTML renders live instance controls", async () => {
  const { createRepository, createApp, createInstanceManager } = await loadModules();
  const repository = createRepository();
  const manager = createInstanceManager(createRuntimeConfig(), {
    execImpl: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { status: "ok" };
      }
    })
  });

  const app = createApp({
    repository,
    instanceManager: manager,
    profileClientFactory() {
      return {
        async updateFacts() {
          return { ok: true };
        },
        async getSummary() {
          return { ok: true, data: { profile: {} } };
        }
      };
    },
    freshnessCheck: async () => ({ ok: true }),
    clock: () => "2026-03-23T10:00:00.000Z"
  });

  const response = await app.handle({ method: "GET", pathname: "/" });

  assert.equal(response.status, 200);
  assert.match(response.body, /Live Instances/);
  assert.match(response.body, /Operator Console/);
  assert.match(response.body, /-1001111111111/);
  assert.match(response.body, /Deploy/);
});
