import fs from "node:fs";
import path from "node:path";

import { extractAudiences, normalizeAudience } from "./audience.js";

export function createAudienceImportService(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const repository = options.repository;
  const llmClient = options.llmClient ?? defaultLlmClient();
  const provisioningClient = options.provisioningClient ?? null;
  const factory = options.factory ?? {
    factory_key: "vivo-factory",
    name: "Vivo Factory",
    description: "Audience manager control plane"
  };

  return {
    async getSource() {
      return readAudienceSource(cwd);
    },
    async getImportStatus() {
      const source = readAudienceSource(cwd);
      if (!source.exists) {
        return {
          source_file_name: null,
          source_path: null,
          import_required: false,
          item_count: 0
        };
      }
      const existingAudiences = await repository.listAudiences();
      const existingByKey = new Map(existingAudiences.map((audience) => [audience.audience_key, audience]));
      const items = extractAudiences(source.markdown).map((rawText) => {
        const normalized = normalizeAudience(rawText);
        return {
          raw_text: rawText,
          audience_key: normalized.audience_id
        };
      });
      return {
        source_file_name: source.fileName,
        source_path: source.path,
        import_required: detectImportRequirement(items, existingByKey),
        item_count: items.length
      };
    },
    async previewImport() {
      const source = readAudienceSource(cwd);
      if (!source.exists) {
        return {
          source_file_name: null,
          source_path: null,
          import_required: false,
          items: []
        };
      }

      const existingAudiences = await repository.listAudiences();
      const existingByKey = new Map(existingAudiences.map((audience) => [audience.audience_key, audience]));
      const rawAudiences = extractAudiences(source.markdown);
      const items = [];

      for (const rawText of rawAudiences) {
        const normalized = normalizeAudience(rawText);
        const expanded = mergeAudienceExpansion(normalized, await llmClient.expandAudience({
          rawText,
          normalized
        }));
        const existing = existingByKey.get(normalized.audience_id) ?? null;
        items.push({
          raw_text: rawText,
          audience_key: normalized.audience_id,
          normalized,
          expanded,
          existing_audience_id: existing?.id ?? null
        });
      }

      return {
        source_file_name: source.fileName,
        source_path: source.path,
        import_required: detectImportRequirement(items, existingByKey),
        items
      };
    },
    async confirmImport(items = []) {
      if (!provisioningClient) {
        throw new Error("Audience provisioning client is required for import confirmation.");
      }
      const confirmedItems = Array.isArray(items) ? items : [];
      const ensuredFactory = await provisioningClient.ensureFactory(factory);
      const audiences = [];

      for (const item of confirmedItems) {
        const audience = await provisioningClient.upsertAudience(
          ensuredFactory,
          buildAudiencePayload(item)
        );
        audiences.push(audience);
      }

      return {
        factory: ensuredFactory,
        audiences,
        instances: []
      };
    },
    async createAudience(input = {}) {
      if (!provisioningClient) {
        throw new Error("Audience provisioning client is required for audience creation.");
      }
      const rawText = String(input.raw_text ?? input.rawText ?? "").trim();
      if (!rawText) {
        throw new Error("Audience creation requires raw_text.");
      }
      const normalized = normalizeAudience(rawText);
      const expanded = mergeAudienceExpansion(normalized, await llmClient.expandAudience({
        rawText,
        normalized,
        references: input.references ?? {}
      }));
      const ensuredFactory = await provisioningClient.ensureFactory(factory);
      const audience = await provisioningClient.upsertAudience(ensuredFactory, buildAudiencePayload({
        raw_text: rawText,
        audience_key: normalized.audience_id,
        normalized,
        expanded
      }));
      return {
        factory: ensuredFactory,
        audience,
        instance: null
      };
    }
  };
}

function buildAudiencePayload(item) {
  const normalized = item.normalized ?? normalizeAudience(item.raw_text ?? "");
  const expanded = mergeAudienceExpansion(normalized, item.expanded ?? {});
  return {
    audience_key: item.audience_key ?? normalized.audience_id,
    label: expanded.label,
    language: expanded.language,
    location: expanded.location,
    family_context: expanded.family_context,
    interests: expanded.interests,
    content_pillars: expanded.content_pillars,
    excluded_topics: expanded.excluded_topics,
    tone: expanded.tone,
    profile_snapshot: {
      raw_text: item.raw_text ?? "",
      normalized,
      expanded
    },
    status: "active"
  };
}

function readAudienceSource(cwd) {
  const candidates = ["audience.md", "audience_group.md"];
  for (const fileName of candidates) {
    const filePath = path.resolve(cwd, fileName);
    if (fs.existsSync(filePath)) {
      return {
        exists: true,
        fileName,
        path: filePath,
        markdown: fs.readFileSync(filePath, "utf8")
      };
    }
  }

  return {
    exists: false,
    fileName: null,
    path: null,
    markdown: ""
  };
}

function detectImportRequirement(items, existingByKey) {
  if (items.length !== existingByKey.size) {
    return true;
  }
  return items.some((item) => {
    const existing = existingByKey.get(item.audience_key);
    if (!existing) {
      return true;
    }
    return existing.profile_snapshot?.raw_text !== item.raw_text;
  });
}

function mergeAudienceExpansion(normalized, expanded) {
  const merged = {
    ...normalized,
    ...expanded
  };
  merged.interests = dedupeList(expanded.interests ?? normalized.interests ?? []);
  merged.content_pillars = dedupeList(expanded.content_pillars ?? normalized.content_pillars ?? []);
  merged.excluded_topics = dedupeList(expanded.excluded_topics ?? normalized.excluded_topics ?? []);
  merged.label = merged.label ?? normalized.label;
  merged.language = merged.language ?? normalized.language ?? "en";
  merged.location = merged.location ?? normalized.location;
  merged.family_context = merged.family_context ?? normalized.family_context;
  merged.tone = merged.tone ?? normalized.tone ?? "helpful";
  return merged;
}

function dedupeList(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function defaultLlmClient() {
  return {
    async expandAudience({ normalized }) {
      return normalized;
    }
  };
}
