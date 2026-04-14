export function createSetupService(options = {}) {
  const envConfig = options.envConfig ?? {};
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async getStatus() {
      const llm = resolveLlmDefaults(envConfig);
      const supabaseConfigured = Boolean(envConfig.SUPABASE_URL) && Boolean(envConfig.SUPABASE_SERVICE_ROLE_KEY);
      const supabaseConnection = supabaseConfigured
        ? await checkSupabaseConnection(envConfig, fetchImpl)
        : { ok: false, message: "Connection skipped until credentials exist" };
      const supabaseSchema = supabaseConnection.ok
        ? await checkSupabaseSchema(envConfig, fetchImpl)
        : { ok: false, message: "Schema check skipped until Supabase is reachable" };
      const llmConfigured = Boolean(llm.provider) && Boolean(llm.model) && Boolean(llm.apiKey);
      const checks = {
        supabase_config: {
          ok: supabaseConfigured,
          message: supabaseConfigured ? "Credentials loaded" : "Missing Supabase URL or service role key"
        },
        supabase_connection: supabaseConnection,
        supabase_schema: supabaseSchema,
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

const REQUIRED_SUPABASE_TABLES = [
  "vivo_factories",
  "vivo_audiences",
  "vivo_instances",
  "vivo_stories",
  "vivo_story_assets",
  "vivo_story_reviews",
  "vivo_story_publications",
  "vivo_storage_objects"
];

async function checkSupabaseSchema(envConfig, fetchImpl) {
  try {
    for (const tableName of REQUIRED_SUPABASE_TABLES) {
      const url = new URL(`/rest/v1/${tableName}?select=id&limit=1`, envConfig.SUPABASE_URL);
      const response = await fetchImpl(url, {
        headers: {
          apikey: envConfig.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${envConfig.SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
      if (!response.ok) {
        const detail = await formatSupabaseError(response);
        return {
          ok: false,
          message: `Missing or inaccessible table public.${tableName}. ${detail}`.trim()
        };
      }
    }
    return {
      ok: true,
      message: "Required Supabase tables available"
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message
    };
  }
}

async function formatSupabaseError(response) {
  const body = await response.text();
  try {
    const payload = JSON.parse(body);
    return payload.message ?? payload.error_description ?? body;
  } catch {
    return body;
  }
}
