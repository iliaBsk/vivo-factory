import fs from "node:fs";
import path from "node:path";

export function loadJsonConfig(filePath, fallback = {}) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

export function loadTextFile(filePath, fallback = "") {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    return fallback;
  }
  return fs.readFileSync(absolutePath, "utf8");
}

export function loadEnvConfig(filePath = ".env") {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    return {};
  }

  return fs
    .readFileSync(absolutePath, "utf8")
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      accumulator[key] = stripEnvQuotes(value);
      return accumulator;
    }, {});
}

export function writeTextFile(filePath, contents) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

export function writeJsonFile(filePath, payload) {
  writeTextFile(filePath, JSON.stringify(payload, null, 2));
}

function stripEnvQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
