// User intent profile generator.
// Derives what the user is trying to achieve across life dimensions from their Marble KG,
// generates achievement/anti-achievement pairs, and asks GPT what's relevant today per dimension.
// Caches per audience in data/user-intent-{key}.json; pushes changes back to Marble.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DIMENSIONS = ["personal", "health", "career", "family", "social", "heritage", "topics"];
const DOMAINS = ["topics", "personal", "health", "career", "family", "social", "heritage", "wealth"];
const HORIZONS = ["today", "this_week", "this_month", "this_year", "lifetime"];

const INTENT_HIERARCHY_SYSTEM = `You are a strategic life intelligence assistant. Given a person's Knowledge Graph, derive what they are actually working toward across 7 life dimensions — not surface statements, but what their behaviors, signals, and context reveal.

For each dimension × time horizon produce:
- goal: the specific thing they are trying to achieve (1 concrete sentence)
- anti_goal: the specific failure mode or obstacle that would prevent this (1 concrete sentence)

Dimensions: personal, health, career, family, social, heritage, topics
Horizons: today, this_week, this_month, this_year, lifetime

Return JSON only:
{
  "personal":  { "today": {"goal":"..","anti_goal":".."}, "this_week": {..}, "this_month": {..}, "this_year": {..}, "lifetime": {..} },
  "health":    { "today": {..}, ... },
  "career":    { "today": {..}, ... },
  "family":    { "today": {..}, ... },
  "social":    { "today": {..}, ... },
  "heritage":  { "today": {..}, ... },
  "topics":    { "today": {..}, ... }
}`;

function dimensionRelevanceSystem(dimension) {
  return `You are a personal intelligence researcher. Given a person's goal and anti-goal for their "${dimension}" life dimension today, identify the single most important thing happening in the world right now that they should know about — specifically relevant to this goal.

Be concrete: cite a trend, development, signal, or emerging risk. Not generic advice — a specific heads-up.

Return JSON only: {"insight":"<one paragraph>","why_relevant":"<one sentence connecting to their goal>"}`;
}

function cellExtractionSystem(domain, horizon) {
  return `You are a life intelligence analyst. Given a person's Knowledge Graph (compressed), extract what they are actively working toward in the [${domain}] dimension over the [${horizon}] time scale.

Return JSON only:
{
  "goals":            [{"text":"...","confidence":0.0,"synthesis_basis":"..."}],
  "desires":          [{"text":"...","confidence":0.0,"synthesis_basis":"..."}],
  "fears":            [{"text":"...","confidence":0.0,"synthesis_basis":"..."}],
  "anti_goals":       [{"text":"...","confidence":0.0,"synthesis_basis":"..."}],
  "needs":            [{"text":"...","confidence":0.0,"synthesis_basis":"..."}],
  "relevant_to_know": [{"text":"...","confidence":0.0,"synthesis_basis":"..."}]
}

Definitions:
- goals: concrete achievements being pursued in this domain/horizon
- desires: underlying motivations and wants (what they'd love to have or become)
- fears: outcomes or states they are actively avoiding
- anti_goals: specific failure modes that would block the goal
- needs: functional or replenishment requirements (things they must do/get)
- relevant_to_know: external facts, trends, or signals that matter for this domain/horizon

Rules:
- Omit any item with confidence < 0.2
- If the KG has no signal relevant to this domain and horizon, return {"status":"data_sparse"} with no other fields`;
}

export function createUserIntentService({ fetchImpl, envConfig, clock, dataDir }) {
  const apiKey = envConfig?.OPENAI_API_KEY ?? "";
  const model = envConfig?.OPENAI_MODEL ?? envConfig?.LLM_MODEL ?? "gpt-4o-mini";
  const fastModel = envConfig?.FAST_MODEL ?? model;
  const intentModel = envConfig?.INTENT_MODEL ?? model;
  const baseUrl = String(envConfig?.OPENAI_BASE_URL ?? envConfig?.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const nowIso = clock ?? (() => new Date().toISOString());
  const cacheRoot = dataDir ?? path.join(process.cwd(), "data");

  function profilePath(audienceKey) {
    return path.join(cacheRoot, `user-intent-${audienceKey}.json`);
  }

  function loadCached(audienceKey) {
    try {
      const p = profilePath(audienceKey);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  }

  function saveProfile(audienceKey, profile) {
    try {
      fs.mkdirSync(cacheRoot, { recursive: true });
      fs.writeFileSync(profilePath(audienceKey), JSON.stringify(profile, null, 2), "utf8");
    } catch (err) {
      console.error("[user-intent] Failed to save profile:", err.message);
    }
  }

  function hashDimensions(dimensions) {
    return crypto.createHash("sha256").update(JSON.stringify(dimensions)).digest("hex").slice(0, 16);
  }

  function hoursSince(isoDate, now) {
    return (new Date(now).getTime() - new Date(isoDate).getTime()) / 3_600_000;
  }

  async function llmJson(systemPrompt, userContent, useModel) {
    if (!apiKey) return null;
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: useModel ?? model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.4,
        max_completion_tokens: 3000
      })
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`LLM error ${res.status}: ${err.slice(0, 200)}`);
    }
    const payload = await res.json();
    const text = payload.choices?.[0]?.message?.content ?? "";
    return JSON.parse(text);
  }

  async function pullKGContext(profileClient) {
    if (!profileClient) return null;
    try {
      const [summaryRes, debugRes] = await Promise.allSettled([
        profileClient.getSummary(),
        profileClient.getDebug()
      ]);
      const summary = summaryRes.status === "fulfilled" ? summaryRes.value : null;
      const debug = debugRes.status === "fulfilled" ? debugRes.value : null;
      const merged = {
        ...(summary?.data ?? summary ?? {}),
        ...(debug?.data ?? debug ?? {})
      };
      return Object.keys(merged).length > 0 ? JSON.stringify(merged, null, 2) : null;
    } catch {
      return null;
    }
  }

  function compressKG(kgJson) {
    if (!kgJson) return "";
    try {
      const kg = JSON.parse(kgJson);
      const parts = [];
      if (kg.interests?.length) {
        parts.push(`Interests: ${kg.interests.slice(0, 20).map(i => i.topic || i.name || i.content || JSON.stringify(i)).join("; ")}`);
      }
      if (kg.beliefs?.length) {
        parts.push(`Beliefs:\n${kg.beliefs.slice(0, 30).map(b => `- ${b.content || b.text || JSON.stringify(b)}`).join("\n")}`);
      }
      if (kg.preferences?.length) {
        parts.push(`Preferences:\n${kg.preferences.slice(0, 20).map(p => `- ${p.content || p.text || JSON.stringify(p)}`).join("\n")}`);
      }
      if (kg.insights?.length) {
        parts.push(`Insights:\n${kg.insights.slice(0, 15).map(i => `- ${i.content || i.text || JSON.stringify(i)}`).join("\n")}`);
      }
      if (kg.identities?.length) {
        parts.push(`Identities:\n${kg.identities.slice(0, 10).map(i => `- ${i.content || i.text || JSON.stringify(i)}`).join("\n")}`);
      }
      const compressed = parts.join("\n\n");
      return (compressed || kgJson).slice(0, 3000);
    } catch {
      return kgJson.slice(0, 3000);
    }
  }

  function buildAudienceFallbackKG(audience) {
    const ps = audience.profile_snapshot ?? {};
    const up = ps.user_profile ?? {};
    const cp = ps.content_preferences ?? {};
    const personalization = ps.personalization ?? {};
    const parts = [];

    const name = personalization.avatar_name || audience.label || audience.audience_key;
    const location = audience.location || up.location;
    const ageGroup = up.age_group;
    const familyCtx = audience.family_context && audience.family_context !== "{}" ? audience.family_context : null;

    const who = [name, location && `based in ${location}`, ageGroup && `age ${ageGroup}`, familyCtx && `family: ${familyCtx}`].filter(Boolean).join(", ");
    if (who) parts.push(`Person: ${who}`);

    const interests = audience.interests?.length ? audience.interests : (up.interests ?? []);
    if (interests.length) parts.push(`Interests: ${interests.join("; ")}`);

    const pillars = audience.content_pillars?.length ? audience.content_pillars : [];
    if (pillars.length) parts.push(`Content pillars: ${pillars.join("; ")}`);

    if (cp.primary_topics?.length) parts.push(`Primary topics: ${cp.primary_topics.join("; ")}`);
    if (cp.secondary_topics?.length) parts.push(`Secondary topics: ${cp.secondary_topics.join("; ")}`);
    if (cp.style_profile) parts.push(`Style: ${cp.style_profile}`);
    if (cp.shopping_bias) parts.push(`Shopping preference: ${cp.shopping_bias}`);

    if (personalization.image_persona) parts.push(`Persona: ${personalization.image_persona}`);

    return parts.join("\n");
  }

  async function extractCell(domain, horizon, compressedKG, yesterdayCell) {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const userContent = [
      `Domain: ${domain}`,
      `Horizon: ${horizon}`,
      `Today: ${today}`,
      "",
      "Knowledge Graph:",
      compressedKG,
      yesterdayCell ? `\nPrevious extraction (yesterday):\n${JSON.stringify(yesterdayCell, null, 2)}` : ""
    ].join("\n");

    try {
      const raw = await llmJson(cellExtractionSystem(domain, horizon), userContent, intentModel);
      if (!raw || raw.status === "data_sparse") return { status: "data_sparse" };
      const CELL_FIELDS = ["goals", "desires", "fears", "anti_goals", "needs", "relevant_to_know"];
      const cell = {};
      for (const field of CELL_FIELDS) {
        cell[field] = (raw[field] ?? []).filter(item => (item.confidence ?? 1) >= 0.2);
      }
      return cell;
    } catch {
      return { status: "data_sparse" };
    }
  }

  function computeCellDiff(yesterday, today) {
    if (!yesterday) return null;
    const fields = ["goals", "desires", "fears", "anti_goals", "needs", "relevant_to_know"];
    const diff = {};
    let changeCount = 0;
    let totalCount = 0;
    for (const field of fields) {
      const oldTexts = new Set((yesterday[field] ?? []).map(i => i.text));
      const newTexts = new Set((today[field] ?? []).map(i => i.text));
      const added = [...newTexts].filter(t => !oldTexts.has(t));
      const removed = [...oldTexts].filter(t => !newTexts.has(t));
      if (added.length || removed.length) {
        diff[field] = {};
        if (added.length) diff[field].added = added;
        if (removed.length) diff[field].removed = removed;
      }
      changeCount += added.length + removed.length;
      totalCount += oldTexts.size + newTexts.size;
    }
    if (Object.keys(diff).length === 0) return null;
    return { diff, significance_score: totalCount > 0 ? Math.min(1, changeCount / totalCount) : 0 };
  }

  async function generateHierarchy(kgContext) {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const result = await llmJson(
      INTENT_HIERARCHY_SYSTEM,
      `Knowledge Graph:\n${kgContext}\n\nToday: ${today}`
    );
    if (!result || typeof result !== "object") return null;
    if (!DIMENSIONS.every(d => result[d])) return null;
    return result;
  }

  async function generateDimensionInsights(dimensions) {
    const results = await Promise.all(
      DIMENSIONS.map(async (dim) => {
        const todayGoal = dimensions[dim]?.today;
        if (!todayGoal) return [dim, null];
        try {
          const result = await llmJson(
            dimensionRelevanceSystem(dim),
            `Goal: ${todayGoal.goal}\nAnti-goal: ${todayGoal.anti_goal}`,
            fastModel
          );
          return [dim, result ?? null];
        } catch (err) {
          console.error(`[user-intent] Relevance query failed for ${dim}:`, err.message);
          return [dim, null];
        }
      })
    );
    return Object.fromEntries(results);
  }

  function detectChangedDimensions(cached, dimensions) {
    if (!cached?.dimensions) return DIMENSIONS;
    return DIMENSIONS.filter(d => {
      const a = crypto.createHash("sha256").update(JSON.stringify(cached.dimensions[d] ?? {})).digest("hex");
      const b = crypto.createHash("sha256").update(JSON.stringify(dimensions[d] ?? {})).digest("hex");
      return a !== b;
    });
  }

  async function pushToMarble(profileClient, audience, profile) {
    if (!profileClient?.updateFacts) return;
    try {
      // Push intent goals as proper Marble fields: goals (mapped beliefs), context, and identities
      const goalBeliefs = DIMENSIONS.flatMap(dim => {
        const today = profile.dimensions[dim]?.today;
        const week = profile.dimensions[dim]?.this_week;
        const year = profile.dimensions[dim]?.this_year;
        const lifetime = profile.dimensions[dim]?.lifetime;
        const entries = [];
        if (today?.goal) entries.push({ type: "goal", dimension: dim, horizon: "today", content: today.goal, anti: today.anti_goal });
        if (week?.goal) entries.push({ type: "goal", dimension: dim, horizon: "this_week", content: week.goal });
        if (year?.goal) entries.push({ type: "goal", dimension: dim, horizon: "this_year", content: year.goal });
        if (lifetime?.goal) entries.push({ type: "goal", dimension: dim, horizon: "lifetime", content: lifetime.goal });
        return entries;
      });
      const insightBeliefs = DIMENSIONS
        .map(dim => profile.today_insights?.[dim])
        .filter(Boolean)
        .map(ins => ({ type: "signal", content: ins.insight, why: ins.why_relevant }));

      await profileClient.updateFacts({
        goals: goalBeliefs,
        daily_signals: insightBeliefs,
        intent_version: profile.version_hash,
        intent_generated_at: profile.generated_at
      });
      console.log(`[user-intent] Intent profile pushed to Marble for ${audience.audience_key} (${goalBeliefs.length} goals, ${insightBeliefs.length} signals)`);
    } catch (err) {
      console.error(`[user-intent] Marble push failed for ${audience.audience_key}:`, err.message);
    }
  }

  return {
    async generateIntentProfile(audience, { profileClient } = {}) {
      if (!apiKey) return null;

      const cached = loadCached(audience.audience_key);
      const now = nowIso();

      if (cached && hoursSince(cached.generated_at, now) < 23) {
        console.log(`[user-intent] Cached profile for ${audience.audience_key} (${cached.version_hash}, ${Math.floor(hoursSince(cached.generated_at, now))}h old)`);
        return cached;
      }

      const kgContext = await pullKGContext(profileClient);
      if (!kgContext) {
        console.log(`[user-intent] No KG context for ${audience.audience_key} — skipping intent generation`);
        return null;
      }

      console.log(`[user-intent] Generating intent profile for ${audience.audience_key}...`);

      let dimensions;
      try {
        dimensions = await generateHierarchy(kgContext);
      } catch (err) {
        console.error(`[user-intent] Hierarchy generation failed for ${audience.audience_key}:`, err.message);
        return null;
      }
      if (!dimensions) return null;

      const insights = await generateDimensionInsights(dimensions);
      const versionHash = hashDimensions(dimensions);
      const changedDimensions = detectChangedDimensions(cached, dimensions);

      const profile = {
        audience_key: audience.audience_key,
        generated_at: now,
        version_hash: versionHash,
        previous_hash: cached?.version_hash ?? null,
        changed_dimensions: changedDimensions,
        dimensions,
        today_insights: insights
      };

      saveProfile(audience.audience_key, profile);

      if (changedDimensions.length > 0) {
        console.log(`[user-intent] Changed: ${changedDimensions.join(", ")} for ${audience.audience_key}`);
        await pushToMarble(profileClient, audience, profile);
      }

      console.log(`[user-intent] Profile complete for ${audience.audience_key} (${versionHash})`);
      return profile;
    },

    async extractFullMatrix(audience, profileClient, repository) {
      const start = Date.now();
      const extractedAt = nowIso();
      const today = extractedAt.slice(0, 10);

      const kgContext = await pullKGContext(profileClient);
      const compressedKG = compressKG(kgContext) || buildAudienceFallbackKG(audience);

      const yesterdayDate = new Date(new Date(extractedAt).getTime() - 86_400_000).toISOString().slice(0, 10);
      let yesterdayCells = [];
      try {
        yesterdayCells = await repository.listIntentMatrix(audience.id, { date: yesterdayDate }) ?? [];
      } catch { yesterdayCells = []; }
      const yesterdayMap = new Map(yesterdayCells.map(c => [`${c.domain}/${c.horizon}`, c]));

      const cellSpecs = DOMAINS.flatMap(domain => HORIZONS.map(horizon => ({ domain, horizon })));
      let dataSparseCount = 0;
      let diffCount = 0;

      const BATCH_SIZE = 8;
      for (let i = 0; i < cellSpecs.length; i += BATCH_SIZE) {
        const batch = cellSpecs.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ({ domain, horizon }) => {
          const yesterdayCell = yesterdayMap.get(`${domain}/${horizon}`) ?? null;
          const result = await extractCell(domain, horizon, compressedKG, yesterdayCell);
          const isSparse = result.status === "data_sparse";

          await repository.createIntentCell(audience.id, {
            extracted_at: extractedAt,
            horizon,
            domain,
            goals: result.goals ?? [],
            desires: result.desires ?? [],
            fears: result.fears ?? [],
            anti_goals: result.anti_goals ?? [],
            needs: result.needs ?? [],
            relevant_to_know: result.relevant_to_know ?? [],
            status: isSparse ? "data_sparse" : "normal",
            raw_response: result
          });

          if (isSparse) {
            dataSparseCount++;
            await repository.createDataGap(audience.id, {
              field_path: `${domain}/${horizon}`,
              gap_description: "No KG signal for this cell"
            });
          } else {
            const diffResult = computeCellDiff(yesterdayCell, result);
            if (diffResult) {
              await repository.createIntentDiff(audience.id, {
                computed_at: extractedAt,
                horizon,
                domain,
                diff: diffResult.diff,
                significance_score: diffResult.significance_score
              });
              diffCount++;
            }
          }
        }));
      }

      try {
        const allCells = await repository.listIntentMatrix(audience.id, { date: today });
        const matrixPath = path.join(cacheRoot, `intent-matrix-${audience.audience_key}-${today}.json`);
        fs.mkdirSync(cacheRoot, { recursive: true });
        fs.writeFileSync(matrixPath, JSON.stringify(allCells, null, 2), "utf8");
      } catch { /* non-critical backup */ }

      try {
        await repository.flushIntentToProfile(audience.id);
      } catch { /* non-critical — Supabase audience update */ }

      return { cells: cellSpecs.length, data_sparse: dataSparseCount, diffs: diffCount, elapsed_ms: Date.now() - start };
    },

    buildIntentContext(profile) {
      if (!profile?.dimensions) return "";
      const lines = ["\n=== USER INTENT PROFILE ==="];
      for (const dim of DIMENSIONS) {
        const today = profile.dimensions[dim]?.today;
        const week = profile.dimensions[dim]?.this_week;
        const insight = profile.today_insights?.[dim];
        if (!today) continue;
        lines.push(`\n[${dim.toUpperCase()}]`);
        lines.push(`  Goal today: ${today.goal}`);
        lines.push(`  Anti-goal: ${today.anti_goal}`);
        if (week?.goal) lines.push(`  This week: ${week.goal}`);
        if (insight?.insight) lines.push(`  Today's signal: ${insight.insight}`);
        if (insight?.why_relevant) lines.push(`  Why relevant: ${insight.why_relevant}`);
      }
      return lines.join("\n");
    }
  };
}
