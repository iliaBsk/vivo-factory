import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadJsonConfig } from "./runtime-config.js";

const execFileAsync = promisify(execFile);
const runtimeConfig = loadJsonConfig("config/runtime.json", {});
const composeFile = runtimeConfig.compose_file ?? "generated/docker-compose.yml";

try {
  const result = await execFileAsync("docker", ["compose", "-f", composeFile, "up", "-d", "--build"], {
    encoding: "utf8"
  });
  console.log(result.stdout || "Stacks deployed");
} catch (error) {
  console.error(error.stderr || error.stdout || error.message || "docker deployment failed");
  process.exit(error.code ?? 1);
}
