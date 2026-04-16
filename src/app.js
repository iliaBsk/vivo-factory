import {
  TREMOR_DASHBOARD_FRAMEWORK,
  renderTremorBadge,
  renderTremorCard,
  renderTremorFrameworkMeta,
  renderTremorMetric,
  renderTremorTabs
} from "./tremor-dashboard.js";

export function createApp(options) {
  const repository = options.repository;
  const instanceManager = options.instanceManager ?? null;
  const profileClientFactory = options.profileClientFactory ?? null;
  const setupService = options.setupService ?? null;
  const audienceImportService = options.audienceImportService ?? null;
  const audienceManagerLauncher = options.audienceManagerLauncher ?? null;
  const publicationTargetResolver = options.publicationTargetResolver ?? (() => null);
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    async handle(request) {
      try {
        return await handleRequest({
          repository,
          instanceManager,
          profileClientFactory,
          setupService,
          audienceImportService,
          audienceManagerLauncher,
          publicationTargetResolver,
          clock,
          request
        });
      } catch (error) {
        return json(500, { error: error.message });
      }
    }
  };
}

async function handleRequest(context) {
  const {
    repository,
    instanceManager,
    profileClientFactory,
    setupService,
    audienceImportService,
    audienceManagerLauncher,
    publicationTargetResolver,
    clock,
    request
  } = context;

  if (request.method === "GET" && request.pathname === "/api/setup") {
    return json(200, setupService ? await setupService.getStatus() : defaultSetupStatus());
  }

  if (request.method === "GET" && request.pathname === "/api/audience-source") {
    if (!audienceImportService) {
      return json(404, { error: "Audience import is not configured." });
    }
    return json(200, await audienceImportService.getSource());
  }

  if (request.method === "POST" && request.pathname === "/api/audiences/import-preview") {
    if (!audienceImportService) {
      return json(404, { error: "Audience import is not configured." });
    }
    return json(200, await audienceImportService.previewImport());
  }

  if (request.method === "POST" && request.pathname === "/api/audiences/import-confirm") {
    if (!audienceImportService) {
      return json(404, { error: "Audience import is not configured." });
    }
    const body = readBody(request.body);
    return json(200, await audienceImportService.confirmImport(body.items ?? []));
  }

  if (request.method === "POST" && request.pathname === "/api/audiences/create") {
    if (!audienceImportService?.createAudience) {
      return json(404, { error: "Audience creation is not configured." });
    }
    const body = readBody(request.body);
    return json(200, await audienceImportService.createAudience(body));
  }

  if (request.method === "GET" && request.pathname === "/api/instances") {
    return json(200, { items: instanceManager ? instanceManager.listInstances() : [] });
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/instances\/([^/]+)\/commands$/)) {
    ensureInstanceManager(instanceManager);
    const audienceId = request.pathname.split("/")[3];
    return json(200, { commands: instanceManager.getInstanceCommands(audienceId) });
  }

  if (request.method === "GET" && request.pathname === "/api/stories") {
    const items = await repository.listStories(normalizeStoryFilters(request.query));
    return json(200, { items });
  }

  if (request.method === "GET" && request.pathname === "/api/audiences") {
    const items = await repository.listAudiences();
    return json(200, { items });
  }

  if (request.method === "GET" && request.pathname === "/api/analytics") {
    return json(200, { items: await repository.listFeedbackEvents() });
  }

  if (request.method === "GET" && request.pathname === "/api/audit") {
    return json(200, { items: await repository.listAuditLog() });
  }

  if (request.method === "GET" && request.pathname === "/api/deployments") {
    return json(200, { items: await repository.listDeployments() });
  }

  if (request.method === "GET" && request.pathname === "/api/operator-chats") {
    return json(200, { items: await repository.listOperatorChats() });
  }

  if (request.method === "GET" && request.pathname === "/api/instance-reports") {
    return json(200, { items: await repository.listInstanceReports() });
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/stories\/([^/]+)$/)) {
    const storyId = request.pathname.split("/")[3];
    const story = await repository.getStory(storyId);
    return story ? json(200, story) : json(404, { error: "Story not found" });
  }

  if (request.method === "PUT" && matchPath(request.pathname, /^\/api\/stories\/([^/]+)$/)) {
    const storyId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const story = await repository.updateStory(storyId, body.changes ?? {}, {
      actorId: body.actor_id ?? "unknown",
      timestamp: clock()
    });
    return json(200, story);
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/stories\/([^/]+)\/reviews$/)) {
    const storyId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const story = await repository.getStory(storyId);
    if (!story) {
      return json(404, { error: "Story not found" });
    }
    const selectedAssetId = body.selected_asset_id ?? story.selected_asset_id ?? null;
    if (body.review_status === "approved" && !selectedAssetId) {
      return json(409, { error: "An approved review requires a selected asset." });
    }
    const review = await repository.submitStoryReview(storyId, {
      review_status: body.review_status ?? "pending",
      review_notes: body.review_notes ?? "",
      actor_id: body.actor_id ?? "unknown",
      selected_asset_id: selectedAssetId,
      payload: body.payload ?? {},
      created_at: clock()
    });
    return json(200, review);
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/stories\/([^/]+)\/assets\/([^/]+)\/select$/)) {
    const [, , , storyId, , assetId] = request.pathname.split("/");
    const body = readBody(request.body);
    const asset = await repository.selectStoryAsset(storyId, assetId, {
      actorId: body.actor_id ?? "unknown",
      timestamp: clock()
    });
    return json(200, asset);
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/stories\/([^/]+)\/assets\/([^/]+)\/replace$/)) {
    const [, , , storyId, , assetId] = request.pathname.split("/");
    const body = readBody(request.body);
    const asset = await repository.replaceStoryAsset(storyId, assetId, body, {
      actorId: body.actor_id ?? "unknown",
      bucketName: body.bucket_name,
      timestamp: clock()
    });
    return json(200, asset);
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/stories\/([^/]+)\/publications$/)) {
    const storyId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    if (body.selected_asset_id) {
      await repository.selectStoryAsset(storyId, body.selected_asset_id, {
        actorId: body.actor_id ?? "unknown",
        timestamp: clock()
      });
    }

    const story = await repository.getStory(storyId);
    if (!story) {
      return json(404, { error: "Story not found" });
    }
    if (story.status !== "ready_to_publish") {
      return json(409, { error: "Story must be ready_to_publish before queueing publication." });
    }
    if (story.operator_review_status !== "approved") {
      return json(409, { error: "Story must be operator-approved before queueing publication." });
    }

    const selectedAssetId = story.selected_asset_id ?? body.selected_asset_id ?? null;
    if (!selectedAssetId) {
      return json(409, { error: "A selected asset is required before queueing publication." });
    }

    const target = publicationTargetResolver(story.audience, story);
    if (!target?.channel || !target?.target_identifier) {
      return json(409, { error: "No publication target is configured for this audience." });
    }

    const publication = await repository.queueStoryPublication(storyId, {
      asset_id: selectedAssetId,
      channel: target.channel,
      target_identifier: target.target_identifier,
      publish_payload: {
        mode: "manual_queue",
        story_title: story.title,
        story_summary: story.summary
      }
    }, {
      actorId: body.actor_id ?? "unknown",
      timestamp: clock()
    });
    return json(200, publication);
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)$/)) {
    const audienceId = request.pathname.split("/")[3];
    const audience = await repository.getAudience(audienceId);
    return audience ? json(200, audience) : json(404, { error: "Audience not found" });
  }

  if (request.method === "PUT" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)$/)) {
    const audienceId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const audience = await repository.updateAudience(audienceId, body.changes ?? {}, {
      actorId: body.actor_id ?? body.operator ?? "unknown",
      timestamp: clock()
    });
    return json(200, audience);
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/profile-summary$/)) {
    const audienceId = request.pathname.split("/")[3];
    const profileClient = await resolveProfileClient({ repository, profileClientFactory, audienceId });
    if (!profileClient) {
      return json(404, { error: "Audience Marble profile is not configured." });
    }
    const summary = await profileClient.getSummary();
    return json(200, summary.data ?? {});
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/profile-debug$/)) {
    const audienceId = request.pathname.split("/")[3];
    const profileClient = await resolveProfileClient({ repository, profileClientFactory, audienceId });
    if (!profileClient?.getDebug) {
      return json(404, { error: "Audience Marble debug view is not configured." });
    }
    const debug = await profileClient.getDebug();
    return json(200, debug.data ?? {});
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/profile-facts$/)) {
    const audienceId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const audience = await repository.getAudience(audienceId);
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const profileClient = await resolveProfileClient({ repository, profileClientFactory, audienceId, audience });
    if (!profileClient?.updateFacts) {
      return json(404, { error: "Audience Marble profile is not configured." });
    }

    const facts = normalizeAudienceProfileFacts(audience, body.facts ?? body);
    await repository.updateAudience(audienceId, buildAudienceChangesFromFacts(facts), {
      actorId: body.actor_id ?? body.operator ?? "unknown",
      timestamp: clock()
    });
    const summary = await profileClient.updateFacts(facts);
    return json(200, summary.data ?? {});
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/profile-decisions$/)) {
    const audienceId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const audience = await repository.getAudience(audienceId);
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const profileClient = await resolveProfileClient({ repository, profileClientFactory, audienceId, audience });
    if (!profileClient?.storeDecision) {
      return json(404, { error: "Audience Marble profile is not configured." });
    }

    const result = await profileClient.storeDecision({
      decisionType: body.decisionType ?? body.decision_type ?? "operator_feedback",
      source: body.source ?? "dashboard",
      content: body.content ?? {},
      recorded_at: body.recorded_at ?? clock()
    });
    return json(200, result.data ?? {});
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/launch$/)) {
    if (!audienceManagerLauncher) {
      return json(404, { error: "Audience manager launch is not configured." });
    }
    const audienceId = request.pathname.split("/")[3];
    const audience = await repository.getAudience(audienceId);
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const body = readBody(request.body);
    const requestedRuntimeConfig = normalizeLaunchRuntimeConfig(body.runtime_config ?? {});
    let instance = await repository.getInstanceByAudience(audienceId);
    if (!instance) {
      if (!repository.createInstanceForAudience) {
        return json(409, { error: "Audience instance creation is not supported by this repository." });
      }
      instance = await repository.createInstanceForAudience(audience, buildAudienceInstance(audience, requestedRuntimeConfig), {
        actorId: body.operator ?? body.actor_id ?? "unknown",
        timestamp: clock()
      });
    } else {
      instance = {
        ...instance,
        openclaw_admin_url: requestedRuntimeConfig.openclaw_admin_url ?? instance.openclaw_admin_url ?? "",
        profile_base_url: requestedRuntimeConfig.profile_base_url ?? requestedRuntimeConfig.plugin_base_url ?? instance.profile_base_url ?? "",
        runtime_config: {
          ...(instance.runtime_config ?? {}),
          ...requestedRuntimeConfig
        }
      };
    }
    const result = await audienceManagerLauncher.launchAudienceManager(audience, instance, {
      operator: body.operator ?? body.actor_id ?? "unknown",
      timestamp: clock(),
      runtime_config: requestedRuntimeConfig
    });
    if (repository.updateInstance && result.instance_update) {
      await repository.updateInstance(instance.id, result.instance_update, {
        actorId: body.operator ?? body.actor_id ?? "unknown",
        timestamp: clock()
      });
    }
    repository.saveDeploymentResult({
      audience_id: audienceId,
      operator: body.operator ?? body.actor_id ?? "unknown",
      timestamp: clock(),
      result
    });
    return json(200, result);
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/instances\/([^/]+)\/health$/)) {
    ensureInstanceManager(instanceManager);
    const audienceId = request.pathname.split("/")[3];
    return json(200, await instanceManager.getInstanceHealth(audienceId));
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/instances\/([^/]+)\/report$/)) {
    ensureInstanceManager(instanceManager);
    const audienceId = request.pathname.split("/")[3];
    const report = await instanceManager.getInstanceReport(audienceId);
    repository.saveInstanceReport({
      audience_id: audienceId,
      timestamp: clock(),
      report
    });
    return json(200, report);
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/instances\/([^/]+)\/logs$/)) {
    ensureInstanceManager(instanceManager);
    const audienceId = request.pathname.split("/")[3];
    const tail = Number(request.query?.tail ?? "200");
    return json(200, await instanceManager.getInstanceLogs(audienceId, { tail }));
  }

  if (request.method === "POST" && request.pathname === "/api/instances/deploy") {
    ensureInstanceManager(instanceManager);
    const body = readBody(request.body);
    const deployment = await instanceManager.deployAll();
    repository.saveDeploymentResult({
      audience_id: "all",
      operator: body.operator ?? body.actor_id ?? "unknown",
      timestamp: clock(),
      result: deployment
    });
    return json(200, deployment);
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/instances\/([^/]+)\/deploy$/)) {
    ensureInstanceManager(instanceManager);
    const audienceId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const deployment = await instanceManager.deployInstance(audienceId);
    repository.saveDeploymentResult({
      audience_id: audienceId,
      operator: body.operator ?? body.actor_id ?? "unknown",
      timestamp: clock(),
      result: deployment
    });
    return json(200, deployment);
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/instances\/([^/]+)\/chat$/)) {
    ensureInstanceManager(instanceManager);
    const audienceId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const reply = await instanceManager.chatWithInstance(audienceId, {
      operator: body.operator ?? body.actor_id ?? "unknown",
      message: body.message ?? ""
    });
    repository.saveOperatorChat({
      audience_id: audienceId,
      operator: body.operator ?? body.actor_id ?? "unknown",
      message: body.message ?? "",
      response: reply,
      timestamp: clock()
    });
    return json(200, reply);
  }

  if (request.method === "GET" && request.pathname === "/") {
    const filters = normalizeStoryFilters(request.query);
    const activeTab = normalizeDashboardTab(request.query);
    const setupStatus = setupService ? await setupService.getStatus() : defaultSetupStatus();
    const shouldSkipStoryData = shouldSkipStoryDataLoad(setupStatus);
    let audienceImportPreview = null;
    if (activeTab === "setup" && audienceImportService) {
      try {
        audienceImportPreview = audienceImportService.getImportStatus
          ? await audienceImportService.getImportStatus()
          : await audienceImportService.previewImport();
      } catch (error) {
        audienceImportPreview = { error: error.message, items: [], import_required: false };
      }
    }
    const audiences = await safeLoad(() => repository.listAudiences(), []);
    const audienceInstances = repository.listInstances && activeTab === "audiences" ? await safeLoad(() => repository.listInstances(), []) : [];
    const audienceProfiles = activeTab === "audiences"
      ? await loadAudienceProfiles(audiences, audienceInstances, profileClientFactory)
      : new Map();
    const stories = shouldSkipStoryData || activeTab !== "stories"
      ? []
      : (await safeLoad(() => repository.listStories(filters), [])).map((story) => ({
          ...story,
          publication_target: publicationTargetResolver(story.audience, story)
        }));
    const selectedStoryId = request.query?.story_id || "";
    const activeStoryRaw = shouldSkipStoryData || !selectedStoryId
      ? null
      : await safeLoad(() => repository.getStory(selectedStoryId), null);
    const activeStory = activeStoryRaw
      ? {
          ...activeStoryRaw,
          publication_target: publicationTargetResolver(activeStoryRaw.audience, activeStoryRaw)
        }
      : null;
    const auditItems = shouldSkipStoryData || activeTab !== "stories" ? [] : (await safeLoad(() => repository.listAuditLog(), [])).slice(0, 10);
    const analyticsItems = shouldSkipStoryData || activeTab !== "stories" ? [] : (await safeLoad(() => repository.listFeedbackEvents(), [])).slice(0, 10);
    const instances = instanceManager && activeTab === "audiences" ? instanceManager.listInstances() : [];
    return html(200, renderDashboard({
      activeTab,
      selectedAudienceId: request.query?.audience_id ?? "",
      filters,
      setupStatus,
      audienceImportPreview,
      audiences,
      audienceInstances,
      audienceProfiles,
      stories,
      activeStory,
      auditItems,
      analyticsItems,
      instances
    }));
  }

  return json(404, { error: "Not found" });
}

function readBody(body) {
  if (!body) {
    return {};
  }
  return typeof body === "string" ? JSON.parse(body) : body;
}

async function loadAudienceProfiles(audiences, audienceInstances, profileClientFactory) {
  if (typeof profileClientFactory !== "function") {
    return new Map();
  }

  const instancesByAudienceId = new Map((audienceInstances ?? []).map((instance) => [instance.audience_id, instance]));
  const entries = await Promise.all((audiences ?? []).map(async (audience) => {
    const instance = instancesByAudienceId.get(audience.id) ?? null;
    try {
      const profileClient = await profileClientFactory({ audience, instance });
      if (!profileClient?.getSummary) {
        return [audience.id, { error: "Marble profile sidecar is not configured for this audience." }];
      }
      const summary = await profileClient.getSummary();
      const debug = profileClient.getDebug ? await profileClient.getDebug() : { data: null };
      return [audience.id, { summary: summary.data ?? null, debug: debug.data ?? null }];
    } catch (error) {
      return [audience.id, { error: error.message }];
    }
  }));

  return new Map(entries);
}

async function resolveProfileClient({ repository, profileClientFactory, audienceId, audience = null }) {
  if (typeof profileClientFactory !== "function") {
    return null;
  }
  const resolvedAudience = audience ?? await repository.getAudience(audienceId);
  if (!resolvedAudience) {
    return null;
  }
  const instance = typeof repository.getInstanceByAudience === "function"
    ? await safeLoad(() => repository.getInstanceByAudience(audienceId), null)
    : null;
  return profileClientFactory({ audience: resolvedAudience, instance });
}

function normalizeAudienceProfileFacts(audience, input = {}) {
  const baseSnapshot = audience.profile_snapshot ?? {};
  return {
    audience_id: String(input.audience_id ?? audience.id ?? "").trim(),
    label: String(input.label ?? audience.label ?? "").trim(),
    location: String(input.location ?? audience.location ?? "").trim(),
    family_context: String(input.family_context ?? audience.family_context ?? "").trim(),
    interests: normalizeStringList(input.interests ?? audience.interests ?? []),
    content_pillars: normalizeStringList(input.content_pillars ?? audience.content_pillars ?? []),
    excluded_topics: normalizeStringList(input.excluded_topics ?? audience.excluded_topics ?? []),
    tone: String(input.tone ?? audience.tone ?? "").trim(),
    shopping_bias: String(input.shopping_bias ?? audience.shopping_bias ?? "").trim(),
    posting_schedule: String(input.posting_schedule ?? audience.posting_schedule ?? "").trim(),
    extra_metadata: normalizeObject(input.extra_metadata ?? baseSnapshot.extra_metadata ?? {})
  };
}

function buildAudienceChangesFromFacts(facts) {
  return {
    label: facts.label,
    location: facts.location,
    family_context: facts.family_context,
    interests: facts.interests,
    content_pillars: facts.content_pillars,
    excluded_topics: facts.excluded_topics,
    tone: facts.tone,
    shopping_bias: facts.shopping_bias,
    posting_schedule: facts.posting_schedule,
    profile_snapshot: {
      extra_metadata: facts.extra_metadata
    }
  };
}

function normalizeStringList(values) {
  if (Array.isArray(values)) {
    return values.map((value) => String(value).trim()).filter(Boolean);
  }
  return String(values ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function buildAudienceInstance(audience, runtimeConfig = {}) {
  const audienceKey = audience.audience_key ?? audience.audience_id ?? audience.id;
  return {
    factory_id: audience.factory_id ?? runtimeConfig.factory_id ?? null,
    audience_id: audience.id,
    instance_key: runtimeConfig.instance_key ?? `${audienceKey}-openclaw`,
    service_name: runtimeConfig.service_name ?? `${audienceKey}-openclaw`,
    openclaw_admin_url: runtimeConfig.openclaw_admin_url ?? "",
    profile_base_url: runtimeConfig.profile_base_url ?? runtimeConfig.plugin_base_url ?? "",
    runtime_config: {
      profile_service_name: runtimeConfig.profile_service_name ?? `${audienceKey}-profile`,
      profile_engine_image: runtimeConfig.profile_engine_image ?? "",
      profile_engine_command: runtimeConfig.profile_engine_command ?? "",
      profile_engine_health_path: runtimeConfig.profile_engine_health_path ?? "",
      profile_storage_path: runtimeConfig.profile_storage_path ?? "",
      plugin_base_url: runtimeConfig.plugin_base_url ?? "",
      openclaw_admin_url: runtimeConfig.openclaw_admin_url ?? "",
      openclaw_chat_path: runtimeConfig.openclaw_chat_path ?? "",
      openclaw_report_path: runtimeConfig.openclaw_report_path ?? "",
      openclaw_health_path: runtimeConfig.openclaw_health_path ?? "",
      telegram_bot_token: runtimeConfig.telegram_bot_token ?? "",
      telegram_chat_id: runtimeConfig.telegram_chat_id ?? "",
      telegram_report_chat_id: runtimeConfig.telegram_report_chat_id ?? runtimeConfig.telegram_chat_id ?? "",
      llm_provider: runtimeConfig.llm_provider ?? "",
      llm_model: runtimeConfig.llm_model ?? "",
      llm_base_url: runtimeConfig.llm_base_url ?? ""
    },
    status: "launch_pending"
  };
}

function normalizeLaunchRuntimeConfig(runtimeConfig = {}) {
  const allowedKeys = [
    "factory_id",
    "instance_key",
    "service_name",
    "profile_service_name",
    "profile_engine_image",
    "profile_engine_command",
    "profile_engine_health_path",
    "profile_storage_path",
    "plugin_base_url",
    "profile_base_url",
    "openclaw_admin_url",
    "openclaw_chat_path",
    "openclaw_report_path",
    "openclaw_health_path",
    "telegram_bot_token",
    "telegram_chat_id",
    "telegram_report_chat_id",
    "llm_provider",
    "llm_model",
    "llm_base_url"
  ];
  return Object.fromEntries(
    allowedKeys
      .map((key) => [key, typeof runtimeConfig[key] === "string" ? runtimeConfig[key].trim() : runtimeConfig[key]])
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function renderDashboard(model) {
  const activeTab = model.activeTab ?? "setup";
  const setupChecklist = renderSetupChecklist(model.setupStatus);
  const audienceImportPanel = renderAudienceImportPanel(model.audienceImportPreview);
  const storyTableRows = renderStoryTableRows(model.stories, model.filters, model.activeStory?.id ?? "");
  const deployments = collectDeploymentInstances(model.audienceInstances ?? [], model.instances ?? []);
  const selectedAudience = selectAudience(model.audiences ?? [], model.selectedAudienceId);
  const selectedProfileState = selectedAudience ? model.audienceProfiles?.get(selectedAudience.id) ?? {} : {};
  const selectedAudienceInstance = selectedAudience
    ? (model.audienceInstances ?? []).find((instance) => instance.audience_id === selectedAudience.id) ?? null
    : null;
  const selectedDeployment = selectAudienceDeployment(deployments, selectedAudience);

  const audienceOptions = model.audiences.map((audience) => `<option value="${escapeAttribute(audience.id)}"${audience.id === model.filters.audience_id ? " selected" : ""}>${escapeHtml(audience.label)}</option>`).join("");
  const assetCards = model.activeStory
    ? model.activeStory.assets.map((asset) => renderAssetCard(model.activeStory, asset)).join("")
    : `<div class="empty-card">Select a story to review assets.</div>`;
  const publicationItems = model.activeStory?.publications?.length
    ? model.activeStory.publications.map((publication) => `<li><strong>${escapeHtml(publication.channel)}</strong> <span>${escapeHtml(publication.status)}</span> <span>${escapeHtml(publication.target_identifier)}</span></li>`).join("")
    : "<li>No queued publications</li>";
  const reviewItems = model.activeStory?.reviews?.length
    ? model.activeStory.reviews.map((review) => `<li><strong>${escapeHtml(review.review_status)}</strong> <span>${escapeHtml(review.actor_id)}</span> <span>${escapeHtml(review.review_notes ?? "")}</span></li>`).join("")
    : "<li>No review history</li>";
  const auditItems = model.auditItems.length
    ? model.auditItems.map((item) => `<li><strong>${escapeHtml(item.type)}</strong> <span>${escapeHtml(item.timestamp ?? "")}</span></li>`).join("")
    : "<li>No audit events</li>";
  const analyticsItems = model.analyticsItems.length
    ? model.analyticsItems.map((item) => `<li><strong>${escapeHtml(item.story_id ?? item.topic ?? "feedback")}</strong> <span>${escapeHtml(String(item.engagement_score ?? 0))}</span></li>`).join("")
    : "<li>No analytics snapshots</li>";

  const audience = model.activeStory?.audience;
  const audienceFields = audience ? renderAudienceFields(audience) : `<p class="muted">No audience loaded.</p>`;
  const metadataJson = escapeHtml(JSON.stringify(model.activeStory?.metadata ?? {}, null, 2));
  const profileJson = escapeHtml(JSON.stringify(audience?.profile_snapshot ?? {}, null, 2));
  const selectedAssetId = model.activeStory?.selected_asset_id ?? "";
  const publicationTarget = model.activeStory?.publication_target ?? null;
  const drawerOpen = activeTab === "stories" && Boolean(model.activeStory);
  const drawerPortal = drawerOpen
    ? renderStoryDetailDrawer({
        story: model.activeStory,
        assetCards,
        publicationItems,
        reviewItems,
        metadataJson,
        selectedAssetId,
        publicationTarget,
        closeHref: buildDashboardHref(model.filters, "")
      })
    : "";
  const workspace = activeTab === "stories"
    ? renderStoriesWorkspace({
        model,
        storyTableRows,
        audienceOptions,
        assetCards,
        publicationItems,
        reviewItems,
        auditItems,
        analyticsItems,
        audience,
        audienceFields,
        metadataJson,
        profileJson,
        selectedAssetId,
        publicationTarget
      })
    : activeTab === "audiences"
      ? renderAudiencesWorkspace({
          model,
          deployments,
          selectedAudience,
          selectedAudienceInstance,
          selectedProfileState,
          selectedDeployment
        })
      : renderSetupWorkspace({
          model,
          setupChecklist,
          audienceImportPanel
        });

  return `<!doctype html>
<html lang="en"${drawerOpen ? ' class="drawer-open"' : ""} data-theme="light">
  <head>
    <meta charset="utf-8" />
    ${renderTremorFrameworkMeta()}
    <title>Vivo Factory Story Operations</title>
    <script>
      (() => {
        try {
          const stored = localStorage.getItem("vivo-theme");
          const preferred = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
          document.documentElement.dataset.theme = stored || preferred;
        } catch {
          document.documentElement.dataset.theme = "light";
        }
      })();
    </script>
    <style>
      :root,
      [data-theme="light"] {
        color-scheme: light;
        --bg: #f8fafc;
        --body-bg:
          radial-gradient(circle at 14% 0%, rgba(59, 130, 246, 0.08), transparent 28%),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 52%, #f1f5f9 100%);
        --surface: #ffffff;
        --surface-2: #ffffff;
        --surface-muted: #f8fafc;
        --surface-alpha: rgba(255, 255, 255, 0.9);
        --ink: #0f172a;
        --muted: #64748b;
        --line: #e2e8f0;
        --line-strong: #cbd5e1;
        --accent: #2563eb;
        --accent-contrast: #ffffff;
        --accent-soft: #dbeafe;
        --success: #16a34a;
        --success-line: rgba(22, 163, 74, 0.25);
        --warning: #d97706;
        --warning-line: rgba(217, 119, 6, 0.25);
        --secondary-bg: #f1f5f9;
        --preview-bg: linear-gradient(135deg, #e0f2fe 0%, #f8fafc 100%);
        --row-hover: #f8fafc;
        --row-active: #eff6ff;
        --code-bg: #f1f5f9;
        --scrim: rgba(15, 23, 42, 0.28);
        --shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 10px 30px rgba(15, 23, 42, 0.05);
        --drawer-shadow: -40px 0 80px rgba(15, 23, 42, 0.18);
      }
      [data-theme="dark"] {
        color-scheme: dark;
        --bg: #020617;
        --body-bg:
          radial-gradient(circle at 14% 0%, rgba(96, 165, 250, 0.16), transparent 30%),
          linear-gradient(180deg, #020617 0%, #0f172a 54%, #111827 100%);
        --surface: #0f172a;
        --surface-2: #111827;
        --surface-muted: #111827;
        --surface-alpha: rgba(15, 23, 42, 0.9);
        --ink: #f8fafc;
        --muted: #94a3b8;
        --line: rgba(148, 163, 184, 0.18);
        --line-strong: rgba(148, 163, 184, 0.34);
        --accent: #60a5fa;
        --accent-contrast: #020617;
        --accent-soft: rgba(96, 165, 250, 0.18);
        --success: #4ade80;
        --success-line: rgba(74, 222, 128, 0.28);
        --warning: #fbbf24;
        --warning-line: rgba(251, 191, 36, 0.28);
        --secondary-bg: #1e293b;
        --preview-bg: linear-gradient(135deg, rgba(37, 99, 235, 0.28) 0%, rgba(15, 23, 42, 0.88) 100%);
        --row-hover: rgba(148, 163, 184, 0.08);
        --row-active: rgba(96, 165, 250, 0.14);
        --code-bg: #020617;
        --scrim: rgba(2, 6, 23, 0.62);
        --shadow: 0 1px 2px rgba(0, 0, 0, 0.38), 0 20px 50px rgba(0, 0, 0, 0.28);
        --drawer-shadow: -40px 0 80px rgba(0, 0, 0, 0.42);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, "Avenir Next", "Segoe UI", sans-serif;
        background: var(--body-bg);
        color: var(--ink);
      }
      html.drawer-open,
      body.drawer-open { overflow: hidden; }
      a { color: inherit; text-decoration: none; }
      main { max-width: 1500px; margin: 0 auto; padding: 28px 28px 56px; }
      h1, h2, h3 { margin: 0; }
      p { margin: 0; }
      h1 {
        font-family: Georgia, serif;
        font-size: clamp(34px, 5vw, 72px);
        letter-spacing: -0.055em;
        line-height: 0.95;
      }
      h2 {
        font-family: Georgia, serif;
        font-size: clamp(24px, 2vw, 36px);
        letter-spacing: -0.035em;
      }
      h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 28px;
        padding-bottom: 22px;
        border-bottom: 1px solid var(--line);
        animation: rise 420ms ease both;
      }
      .topbar p { color: var(--muted); max-width: 560px; margin-top: 10px; font-size: 15px; }
      .workspace-tabs {
        display: inline-flex;
        gap: 4px;
        padding: 4px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--surface-alpha);
        position: sticky;
        top: 16px;
        backdrop-filter: blur(18px);
        z-index: 4;
      }
      .topbar-actions {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }
      .workspace-tab {
        display: inline-flex;
        align-items: center;
        min-width: 104px;
        justify-content: center;
        padding: 10px 16px;
        border-radius: 999px;
        color: var(--muted);
        font-size: 13px;
        transition: background 180ms ease, color 180ms ease, transform 180ms ease;
      }
      .workspace-tab:hover { transform: translateY(-1px); color: var(--ink); }
      .workspace-tab.active {
        background: var(--accent);
        color: var(--accent-contrast);
      }
      .workspace {
        padding-top: 28px;
        animation: fadeIn 360ms ease both;
      }
      .split {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(420px, 1.4fr);
        gap: 28px;
        align-items: start;
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 16px;
        box-shadow: var(--shadow);
      }
      .panel-inner { padding: 22px; }
      .plain-section {
        border-top: 1px solid var(--line);
        padding-top: 22px;
      }
      .filter-grid {
        display: grid;
        gap: 12px;
        margin-top: 16px;
      }
      .workspace-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 22px;
      }
      .workspace-stack, .story-list, .audience-list, .instance-list { display: grid; gap: 12px; }
      .story-row {
        display: grid;
        gap: 8px;
        padding: 14px 0;
        border-bottom: 1px solid var(--line);
        transition: padding 180ms ease, border-color 180ms ease;
      }
      .story-row-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--muted);
        font-size: 12px;
      }
      .story-row.active {
        padding-left: 12px;
        border-left: 2px solid var(--accent);
      }
      .muted { color: var(--muted); }
      label { display: grid; gap: 7px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
      input, select, textarea, button {
        font: inherit;
      }
      input, select, textarea {
        width: 100%;
        border-radius: 16px;
        border: 1px solid var(--line);
        padding: 12px 13px;
        background: var(--surface-2);
        color: var(--ink);
        text-transform: none;
        letter-spacing: 0;
      }
      textarea { resize: vertical; min-height: 96px; }
      button {
        border: none;
        border-radius: 999px;
        padding: 11px 15px;
        background: var(--accent);
        color: var(--accent-contrast);
        cursor: pointer;
        transition: transform 160ms ease, opacity 160ms ease;
      }
      button:hover {
        transform: translateY(-1px);
      }
      button.secondary {
        background: var(--secondary-bg);
        color: var(--ink);
      }
      .theme-toggle {
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--ink);
        box-shadow: var(--shadow);
      }
      .button-like {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 11px 15px;
        background: var(--accent);
        color: var(--accent-contrast);
      }
      .button-like.secondary {
        background: var(--secondary-bg);
        color: var(--ink);
      }
      button.ghost {
        background: transparent;
        color: var(--accent);
        border: 1px solid var(--line-strong);
      }
      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .section-title {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 12px;
        margin-bottom: 18px;
      }
      .story-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1px;
        margin-bottom: 18px;
        border: 1px solid var(--line);
        border-radius: 22px;
        overflow: hidden;
      }
      .meta-chip {
        padding: 13px;
        background: var(--surface-muted);
      }
      .asset-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      .asset-card, .empty-card {
        padding: 16px;
        border-radius: 22px;
        border: 1px solid var(--line);
        background: var(--surface);
      }
      .asset-card.selected {
        border-color: var(--accent);
      }
      .asset-preview {
        min-height: 120px;
        border-radius: 18px;
        background: var(--preview-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 10px;
        color: var(--muted);
        text-align: center;
        padding: 12px;
      }
      .drawer {
        display: none;
      }
      .drawer.open {
        display: block;
      }
      ul.compact {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 0;
      }
      ul.compact li {
        padding: 12px 0;
        border-bottom: 1px solid var(--line);
      }
      .stat-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 1px;
        border: 1px solid var(--line);
        border-radius: 24px;
        overflow: hidden;
        margin-bottom: 22px;
      }
      .stat {
        padding: 18px;
        background: var(--surface);
      }
      .stat strong { display: block; font-size: 28px; letter-spacing: -0.04em; }
      .stat span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .eyebrow {
        color: var(--muted);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        margin-bottom: 10px;
      }
      .audiences-shell {
        display: grid;
        grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(280px, 320px);
        gap: 32px;
        align-items: start;
      }
      .audience-directory-panel,
      .audience-workspace-panel,
      .audience-inspector-rail > .panel {
        min-width: 0;
      }
      .audience-directory-panel,
      .audience-inspector-rail {
        position: sticky;
        top: 24px;
      }
      .audience-directory-panel,
      .audience-workspace-panel,
      .audience-inspector-rail > .panel {
        background: transparent;
        border: none;
        box-shadow: none;
      }
      .audience-directory-panel .panel-inner,
      .audience-workspace-panel .panel-inner,
      .audience-inspector-rail > .panel .panel-inner {
        padding: 0;
      }
      .audience-directory-list,
      .audience-canvas,
      .deployment-index {
        display: grid;
        gap: 12px;
      }
      .audience-directory-row {
        display: grid;
        gap: 8px;
        padding: 14px 0 14px 16px;
        border-top: 1px solid var(--line);
        border-left: 1px solid transparent;
        background: transparent;
        transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
      }
      .audience-directory-row:hover,
      .audience-directory-row.active {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 5%, transparent);
        transform: translateY(-1px);
      }
      .audience-directory-list .audience-directory-row:last-child {
        border-bottom: 1px solid var(--line);
      }
      .audience-directory-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 10px;
      }
      .audience-directory-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        color: var(--muted);
        font-size: 12px;
      }
      .audience-directory-panel .section-title {
        margin-bottom: 10px;
      }
      .audience-canvas {
        gap: 26px;
        padding: 28px;
        border: 1px solid var(--line);
        border-radius: 28px;
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--surface) 90%, transparent) 0%, var(--surface) 100%);
        box-shadow: var(--shadow);
      }
      .audience-hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 240px;
        gap: 24px;
        align-items: end;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--line);
      }
      .audience-hero-copy {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .audience-hero-copy h2 {
        max-width: 13ch;
        font-size: clamp(36px, 4vw, 58px);
        line-height: 0.94;
        overflow-wrap: anywhere;
      }
      .audience-hero-summary {
        max-width: 56ch;
        color: var(--muted);
        line-height: 1.6;
      }
      .audience-hero-meta {
        display: grid;
        gap: 12px;
      }
      .audience-hero-fact {
        display: grid;
        gap: 4px;
        padding-top: 10px;
        border-top: 1px solid var(--line);
      }
      .audience-hero-fact:first-child {
        padding-top: 0;
        border-top: none;
      }
      .audience-hero-fact strong {
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .audience-hero-fact span {
        overflow-wrap: anywhere;
      }
      .audience-hero-pills {
        align-content: start;
        justify-content: start;
        margin-top: 0;
      }
      .audience-summary-strip {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
        padding: 18px 0;
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
      }
      .audience-module {
        display: grid;
        gap: 16px;
        padding-top: 22px;
        border-top: 1px solid var(--line);
      }
      .audience-module:first-of-type {
        padding-top: 0;
        border-top: none;
      }
      .audience-state-grid,
      .audience-tag-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .audience-tag-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .state-card {
        display: grid;
        gap: 10px;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: color-mix(in srgb, var(--surface) 88%, transparent);
      }
      .state-card p {
        margin: 0;
        line-height: 1.5;
      }
      .state-label {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .state-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 10px;
      }
      .state-list li {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 13px;
      }
      .state-list li span {
        color: var(--muted);
      }
      .debug-panel summary {
        cursor: pointer;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .debug-panel pre {
        margin: 0;
        padding: 12px;
        border-radius: 12px;
        background: var(--code-bg);
        overflow-x: auto;
        font-size: 12px;
        line-height: 1.45;
      }
      .pill-line {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin-top: 0;
      }
      .pill {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 5px 9px;
        color: var(--muted);
        font-size: 12px;
      }
      .launch-config {
        display: grid;
        gap: 14px;
        padding: 0;
      }
      .profile-form {
        display: grid;
        gap: 14px;
      }
      .launch-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px 14px;
      }
      .launch-actions {
        justify-content: end;
      }
      .audience-inspector-rail {
        display: grid;
        gap: 24px;
      }
      .audience-inspector-rail > .panel {
        padding-top: 18px;
        border-top: 1px solid var(--line);
      }
      .audience-inspector-rail > .panel:first-child {
        padding-top: 0;
        border-top: none;
      }
      .deployment-inspector {
        display: grid;
        gap: 12px;
      }
      .instance-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .instance-meta {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 12px;
      }
      .instance-meta span {
        overflow-wrap: anywhere;
      }
      .instance-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      .command-list {
        display: grid;
        gap: 8px;
      }
      .command-block {
        display: grid;
        gap: 4px;
      }
      .command-block code {
        display: block;
        padding: 8px 10px;
        border-radius: 12px;
        background: var(--code-bg);
        overflow-x: auto;
        font-size: 12px;
      }
      .asset-preview-media {
        width: 100%;
        max-height: 240px;
        object-fit: cover;
        border-radius: 14px;
      }
      .deployment-index-row {
        display: grid;
        gap: 4px;
        padding: 12px 0;
        border-top: 1px solid var(--line);
      }
      .deployment-index-row:first-child {
        border-top: none;
      }
      .tremor-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 16px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .tremor-filterbar {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr)) auto;
        gap: 10px;
        align-items: end;
        padding: 16px;
        border-bottom: 1px solid var(--line);
      }
      .tremor-table-wrap {
        overflow-x: auto;
      }
      .tremor-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .tremor-table th {
        color: var(--muted);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-align: left;
        text-transform: uppercase;
        padding: 12px 16px;
        border-bottom: 1px solid var(--line);
        background: var(--surface-muted);
      }
      .tremor-table td {
        padding: 14px 16px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }
      .tremor-table tr {
        transition: background 160ms ease;
      }
      .tremor-table tbody tr:hover {
        background: var(--row-hover);
      }
      .tremor-table tbody tr.active {
        background: var(--row-active);
      }
      .story-title-link {
        display: inline-grid;
        gap: 3px;
        color: var(--ink);
      }
      .story-title-link span {
        color: var(--muted);
        font-size: 12px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 4px 8px;
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
      }
      .badge.ready, .badge.approved {
        color: var(--success);
        border-color: var(--success-line);
        background: color-mix(in srgb, var(--success) 12%, transparent);
      }
      .badge.warning {
        color: var(--warning);
        border-color: var(--warning-line);
        background: color-mix(in srgb, var(--warning) 12%, transparent);
      }
      .audience-workspace-panel .badge {
        justify-self: start;
      }
      .drawer-portal {
        position: fixed;
        inset: 0;
        z-index: 50;
        pointer-events: none;
      }
      .drawer-scrim {
        position: fixed;
        inset: 0;
        background: var(--scrim);
        backdrop-filter: blur(2px);
        z-index: 50;
        pointer-events: auto;
        animation: fadeIn 180ms ease both;
      }
      .story-detail-drawer {
        position: fixed;
        top: 8px;
        right: 8px;
        bottom: 8px;
        width: min(40vw, 760px);
        min-width: 520px;
        max-width: calc(100vw - 16px);
        overflow-y: auto;
        background: var(--surface-2);
        border: 1px solid var(--line-strong);
        border-radius: 18px;
        box-shadow: var(--drawer-shadow);
        z-index: 51;
        pointer-events: auto;
        transform: translateX(100%);
        transition: transform 240ms ease;
      }
      .story-detail-drawer.open {
        transform: translateX(0);
        animation: slideIn 240ms ease both;
      }
      .drawer-header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 24px;
        background: var(--surface-alpha);
        border-bottom: 1px solid var(--line);
        backdrop-filter: blur(18px);
      }
      .drawer-body {
        display: grid;
        gap: 22px;
        padding: 24px;
      }
      .drawer-section {
        border-top: 1px solid var(--line);
        padding-top: 20px;
      }
      @keyframes slideIn {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
      @keyframes rise {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
          @media (max-width: 1080px) {
            main { padding: 18px 16px 44px; }
            .topbar, .split, .workspace-grid {
              grid-template-columns: 1fr;
              display: grid;
            }
            .audiences-shell,
            .audience-hero,
            .audience-summary-strip,
            .audience-state-grid,
            .audience-tag-grid,
            .launch-grid {
              grid-template-columns: 1fr;
            }
            .audience-directory-panel,
            .audience-inspector-rail {
              position: static;
            }
            .audience-canvas {
              padding: 22px 18px;
            }
            .tremor-filterbar { grid-template-columns: 1fr; }
            .story-detail-drawer {
              inset: 8px;
          width: auto;
          min-width: 0;
        }
        .workspace-tabs { width: 100%; overflow-x: auto; justify-content: start; }
      }
    </style>
  </head>
  <body${drawerOpen ? ' class="drawer-open"' : ""} data-ui-framework="${TREMOR_DASHBOARD_FRAMEWORK}">
    <main data-ui-framework="${TREMOR_DASHBOARD_FRAMEWORK}">
      <header class="topbar">
        <div>
          <h1>Vivo Factory</h1>
          <p>Setup, story review, and audience manager launch in one restrained operations surface.</p>
        </div>
        <div class="topbar-actions">
          ${renderWorkspaceTabs(activeTab)}
          <button type="button" class="theme-toggle" id="theme-toggle" data-theme-toggle aria-label="Toggle color theme">Theme</button>
        </div>
      </header>
      <section class="workspace">
        ${workspace}
      </section>
    </main>
    ${drawerPortal}

    ${renderDashboardScript()}
  </body>
</html>`;
}

function renderSetupWorkspace({ model, setupChecklist, audienceImportPanel }) {
  return `<div class="split">
    <section>
      <div class="stat-row">
        ${renderTremorMetric({ value: model.setupStatus?.ready ? "Ready" : "Open", label: "Setup state" })}
        ${renderTremorMetric({ value: String(model.audiences.length), label: "Audiences" })}
        ${renderTremorMetric({ value: model.setupStatus?.llm?.model ?? "unset", label: "LLM model" })}
      </div>
      <section class="panel">
        <div class="panel-inner">
          <div class="section-title">
            <div><h2>Setup Checklist</h2><p class="muted">Supabase, schema, LLM, and dashboard readiness.</p></div>
            <span class="muted">${escapeHtml(model.setupStatus?.ready ? "ready" : "action required")}</span>
          </div>
          ${setupChecklist}
        </div>
      </section>
    </section>
    <section class="panel">
      <div class="panel-inner">
        <div class="section-title">
          <div><h2>Create Audiences</h2><p class="muted">Import audience.md or create one investigated profile. Instances are not prepared until launch.</p></div>
        </div>
        ${audienceImportPanel}
        <div class="plain-section" style="margin-top:22px;">
          <h3>Create One Audience</h3>
          <form id="create-audience-form" class="filter-grid">
            <label>Raw audience brief, sources, photos, accounts
              <textarea name="raw_text" placeholder="Describe the audience. Add Twitter accounts, similar photos, references, and constraints."></textarea>
            </label>
            <button type="submit">Run LLM Investigation</button>
          </form>
        </div>
      </div>
    </section>
  </div>`;
}

function renderStoriesWorkspace(context) {
  const {
    model,
    storyTableRows,
    audienceOptions,
    auditItems,
    analyticsItems
  } = context;
  const storiesTable = renderTremorCard({
    title: "Stories Table",
    description: "Select a row to open details, assets, approval, and publication controls.",
    action: `<span class="muted">${escapeHtml(String(model.stories.length))} stories</span>`,
    children: `
      <form method="GET" class="tremor-filterbar">
        <input type="hidden" name="tab" value="stories" />
        <label>Status
          <select name="status">${renderStatusOptions(model.filters.status)}</select>
        </label>
        <label>Review
          <select name="review_status">${renderReviewOptions(model.filters.review_status)}</select>
        </label>
        <label>Audience
          <select name="audience_id">
            <option value="">All audiences</option>
            ${audienceOptions}
          </select>
        </label>
        <label>Search
          <input type="text" name="search" value="${escapeAttribute(model.filters.search ?? "")}" placeholder="Search title or story text" />
        </label>
        <button type="submit">Apply Filters</button>
      </form>
      <div class="tremor-table-wrap">
        <table class="tremor-table" data-tremor-component="Table">
          <thead>
            <tr>
              <th>Story</th>
              <th>Audience</th>
              <th>Status</th>
              <th>Review</th>
              <th>Asset</th>
              <th>Channel</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            ${storyTableRows || `<tr><td colspan="7" class="muted">No stories match these filters.</td></tr>`}
          </tbody>
        </table>
      </div>`
  });

  return `<div class="workspace-grid">
    ${storiesTable}

    <section class="split" style="margin-top:22px;">
      <div class="panel"><div class="panel-inner"><div class="section-title"><h2>Audit Log</h2></div><ul class="compact">${auditItems}</ul></div></div>
      <div class="panel"><div class="panel-inner"><div class="section-title"><h2>Analytics Snapshot</h2></div><ul class="compact">${analyticsItems}</ul></div></div>
    </section>
  </div>`;
}

function renderStoryTableRows(stories, filters, activeStoryId) {
  return stories.map((story) => {
    const href = buildDashboardHref(filters, story.id);
    const targetLabel = story.publication_target
      ? `${story.publication_target.channel}:${story.publication_target.target_identifier}`
      : "unconfigured";
    return `<tr class="${story.id === activeStoryId ? "active" : ""}" data-story-href="${escapeAttribute(href)}">
      <td>
        <a class="story-title-link" href="${escapeAttribute(href)}">
          <strong>${escapeHtml(story.title)}</strong>
          <span>${escapeHtml(truncateText(story.summary ?? story.story_text ?? "", 86))}</span>
        </a>
      </td>
      <td>${escapeHtml(story.audience?.label ?? "Unknown audience")}</td>
      <td>${renderStatusBadge(story.status)}</td>
      <td>${renderReviewBadge(story.operator_review_status)}</td>
      <td>${escapeHtml(story.selected_asset_id ?? "none")}</td>
      <td>${escapeHtml(targetLabel)}</td>
      <td>${escapeHtml(formatShortDate(story.updated_at ?? story.created_at))}</td>
    </tr>`;
  }).join("");
}

function renderStoryDetailDrawer({ story, assetCards, publicationItems, reviewItems, metadataJson, selectedAssetId, publicationTarget, closeHref }) {
  return `<div class="drawer-portal" data-tremor-component="DrawerPortal">
  <a class="drawer-scrim" href="${escapeAttribute(closeHref)}" aria-label="Close story details"></a>
  <aside class="story-detail-drawer open" data-tremor-component="Drawer" aria-label="Story details">
    <div class="drawer-header">
      <div>
        <h2>Story Details</h2>
        <p class="muted">${escapeHtml(story.audience?.label ?? "Unknown audience")}</p>
      </div>
      <a class="button-like secondary" href="${escapeAttribute(closeHref)}">Close</a>
    </div>
    <div class="drawer-body">
      <div class="story-meta">
        <div class="meta-chip"><strong>Pipeline</strong><div>${escapeHtml(story.status)}</div></div>
        <div class="meta-chip"><strong>Review</strong><div>${escapeHtml(story.operator_review_status)}</div></div>
        <div class="meta-chip"><strong>Selected Asset</strong><div>${escapeHtml(selectedAssetId || "none")}</div></div>
        <div class="meta-chip"><strong>Instance</strong><div>${escapeHtml(story.instance?.service_name ?? "unassigned")}</div></div>
        <div class="meta-chip"><strong>Channel Target</strong><div>${escapeHtml(publicationTarget ? `${publicationTarget.channel}:${publicationTarget.target_identifier}` : "unconfigured")}</div></div>
      </div>

      <section>
        <div class="section-title"><div><h3>Story Copy</h3><p class="muted">Edit story text and metadata.</p></div></div>
        <form id="story-form" data-story-id="${escapeAttribute(story.id)}" class="filter-grid">
          <label>Title
            <input name="title" value="${escapeAttribute(story.title)}" />
          </label>
          <label>Story Text
            <textarea name="story_text">${escapeHtml(story.story_text)}</textarea>
          </label>
          <label>Summary
            <textarea name="summary">${escapeHtml(story.summary ?? "")}</textarea>
          </label>
          <label>Metadata JSON
            <textarea name="metadata">${metadataJson}</textarea>
          </label>
          <div class="button-row"><button type="submit">Save Story</button></div>
        </form>
      </section>

      <section class="drawer-section">
        <div class="section-title"><div><h3>Asset Panel</h3><p class="muted">Select or replace the publish asset.</p></div></div>
        <div class="asset-grid">${assetCards}</div>
      </section>

      <section class="drawer-section">
        <div class="section-title"><div><h3>Publication Queue</h3><p class="muted">Approve with a selected asset before queueing.</p></div></div>
        <div class="story-meta" style="margin-bottom:12px;">
          <div class="meta-chip"><strong>Channel</strong><div>${escapeHtml(publicationTarget?.channel ?? "unconfigured")}</div></div>
          <div class="meta-chip"><strong>Target</strong><div>${escapeHtml(publicationTarget?.target_identifier ?? "unconfigured")}</div></div>
        </div>
        <form id="review-form" data-story-id="${escapeAttribute(story.id)}" class="filter-grid">
          <label>Review Notes
            <textarea name="review_notes" placeholder="What changed or why is this ready?"></textarea>
          </label>
          <input type="hidden" name="selected_asset_id" value="${escapeAttribute(selectedAssetId)}" />
          <div class="button-row">
            <button type="button" data-review-status="approved">Approve</button>
            <button type="button" class="secondary" data-review-status="changes_requested">Request Changes</button>
            <button type="button" class="secondary" data-review-status="rejected">Reject</button>
          </div>
        </form>
        <div class="button-row" style="margin-top:12px;">
          <button type="button" id="queue-publication-button" data-story-id="${escapeAttribute(story.id)}">Queue Channel Publication</button>
        </div>
        <h3 style="margin:22px 0 8px;">Queued Publications</h3>
        <ul class="compact">${publicationItems}</ul>
        <h3 style="margin:22px 0 8px;">Review History</h3>
        <ul class="compact">${reviewItems}</ul>
      </section>
    </div>
  </aside>
</div>`;
}

function renderAudiencesWorkspace({ model, deployments, selectedAudience, selectedAudienceInstance, selectedProfileState, selectedDeployment }) {
  return `<div class="audiences-shell">
    <section class="panel audience-directory-panel">
      <div class="panel-inner">
        <div class="section-title">
          <div><h2>Audience Directory</h2><p class="muted">Select one audience to inspect Marble state, enrich profile data, and manage runtime delivery.</p></div>
          <span class="muted">${escapeHtml(String(model.audiences.length))} audiences</span>
        </div>
        ${renderAudienceDirectory(model.audiences ?? [], deployments, model.audienceProfiles ?? new Map(), selectedAudience?.id ?? "")}
      </div>
    </section>
    <section class="panel audience-workspace-panel">
      <div class="panel-inner">
        <div class="section-title">
          <div><h2>Audience Workspace</h2><p class="muted">Profile state first, edit surfaces second, delivery runtime last.</p></div></div>
        ${renderAudienceWorkspaceCanvas(selectedAudience, selectedAudienceInstance, selectedProfileState)}
      </div>
    </section>
    <section class="workspace-stack audience-inspector-rail">
      ${renderAudienceInspector(selectedAudience, selectedDeployment, deployments)}
    </section>
  </div>`;
}

function collectDeploymentInstances(audienceInstances, staticInstances) {
  const deployments = new Map();
  for (const instance of audienceInstances ?? []) {
    deployments.set(instance.service_name ?? instance.instance_key ?? instance.id, normalizeDeploymentInstance(instance, "created"));
  }
  for (const instance of staticInstances ?? []) {
    deployments.set(instance.service_name ?? instance.instance_key ?? instance.audience_id, normalizeDeploymentInstance(instance, "static"));
  }
  return [...deployments.values()];
}

function normalizeDeploymentInstance(instance, source) {
  const runtime = instance.runtime_config ?? {};
  return {
    source,
    audience_id: instance.audience_id,
    audience_key: instance.audience_key ?? instance.instance_key?.replace(/-openclaw$/, "") ?? instance.audience_id,
    service_name: instance.service_name ?? instance.instance_key,
    profile_service_name: instance.profile_service_name ?? runtime.profile_service_name,
    openclaw_admin_url: instance.openclaw_admin_url ?? runtime.openclaw_admin_url ?? "",
    profile_base_url: instance.profile_base_url ?? runtime.plugin_base_url ?? "",
    profile_engine_image: runtime.profile_engine_image ?? "",
    profile_engine_command: runtime.profile_engine_command ?? "",
    profile_engine_health_path: runtime.profile_engine_health_path ?? "",
    profile_storage_path: runtime.profile_storage_path ?? "",
    telegram_chat_id: instance.telegram_chat_id ?? runtime.telegram_chat_id ?? "",
    telegram_report_chat_id: instance.telegram_report_chat_id ?? runtime.telegram_report_chat_id ?? runtime.telegram_chat_id ?? "",
    status: instance.status ?? "configured",
    env_file: runtime.generated_env_file ?? "",
    compose_file: runtime.generated_compose_file ?? "",
    llm_model: runtime.llm_model ?? "",
    commands: instance.commands ?? runtime.commands ?? {}
  };
}

function selectAudience(audiences, selectedAudienceId) {
  if (!audiences?.length) {
    return null;
  }
  return audiences.find((audience) => audience.id === selectedAudienceId) ?? audiences[0];
}

function selectAudienceDeployment(deployments, audience) {
  if (!deployments?.length) {
    return null;
  }
  if (!audience) {
    return deployments[0];
  }
  return deployments.find((deployment) => deploymentMatchesAudience(deployment, audience)) ?? deployments[0];
}

function deploymentMatchesAudience(deployment, audience) {
  const audienceKey = audience?.audience_key ?? audience?.id ?? "";
  return [
    deployment.audience_id,
    deployment.audience_key
  ].includes(audience.id) || [
    deployment.audience_id,
    deployment.audience_key
  ].includes(audienceKey);
}

function renderAudienceDirectory(audiences, deployments, audienceProfiles, selectedAudienceId) {
  if (!audiences.length) {
    return `<div class="empty-card">No audiences are configured.</div>`;
  }

  return `<div class="audience-directory-list">
    ${audiences.map((audience) => {
      const deployment = deployments.find((item) => deploymentMatchesAudience(item, audience)) ?? null;
      const summary = audienceProfiles.get(audience.id)?.summary?.profile ?? {};
      const href = buildAudienceWorkspaceHref(audience.id);
      const isActive = audience.id === selectedAudienceId;
      return `<a class="audience-directory-row${isActive ? " active" : ""}" href="${escapeAttribute(href)}" data-audience-link="${escapeAttribute(audience.id)}">
        <div class="audience-directory-head">
          <strong>${escapeHtml(audience.label ?? audience.audience_key ?? audience.id)}</strong>
          ${renderTremorBadge(deployment?.status ?? audience.status ?? "draft", { tone: deployment?.status === "active" ? "success" : "neutral" })}
        </div>
        <div class="muted">${escapeHtml(audience.audience_key ?? audience.id)}</div>
        <div class="audience-directory-meta">
          <span>${escapeHtml(formatStructuredText(audience.location, "Location unset"))}</span>
          <span>${escapeHtml(deployment?.service_name ?? "Instance not launched")}</span>
        </div>
        <p class="muted">${escapeHtml(formatStructuredText(summary.reasoning_summary ?? audience.family_context, "No Marble summary stored."))}</p>
      </a>`;
    }).join("")}
  </div>`;
}

function renderAudienceWorkspaceCanvas(audience, instance, profileState = {}) {
  if (!audience) {
    return `<div class="empty-card">Create an audience to unlock Marble profile editing and runtime launch controls.</div>`;
  }

  const summary = profileState.summary?.profile ?? {};
  const debug = profileState.debug ?? null;
  const error = profileState.error ?? "";
  const merged = {
    label: formatStructuredText(summary.label ?? audience.label, audience.label ?? ""),
    location: formatStructuredText(summary.location ?? audience.location, audience.location ?? ""),
    family_context: formatStructuredText(summary.family_context ?? audience.family_context, audience.family_context ?? ""),
    interests: normalizeAudienceList(summary.interests ?? audience.interests ?? []),
    content_pillars: normalizeAudienceList(summary.content_pillars ?? audience.content_pillars ?? []),
    excluded_topics: normalizeAudienceList(summary.excluded_topics ?? audience.excluded_topics ?? []),
    tone: formatStructuredText(summary.tone ?? audience.tone, audience.tone ?? ""),
    shopping_bias: formatStructuredText(summary.shopping_bias ?? audience.shopping_bias, audience.shopping_bias ?? ""),
    posting_schedule: formatStructuredText(debug?.metadata?.posting_schedule ?? audience.posting_schedule, audience.posting_schedule ?? ""),
    reasoning_summary: formatStructuredText(summary.reasoning_summary, ""),
    updated_at: summary.updated_at ?? "",
    extra_metadata: debug?.metadata?.extra_metadata ?? audience.profile_snapshot?.extra_metadata ?? {}
  };
  const interestCount = debug?.memory_nodes?.interests ?? merged.interests.length;
  const preferenceCount = debug?.memory_nodes?.preferences ?? debug?.memory_nodes?.preference_count ?? 0;
  const decisionCount = Array.isArray(debug?.decisions) ? debug.decisions.length : 0;
  const debugJson = error
    ? ""
    : escapeHtml(JSON.stringify(debug ?? {
        profile: summary,
        metadata: merged.extra_metadata
      }, null, 2));

  return `<div class="audience-canvas">
    <section class="audience-hero">
      <div class="audience-hero-copy">
        <div class="eyebrow">Selected Audience</div>
        <h2>${escapeHtml(merged.label || audience.label || audience.audience_key || audience.id)}</h2>
        <p class="audience-hero-summary">${escapeHtml(merged.family_context || "Family context is not set yet.")}</p>
      </div>
      <div class="audience-hero-meta">
        ${renderAudienceHeroFact("Audience Key", audience.audience_key ?? audience.id)}
        ${renderAudienceHeroFact("Location", merged.location || "Location unset")}
        ${renderAudienceHeroFact("Language", formatStructuredText(audience.language, "Language unset"))}
        ${renderAudienceHeroFact("Runtime", instance?.status ?? "not launched")}
      </div>
    </section>

    <section class="audience-summary-strip">
      ${renderTremorMetric({ value: merged.interests.length || 0, label: "Tracked Interests" })}
      ${renderTremorMetric({ value: preferenceCount || 0, label: "Preferences" })}
      ${renderTremorMetric({ value: decisionCount || 0, label: "Decision Events" })}
      ${renderTremorMetric({ value: merged.updated_at ? formatShortDate(merged.updated_at) : "never", label: "Last Sync" })}
    </section>

    <section class="audience-module" data-tremor-component="Card">
      <div class="section-title">
        <div><h3>Profile Canvas</h3><p class="muted">Current Marble interpretation, summarized for operator review.</p></div>
        <span class="badge ${error ? "warning" : "ready"}">${escapeHtml(error ? "Marble unavailable" : "Marble connected")}</span>
      </div>
      ${error ? `<div class="empty-card">${escapeHtml(error)}</div>` : ""}
      <div class="audience-state-grid">
        <div class="state-card">
          <span class="state-label">Reasoning Summary</span>
          <p>${escapeHtml(merged.reasoning_summary || "No Marble summary stored.")}</p>
        </div>
        <div class="state-card">
          <span class="state-label">Audience Shape</span>
          <ul class="state-list">
            <li><strong>Tone</strong><span>${escapeHtml(merged.tone || "unset")}</span></li>
            <li><strong>Shopping Bias</strong><span>${escapeHtml(merged.shopping_bias || "unset")}</span></li>
            <li><strong>Posting Schedule</strong><span>${escapeHtml(merged.posting_schedule || "unset")}</span></li>
            <li><strong>Memory Nodes</strong><span>${escapeHtml(String(interestCount))} interests</span></li>
          </ul>
        </div>
      </div>
      <div class="audience-tag-grid">
        ${renderAudienceTagBlock("Interests", merged.interests)}
        ${renderAudienceTagBlock("Content Pillars", merged.content_pillars)}
        ${renderAudienceTagBlock("Excluded Topics", merged.excluded_topics)}
      </div>
    </section>

    <section class="audience-module" data-tremor-component="Card">
      <div class="section-title">
        <div><h3>Knowledge Inputs</h3><p class="muted">Edit the seeded facts that shape future Marble reads and delivery decisions.</p></div>
      </div>
      <form class="profile-form" data-profile-facts-audience-id="${escapeAttribute(audience.id)}">
        <div class="launch-grid">
          <label>Label
            <input name="label" value="${escapeAttribute(merged.label)}" required />
          </label>
          <label>Location
            <input name="location" value="${escapeAttribute(merged.location)}" required />
          </label>
          <label>Family Context
            <textarea name="family_context" rows="4">${escapeHtml(merged.family_context)}</textarea>
          </label>
          <label>Posting Schedule
            <input name="posting_schedule" value="${escapeAttribute(merged.posting_schedule)}" placeholder="weekday mornings" />
          </label>
          <label>Interests
            <input name="interests" value="${escapeAttribute((merged.interests ?? []).join(", "))}" />
          </label>
          <label>Content Pillars
            <input name="content_pillars" value="${escapeAttribute((merged.content_pillars ?? []).join(", "))}" />
          </label>
          <label>Excluded Topics
            <input name="excluded_topics" value="${escapeAttribute((merged.excluded_topics ?? []).join(", "))}" />
          </label>
          <label>Tone
            <input name="tone" value="${escapeAttribute(merged.tone)}" />
          </label>
          <label>Shopping Bias
            <input name="shopping_bias" value="${escapeAttribute(merged.shopping_bias)}" placeholder="quality-first" />
          </label>
          <label>Operator
            <input name="operator" value="operator@example.com" />
          </label>
        </div>
        <label>Extra Metadata
          <textarea name="extra_metadata" rows="8" placeholder='{"shopping_data":["Maremagnum"],"event_websites":["https://example.com/events"],"location_notes":["Near Barceloneta"]}'>${escapeHtml(JSON.stringify(merged.extra_metadata ?? {}, null, 2))}</textarea>
        </label>
        <div class="button-row launch-actions">
          <button type="submit">Sync Marble KG</button>
        </div>
      </form>
    </section>

    <section class="audience-module" data-tremor-component="Card">
      <div class="section-title">
        <div><h3>Enrichment Feed</h3><p class="muted">Append shopping data, venues, event sites, and operator judgments as structured Marble events.</p></div>
      </div>
      <form class="profile-form" data-profile-decision-audience-id="${escapeAttribute(audience.id)}">
        <div class="launch-grid">
          <label>Decision Type
            <input name="decision_type" value="operator_enrichment" />
          </label>
          <label>Source
            <input name="source" value="dashboard" />
          </label>
          <label>Operator
            <input name="operator" value="operator@example.com" />
          </label>
        </div>
        <label>Content JSON
          <textarea name="content" rows="8" placeholder='{"shopping_data":["Passeig de Gracia"],"event_websites":["https://event-site.example"],"locations":["Barcelona waterfront"]}'>{}</textarea>
        </label>
        <div class="button-row launch-actions">
          <button type="submit" class="secondary">Store Enrichment Event</button>
        </div>
      </form>
      <details class="debug-panel">
        <summary>Graph Debug</summary>
        <pre>${debugJson || "No Marble debug payload available."}</pre>
      </details>
    </section>

    <section class="audience-module" data-tremor-component="Card">
      <div class="section-title">
        <div><h3>Runtime Controls</h3><p class="muted">Telegram, sidecar, and runtime overrides written at launch time.</p></div>
      </div>
      ${renderLaunchConfigForm(audience, instance)}
    </section>
  </div>`;
}

function renderAudienceTagBlock(label, values) {
  const items = normalizeAudienceList(values);
  return `<div class="state-card">
    <span class="state-label">${escapeHtml(label)}</span>
    <div class="pill-line">${items.length ? items.map((value) => `<span class="pill">${escapeHtml(value)}</span>`).join("") : '<span class="pill">None</span>'}</div>
  </div>`;
}

function renderAudienceHeroFact(label, value) {
  return `<div class="audience-hero-fact">
    <strong>${escapeHtml(label)}</strong>
    <span>${escapeHtml(formatStructuredText(value, "unset"))}</span>
  </div>`;
}

function renderAudienceInspector(audience, selectedDeployment, deployments) {
  return `
    <section class="panel">
      <div class="panel-inner">
        <div class="section-title">
          <div><h2>Runtime Snapshot</h2><p class="muted">Current deployment status, exact commands, and service endpoints for the selected audience.</p></div>
        </div>
        ${renderSelectedDeployment(selectedDeployment)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-inner">
        <div class="section-title">
          <div><h2>Manager Console</h2><p class="muted">Send direct operator feedback to the selected OpenClaw audience manager.</p></div>
        </div>
        ${renderOperatorConsole(audience, selectedDeployment)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-inner">
        <div class="section-title">
          <div><h2>Live Deployments</h2><p class="muted">Instance index across the factory, grouped for fast scanning.</p></div>
        </div>
        ${renderDeploymentIndex(deployments)}
      </div>
    </section>`;
}

function renderSelectedDeployment(instance) {
  if (!instance) {
    return `<div class="empty-card">No deployment selected.</div>`;
  }

  const actions = instance.source === "static"
    ? `<div class="instance-actions">
          <button type="button" data-instance-action="deploy" data-audience-id="${escapeAttribute(instance.audience_id)}">Deploy</button>
          <button type="button" data-instance-action="health" data-audience-id="${escapeAttribute(instance.audience_id)}">Health</button>
          <button type="button" data-instance-action="report" data-audience-id="${escapeAttribute(instance.audience_id)}">Report</button>
          <button type="button" data-instance-action="logs" data-audience-id="${escapeAttribute(instance.audience_id)}">Logs</button>
        </div>`
    : "";

  return `<div class="deployment-inspector">
    <div class="instance-heading">
      <strong>${escapeHtml(instance.service_name ?? instance.audience_id)}</strong>
      ${renderTremorBadge(instance.status ?? "configured", { tone: instance.status === "active" ? "success" : "neutral" })}
    </div>
    <div class="instance-meta">
      <span>Audience: ${escapeHtml(instance.audience_key ?? instance.audience_id)}</span>
      <span>Chat: ${escapeHtml(instance.telegram_chat_id || "unset")}</span>
      <span>Report: ${escapeHtml(instance.telegram_report_chat_id || "unset")}</span>
      <span>Admin: ${escapeHtml(instance.openclaw_admin_url || "unset")}</span>
      <span>Profile: ${escapeHtml(instance.profile_service_name || "unset")}</span>
      <span>LLM: ${escapeHtml(instance.llm_model || "default")}</span>
      ${instance.env_file ? `<span>Env: ${escapeHtml(instance.env_file)}</span>` : ""}
    </div>
    ${actions}
    <details class="debug-panel">
      <summary>Runtime Commands</summary>
      <div class="command-list">
        ${renderCommandBlock("OpenClaw Shell", instance.commands?.openclaw_shell)}
        ${renderCommandBlock("Profile Shell", instance.commands?.profile_shell)}
        ${renderCommandBlock("OpenClaw Env", instance.commands?.openclaw_env)}
        ${renderCommandBlock("OpenClaw Logs", instance.commands?.openclaw_logs)}
        ${renderCommandBlock("Profile Logs", instance.commands?.profile_logs)}
      </div>
    </details>
  </div>`;
}

function renderOperatorConsole(audience, selectedDeployment) {
  const audienceId = audience?.id ?? selectedDeployment?.audience_id ?? "";
  const audienceKey = audience?.audience_key ?? selectedDeployment?.audience_key ?? audienceId;
  if (!audienceId) {
    return `<div class="empty-card">Select an audience or launch a deployment to send operator feedback.</div>`;
  }
  return `<form class="profile-form" data-instance-chat-form="${escapeAttribute(audienceId)}">
    <label>Audience ID
      <input name="audience_id" value="${escapeAttribute(audienceId)}" placeholder="barcelona-family" />
    </label>
    <label>Audience Key
      <input value="${escapeAttribute(audienceKey)}" disabled />
    </label>
    <label>Message
      <textarea name="message" rows="5" placeholder="Use the new Marble enrichment data when refining venue and product selections."></textarea>
    </label>
    <label>Operator
      <input name="operator" value="operator@example.com" />
    </label>
    <div class="button-row">
      <button type="submit">Send To Instance</button>
    </div>
  </form>`;
}

function renderDeploymentIndex(deployments) {
  if (!deployments.length) {
    return `<div class="empty-card">No deployments</div>`;
  }

  return `<div class="deployment-index">
    ${deployments.map((instance) => `<div class="deployment-index-row">
      <strong>${escapeHtml(instance.audience_key ?? instance.audience_id)}</strong>
      <span>${escapeHtml(instance.service_name ?? "unset")}</span>
      ${renderTremorBadge(instance.status ?? "configured", { tone: instance.status === "active" ? "success" : "neutral" })}
    </div>`).join("")}
  </div>`;
}

function renderWorkspaceTabs(activeTab) {
  return renderTremorTabs(activeTab, ["setup", "stories", "audiences"].map((tab) => ({
    id: tab,
    label: tab[0].toUpperCase() + tab.slice(1),
    href: tab === "setup" ? "/" : `/?tab=${tab}`
  })));
}

function renderDashboardScript() {
  return `<script>
      async function sendJson(url, method, body) {
        const response = await fetch(url, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok) {
          throw new Error(parsed.error || text || "Request failed");
        }
        return parsed;
      }

      async function fileToBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = reject;
          reader.onload = () => {
            const result = String(reader.result || "");
            resolve(result.split(",").at(-1) || "");
          };
          reader.readAsDataURL(file);
        });
      }

      function setTheme(theme) {
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem("vivo-theme", theme);
        } catch {}
        const toggle = document.getElementById("theme-toggle");
        if (toggle) {
          toggle.textContent = theme === "dark" ? "Light" : "Dark";
          toggle.setAttribute("aria-label", "Switch to " + (theme === "dark" ? "light" : "dark") + " theme");
        }
      }

      setTheme(document.documentElement.dataset.theme || "light");

      document.getElementById("theme-toggle")?.addEventListener("click", () => {
        setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      });

      document.getElementById("toggle-audience-button")?.addEventListener("click", () => {
        document.getElementById("audience-drawer")?.classList.add("open");
      });

      document.getElementById("close-audience-button")?.addEventListener("click", () => {
        document.getElementById("audience-drawer")?.classList.remove("open");
      });

      document.querySelectorAll("[data-story-href]").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target.closest("a, button, input, select, textarea")) {
            return;
          }
          window.location.href = row.dataset.storyHref;
        });
      });

      document.getElementById("story-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const storyId = form.dataset.storyId;
        await sendJson("/api/stories/" + storyId, "PUT", {
          actor_id: "operator@example.com",
          changes: {
            title: form.title.value,
            story_text: form.story_text.value,
            summary: form.summary.value,
            metadata: JSON.parse(form.metadata.value || "{}")
          }
        });
        window.location.reload();
      });

      document.querySelectorAll("[data-asset-select]").forEach((button) => {
        button.addEventListener("click", async () => {
          await sendJson(button.dataset.assetSelect, "POST", {
            actor_id: "operator@example.com"
          });
          window.location.reload();
        });
      });

      document.querySelectorAll("[data-asset-replace]").forEach((button) => {
        button.addEventListener("click", async () => {
          const container = button.closest("[data-asset-card]");
          const input = container.querySelector("input[type=file]");
          const file = input.files[0];
          if (!file) {
            alert("Choose a file first.");
            return;
          }
          await sendJson(button.dataset.assetReplace, "POST", {
            actor_id: "operator@example.com",
            file_name: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size,
            file_data_base64: await fileToBase64(file)
          });
          window.location.reload();
        });
      });

      document.querySelectorAll("[data-review-status]").forEach((button) => {
        button.addEventListener("click", async () => {
          const form = document.getElementById("review-form");
          await sendJson("/api/stories/" + form.dataset.storyId + "/reviews", "POST", {
            actor_id: "operator@example.com",
            review_status: button.dataset.reviewStatus,
            review_notes: form.review_notes.value,
            selected_asset_id: form.selected_asset_id.value || null
          });
          window.location.reload();
        });
      });

      document.getElementById("queue-publication-button")?.addEventListener("click", async (event) => {
        await sendJson("/api/stories/" + event.currentTarget.dataset.storyId + "/publications", "POST", {
          actor_id: "operator@example.com"
        });
        window.location.reload();
      });

      document.getElementById("audience-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        await sendJson("/api/audiences/" + form.dataset.audienceId, "PUT", {
          actor_id: "operator@example.com",
          changes: {
            label: form.label.value,
            language: form.language.value,
            location: form.location.value,
            family_context: form.family_context.value,
            interests: splitList(form.interests.value),
            content_pillars: splitList(form.content_pillars.value),
            excluded_topics: splitList(form.excluded_topics.value),
            tone: form.tone.value,
            status: form.status.value,
            profile_snapshot: JSON.parse(form.profile_snapshot.value || "{}")
          }
        });
        window.location.reload();
      });

      document.getElementById("import-audience-file-button")?.addEventListener("click", async () => {
        const preview = await sendJson("/api/audiences/import-preview", "POST", {});
        await sendJson("/api/audiences/import-confirm", "POST", {
          items: preview.items ?? []
        });
        window.location.href = "/?tab=audiences";
      });

      document.getElementById("create-audience-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        await sendJson("/api/audiences/create", "POST", {
          raw_text: form.raw_text.value
        });
        window.location.href = "/?tab=audiences";
      });

      function splitList(value) {
        return value.split(",").map((item) => item.trim()).filter(Boolean);
      }

      function parseJsonField(value, fallback = {}) {
        const trimmed = String(value || "").trim();
        if (!trimmed) {
          return fallback;
        }
        return JSON.parse(trimmed);
      }

      function formRuntimeConfig(form) {
        return Object.fromEntries(
          [...new FormData(form).entries()]
            .map(([key, value]) => [key, String(value || "").trim()])
            .filter(([, value]) => value)
        );
      }

      async function postInstance(url, payload) {
        try {
          const result = await sendJson(url, "POST", payload);
          if (result.stdout || result.reply || result.status) {
            alert(JSON.stringify(result, null, 2));
          }
          window.location.reload();
        } catch (error) {
          alert(error.message);
        }
      }

      async function getJson(url) {
        const response = await fetch(url);
        const text = await response.text();
        if (!response.ok) {
          throw new Error(text);
        }
        return text ? JSON.parse(text) : {};
      }

      document.getElementById("deploy-all-button")?.addEventListener("click", async () => {
        await postInstance("/api/instances/deploy", { operator: "operator@example.com" });
      });

      document.querySelectorAll("[data-instance-action]").forEach((button) => {
        button.addEventListener("click", async () => {
          const audienceId = button.dataset.audienceId;
          const action = button.dataset.instanceAction;
          if (action === "deploy") {
            await postInstance("/api/instances/" + audienceId + "/deploy", { operator: "operator@example.com" });
            return;
          }
          const result = await getJson("/api/instances/" + audienceId + "/" + action + (action === "logs" ? "?tail=200" : ""));
          alert(JSON.stringify(result, null, 2));
          window.location.reload();
        });
      });

      document.querySelectorAll("form[data-launch-audience-id]").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          await postInstance("/api/audiences/" + form.dataset.launchAudienceId + "/launch", {
            operator: "operator@example.com",
            runtime_config: formRuntimeConfig(form)
          });
        });
      });

      document.querySelectorAll("form[data-profile-facts-audience-id]").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          await postInstance("/api/audiences/" + form.dataset.profileFactsAudienceId + "/profile-facts", {
            actor_id: form.operator.value || "operator@example.com",
            facts: {
              label: form.label.value,
              location: form.location.value,
              family_context: form.family_context.value,
              interests: splitList(form.interests.value),
              content_pillars: splitList(form.content_pillars.value),
              excluded_topics: splitList(form.excluded_topics.value),
              tone: form.tone.value,
              shopping_bias: form.shopping_bias.value,
              posting_schedule: form.posting_schedule.value,
              extra_metadata: parseJsonField(form.extra_metadata.value, {})
            }
          });
        });
      });

      document.querySelectorAll("form[data-profile-decision-audience-id]").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          await postInstance("/api/audiences/" + form.dataset.profileDecisionAudienceId + "/profile-decisions", {
            actor_id: form.operator.value || "operator@example.com",
            decisionType: form.decision_type.value || "operator_enrichment",
            source: form.source.value || "dashboard",
            content: parseJsonField(form.content.value, {})
          });
        });
      });

      document.getElementById("chat-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        await postInstance("/api/instances/" + form.audience_id.value + "/chat", {
          operator: form.operator.value || "operator@example.com",
          message: form.message.value || ""
        });
      });

      document.querySelectorAll("form[data-instance-chat-form]").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          await postInstance("/api/instances/" + form.dataset.instanceChatForm + "/chat", {
            operator: form.operator.value || "operator@example.com",
            message: form.message.value || ""
          });
        });
      });
    </script>`;
}

function renderAssetCard(story, asset) {
  const selected = asset.is_selected ? " selected" : "";
  const replaceUrl = `/api/stories/${story.id}/assets/${asset.id}/replace`;
  const selectUrl = `/api/stories/${story.id}/assets/${asset.id}/select`;
  const previewUrl = asset.preview_url ?? asset.download_url ?? asset.source_asset_url ?? "";
  const preview = previewUrl
    ? renderAssetPreview(asset, previewUrl)
    : escapeHtml(asset.storage_object?.file_name ?? asset.source_asset_url ?? `${asset.asset_type} asset`);

  return `<article class="asset-card${selected}" data-asset-card>
    <div class="asset-preview">${preview}</div>
    <div class="muted">${escapeHtml(asset.asset_type)} · ${escapeHtml(asset.status)} · ${asset.is_selected ? "selected" : "not selected"}</div>
    <div class="button-row" style="margin-top:10px;">
      <button type="button" class="secondary" data-asset-select="${escapeAttribute(selectUrl)}">Select</button>
    </div>
    <label style="margin-top:10px;">Replace Asset
      <input type="file" accept="image/*,video/mp4" />
    </label>
    <div class="button-row" style="margin-top:10px;">
      <button type="button" data-asset-replace="${escapeAttribute(replaceUrl)}">Upload Replacement</button>
    </div>
  </article>`;
}

function renderSetupChecklist(setupStatus) {
  const checks = setupStatus?.checks ?? {};
  return `<ul class="compact">
    ${Object.entries(checks).map(([key, value]) => `<li><strong>${escapeHtml(humanizeCheckName(key))}</strong> <span>${escapeHtml(value?.ok ? "ok" : "missing")}</span> <span>${escapeHtml(value?.message ?? "")}</span></li>`).join("")}
  </ul>`;
}

function renderAudienceImportPanel(preview) {
  if (!preview) {
    return `<div class="empty-card">Audience import is not configured.</div>`;
  }
  const sourceLabel = preview.source_file_name ?? "No audience source";
  const itemCount = preview.items?.length ?? preview.item_count ?? 0;
  const summary = preview.error
    ? escapeHtml(preview.error)
    : preview.import_required
      ? `${itemCount} audience updates ready to import`
      : "No audience import required";
  return `<div class="empty-card">
    <strong>Source</strong>
    <div class="muted">${escapeHtml(sourceLabel)}</div>
    <div class="muted">LLM expansion runs before Supabase write.</div>
    <div class="muted">${summary}</div>
    ${preview.import_required ? `<div class="button-row" style="margin-top:10px;"><button type="button" id="import-audience-file-button">Import ${escapeHtml(sourceLabel)}</button></div>` : ""}
  </div>`;
}

function renderLaunchConfigForm(audience, instance) {
  const runtime = instance?.runtime_config ?? {};
  const value = (key, fallback = "") => escapeAttribute(runtime[key] ?? instance?.[key] ?? fallback);
  return `<form class="launch-config" data-launch-audience-id="${escapeAttribute(audience.id)}">
    <div class="launch-grid">
      <label>Telegram Bot Token
        <input name="telegram_bot_token" value="${value("telegram_bot_token")}" autocomplete="off" required />
      </label>
      <label>Telegram Channel ID
        <input name="telegram_chat_id" value="${value("telegram_chat_id")}" placeholder="-100..." required />
      </label>
      <label>Telegram Report ID
        <input name="telegram_report_chat_id" value="${value("telegram_report_chat_id", runtime.telegram_chat_id ?? "")}" placeholder="-100..." />
      </label>
      <label>OpenClaw Admin URL
        <input name="openclaw_admin_url" value="${value("openclaw_admin_url")}" placeholder="http://127.0.0.1:7610" />
      </label>
      <label>Profile Base URL
        <input name="plugin_base_url" value="${value("plugin_base_url", instance?.profile_base_url ?? "")}" placeholder="http://127.0.0.1:5410" />
      </label>
      <label>Profile Engine Image
        <input name="profile_engine_image" value="${value("profile_engine_image")}" placeholder="ghcr.io/openclaw/marble-profile-service:latest" />
      </label>
      <label>Profile Engine Command
        <input name="profile_engine_command" value="${value("profile_engine_command")}" placeholder="node api/profile-server.js" />
      </label>
      <label>Profile Health Path
        <input name="profile_engine_health_path" value="${value("profile_engine_health_path", "/healthz")}" placeholder="/healthz" />
      </label>
      <label>Profile Storage Path
        <input name="profile_storage_path" value="${value("profile_storage_path")}" placeholder="/srv/marble-profile" />
      </label>
      <label>LLM Provider
        <input name="llm_provider" value="${value("llm_provider", "openai")}" />
      </label>
      <label>LLM Model
        <input name="llm_model" value="${value("llm_model")}" placeholder="global default" />
      </label>
      <label>LLM Base URL
        <input name="llm_base_url" value="${value("llm_base_url")}" placeholder="global default" />
      </label>
    </div>
    <div class="button-row launch-actions">
      <button type="submit">Launch Deployment</button>
    </div>
  </form>`;
}

function formatStructuredText(value, fallback = "") {
  const parts = dedupeStrings(flattenStructuredValue(value));
  return parts.length ? parts.join(", ") : fallback;
}

function normalizeAudienceList(values) {
  if (Array.isArray(values)) {
    return dedupeStrings(values.flatMap((value) => flattenStructuredValue(value)));
  }
  if (typeof values === "string") {
    return dedupeStrings(values.split(",").map((value) => value.trim()).filter(Boolean));
  }
  return dedupeStrings(flattenStructuredValue(values));
}

function flattenStructuredValue(value) {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStructuredValue(item));
  }
  if (typeof value === "object") {
    const preferredKeys = ["label", "name", "title", "value", "city", "country", "region", "marital_status", "relation", "age_range", "type"];
    const preferredValues = preferredKeys.flatMap((key) => (
      Object.prototype.hasOwnProperty.call(value, key) ? flattenStructuredValue(value[key]) : []
    ));
    if (preferredValues.length) {
      return preferredValues;
    }
    return Object.values(value).flatMap((item) => flattenStructuredValue(item));
  }
  const normalized = String(value).trim();
  return normalized ? [normalized] : [];
}

function dedupeStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

function buildAudienceWorkspaceHref(audienceId) {
  const url = new URL("http://localhost/");
  url.searchParams.set("tab", "audiences");
  if (audienceId) {
    url.searchParams.set("audience_id", audienceId);
  }
  return `${url.pathname}${url.search}`;
}

function humanizeCheckName(value) {
  return String(value).replaceAll("_", " ");
}

function renderAssetPreview(asset, previewUrl) {
  if (asset.asset_type === "video") {
    return `<video class="asset-preview-media" controls src="${escapeAttribute(previewUrl)}"></video>`;
  }
  return `<img class="asset-preview-media" src="${escapeAttribute(previewUrl)}" alt="${escapeAttribute(asset.asset_slot ?? asset.asset_type ?? "asset")}" />`;
}

function renderCommandBlock(label, command) {
  if (!command) {
    return "";
  }
  return `<div class="command-block"><strong>${escapeHtml(label)}</strong><code>${escapeHtml(command)}</code></div>`;
}

function renderAudienceFields(audience) {
  return `
    <label>Label
      <input name="label" value="${escapeAttribute(audience.label ?? "")}" />
    </label>
    <label>Language
      <input name="language" value="${escapeAttribute(audience.language ?? "")}" />
    </label>
    <label>Location
      <input name="location" value="${escapeAttribute(audience.location ?? "")}" />
    </label>
    <label>Family Context
      <textarea name="family_context">${escapeHtml(audience.family_context ?? "")}</textarea>
    </label>
    <label>Interests
      <input name="interests" value="${escapeAttribute((audience.interests ?? []).join(", "))}" />
    </label>
    <label>Content Pillars
      <input name="content_pillars" value="${escapeAttribute((audience.content_pillars ?? []).join(", "))}" />
    </label>
    <label>Excluded Topics
      <input name="excluded_topics" value="${escapeAttribute((audience.excluded_topics ?? []).join(", "))}" />
    </label>
    <label>Tone
      <input name="tone" value="${escapeAttribute(audience.tone ?? "")}" />
    </label>
    <label>Status
      <input name="status" value="${escapeAttribute(audience.status ?? "")}" />
    </label>
  `;
}

function renderStatusOptions(selected) {
  return renderOptions(["", "new", "classifying", "classified", "media_decided", "assets_collected", "asset_generating", "ready_to_publish", "published", "failed", "archived"], selected, "All statuses");
}

function renderReviewOptions(selected) {
  return renderOptions(["", "pending", "approved", "rejected", "changes_requested"], selected, "All review states");
}

function renderStatusBadge(status) {
  const value = status ?? "unknown";
  const tone = value === "ready_to_publish" || value === "published"
    ? "success"
    : value === "failed" || value === "changes_requested"
      ? "warning"
      : "neutral";
  return renderTremorBadge(value, { tone });
}

function renderReviewBadge(status) {
  const value = status ?? "pending";
  const tone = value === "approved"
    ? "approved"
    : value === "changes_requested" || value === "rejected"
      ? "warning"
      : "neutral";
  return renderTremorBadge(value, { tone });
}

function truncateText(value, length) {
  const text = String(value ?? "").replaceAll(/\s+/g, " ").trim();
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, Math.max(0, length - 1)).trim()}...`;
}

function formatShortDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString().slice(0, 10);
}

function renderOptions(values, selected, blankLabel) {
  return values.map((value) => {
    const label = value === "" ? blankLabel : value;
    return `<option value="${escapeAttribute(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function buildDashboardHref(filters, storyId) {
  const url = new URL("http://localhost/");
  url.searchParams.set("tab", "stories");
  if (filters.status) {
    url.searchParams.set("status", filters.status);
  }
  if (filters.review_status) {
    url.searchParams.set("review_status", filters.review_status);
  }
  if (filters.audience_id) {
    url.searchParams.set("audience_id", filters.audience_id);
  }
  if (filters.search) {
    url.searchParams.set("search", filters.search);
  }
  if (storyId) {
    url.searchParams.set("story_id", storyId);
  }
  return `${url.pathname}${url.search}`;
}

function normalizeDashboardTab(query = {}) {
  const value = query.tab ?? "setup";
  return ["setup", "stories", "audiences"].includes(value) ? value : "setup";
}

function normalizeStoryFilters(query = {}) {
  return {
    status: query.status ?? "",
    review_status: query.review_status ?? "",
    audience_id: query.audience_id ?? "",
    search: query.search ?? ""
  };
}

function ensureInstanceManager(instanceManager) {
  if (!instanceManager) {
    throw new Error("instanceManager is required for instance endpoints");
  }
}

async function safeLoad(loader, fallback) {
  try {
    return await loader();
  } catch {
    return fallback;
  }
}

function shouldSkipStoryDataLoad(setupStatus) {
  const checks = setupStatus?.checks ?? {};
  if (checks.supabase_config?.ok !== true) {
    return false;
  }
  return checks.supabase_connection?.ok === false || checks.supabase_schema?.ok === false;
}

function defaultSetupStatus() {
  return {
    ready: true,
    llm: {
      provider: "",
      model: ""
    },
    checks: {
      story_admin: { ok: true, message: "Dashboard available" }
    }
  };
}

function json(status, data) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  };
}

function html(status, body) {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body
  };
}

function matchPath(value, pattern) {
  return pattern.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
