import crypto from "node:crypto";

export function createContentFetcher(options = {}) {
  const sourcesConfig = options.sourcesConfig ?? { sources: [] };
  const merchantRegistry = options.merchantRegistry ?? { merchants: [], audienceOverrides: [] };
  const profileClientFactory = options.profileClientFactory ?? null;
  const repository = options.repository;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const factoryId = options.factoryId ?? null;
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    async fetchForAudience(audience, instance, fetchOptions = {}) {
      const limit = fetchOptions.limit ?? 20;
      const audienceLocation = normalizeLocation(audience.location ?? "");

      const customSources = instance?.runtime_config?.custom_sources ?? [];
      const allSources = [...sourcesConfig.sources, ...customSources];
      const localSources = allSources.filter(
        (s) => normalizeLocation(s.location ?? "") === audienceLocation
      );
      const globalSources = allSources.filter((s) => s.location === "global");

      const [localCandidates, globalCandidates] = await Promise.all([
        fetchSources(localSources, fetchImpl, merchantRegistry, 40),
        fetchSources(globalSources, fetchImpl, merchantRegistry, 10)
      ]);
      const allCandidates = [...localCandidates, ...globalCandidates];

      // Deduplicate vs stories created in the last 7 days
      const existing = await repository.listStories({ audience_id: audience.id });
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentUrls = new Set(
        existing
          .filter((s) => (s.created_at ?? "") >= sevenDaysAgo)
          .map((s) => s.primary_source_url)
          .filter(Boolean)
      );
      const deduplicated = allCandidates.filter((c) => !recentUrls.has(c.url));

      if (deduplicated.length === 0) {
        return { stories_created: 0 };
      }

      // Score with marble if profileClient available
      const profileClient = typeof profileClientFactory === "function"
        ? profileClientFactory({ audience, instance })
        : null;
      const scored = await scoreWithMarble(profileClient, deduplicated, limit);

      const storyKey = (audienceId, url) =>
        crypto.createHash("sha1").update(`${audienceId}:${url}`).digest("hex");

      let created = 0;
      const timestamp = clock();
      for (const item of scored) {
        try {
          await repository.createStory({
            factory_id: factoryId,
            audience_id: audience.id,
            instance_id: instance?.id ?? null,
            story_key: storyKey(audience.id, item.url),
            title: item.title,
            story_text: item.description,
            summary: item.description.slice(0, 200),
            source_kind: item.source_type,
            primary_source_url: item.url,
            is_deal: item.category === "deals",
            is_local: item.is_local,
            metadata: {
              marble_score: item.score,
              marble_rank: item.rank,
              source_id: item.source_id,
              category: item.category
            }
          }, { actorId: "content-fetcher", timestamp });
          created++;
        } catch (err) {
          // Duplicate story_key = already seen; skip silently
          if (!String(err.message).toLowerCase().includes("duplicate") &&
              !String(err.message).toLowerCase().includes("unique") &&
              !String(err.message).toLowerCase().includes("story_key")) {
            throw err;
          }
        }
      }

      return { stories_created: created };
    }
  };
}

async function fetchSources(sources, fetchImpl, merchantRegistry, maxItems) {
  const results = [];
  for (const source of sources) {
    if (results.length >= maxItems) break;
    try {
      if (source.type === "rss") {
        const items = await fetchRss(source, fetchImpl, maxItems - results.length);
        results.push(...items);
      } else if (source.type === "merchant") {
        const items = fetchMerchantItems(source, merchantRegistry, maxItems - results.length);
        results.push(...items);
      }
    } catch {
      // Skip failed sources silently; don't break the whole fetch
    }
  }
  return results.slice(0, maxItems);
}

async function fetchRss(source, fetchImpl, max) {
  const res = await fetchImpl(source.url, {});
  if (!res.ok) return [];
  const xml = await res.text();
  return parseRssItems(xml, source, max);
}

function parseRssItems(xml, source, max) {
  const items = [];
  const itemPattern = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemPattern.exec(xml)) !== null) {
    if (items.length >= max) break;
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link") || extractTag(block, "guid");
    const description = extractTag(block, "description") || extractTag(block, "summary") || "";
    if (title && link) {
      items.push({
        id: link,
        title: stripCdata(title),
        description: stripHtml(stripCdata(description)),
        url: link,
        category: source.category,
        source_id: source.id,
        source_type: "rss",
        is_local: source.location !== "global"
      });
    }
  }
  return items;
}

function fetchMerchantItems(source, merchantRegistry, max) {
  const merchant = (merchantRegistry.merchants ?? []).find(
    (m) => m.merchant_id === source.merchant_id
  );
  if (!merchant || !merchant.enabled) return [];
  const url = merchant.discovery_config?.listing_url ?? `https://${merchant.domain}`;
  return [{
    id: url,
    title: `Deals from ${merchant.domain}`,
    description: `Curated deals and offers from ${merchant.domain}`,
    url,
    category: source.category,
    source_id: source.id,
    source_type: "merchant",
    is_local: source.location !== "global"
  }].slice(0, max);
}

async function scoreWithMarble(profileClient, items, limit) {
  if (!profileClient?.selectItems) {
    return items.slice(0, limit).map((item, i) => ({ ...item, score: 0.5, rank: i + 1 }));
  }
  const input = items.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.description,
    category: item.category,
    url: item.url
  }));
  const result = await profileClient.selectItems(input, { task: "daily_recap", limit });
  const ranked = result.data?.selected ?? [];
  const scoreMap = new Map(ranked.map((r) => [r.id, r]));
  return items
    .filter((item) => scoreMap.has(item.id))
    .map((item) => ({
      ...item,
      score: scoreMap.get(item.id).score,
      rank: scoreMap.get(item.id).rank
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
}

function extractTag(xml, tag) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function stripCdata(text) {
  return String(text).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function normalizeLocation(location) {
  return String(location).toLowerCase().trim();
}
