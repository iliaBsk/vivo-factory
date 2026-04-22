const DEFAULT_TTL_MS = 5000;
const PROBE_TIMEOUT_MS = 2500;

export function createRuntimeStatusService({ fetchImpl = globalThis.fetch, runtimeConfig = {}, cacheTtlMs = DEFAULT_TTL_MS } = {}) {
  const cache = new Map();

  async function probe(url) {
    if (!url) return "unknown";
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return res.ok ? "running" : "stopped";
    } catch {
      return "stopped";
    }
  }

  return {
    async getStatus(audienceKey) {
      const now = Date.now();
      const cached = cache.get(audienceKey);
      if (cached && now < cached.expiresAt) return cached.value;

      const audConf = runtimeConfig.audiences?.[audienceKey] ?? {};
      const openclawHealthUrl = audConf.openclaw_admin_url
        ? `${audConf.openclaw_admin_url}${audConf.openclaw_health_path ?? "/healthz"}`
        : null;
      const marbleHealthUrl = audConf.plugin_base_url
        ? `${audConf.plugin_base_url}/healthz`
        : null;

      const [openclaw, marble] = await Promise.all([
        probe(openclawHealthUrl),
        probe(marbleHealthUrl),
      ]);

      const value = {
        openclaw,
        marble,
        openclaw_admin_url: audConf.openclaw_admin_url ?? null,
        profile_base_url: audConf.plugin_base_url ?? null,
        checked_at: new Date().toISOString(),
      };
      cache.set(audienceKey, { value, expiresAt: now + cacheTtlMs });
      return value;
    },

    invalidate(audienceKey) {
      if (audienceKey) cache.delete(audienceKey);
      else cache.clear();
    },
  };
}
