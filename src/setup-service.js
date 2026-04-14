export function createSetupService(options = {}) {
  const envConfig = options.envConfig ?? {};
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async getStatus() {
      const llm = resolveLlmDefaults(envConfig);
      const supabaseConfigured = Boolean(envConfig.SUPABASE_URL) && Boolean(envConfig.SUPABASE_SERVICE_ROLE_KEY);
      const llmConfigured = Boolean(llm.provider) && Boolean(llm.model) && Boolean(llm.apiKey);
      const checks = {
        supabase_config: {
          ok: supabaseConfigured,
          message: supabaseConfigured ? "Credentials loaded" : "Missing Supabase URL or service role key"
        },
        supabase_connection: supabaseConfigured
          ? await checkSupabaseConnection(envConfig, fetchImpl)
          : { ok: false, message: "Connection skipped until credentials exist" },
        llm_config: {
          ok: llmConfigured,
          message: llmConfigured ? "Global LLM defaults loaded" : "Missing provider, model, or API key"
        },
        story_admin: {
          ok: true,
          message: "Dashboard available"
        }
      };

      return {
        ready: Object.values(checks).every((check) => check.ok),
        llm: {
          provider: llm.provider,
          model: llm.model,
          base_url: llm.baseUrl
        },
        checks
      };
    }
  };
}

export function resolveLlmDefaults(envConfig = {}) {
  const provider = envConfig.LLM_PROVIDER ?? (envConfig.OPENAI_API_KEY ? "openai" : "");
  const model = envConfig.LLM_MODEL ?? envConfig.OPENAI_MODEL ?? "";
  const apiKey = envConfig.LLM_API_KEY ?? envConfig.OPENAI_API_KEY ?? "";
  const baseUrl = envConfig.LLM_BASE_URL ?? envConfig.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  return {
    provider,
    model,
    apiKey,
    baseUrl
  };
}

async function checkSupabaseConnection(envConfig, fetchImpl) {
  try {
    const url = new URL("/rest/v1/vivo_audiences?select=id&limit=1", envConfig.SUPABASE_URL);
    const response = await fetchImpl(url, {
      headers: {
        apikey: envConfig.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${envConfig.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (!response.ok) {
      return {
        ok: false,
        message: await response.text()
      };
    }
    return {
      ok: true,
      message: "Supabase reachable"
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message
    };
  }
}
