import { createInstanceManager } from "./instance-manager.js";
import { loadJsonConfig } from "./runtime-config.js";

const runtimeConfig = loadJsonConfig("config/runtime.json", {});
const instanceManager = createInstanceManager(runtimeConfig);
const result = await instanceManager.deployAll();

if (result.exitCode !== 0) {
  console.error(result.stderr || result.stdout || "docker deployment failed");
  process.exit(result.exitCode);
}

console.log(result.stdout || "Stacks deployed");
