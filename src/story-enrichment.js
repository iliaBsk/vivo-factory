// Story enrichment: KG-driven insight selection + narration.
// Runs after content-fetcher creates approved stories; transitions them to ready_to_publish.

const CATEGORY_SLOT_TARGETS = { news: 5, local_event: 3, product: 2 };

const FALLBACK_PERSONA = "Male, early 40s, Suzhou-based. China tech/VC insider, ultramarathon runner, geopolitics obsessive. Reads deeply, travels frequently, schedules tightly.";

function deriveCta(storyType) {
  if (storyType === "local_event") return "RSVP";
  if (storyType === "product") return "Check it out";
  return "Read full analysis";
}

function buildKGContext(summaryEnvelope, debugEnvelope) {
  const summary = summaryEnvelope?.data ?? summaryEnvelope ?? {};
  const debug = debugEnvelope?.data ?? debugEnvelope ?? {};
  const merged = { ...summary, ...debug };

  const parts = [];

  const location = merged.location ?? merged.current_location ?? merged.city;
  if (location) parts.push(`Current location: ${typeof location === "string" ? location : JSON.stringify(location)}`);

  const travel = merged.upcoming_travel ?? merged.travel_plans ?? merged.travel;
  if (travel && (Array.isArray(travel) ? travel.length > 0 : travel)) {
    parts.push(`Upcoming travel: ${JSON.stringify(travel)}`);
  }

  const schedule = merged.schedule ?? merged.routine ?? merged.weekly_pattern;
  if (schedule) parts.push(`Schedule patterns: ${JSON.stringify(schedule)}`);

  const family = merged.family ?? merged.personal ?? merged.household;
  if (family) parts.push(`Family/personal: ${JSON.stringify(family)}`);

  const interests = merged.interests ?? merged.topics ?? merged.top_topics ?? merged.categories;
  if (interests) parts.push(`Top interests: ${JSON.stringify(interests)}`);

  const goals = merged.goals ?? merged.objectives;
  if (goals) parts.push(`Goals: ${JSON.stringify(goals)}`);

  const beliefs = merged.beliefs ?? merged.values;
  if (beliefs) parts.push(`Beliefs: ${JSON.stringify(beliefs)}`);

  const portfolio = merged.portfolio ?? merged.investments ?? merged.companies;
  if (portfolio) parts.push(`Portfolio/investments: ${JSON.stringify(portfolio)}`);

  const recent = merged.recent_decisions ?? merged.recent_activity ?? merged.recent_signals;
  if (recent && (Array.isArray(recent) ? recent.length > 0 : recent)) {
    parts.push(`Recent signals: ${JSON.stringify(recent)}`);
  }

  return parts.join("\n") || null;
}

const DAILY_QUESTIONS_SYSTEM = `You are a personal intelligence assistant. Given a person's Knowledge Graph, generate the 3 most important questions they would want answered today — one per category.

Be specific to this person's actual situation: their location, schedule, portfolio, ongoing concerns, upcoming events. Not generic. Not what a typical person in their field would ask — what THIS person, TODAY, given what you know about them.

Return JSON only:
{
  "news": "<one precise question about what this person needs to know in the world today — developments, opportunities, risks>",
  "events": "<one precise question about events, opportunities, or actions they should take based on their location, travel plans, schedule, and interests>",
  "products": "<one precise question about tools, products, or resources that would genuinely benefit them right now given what they're working on>"
}`;

function buildIntentContextFromMatrix(cells, diffs) {
  if (!cells?.length) return "";
  const ORDERED_DOMAINS = ["topics", "personal", "health", "career", "family", "social", "heritage", "wealth"];
  const byKey = new Map(cells.map(c => [`${c.domain}/${c.horizon}`, c]));
  const lines = ["\n=== INTENT MATRIX ==="];

  for (const domain of ORDERED_DOMAINS) {
    const todayCell = byKey.get(`${domain}/today`);
    if (!todayCell || todayCell.status === "data_sparse") continue;
    const topGoal = todayCell.goals?.[0]?.text;
    if (!topGoal) continue;
    lines.push(`\n[${domain.toUpperCase()}]`);
    lines.push(`  Goal today: ${topGoal}`);
    const topAnti = todayCell.anti_goals?.[0]?.text;
    if (topAnti) lines.push(`  Anti-goal: ${topAnti}`);
    const topFear = todayCell.fears?.[0]?.text;
    if (topFear) lines.push(`  Fear: ${topFear}`);
    const weekGoal = byKey.get(`${domain}/this_week`)?.goals?.[0]?.text;
    if (weekGoal) lines.push(`  This week: ${weekGoal}`);
    const relevant = todayCell.relevant_to_know?.[0]?.text;
    if (relevant) lines.push(`  Relevant today: ${relevant}`);
  }

  if (diffs?.length > 0) {
    lines.push("\n=== PRIORITY SIGNALS (recent high-significance shifts) ===");
    for (const diff of diffs.slice(0, 5)) {
      const entries = Object.entries(diff.diff ?? {});
      if (entries.length === 0) continue;
      const [field, change] = entries[0];
      const added = change.added?.[0] ?? "";
      if (added) lines.push(`  ${diff.domain}/${diff.horizon} — new ${field}: "${added}"`);
    }
  }

  return lines.join("\n");
}

function candidateList(stories) {
  return stories.map(s =>
    `id=${s.id}\ntitle: ${s.title}\nsummary: ${(s.story_text ?? s.summary ?? "").slice(0, 300)}\nsource: ${s.source_name ?? ""}`
  ).join("\n\n---\n\n");
}

function newsSelectionPrompt(kgContext, dailyQuestion, candidates) {
  const question = dailyQuestion ?? "What does this person most need to know today in the world of tech, VC, geopolitics, and macro?";
  return {
    system: `You are the editorial intelligence behind VIVO, a ruthlessly personalised daily briefing.

PERSON'S LIVE KNOWLEDGE GRAPH:
${kgContext ?? FALLBACK_PERSONA}

TODAY'S QUESTION FOR THIS PERSON:
"${question}"

Your job: find which of these candidates best answer that question for this person today.
Score each for: how directly it answers their question (0.5) + temporal urgency (0.3) + novelty to them (0.2).
Reject: generic takes, stories their networks already circulated, anything that doesn't move the needle on their actual question.

For each selected: "why_today" = one sentence on exactly how this answers their question and affects their world.

Return JSON only:
{"selected":[{"id":"<id>","score":0.0,"why_today":"<one sentence>"}]}`,
    user: `News candidates:\n\n${candidateList(candidates)}`
  };
}

function eventsSelectionPrompt(kgContext, dailyQuestion, candidates) {
  const question = dailyQuestion ?? "What events or opportunities should this person act on in their location today?";
  return {
    system: `You are the editorial intelligence behind VIVO, a ruthlessly personalised daily briefing.

PERSON'S LIVE KNOWLEDGE GRAPH:
${kgContext ?? FALLBACK_PERSONA}

TODAY'S QUESTION FOR THIS PERSON:
"${question}"

Your job: find which of these candidates best answer that question.
Prioritise events in their current location and upcoming travel destinations.
If their schedule shows family/weekend time → kid-friendly events rank higher.
Reject events older than 2 days unless there's an imminent related deadline.

For each: "why_today" = the specific action they should take (buy ticket, RSVP, register, note the deadline).

Return JSON only:
{"selected":[{"id":"<id>","score":0.0,"why_today":"<one sentence — the action>"}]}`,
    user: `Event candidates:\n\n${candidateList(candidates)}`
  };
}

function productsSelectionPrompt(kgContext, dailyQuestion, candidates) {
  const question = dailyQuestion ?? "What tools, products, or resources would genuinely benefit this person right now?";
  return {
    system: `You are the editorial intelligence behind VIVO, a ruthlessly personalised daily briefing.

PERSON'S LIVE KNOWLEDGE GRAPH:
${kgContext ?? FALLBACK_PERSONA}

TODAY'S QUESTION FOR THIS PERSON:
"${question}"

Your job: find which candidates best answer that question.
Must be accessible from their location (China-available or international shipping/VPN).
Actionability matters: launch price, limited window, directly relevant to their current work or goals.
Reject anything they'd already know about or that doesn't match their actual situation.

For each: "why_today" = the specific reason to act now (timing, fit with their current goals, discount, etc.).

Return JSON only:
{"selected":[{"id":"<id>","score":0.0,"why_today":"<one sentence — the buying trigger>"}]}`,
    user: `Product candidates:\n\n${candidateList(candidates)}`
  };
}

// ── Exported pure helpers (also used by tests) ───────────────────────────────

export const REGISTER_VOICE = {
  informative: "Dry, factual, insider-level. One weirdly specific detail that earns trust. No adjectives that don't carry weight.",
  inspiring:   "Prove that a trend this person cares about is accelerating. End on momentum, not a recap.",
  alert:       "Name the specific threat or risk. Concrete implications only. No hedging, no reassurance.",
  entertaining:"Find the genuinely unexpected or absurd angle. One observation that earns a raised eyebrow.",
  reflective:  "Connect this to a bigger pattern. Raise the implicit question. Don't answer it.",
  actionable:  "Give the single most important next action. Specifics: date, place, what to do. Nothing else.",
  comforting:  "Validate the reader's existing thesis. Confirm the signal they've been watching for.",
  curious:     "Drop one fact that opens a bigger question. End on the open thread, not the answer.",
};

export function assignRegister(storyType, marbleMeta) {
  if (storyType === "local_event") return "actionable";
  if (storyType === "product") {
    return (marbleMeta?.dimension_scores?.surprise_score ?? 0) > 0.5 ? "curious" : "actionable";
  }
  const ds = marbleMeta?.dimension_scores ?? {};
  const surprise = ds.surprise_score ?? 0;
  const insight  = ds.insight_density ?? 0;
  const depth    = ds.personalization_depth ?? 0;
  const temporal = ds.temporal_relevance ?? 0;
  if (surprise > 0.55)               return "curious";
  if (temporal > 0.65 && depth > 0.45) return "alert";
  if (insight > 0.55)                return "reflective";
  if (depth > 0.65)                  return "inspiring";
  return "informative";
}

const GUARDRAIL_PATTERNS = [
  { pattern: /\b(you should (invest|buy|sell|short|long))\b/i, flag: "financial_advice" },
  { pattern: /\b(guaranteed|risk-free|100% safe)\b/i,          flag: "false_claim" },
  { pattern: /\b(vote for|elect|support [A-Z][a-z]+ for)\b/i,  flag: "political_opinion" },
  { pattern: /\b(cure[sd]?|treats?|heals?|eliminates? [a-z]+ disease)\b/i, flag: "medical_claim" },
];

export function runGuardrails(text, excludedTopics = []) {
  const flags = [];
  for (const { pattern, flag } of GUARDRAIL_PATTERNS) {
    if (pattern.test(text)) flags.push(flag);
  }
  for (const topic of excludedTopics) {
    if (topic && text.toLowerCase().includes(topic.toLowerCase())) {
      flags.push(`excluded_topic:${topic}`);
    }
  }
  return flags;
}

export function createStoryEnrichmentService({ repository, fetchImpl, envConfig, clock, userIntentService }) {
  const apiKey = envConfig?.OPENAI_API_KEY ?? "";
  const model = envConfig?.OPENAI_MODEL ?? envConfig?.LLM_MODEL ?? "gpt-4o-mini";
  const baseUrl = String(envConfig?.OPENAI_BASE_URL ?? envConfig?.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const nowIso = clock ?? (() => new Date().toISOString());

  async function llmJson(systemPrompt, userContent) {
    if (!apiKey) return null;
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.4,
        max_completion_tokens: 2000
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
      const [summaryResult, debugResult] = await Promise.allSettled([
        profileClient.getSummary(),
        profileClient.getDebug()
      ]);
      const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
      const debug = debugResult.status === "fulfilled" ? debugResult.value : null;
      return buildKGContext(summary, debug);
    } catch {
      return null;
    }
  }

  async function runMarbleFilter(gptStories, profileClient, category) {
    if (!profileClient || gptStories.length === 0) return gptStories;
    try {
      const items = gptStories.map(({ story }) => ({
        id: story.id,
        title: story.title ?? "",
        topics: story.metadata?.topics ?? story.metadata?.tags ?? [],
        source: story.source_name ?? ""
      }));
      const result = await profileClient.selectItems(items, { category, use_case: 'daily_briefing' });
      const scoredItems = result?.data?.selected ?? result?.data?.items ?? result?.items ?? [];
      if (scoredItems.length === 0) return gptStories;
      const marbleMeta = new Map(scoredItems.map(i => [i.id, i]));
      return gptStories
        .map(entry => {
          const meta = marbleMeta.get(entry.story.id);
          const marbleScore = meta?.score ?? 0;
          return {
            ...entry,
            combinedScore: (entry.gptScore * 0.5) + (marbleScore * 0.5),
            marbleMeta: meta ?? null,
          };
        })
        .sort((a, b) => b.combinedScore - a.combinedScore);
    } catch (err) {
      console.error(`[enrichment] Marble selectItems error (${category}):`, err.message);
      return gptStories;
    }
  }

  async function generateDailyQuestions(kgContext) {
    if (!kgContext) return { news: null, events: null, products: null };
    try {
      const result = await llmJson(
        DAILY_QUESTIONS_SYSTEM,
        `Knowledge Graph:\n${kgContext}\n\nToday's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`
      );
      return {
        news: result?.news ?? null,
        events: result?.events ?? null,
        products: result?.products ?? null
      };
    } catch (err) {
      console.error("[enrichment] Daily question generation failed:", err.message);
      return { news: null, events: null, products: null };
    }
  }

  async function selectCategory(candidates, prompt, profileClient, category, targetCount) {
    if (candidates.length === 0) return [];
    const { system, user } = prompt;
    let raw;
    try {
      const result = await llmJson(system, user);
      raw = result?.selected ?? [];
    } catch (err) {
      console.error(`[enrichment] GPT selection failed for ${category}:`, err.message);
      return [];
    }

    const candidateMap = new Map(candidates.map(s => [s.id, s]));
    const gptStories = raw
      .filter(item => candidateMap.has(item.id))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map(item => ({
        story: candidateMap.get(item.id),
        gptScore: item.score ?? 0,
        whyToday: item.why_today ?? "",
        combinedScore: item.score ?? 0
      }));

    const filtered = await runMarbleFilter(gptStories, profileClient, category);
    return filtered.slice(0, targetCount);
  }

  // ── Editor pipeline ───────────────────────────────────────────────────────

  async function runAdversarialPass(narration, register, audienceSummary) {
    if (!apiKey) return { approved: true, quality_score: 0.8, flags: [] };
    const system = `You are a ruthless quality-control editor for a personal daily briefing.
Audience: ${audienceSummary}
Assigned register: ${register}

Review the narration below for:
1. Sensationalism or clickbait
2. False or manufactured urgency
3. Unqualified factual overclaiming
4. Register mismatch (does the tone actually match "${register}"?)
5. Generic filler (phrases that could appear in any article)

Return JSON only — no commentary:
{"approved":true,"quality_score":0.0,"flags":[]}
quality_score: 0.0–1.0 (1.0 = excellent). Set approved=false if quality_score < 0.55 or any hard violations.`;

    try {
      const result = await llmJson(system, `Narration:\n${narration}`);
      return {
        approved:      result?.approved ?? true,
        quality_score: result?.quality_score ?? 0.75,
        flags:         result?.flags ?? [],
      };
    } catch {
      return { approved: true, quality_score: 0.75, flags: [] };
    }
  }

  async function runEditorStage(story, selection, audience) {
    const marbleMeta   = selection.marble_scores ?? null;
    const storyType    = selection.type ?? "news";
    const register     = assignRegister(storyType, marbleMeta);
    const voiceGuide   = REGISTER_VOICE[register];
    const excludedTopics = audience.excluded_topics ?? [];

    const narrationResult = await generateNarration(story, selection.why_today, storyType, register, voiceGuide);
    if (!narrationResult?.narration) return null;

    // Static guardrails first (cheap)
    const guardrailFlags = runGuardrails(narrationResult.narration, excludedTopics);
    const hardViolations = guardrailFlags.filter(f =>
      ["financial_advice", "medical_claim", "political_opinion", "false_claim"].includes(f)
    );
    if (hardViolations.length > 0) {
      console.log(`[editor] Hard guardrail violation in story ${story.id}: ${hardViolations.join(", ")}`);
      return null;
    }

    // Adversarial pass
    const audienceSummary = [
      audience.label ?? audience.audience_key,
      audience.location ? `based in ${audience.location}` : "",
      audience.interests?.length ? `interests: ${audience.interests.slice(0, 4).join(", ")}` : "",
    ].filter(Boolean).join(", ");

    const critique = await runAdversarialPass(narrationResult.narration, register, audienceSummary);

    if (!critique.approved) {
      console.log(`[editor] Adversarial rejection for story ${story.id} (score ${critique.quality_score}): ${critique.flags.join(", ")}`);
      return null;
    }

    return {
      narration:     narrationResult.narration,
      cta:           narrationResult.cta,
      register,
      quality_score: critique.quality_score,
      editor_flags:  [...guardrailFlags, ...critique.flags],
    };
  }

  async function generateNarration(story, whyToday, storyType, register, voiceGuide) {
    if (!apiKey) return null;

    let ctaHint = "";
    if (storyType === "local_event") {
      ctaHint = 'cta: short action verb phrase for the event (e.g. "RSVP now", "Get tickets", "Register"). Max 4 words.';
    } else if (storyType === "product") {
      ctaHint = 'cta: buying/trying action matching product type (e.g. "Check the price", "Try it free", "Get early access"). Max 5 words.';
    } else {
      ctaHint = 'cta: tease the specific insight they\'ll get (e.g. "Read the regulatory breakdown", "See the data", "Read the full analysis"). Max 5 words, never just "Read".';
    }

    const registerLine = register && voiceGuide
      ? `REGISTER: ${register.toUpperCase()} — ${voiceGuide}`
      : "VOICE: Quiet insider. Dry, not clever. One weirdly specific detail that earns trust. Ends on an implication, not a recap.";

    const systemPrompt = `You are writing a spoken post for VIVO, a ruthlessly personalised daily briefing.
This story made the cut. Write it as the reader's most trusted advisor — precise, no fluff.
${registerLine}
RULES: 3–5 sentences. No greeting, no "today", no "in conclusion". Name entities exactly. Write for the ear.
Also generate a contextual CTA (call-to-action link text) for the Telegram button.
${ctaHint}
Return JSON only: {"narration":"<3-5 sentences>","cta":"<short cta text>"}`;

    const userContent = [
      `Title: ${story.title}`,
      `Summary: ${(story.story_text ?? story.summary ?? "").slice(0, 400)}`,
      whyToday ? `Why today: ${whyToday}` : "",
      `Source: ${story.primary_source_url ?? ""}`,
      `Type: ${storyType ?? "news"}`
    ].filter(Boolean).join("\n");

    try {
      const result = await llmJson(systemPrompt, userContent);
      return {
        narration: result?.narration ?? null,
        cta: result?.cta ?? deriveCta(storyType)
      };
    } catch {
      return null;
    }
  }

  async function enrichWithKG(pending, audience, profileClient) {
    let kgContext = await pullKGContext(profileClient);
    if (kgContext) {
      console.log(`[enrichment] KG context loaded for ${audience.audience_key} (${kgContext.slice(0, 80)}...)`);
    }

    // Augment KG context with intent matrix — prefer DB, fall back to file-cached profile
    if (userIntentService || repository) {
      const today = nowIso().slice(0, 10);
      let intentContext = "";

      try {
        const cells = await repository.listIntentMatrix(audience.id, { date: today });
        if (cells?.length > 0) {
          const diffs = await repository.listIntentDiffs(audience.id, { date: today, minSignificance: 0.5 }).catch(() => []);
          intentContext = buildIntentContextFromMatrix(cells, diffs);
          console.log(`[enrichment] DB intent matrix injected for ${audience.audience_key} (${cells.length} cells, ${diffs.length} high-sig diffs)`);
        }
      } catch { /* DB not available — fall through to file cache */ }

      if (!intentContext && userIntentService) {
        const intentProfile = await userIntentService.generateIntentProfile(audience, { profileClient }).catch(err => {
          console.error("[enrichment] Intent profile generation failed:", err.message);
          return null;
        });
        intentContext = userIntentService.buildIntentContext(intentProfile) ?? "";
        if (intentContext) {
          console.log(`[enrichment] File-cached intent profile injected for ${audience.audience_key} (${(intentProfile?.changed_dimensions ?? []).length} changed dims)`);
        }
      }

      if (intentContext) kgContext = (kgContext ?? "") + intentContext;
    }

    // Generate personalized daily questions from the KG — these drive selection
    const dailyQuestions = await generateDailyQuestions(kgContext);
    if (dailyQuestions.news) {
      console.log(`[enrichment] Today's news question: ${dailyQuestions.news.slice(0, 100)}`);
    }

    const newsCandidates = pending.filter(s => {
      const cat = s.metadata?.category ?? "";
      return cat !== "local_event" && cat !== "product";
    });
    const eventCandidates = pending.filter(s => {
      const cat = s.metadata?.category ?? "";
      return cat === "local_event" || s.is_local === true;
    });
    const productCandidates = pending.filter(s => s.metadata?.category === "product");

    const [newsResult, eventsResult, productsResult] = await Promise.allSettled([
      selectCategory(
        newsCandidates,
        newsSelectionPrompt(kgContext, dailyQuestions.news, newsCandidates),
        profileClient, "news",
        CATEGORY_SLOT_TARGETS.news
      ),
      selectCategory(
        eventCandidates,
        eventsSelectionPrompt(kgContext, dailyQuestions.events, eventCandidates),
        profileClient, "local_event",
        CATEGORY_SLOT_TARGETS.local_event
      ),
      selectCategory(
        productCandidates,
        productsSelectionPrompt(kgContext, dailyQuestions.products, productCandidates),
        profileClient, "product",
        CATEGORY_SLOT_TARGETS.product
      )
    ]);

    const allSelected = [
      ...(newsResult.status === "fulfilled" ? newsResult.value : []),
      ...(eventsResult.status === "fulfilled" ? eventsResult.value : []),
      ...(productsResult.status === "fulfilled" ? productsResult.value : [])
    ];

    return allSelected.map(({ story, whyToday, gptScore, marbleMeta }) => ({
      id: story.id,
      type: story.metadata?.category ?? "news",
      score: gptScore,
      why_today: whyToday,
      marble_scores: marbleMeta ? {
        score: marbleMeta.score,
        dimension_scores: marbleMeta.dimension_scores ?? null,
        popularity_score: marbleMeta.popularity_score ?? null,
        entity_affinity: marbleMeta.entity_affinity ?? null,
      } : null,
    }));
  }

  async function enrichWithStaticPrompt(pending) {
    const INSIGHT_SYSTEM = `You are the editorial intelligence behind VIVO, a ruthlessly personalised daily briefing for Chontang.

WHO IS CHONTANG: ${FALLBACK_PERSONA}

STEP 1 — CLASSIFY each candidate: news | local_event | product
STEP 2 — SCORE within each category
STEP 3 — SELECT exactly: 5 news + 3 local_event + 2 product = 10 total
STEP 4 — For each: write "why_today" — WHY this person needs this TODAY

Return JSON only:
{"selected":[{"id":"<id>","type":"news|local_event|product","score":0.0,"why_today":"<one sentence>"}]}`;

    const candidatesText = pending.map(s =>
      `id=${s.id}\ntitle: ${s.title}\nsummary: ${(s.story_text ?? s.summary ?? "").slice(0, 300)}\ncategory: ${s.metadata?.category ?? "unknown"}\nis_local: ${s.is_local ?? false}`
    ).join("\n\n---\n\n");

    const result = await llmJson(INSIGHT_SYSTEM, `Today's story candidates:\n\n${candidatesText}`);
    const raw = result?.selected ?? [];

    const byType = {};
    for (const item of raw) {
      const type = item.type ?? "news";
      if (!byType[type]) byType[type] = [];
      byType[type].push(item);
    }
    const enforced = [];
    for (const [type, target] of Object.entries(CATEGORY_SLOT_TARGETS)) {
      const slots = (byType[type] ?? [])
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, target);
      enforced.push(...slots);
    }
    return enforced;
  }

  return {
    async enrichPending(audience, { profileClient } = {}) {
      if (!apiKey) {
        console.log("[enrichment] No LLM API key configured — skipping enrichment");
        return { enriched: 0, skipped: 0 };
      }

      const allStories = await repository.listStories({ audience_id: audience.id });
      const ENRICHABLE = new Set(["new", "classified", "media_decided"]);
      const pending = allStories.filter(s =>
        s.operator_review_status !== "rejected" &&
        ENRICHABLE.has(s.status) &&
        !s.metadata?.enriched
      ).slice(0, 20);

      if (pending.length === 0) return { enriched: 0, skipped: 0 };

      let selected;
      try {
        selected = profileClient
          ? await enrichWithKG(pending, audience, profileClient)
          : await enrichWithStaticPrompt(pending);
      } catch (err) {
        console.error("[enrichment] Selection failed:", err.message);
        return { enriched: 0, skipped: pending.length };
      }

      const selectionMap = new Map(selected.map(s => [s.id, s]));
      const ts = nowIso();

      for (const story of pending) {
        if (!selectionMap.has(story.id)) {
          await repository.submitStoryReview(story.id, {
            review_status: "rejected",
            review_notes: "not selected by editorial AI",
            actor_id: "story-enrichment",
            timestamp: ts
          }).catch(() => {});
        }
      }

      let enriched = 0;

      for (const story of pending) {
        const selection = selectionMap.get(story.id);
        if (!selection) continue;

        try {
          const editorResult = await runEditorStage(story, selection, audience);
          if (!editorResult?.narration) continue;

          await repository.updateStory(story.id, {
            story_text: editorResult.narration,
            summary: editorResult.narration.slice(0, 200),
            metadata: {
              ...story.metadata,
              enriched: true,
              why_today: selection.why_today,
              story_type: selection.type,
              editorial_score: selection.score,
              cta_text: editorResult.cta,
              register: editorResult.register,
              quality_score: editorResult.quality_score,
              editor_flags: editorResult.editor_flags,
              ...(selection.marble_scores ? { marble_scores: selection.marble_scores } : {})
            }
          }, { actorId: "story-enrichment", timestamp: ts });

          // Use markStoryApproved so story stays 'new' for N8N 991 classification.
          // submitStoryReview would auto-transition to ready_to_publish, bypassing asset generation.
          await repository.markStoryApproved(story.id, { actorId: "story-enrichment" });

          enriched++;
        } catch (err) {
          console.error(`[enrichment] Failed to enrich story ${story.id}:`, err.message);
        }
      }

      console.log(`[enrichment] Enriched ${enriched}/${selected.length} selected from ${pending.length} pending for ${audience.audience_key}`);
      return { enriched, skipped: pending.length - enriched };
    }
  };
}
