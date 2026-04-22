import {
  TREMOR_DASHBOARD_FRAMEWORK,
  renderTremorBadge,
  renderTremorCard,
  renderTremorFrameworkMeta,
  renderTremorMetric,
  renderSidebarNav
} from "./tremor-dashboard.js";
import { getSourcesForAudience } from "./sources-catalog.js";

export function createApp(options) {
  const repository = options.repository;
  const instanceManager = options.instanceManager ?? null;
  const profileClientFactory = options.profileClientFactory ?? null;
  const setupService = options.setupService ?? null;
  const audienceImportService = options.audienceImportService ?? null;
  const audienceManagerLauncher = options.audienceManagerLauncher ?? null;
  const publicationTargetResolver = options.publicationTargetResolver ?? (() => null);
  const clock = options.clock ?? (() => new Date().toISOString());
  const dispatchFetch = options.dispatchFetch ?? null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const audienceRuntimeConfig = options.audienceRuntimeConfig ?? {};
  const runtimeStatusService = options.runtimeStatusService ?? null;

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
          dispatchFetch,
          fetchImpl,
          clock,
          audienceRuntimeConfig,
          runtimeStatusService,
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
    dispatchFetch,
    fetchImpl,
    clock,
    audienceRuntimeConfig,
    runtimeStatusService,
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

  // POST /api/audiences/create-full — wizard 3-step create
  if (request.method === "POST" && request.pathname === "/api/audiences/create-full") {
    if (!audienceImportService?.createAudience) {
      return json(404, { error: "Audience creation is not configured." });
    }
    const body = readBody(request.body);
    const details = body.details ?? {};
    const channels = body.channels ?? {};
    const photo = body.photo ?? null;

    const label = String(details.label ?? "").trim();
    const profileRawText = String(details.profile_raw_text ?? details.description ?? "").trim();
    const botToken = String(channels.telegram_bot_token ?? "").trim();
    const chatId = String(channels.telegram_chat_id ?? "").trim();

    if (!label) return json(400, { error: "details.label is required." });
    if (!profileRawText) return json(400, { error: "details.profile_raw_text is required." });
    if (!botToken) return json(400, { error: "channels.telegram_bot_token is required." });
    if (!chatId) return json(400, { error: "channels.telegram_chat_id is required." });
    if (photo) {
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(photo.mime_type)) return json(400, { error: "photo.mime_type must be jpeg, png, webp, or gif." });
      if ((photo.size_bytes ?? 0) > 5 * 1024 * 1024) return json(400, { error: "Photo must be under 5 MB." });
    }

    const rawText = [
      label,
      details.description && details.description !== label ? details.description : null,
      details.location ? `Location: ${details.location}` : null,
      details.interests?.length ? `Interests: ${details.interests.join(", ")}` : null,
      profileRawText !== label ? profileRawText : null,
    ].filter(Boolean).join(". ");

    const result = await audienceImportService.createAudience({
      raw_text: rawText,
      initial_status: "new",
      channels: { telegram_bot_token: botToken, telegram_chat_id: chatId, posting_schedule: channels.posting_schedule ?? "twice_daily" }
    });

    let photoUrl = null;
    if (photo && result.audience?.id) {
      try {
        photoUrl = await repository.storeAudiencePhoto(result.audience.id, photo);
      } catch (err) {
        console.error("[create-full] photo upload failed:", err.message);
      }
    }

    return json(200, {
      audience_id: result.audience?.id,
      audience_key: result.audience?.audience_key,
      photo_url: photoUrl,
      status: "new"
    });
  }

  // GET /api/audiences/:id/runtime-status
  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/runtime-status$/)) {
    const audienceKey = request.pathname.split("/")[3];
    if (!runtimeStatusService) {
      return json(200, { openclaw: "unknown", marble: "unknown" });
    }
    const audiences = await safeLoad(() => repository.listAudiences(), []);
    const audience = audiences.find(a => a.audience_key === audienceKey || a.id === audienceKey);
    if (!audience) return json(404, { error: "Audience not found" });
    const status = await runtimeStatusService.getStatus(audience.audience_key);
    return json(200, status);
  }

  if (request.method === "POST" && request.pathname === "/api/audiences/infer-from-posts") {
    if (!audienceImportService?.inferFromPosts) {
      return json(404, { error: "Post inference is not configured." });
    }
    const body = readBody(request.body);
    const twitterHandle = String(body.twitter_handle ?? "").trim().replace(/^@+/, "");
    const postsText = String(body.posts_text ?? "").trim();
    if (!twitterHandle && !postsText) {
      return json(400, { error: "twitter_handle or posts_text is required." });
    }
    return json(200, await audienceImportService.inferFromPosts({
      twitterHandle: twitterHandle || null,
      postsText: postsText || null
    }));
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
    const hasAssets = (story.assets?.length ?? 0) > 0;
    const selectedAssetId = body.selected_asset_id ?? story.selected_asset_id ?? null;
    if (body.review_status === "approved" && hasAssets && !selectedAssetId) {
      return json(409, { error: "An approved review requires a selected asset when the story has assets." });
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

  if (request.method === "GET" && /^\/api\/instances\/[^/]+\/chat\/history$/.test(request.pathname)) {
    const audienceId = decodeURIComponent(request.pathname.split("/")[3]);
    const conv = await repository.getOrCreateConversation(audienceId, "operator_console");
    const messages = await repository.getConversationMessages(conv.id);
    return json(200, { messages });
  }

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/instances\/([^/]+)\/chat$/)) {
    ensureInstanceManager(instanceManager);
    const audienceId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const message = body.message ?? "";
    const operator = body.operator ?? body.actor_id ?? "unknown";

    const conv = await repository.getOrCreateConversation(audienceId, "operator_console");

    await repository.appendChatMessage(conv.id, {
      audienceId,
      role: "user",
      content: message,
      senderId: operator,
      senderName: operator,
      metadata: {}
    });

    const result = await instanceManager.chatWithInstance(audienceId, { operator, message });
    const reply = result.reply ?? result.stdout ?? "";

    await repository.appendChatMessage(conv.id, {
      audienceId,
      role: "assistant",
      content: reply,
      senderId: "assistant",
      senderName: "AI",
      metadata: {}
    });

    repository.saveOperatorChat({
      audience_id: audienceId,
      operator,
      message,
      response: result,
      timestamp: clock()
    });

    return json(200, { reply, conversationId: conv.id });
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
    const merchants = activeTab === "merchants"
      ? await safeLoad(() => repository.listMerchants(), [])
      : [];
    const activeMerchantId = request.query?.merchant_id ?? "";
    const activeMerchant = activeMerchantId && activeTab === "merchants"
      ? await safeLoad(() => repository.getMerchant(activeMerchantId), null)
      : null;
    const activeMerchantOverrides = activeMerchant
      ? await safeLoad(() => repository.listMerchantOverrides(activeMerchantId), [])
      : [];
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
    const selectedAudienceId = request.query?.audience_id ?? "";
    const selectedAudience = selectAudience(audiences, selectedAudienceId);
    const chatHistory = selectedAudience && activeTab === "audiences"
      ? await (async () => {
          const conv = await repository.getOrCreateConversation(selectedAudience.audience_key, "operator_console");
          return repository.getConversationMessages(conv.id);
        })()
      : [];
    return html(200, renderDashboard({
      activeTab,
      selectedAudienceId,
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
      instances,
      chatHistory,
      merchants,
      activeMerchant,
      activeMerchantOverrides,
      audienceRuntimeConfig
    }));
  }

  // POST /api/audiences/:id/fetch-content
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/fetch-content$/)) {
    if (!dispatchFetch) {
      return json(404, { error: "Content fetching is not configured." });
    }
    const rawAudienceId = request.pathname.split("/")[3];
    let audience = await safeLoad(() => repository.getAudience(rawAudienceId), null);
    if (!audience) {
      const all = await safeLoad(() => repository.listAudiences(), []);
      audience = all.find(a => a.audience_key === rawAudienceId) ?? null;
    }
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const body = readBody(request.body);
    const instance = typeof repository.getInstanceByAudience === "function"
      ? await safeLoad(() => repository.getInstanceByAudience(audience.id), null)
      : null;
    let jobId = null;
    try {
      const job = await repository.createJob({ audience_id: audience.id }, { timestamp: clock() });
      jobId = job?.id ?? null;
    } catch {
      // jobs table may not exist; proceed without tracking
    }
    dispatchFetch(audience, instance, jobId, { limit: body.limit ?? 20 }).catch((err) => {
      if (jobId) repository.updateJob(jobId, { status: "failed", error: String(err.message ?? err).slice(0, 500) }).catch(() => {});
    });
    return json(200, { job_id: jobId });
  }

  // GET /api/jobs/:jobId
  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/jobs\/([^/]+)$/)) {
    const jobId = request.pathname.split("/")[3];
    const job = await repository.getJob(jobId);
    return job ? json(200, job) : json(404, { error: "Job not found" });
  }

  // POST /api/audiences/:id/sources
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/sources$/)) {
    const audienceId = request.pathname.split("/")[3];
    const audience = await repository.getAudience(audienceId);
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const body = readBody(request.body);
    const source = body.source ?? {};
    if (!source.url && !source.merchant_id) {
      return json(400, { error: "source must have url or merchant_id" });
    }
    const instance = typeof repository.getInstanceByAudience === "function"
      ? await safeLoad(() => repository.getInstanceByAudience(audienceId), null)
      : null;
    if (!instance) {
      return json(404, { error: "No instance configured for this audience." });
    }
    const { randomUUID } = await import("node:crypto");
    const newSource = { id: randomUUID(), ...source };
    const customSources = instance.runtime_config?.custom_sources ?? [];
    await repository.updateInstance(instance.id, {
      runtime_config: { ...instance.runtime_config, custom_sources: [...customSources, newSource] }
    }, { actorId: "system", timestamp: clock() });
    return json(200, { source_id: newSource.id });
  }

  // POST /api/audiences/:id/sources/seed
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/sources\/seed$/)) {
    const audienceId = request.pathname.split("/")[3];
    let audience = await safeLoad(() => repository.getAudience(audienceId), null);
    if (!audience) {
      const all = await safeLoad(() => repository.listAudiences(), []);
      audience = all.find(a => a.audience_key === audienceId) ?? null;
    }
    if (!audience) return json(404, { error: "Audience not found" });
    let instance = typeof repository.getInstanceByAudience === "function"
      ? await safeLoad(() => repository.getInstanceByAudience(audience.id), null)
      : null;
    if (!instance && repository.createInstanceForAudience) {
      const audienceKey = audience.audience_key ?? audience.id;
      const rconf = audienceRuntimeConfig?.[audienceKey] ?? {};
      instance = await repository.createInstanceForAudience(
        audience,
        buildAudienceInstance(audience, rconf),
        { actorId: "system", timestamp: clock() }
      );
    }
    if (!instance) return json(404, { error: "No instance configured for this audience." });

    const body = readBody(request.body);
    const catalogSources = getSourcesForAudience({
      city: body.city ?? audience.location ?? "",
      passions: body.passions ?? [],
      foodPreferences: body.foodPreferences ?? [],
      movieGenres: body.movieGenres ?? [],
    });

    const { randomUUID } = await import("node:crypto");
    const existing = new Set((instance.runtime_config?.custom_sources ?? []).map(s => s.id));
    const toAdd = catalogSources.filter(s => !existing.has(s.id));
    if (toAdd.length === 0) return json(200, { added: 0 });

    const newSources = [...(instance.runtime_config?.custom_sources ?? []), ...toAdd];
    await repository.updateInstance(instance.id, {
      runtime_config: { ...instance.runtime_config, custom_sources: newSources }
    }, { actorId: "system", timestamp: clock() });

    return json(200, { added: toAdd.length, sources: toAdd.map(s => s.id) });
  }

  // POST /api/audiences/:id/publish-recap
  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/publish-recap$/)) {
    const audienceId = request.pathname.split("/")[3];
    let audience = await safeLoad(() => repository.getAudience(audienceId), null);
    if (!audience) {
      const all = await safeLoad(() => repository.listAudiences(), []);
      audience = all.find(a => a.audience_key === audienceId) ?? null;
    }
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const body = readBody(request.body);
    const instance = typeof repository.getInstanceByAudience === "function"
      ? await safeLoad(() => repository.getInstanceByAudience(audience.id), null)
      : null;
    const botToken = instance?.runtime_config?.telegram_bot_token ?? "";
    const chatId = instance?.runtime_config?.telegram_chat_id ?? "";
    if (!botToken || !chatId) {
      return json(409, { error: "No Telegram bot token or chat_id configured for this audience." });
    }
    const allReady = (await repository.listStories({ audience_id: audience.id }))
      .filter((s) => s.status === "ready_to_publish" && s.operator_review_status === "approved");
    const toPublish = body.story_ids?.length
      ? allReady.filter((s) => body.story_ids.includes(s.id))
      : allReady;

    let published = 0;
    for (const story of toPublish) {
      try {
        const message = [
          `<b>${escapeHtml(story.title)}</b>`,
          story.story_text ? escapeHtml(story.story_text.slice(0, 800)) : "",
          story.primary_source_url ? `<a href="${story.primary_source_url}">Read more</a>` : ""
        ].filter(Boolean).join("\n\n");
        const sendRes = await fetchImpl(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" })
          }
        );
        if (!sendRes.ok) {
          const errText = await sendRes.text().catch(() => "");
          throw new Error(`Telegram sendMessage failed: ${sendRes.status} ${errText.slice(0, 100)}`);
        }
        await repository.transitionStoryStatus(story.id, "published", {
          actorId: "system",
          timestamp: clock()
        });
        await repository.updateStory(story.id, {
          metadata: { ...story.metadata, published_at: clock() }
        }, { actorId: "system", timestamp: clock() });
        published++;
      } catch (err) {
        console.error(`[publish-recap] Failed to publish story ${story.id}:`, err.message);
        try {
          await repository.transitionStoryStatus(story.id, "failed", {
            actorId: "system",
            timestamp: clock()
          });
        } catch {}
      }
    }
    return json(200, { published });
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/merchants$/)) {
    const items = await safeLoad(() => repository.listMerchants(), []);
    return json(200, { items });
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/merchants\/([^/]+)\/overrides$/)) {
    const merchantId = request.pathname.split("/")[3];
    const items = await safeLoad(() => repository.listMerchantOverrides(merchantId), []);
    return json(200, { items });
  }

  if (request.method === "PUT" && matchPath(request.pathname, /^\/api\/merchants\/([^/]+)\/overrides\/([^/]+)$/)) {
    const parts = request.pathname.split("/");
    const merchantId = parts[3];
    const audienceId = parts[5];
    const body = readBody(request.body);
    const override = await repository.upsertMerchantOverride(merchantId, audienceId, {
      enabled: body.enabled,
      boost_tags: body.boost_tags
    });
    return json(200, override);
  }

  if (request.method === "GET" && matchPath(request.pathname, /^\/api\/merchants\/([^/]+)$/)) {
    const merchantId = request.pathname.split("/")[3];
    const merchant = await safeLoad(() => repository.getMerchant(merchantId), null);
    return merchant ? json(200, merchant) : json(404, { error: "Merchant not found" });
  }

  if (request.method === "PUT" && matchPath(request.pathname, /^\/api\/merchants\/([^/]+)$/)) {
    const merchantId = request.pathname.split("/")[3];
    const body = readBody(request.body);
    const merchant = await repository.updateMerchant(merchantId, {
      publisher_id: body.publisher_id,
      enabled: body.enabled,
      disclosure_text: body.disclosure_text,
      categories: body.categories
    });
    return json(200, merchant);
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
    : `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">Select a story to review assets.</div>`;
  const publicationItems = model.activeStory?.publications?.length
    ? model.activeStory.publications.map((publication) => `<li class="flex items-start justify-between gap-3 py-2.5 text-sm"><strong class="text-gray-900 dark:text-gray-100">${escapeHtml(publication.channel)}</strong> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(publication.status)}</span> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(publication.target_identifier)}</span></li>`).join("")
    : `<li class="py-2.5 text-sm text-gray-500 dark:text-gray-400">No queued publications</li>`;
  const reviewItems = model.activeStory?.reviews?.length
    ? model.activeStory.reviews.map((review) => `<li class="flex items-start justify-between gap-3 py-2.5 text-sm"><strong class="text-gray-900 dark:text-gray-100">${escapeHtml(review.review_status)}</strong> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(review.actor_id)}</span> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(review.review_notes ?? "")}</span></li>`).join("")
    : `<li class="py-2.5 text-sm text-gray-500 dark:text-gray-400">No review history</li>`;
  const auditItems = model.auditItems.length
    ? model.auditItems.map((item) => `<li class="flex items-start justify-between gap-3 py-2.5 text-sm"><strong class="text-gray-900 dark:text-gray-100">${escapeHtml(item.type)}</strong> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(item.timestamp ?? "")}</span></li>`).join("")
    : `<li class="py-2.5 text-sm text-gray-500 dark:text-gray-400">No audit events</li>`;
  const analyticsItems = model.analyticsItems.length
    ? model.analyticsItems.map((item) => `<li class="flex items-start justify-between gap-3 py-2.5 text-sm"><strong class="text-gray-900 dark:text-gray-100">${escapeHtml(item.story_id ?? item.topic ?? "feedback")}</strong> <span class="text-gray-500 dark:text-gray-400">${escapeHtml(String(item.engagement_score ?? 0))}</span></li>`).join("")
    : `<li class="py-2.5 text-sm text-gray-500 dark:text-gray-400">No analytics snapshots</li>`;

  const metadataJson = escapeHtml(JSON.stringify(model.activeStory?.metadata ?? {}, null, 2));
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
  const merchantDrawerPortal = activeTab === "merchants" && model.activeMerchant
    ? renderMerchantDrawer({ merchant: model.activeMerchant, overrides: model.activeMerchantOverrides ?? [], audiences: model.audiences ?? [] })
    : "";
  const audienceDrawerPortal = activeTab === "audiences" && model.selectedAudienceId && selectedAudience
    ? renderAudienceDrawer({
        audience: selectedAudience,
        instance: selectedAudienceInstance,
        profileState: selectedProfileState,
        deployment: selectedDeployment,
        deployments,
        chatHistory: model.chatHistory ?? []
      })
    : "";
  const workspace = activeTab === "stories"
    ? renderStoriesWorkspace({
        model,
        storyTableRows,
        audienceOptions,
        auditItems,
        analyticsItems
      })
    : activeTab === "audiences"
      ? renderAudiencesWorkspace({
          model,
          deployments,
          selectedAudience,
          selectedAudienceInstance,
          selectedProfileState,
          selectedDeployment,
          chatHistory: model.chatHistory ?? []
        })
      : activeTab === "merchants"
        ? renderMerchantsWorkspace({ merchants: model.merchants ?? [], activeMerchant: model.activeMerchant ?? null, overrides: model.activeMerchantOverrides ?? [], audiences: model.audiences ?? [] })
        : renderSetupWorkspace({
            model,
            setupChecklist,
            audienceImportPanel
          });

  return `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    ${renderTremorFrameworkMeta()}
    <title>Vivo Factory</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/styles.css" />
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
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
  </head>
  <body class="h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
    <div class="flex h-full overflow-hidden">

      ${renderSidebarNav(activeTab)}

      <div class="flex flex-1 flex-col overflow-hidden min-w-0">
        <main class="flex-1 overflow-y-auto" data-ui-framework="${TREMOR_DASHBOARD_FRAMEWORK}">
          <div class="px-6 py-6">
            ${workspace}
          </div>
        </main>
      </div>
    </div>

    ${drawerPortal}
    ${merchantDrawerPortal}
    ${audienceDrawerPortal}
    ${renderAudienceWizard()}
    ${renderDashboardScript()}
  </body>
</html>`;
}

function renderSetupWorkspace({ model, setupChecklist, audienceImportPanel }) {
  return `<div>
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Setup</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Supabase, LLM configuration, and audience provisioning.</p>
    </div>
    <div class="grid grid-cols-2 gap-6 items-start">
    <div class="space-y-5">
      <dl class="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div class="bg-white dark:bg-gray-800 px-5 py-4">
          <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Setup state</dt>
          <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(model.setupStatus?.ready ? "Ready" : "Open")}</dd>
        </div>
        <div class="bg-white dark:bg-gray-800 px-5 py-4">
          <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Audiences</dt>
          <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(String(model.audiences.length))}</dd>
        </div>
        <div class="bg-white dark:bg-gray-800 px-5 py-4">
          <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">LLM model</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 truncate">${escapeHtml(model.setupStatus?.llm?.model ?? "unset")}</dd>
        </div>
      </dl>
      <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Setup Checklist</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Supabase, schema, LLM, and dashboard readiness.</p>
          </div>
          <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(model.setupStatus?.ready ? "ready" : "action required")}</span>
        </div>
        <div class="px-5 py-4">${setupChecklist}</div>
      </div>
    </div>
    <div class="space-y-5">
      <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Create Audiences</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Import audience.md or create one investigated profile. Instances are not prepared until launch.</p>
          </div>
          <button onclick="openAudienceWizard()" class="btn btn-accent btn-sm shrink-0">+ New Audience</button>
        </div>
        <div class="px-5 py-4 space-y-5">
          ${audienceImportPanel}
          <div class="border-t border-gray-200 dark:border-gray-700 pt-5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Create One Audience</h3>
            <form id="create-audience-form" class="space-y-3">
              <label class="block">
                <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Twitter handle</span>
                <input name="twitter_handle" type="text" placeholder="@username"
                       class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </label>
              <label class="block">
                <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Twitter extract (.txt)</span>
                <div class="flex items-center gap-2">
                  <input id="posts-file-input" type="file" accept=".txt,.csv,.tsv"
                         class="block flex-1 text-sm text-gray-500 dark:text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-gray-100 dark:file:bg-gray-700 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 dark:file:text-gray-300 cursor-pointer" />
                  <button type="button" id="analyze-posts-button"
                          class="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors cursor-pointer">Analyze</button>
                </div>
              </label>
              <p id="analyze-status" class="text-xs text-gray-400 hidden"></p>
              <label class="block">
                <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Raw audience brief, sources, photos, accounts</span>
                <textarea name="raw_text" rows="5" placeholder="Describe the audience. Add Twitter accounts, similar photos, references, and constraints. Or use Analyze above to infer from posts."
                          class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y"></textarea>
              </label>
              <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Run LLM Investigation</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
  </div>`;
}

function renderMerchantsWorkspace({ merchants, activeMerchant, overrides, audiences }) {
  const rows = merchants.map((m) => {
    const statusBadge = !m.network
      ? `<span class="text-xs text-gray-400 dark:text-gray-500">No program</span>`
      : m.needs_setup
        ? `<span class="inline-flex items-center rounded-full bg-yellow-50 dark:bg-yellow-900/20 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:text-yellow-300 ring-1 ring-inset ring-yellow-600/20">⚠ Needs Setup</span>`
        : m.enabled
          ? `<span class="inline-flex items-center rounded-full bg-green-50 dark:bg-green-900/20 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400 ring-1 ring-inset ring-green-600/20">✓ Active</span>`
          : `<span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">Disabled</span>`;
    const isActive = activeMerchant?.merchant_id === m.merchant_id;
    const href = escapeAttribute(`/?tab=merchants&merchant_id=${encodeURIComponent(m.merchant_id)}`);
    return `<tr class="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors${isActive ? " bg-indigo-50 dark:bg-indigo-900/20" : ""}" onclick="window.location.href='${href}'">
      <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(m.name)}</td>
      <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">${escapeHtml(m.domain)}</td>
      <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">${escapeHtml(m.network ?? "—")}</td>
      <td class="px-4 py-3 text-xs">${(m.categories ?? []).map((c) => `<span class="mr-1 inline-block rounded bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 text-indigo-700 dark:text-indigo-300">${escapeHtml(c)}</span>`).join("")}</td>
      <td class="whitespace-nowrap px-4 py-3">${statusBadge}</td>
    </tr>`;
  }).join("");

  return `<div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Merchants</h2>
      <span class="text-sm text-gray-500 dark:text-gray-400">${merchants.length} merchant${merchants.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="overflow-hidden rounded-lg ring-1 ring-gray-200 dark:ring-gray-700 bg-white dark:bg-gray-800">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-700/50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Merchant</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Domain</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Network</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Categories</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
          ${rows || `<tr><td colspan="5" class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No merchants configured.</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

function renderMerchantDrawer({ merchant, overrides, audiences }) {
  const closeHref = "/?tab=merchants";
  const networkLabel = merchant.network ? merchant.network.toUpperCase() : null;

  const statusBadge = !merchant.network
    ? `<span class="rounded bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">No program</span>`
    : merchant.needs_setup
      ? `<span class="rounded bg-yellow-50 dark:bg-yellow-900/20 px-2 py-0.5 text-xs font-semibold text-yellow-800 dark:text-yellow-300">⚠ Needs Setup</span>`
      : merchant.enabled
        ? `<span class="rounded bg-green-50 dark:bg-green-900/20 px-2 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400">✓ Active</span>`
        : `<span class="rounded bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">Disabled</span>`;

  const affiliateSetupSection = merchant.network
    ? `<div class="${merchant.needs_setup ? "rounded-lg border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/10 p-4 mb-4" : "mb-4"}">
        <div class="text-xs font-bold ${merchant.needs_setup ? "text-yellow-900 dark:text-yellow-300" : "text-gray-900 dark:text-gray-100"} mb-1">Affiliate Setup · ${escapeHtml(networkLabel)}</div>
        ${merchant.needs_setup ? `<div class="text-xs text-yellow-800 dark:text-yellow-400 mb-3 leading-relaxed">Join the ${escapeHtml(merchant.name)} program on ${escapeHtml(networkLabel)}, then paste your publisher ID below.</div>` : ""}
        <label class="block text-xs font-semibold text-gray-900 dark:text-gray-100 mb-1">Your ${escapeHtml(networkLabel)} Publisher ID</label>
        <input id="drawer-publisher-id"
               class="w-full rounded border ${merchant.needs_setup ? "border-yellow-400 dark:border-yellow-600" : "border-gray-300 dark:border-gray-600"} bg-white dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
               placeholder="e.g. 123456" value="${escapeAttribute(merchant.publisher_id ?? "")}"/>
        ${merchant.network_merchant_code ? `<div class="mt-2 text-xs text-gray-500 dark:text-gray-400">Merchant code: <code class="rounded bg-gray-100 dark:bg-gray-700 px-1 py-0.5 text-gray-800 dark:text-gray-200">${escapeHtml(merchant.network_merchant_code)}</code></div>` : ""}
      </div>`
    : "";

  const categoriesSection = `<div class="mb-4">
    <div class="text-xs font-semibold text-gray-900 dark:text-gray-100 mb-1.5">Categories</div>
    <div class="flex flex-wrap gap-1.5">
      ${(merchant.categories ?? []).map((c) => `<span class="rounded bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300">${escapeHtml(c)}</span>`).join("") || `<span class="text-xs text-gray-400">None</span>`}
    </div>
  </div>`;

  const overrideRows = audiences.map((aud) => {
    const override = overrides.find((o) => o.audience_id === aud.id);
    const isEnabled = override ? override.enabled : true;
    const boostHint = override?.boost_tags?.length
      ? override.boost_tags.map((b) => `${b.tag} ×${b.weight}`).join(", ")
      : "—";
    return `<div class="grid grid-cols-[1fr_auto_auto] gap-2 items-center px-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span class="text-xs font-medium text-gray-900 dark:text-gray-100">${escapeHtml(aud.audience_key ?? aud.id)}</span>
      <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(boostHint)}</span>
      <label class="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300 cursor-pointer whitespace-nowrap">
        <input type="checkbox" class="override-toggle" data-audience-id="${escapeAttribute(aud.id)}"${isEnabled ? " checked" : ""}/>
        on
      </label>
    </div>`;
  }).join("");

  const merchantIdJs = JSON.stringify(merchant.merchant_id);

  return `<div class="fixed inset-0 z-40" data-tremor-component="DrawerPortal">
    <a class="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-40"
       href="${escapeAttribute(closeHref)}" aria-label="Close merchant details"></a>
    <aside class="fixed inset-y-0 right-0 flex w-2/5 flex-col bg-white dark:bg-gray-800 shadow-xl z-50 overflow-hidden"
           data-tremor-component="Drawer" aria-label="Merchant details">

      <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4">
        <div>
          <div class="text-sm font-bold text-gray-900 dark:text-gray-100">${escapeHtml(merchant.name)}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(merchant.domain)} · ${escapeHtml(merchant.country)} · ${escapeHtml(merchant.currency)}</div>
        </div>
        <div class="flex items-center gap-2">
          ${statusBadge}
          <label class="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer whitespace-nowrap">
            <input type="checkbox" id="drawer-enabled" ${merchant.enabled ? "checked" : ""}/>
            Enabled
          </label>
          <a href="${escapeAttribute(closeHref)}"
             class="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200"
             aria-label="Close">✕</a>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4">
        ${affiliateSetupSection}
        ${categoriesSection}
        ${audiences.length > 0 ? `<div class="mb-4">
          <div class="text-xs font-semibold text-gray-900 dark:text-gray-100 mb-2">Audience Overrides</div>
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
            ${overrideRows || `<div class="px-3 py-3 text-xs text-gray-400">No audiences configured.</div>`}
          </div>
        </div>` : ""}
        <div class="mb-5">
          <label class="block text-xs font-semibold text-gray-900 dark:text-gray-100 mb-1">Disclosure text</label>
          <input id="drawer-disclosure"
                 class="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                 value="${escapeAttribute(merchant.disclosure_text ?? "")}"/>
        </div>
        <button id="drawer-save-btn"
                class="w-full rounded-md bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                data-merchant-id="${escapeAttribute(merchant.merchant_id)}">
          Save Changes
        </button>
        <div id="drawer-save-msg" class="mt-2 text-center text-xs hidden"></div>
      </div>

    </aside>
    <script>
    (function() {
      var btn = document.getElementById('drawer-save-btn');
      var merchantId = ${merchantIdJs};
      btn.addEventListener('click', async function() {
        btn.disabled = true;
        var msg = document.getElementById('drawer-save-msg');
        msg.className = 'mt-2 text-center text-xs hidden';
        try {
          var publisherInput = document.getElementById('drawer-publisher-id');
          var enabledInput = document.getElementById('drawer-enabled');
          var disclosureInput = document.getElementById('drawer-disclosure');
          var body = {};
          if (publisherInput) body.publisher_id = publisherInput.value.trim();
          if (enabledInput) body.enabled = enabledInput.checked;
          if (disclosureInput) body.disclosure_text = disclosureInput.value;
          var res = await fetch('/api/merchants/' + encodeURIComponent(merchantId), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!res.ok) throw new Error(await res.text());

          var toggles = document.querySelectorAll('.override-toggle');
          await Promise.all(Array.from(toggles).map(function(t) {
            return fetch('/api/merchants/' + encodeURIComponent(merchantId) + '/overrides/' + encodeURIComponent(t.dataset.audienceId), {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ enabled: t.checked })
            });
          }));

          msg.textContent = 'Saved!';
          msg.className = 'mt-2 text-center text-xs text-green-600 dark:text-green-400';
          setTimeout(function() { window.location.reload(); }, 800);
        } catch(e) {
          msg.textContent = 'Error: ' + e.message;
          msg.className = 'mt-2 text-center text-xs text-red-600 dark:text-red-400';
          btn.disabled = false;
        }
      });
    })();
    </script>
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
    title: "Stories",
    description: "Select a row to open details, assets, approval, and publication controls.",
    action: `<span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(String(model.stories.length))} stories</span>`,
    children: `
      <form method="GET" class="flex flex-wrap items-end gap-3 px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <input type="hidden" name="tab" value="stories" />
        <label class="flex flex-col gap-1 min-w-[120px]">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</span>
          <select name="status" class="block rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none">${renderStatusOptions(model.filters.status)}</select>
        </label>
        <label class="flex flex-col gap-1 min-w-[120px]">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Review</span>
          <select name="review_status" class="block rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none">${renderReviewOptions(model.filters.review_status)}</select>
        </label>
        <label class="flex flex-col gap-1 min-w-[120px]">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Audience</span>
          <select name="audience_id" class="block rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none">
            <option value="">All audiences</option>
            ${audienceOptions}
          </select>
        </label>
        <label class="flex flex-col gap-1 flex-1 min-w-[160px]">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Search</span>
          <input type="text" name="search" value="${escapeAttribute(model.filters.search ?? "")}" placeholder="Search title or story text"
                 class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        </label>
        <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors cursor-pointer">Apply</button>
      </form>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700" data-tremor-component="Table">
          <thead class="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Story</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Audience</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Review</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Asset</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Channel</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Updated</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
            ${storyTableRows || `<tr><td colspan="7" class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">No stories match these filters.</td></tr>`}
          </tbody>
        </table>
      </div>`
  });

  return `<div>
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Stories</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Review, approve, and publish story assets to Telegram channels.</p>
    </div>
    <div class="space-y-5">
      ${storiesTable}
      <div class="grid grid-cols-2 gap-5">
        <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
          <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Audit Log</h2>
          </div>
          <ul class="divide-y divide-gray-100 dark:divide-gray-700 px-5">${auditItems}</ul>
        </div>
        <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
          <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Analytics Snapshot</h2>
          </div>
          <ul class="divide-y divide-gray-100 dark:divide-gray-700 px-5">${analyticsItems}</ul>
        </div>
      </div>
    </div>
  </div>`;
}

function renderStoryTableRows(stories, filters, activeStoryId) {
  return stories.map((story) => {
    const href = buildDashboardHref(filters, story.id);
    const targetLabel = story.publication_target
      ? `${story.publication_target.channel}:${story.publication_target.target_identifier}`
      : "unconfigured";
    const isActive = story.id === activeStoryId;
    return `<tr class="${isActive ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-700/50"} transition-colors cursor-pointer" data-story-href="${escapeAttribute(href)}">
      <td class="px-6 py-3">
        <a class="block" href="${escapeAttribute(href)}">
          <div class="text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(story.title)}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(truncateText(story.summary ?? story.story_text ?? "", 86))}</div>
        </a>
      </td>
      <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(story.audience?.label ?? "Unknown audience")}</td>
      <td class="px-4 py-3">${renderStatusBadge(story.status)}</td>
      <td class="px-4 py-3">${renderReviewBadge(story.operator_review_status)}</td>
      <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">${escapeHtml(story.selected_asset_id ?? "none")}</td>
      <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(targetLabel)}</td>
      <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(formatShortDate(story.updated_at ?? story.created_at))}</td>
    </tr>`;
  }).join("");
}

function renderStoryDetailDrawer({ story, assetCards, publicationItems, reviewItems, metadataJson, selectedAssetId, publicationTarget, closeHref }) {
  return `<div class="fixed inset-0 z-40" data-tremor-component="DrawerPortal">
  <a class="fixed inset-0 bg-gray-900/50 dark:bg-gray-900/70 backdrop-blur-sm z-40"
     href="${escapeAttribute(closeHref)}" aria-label="Close story details"></a>
  <aside class="fixed inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white dark:bg-gray-800
                shadow-xl z-50 overflow-hidden"
         data-tremor-component="Drawer" aria-label="Story details">
    <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b
                border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90
                backdrop-blur px-6 py-4">
      <div>
        <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">Story Details</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(story.audience?.label ?? "Unknown audience")}</p>
      </div>
      <a class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors"
         href="${escapeAttribute(closeHref)}">Close</a>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-5 space-y-6">

      <dl class="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        ${[
          ["Pipeline", story.status ?? "unknown"],
          ["Review", story.operator_review_status ?? "pending"],
          ["Asset", selectedAssetId || "none"],
          ["Instance", story.instance?.service_name ?? "unassigned"],
          ["Channel", publicationTarget ? `${publicationTarget.channel}:${publicationTarget.target_identifier}` : "unconfigured"]
        ].map(([k, v]) => `<div class="bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
          <dt class="text-xs font-medium text-gray-500 dark:text-gray-400">${escapeHtml(k)}</dt>
          <dd class="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100 break-all">${escapeHtml(v)}</dd>
        </div>`).join("")}
      </dl>

      <section>
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Story Copy</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Edit story text and metadata.</p>
          </div>
        </div>
        <form id="story-form" data-story-id="${escapeAttribute(story.id)}" class="space-y-3">
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Title</span>
            <input name="title" value="${escapeAttribute(story.title)}"
                   class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </label>
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Story Text</span>
            <textarea name="story_text" rows="5"
                      class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y">${escapeHtml(story.story_text)}</textarea>
          </label>
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Summary</span>
            <textarea name="summary" rows="3"
                      class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y">${escapeHtml(story.summary ?? "")}</textarea>
          </label>
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Metadata JSON</span>
            <textarea name="metadata" rows="4"
                      class="block w-full rounded-md border-0 py-1.5 px-3 text-sm font-mono text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y">${metadataJson}</textarea>
          </label>
          <div class="flex gap-2">
            <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors cursor-pointer">Save Story</button>
          </div>
        </form>
      </section>

      <section class="border-t border-gray-200 dark:border-gray-700 pt-5">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Asset Panel</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Select or replace the publish asset.</p>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">${assetCards}</div>
      </section>

      <section class="border-t border-gray-200 dark:border-gray-700 pt-5">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Publication Queue</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Approve with a selected asset before queueing.</p>
          </div>
        </div>
        <dl class="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-4">
          <div class="bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
            <dt class="text-xs font-medium text-gray-500 dark:text-gray-400">Channel</dt>
            <dd class="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(publicationTarget?.channel ?? "unconfigured")}</dd>
          </div>
          <div class="bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
            <dt class="text-xs font-medium text-gray-500 dark:text-gray-400">Target</dt>
            <dd class="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(publicationTarget?.target_identifier ?? "unconfigured")}</dd>
          </div>
        </dl>
        <form id="review-form" data-story-id="${escapeAttribute(story.id)}" class="space-y-3">
          <label class="block">
            <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Review Notes</span>
            <textarea name="review_notes" placeholder="What changed or why is this ready?" rows="3"
                      class="block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y"></textarea>
          </label>
          <input type="hidden" name="selected_asset_id" value="${escapeAttribute(selectedAssetId)}" />
          <div class="flex flex-wrap gap-2">
            <button type="button" data-review-status="approved"
                    class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Approve</button>
            <button type="button" data-review-status="changes_requested"
                    class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Request Changes</button>
            <button type="button" data-review-status="rejected"
                    class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Reject</button>
          </div>
        </form>
        <div class="mt-4 flex gap-2">
          <button type="button" id="queue-publication-button" data-story-id="${escapeAttribute(story.id)}"
                  class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Queue Channel Publication</button>
        </div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-5 mb-2">Queued Publications</h3>
        <ul class="divide-y divide-gray-100 dark:divide-gray-700">${publicationItems}</ul>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-5 mb-2">Review History</h3>
        <ul class="divide-y divide-gray-100 dark:divide-gray-700">${reviewItems}</ul>
      </section>

    </div>
  </aside>
</div>`;
}

function renderAudiencesWorkspace({ model, deployments, selectedAudience, selectedAudienceInstance, selectedProfileState, selectedDeployment, chatHistory = [] }) {
  const audiences = model.audiences ?? [];
  const runtimeConfig = model.audienceRuntimeConfig ?? {};

  const rows = audiences.map((audience) => {
    const audienceKey = audience.audience_key ?? audience.id;
    const rconf = runtimeConfig[audienceKey] ?? {};
    const isActive = selectedAudience?.id === audience.id;
    const href = escapeAttribute(`/?tab=audiences&audience_id=${encodeURIComponent(audience.id)}`);
    const interests = normalizeAudienceList(audience.interests ?? []).slice(0, 3);
    const photo = audience.photo_url ?? null;
    const initials = (audience.label ?? audienceKey ?? "?").slice(0, 2).toUpperCase();
    const thumbnail = photo
      ? `<img src="${escapeAttribute(photo)}" alt="" class="w-10 h-10 rounded-full object-cover flex-shrink-0" />`
      : `<div class="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0 text-xs font-bold text-indigo-600 dark:text-indigo-300">${escapeHtml(initials)}</div>`;
    const statusClass = audience.status === "active" ? "badge-active" : audience.status === "new" ? "badge-new" : "badge-neutral";
    const interestTags = interests.map((i) => `<span class="badge-neutral text-xs px-1.5 py-0.5 rounded-full">${escapeHtml(i)}</span>`).join("");

    const marbleBase = rconf.plugin_base_url ?? "";
    const marbleLink = marbleBase
      ? `<a href="${escapeAttribute(marbleBase + "/user-profile/graph/ui")}" target="_blank" rel="noopener"
            onclick="event.stopPropagation()"
            class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors whitespace-nowrap">
           <span>Marble</span><span class="opacity-60">↗</span>
         </a>`
      : `<span class="text-xs text-gray-400">—</span>`;

    return `<tr class="${isActive ? "bg-indigo-50 dark:bg-indigo-900/20" : ""} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors" onclick="window.location.href='${href}'" data-runtime-audience-id="${escapeAttribute(audienceKey)}">
      <td class="px-4 py-3 w-12">${thumbnail}</td>
      <td class="px-4 py-3">
        <div class="text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(audienceKey)}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">${escapeHtml(formatStructuredText(audience.label, ""))}</div>
      </td>
      <td class="px-4 py-3 max-w-xs">
        <p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">${escapeHtml(formatStructuredText(audience.family_context, "No description"))}</p>
      </td>
      <td class="px-4 py-3">
        <div class="flex flex-wrap gap-1">${interestTags || `<span class="text-xs text-gray-400">—</span>`}</div>
      </td>
      <td class="px-4 py-3 whitespace-nowrap">
        <span class="badge-unknown" data-runtime-openclaw>
          <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>…
        </span>
      </td>
      <td class="px-4 py-3 whitespace-nowrap">
        <span class="badge-unknown" data-runtime-marble>
          <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>…
        </span>
      </td>
      <td class="px-4 py-3 whitespace-nowrap">${marbleLink}</td>
      <td class="px-4 py-3 whitespace-nowrap">
        <span class="${statusClass}">${escapeHtml(audience.status ?? "unknown")}</span>
      </td>
    </tr>`;
  }).join("");

  const emptyState = audiences.length === 0
    ? `<tr><td colspan="8" class="px-4 py-16 text-center">
        <div class="flex flex-col items-center gap-4">
          <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl">👥</div>
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">No audiences yet</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Create your first audience to get started</p>
          </div>
          <button onclick="openAudienceWizard()" class="btn btn-accent">+ Create Audience</button>
        </div>
      </td></tr>`
    : "";

  return `<div>
    <div class="mb-5 flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Audiences</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(String(audiences.length))} audience${audiences.length !== 1 ? "s" : ""} · Marble profile and runtime delivery.</p>
      </div>
      <button onclick="openAudienceWizard()" class="btn btn-accent btn-sm">+ New Audience</button>
    </div>

    <div class="overflow-hidden rounded-lg ring-1 ring-gray-200 dark:ring-gray-700 bg-white dark:bg-gray-800">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-700/50">
          <tr>
            <th class="px-4 py-3 w-12"></th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Audience</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Description</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Interests</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">OpenClaw</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Marble</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Profile</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
          ${rows || emptyState}
        </tbody>
      </table>
    </div>
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
    profile_base_url: instance.profile_base_url ?? instance.plugin_base_url ?? runtime.plugin_base_url ?? "",
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
  if (!audiences?.length || !selectedAudienceId) {
    return null;
  }
  return audiences.find((audience) => audience.id === selectedAudienceId) ?? null;
}

function selectAudienceDeployment(deployments, audience) {
  if (!deployments?.length) {
    return null;
  }
  if (!audience) {
    return deployments[0];
  }
  return deployments.find((deployment) => deploymentMatchesAudience(deployment, audience)) ?? null;
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
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">No audiences are configured.</div>`;
  }

  return `<div class="divide-y divide-gray-100 dark:divide-gray-700">
    ${audiences.map((audience) => {
      const deployment = deployments.find((item) => deploymentMatchesAudience(item, audience)) ?? null;
      const summary = audienceProfiles.get(audience.id)?.summary?.profile ?? {};
      const href = buildAudienceWorkspaceHref(audience.id);
      const isActive = audience.id === selectedAudienceId;
      return `<a class="block py-3 px-2 rounded-md transition-colors ${isActive ? "bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500 pl-3" : "hover:bg-gray-50 dark:hover:bg-gray-800 border-l-2 border-transparent pl-3"}"
           href="${escapeAttribute(href)}" data-audience-link="${escapeAttribute(audience.id)}">
        <div class="flex items-start justify-between gap-1 mb-0.5">
          <span class="text-xs font-semibold text-gray-900 dark:text-gray-100 leading-tight">${escapeHtml(audience.label ?? audience.audience_key ?? audience.id)}</span>
          ${renderTremorBadge(deployment?.status ?? audience.status ?? "draft", { tone: deployment?.status === "active" ? "success" : "neutral" })}
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 leading-snug line-clamp-2">${escapeHtml(formatStructuredText(summary.reasoning_summary ?? audience.family_context, "No summary."))}</p>
      </a>`;
    }).join("")}
  </div>`;
}

function renderAudienceWorkspaceCanvas(audience, instance, profileState = {}) {
  if (!audience) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-8 text-sm text-gray-500 dark:text-gray-400 text-center">Create an audience to unlock Marble profile editing and runtime launch controls.</div>`;
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
  const debugJson = error ? "" : escapeHtml(JSON.stringify(debug ?? { profile: summary, metadata: merged.extra_metadata }, null, 2));

  const inputClass = "block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5";

  return `<div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden space-y-0">

    <div class="grid gap-6 p-6" style="grid-template-columns: minmax(0,1fr) 200px;">
      <div class="space-y-2">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Selected Audience</p>
        <h2 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(merged.label || audience.label || audience.audience_key || audience.id)}</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">${escapeHtml(merged.family_context || "Family context is not set yet.")}</p>
      </div>
      <div class="space-y-3">
        ${renderAudienceHeroFact("Audience Key", audience.audience_key ?? audience.id)}
        ${renderAudienceHeroFact("Location", merged.location || "Location unset")}
        ${renderAudienceHeroFact("Language", formatStructuredText(audience.language, "Language unset"))}
        ${renderAudienceHeroFact("Runtime", instance?.status ?? "not launched")}
      </div>
    </div>

    <dl class="grid grid-cols-4 divide-x divide-gray-200 dark:divide-gray-700 border-t border-gray-200 dark:border-gray-700">
      <div class="px-5 py-4">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Tracked Interests</dt>
        <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(String(merged.interests.length || 0))}</dd>
      </div>
      <div class="px-5 py-4">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Preferences</dt>
        <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(String(preferenceCount || 0))}</dd>
      </div>
      <div class="px-5 py-4">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Decision Events</dt>
        <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">${escapeHtml(String(decisionCount || 0))}</dd>
      </div>
      <div class="px-5 py-4">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Last Sync</dt>
        <dd class="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 text-base">${escapeHtml(merged.updated_at ? formatShortDate(merged.updated_at) : "never")}</dd>
      </div>
    </dl>

    <div class="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Profile Canvas</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Current Marble interpretation, summarized for operator review.</p>
        </div>
        ${renderTremorBadge(error ? "Marble unavailable" : "Marble connected", { tone: error ? "warning" : "success" })}
      </div>
      ${error ? `<div class="rounded-lg border border-dashed border-yellow-200 dark:border-yellow-800 p-4 text-sm text-yellow-700 dark:text-yellow-400">${escapeHtml(error)}</div>` : ""}
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-2">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Reasoning Summary</span>
          <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">${escapeHtml(merged.reasoning_summary || "No Marble summary stored.")}</p>
        </div>
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-2">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Audience Shape</span>
          <ul class="space-y-2 text-sm">
            <li class="flex justify-between gap-2"><strong class="text-gray-900 dark:text-gray-100">Tone</strong><span class="text-gray-500 dark:text-gray-400">${escapeHtml(merged.tone || "unset")}</span></li>
            <li class="flex justify-between gap-2"><strong class="text-gray-900 dark:text-gray-100">Shopping Bias</strong><span class="text-gray-500 dark:text-gray-400">${escapeHtml(merged.shopping_bias || "unset")}</span></li>
            <li class="flex justify-between gap-2"><strong class="text-gray-900 dark:text-gray-100">Posting Schedule</strong><span class="text-gray-500 dark:text-gray-400">${escapeHtml(merged.posting_schedule || "unset")}</span></li>
            <li class="flex justify-between gap-2"><strong class="text-gray-900 dark:text-gray-100">Memory Nodes</strong><span class="text-gray-500 dark:text-gray-400">${escapeHtml(String(interestCount))} interests</span></li>
          </ul>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3">
        ${renderAudienceTagBlock("Interests", merged.interests)}
        ${renderAudienceTagBlock("Content Pillars", merged.content_pillars)}
        ${renderAudienceTagBlock("Excluded Topics", merged.excluded_topics)}
      </div>
    </div>

    <div class="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Knowledge Inputs</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Edit the seeded facts that shape future Marble reads and delivery decisions.</p>
      </div>
      <form class="space-y-3" data-profile-facts-audience-id="${escapeAttribute(audience.id)}">
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><span class="${labelClass}">Label</span><input name="label" value="${escapeAttribute(merged.label)}" required class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Location</span><input name="location" value="${escapeAttribute(merged.location)}" required class="${inputClass}" /></label>
          <label class="block col-span-2"><span class="${labelClass}">Family Context</span><textarea name="family_context" rows="3" class="${inputClass} resize-y">${escapeHtml(merged.family_context)}</textarea></label>
          <label class="block"><span class="${labelClass}">Posting Schedule</span><input name="posting_schedule" value="${escapeAttribute(merged.posting_schedule)}" placeholder="weekday mornings" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Tone</span><input name="tone" value="${escapeAttribute(merged.tone)}" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Interests</span><input name="interests" value="${escapeAttribute((merged.interests ?? []).join(", "))}" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Content Pillars</span><input name="content_pillars" value="${escapeAttribute((merged.content_pillars ?? []).join(", "))}" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Excluded Topics</span><input name="excluded_topics" value="${escapeAttribute((merged.excluded_topics ?? []).join(", "))}" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Shopping Bias</span><input name="shopping_bias" value="${escapeAttribute(merged.shopping_bias)}" placeholder="quality-first" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Operator</span><input name="operator" value="operator@example.com" class="${inputClass}" /></label>
        </div>
        <label class="block"><span class="${labelClass}">Extra Metadata</span><textarea name="extra_metadata" rows="6" placeholder='{"shopping_data":["Maremagnum"]}' class="${inputClass} resize-y font-mono">${escapeHtml(JSON.stringify(merged.extra_metadata ?? {}, null, 2))}</textarea></label>
        <div class="flex justify-end">
          <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Sync Marble KG</button>
        </div>
      </form>
    </div>

    <div class="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Enrichment Feed</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Append shopping data, venues, event sites, and operator judgments as structured Marble events.</p>
      </div>
      <form class="space-y-3" data-profile-decision-audience-id="${escapeAttribute(audience.id)}">
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><span class="${labelClass}">Decision Type</span><input name="decision_type" value="operator_enrichment" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Source</span><input name="source" value="dashboard" class="${inputClass}" /></label>
          <label class="block"><span class="${labelClass}">Operator</span><input name="operator" value="operator@example.com" class="${inputClass}" /></label>
        </div>
        <label class="block"><span class="${labelClass}">Content JSON</span><textarea name="content" rows="6" placeholder='{"shopping_data":["Passeig de Gracia"]}' class="${inputClass} resize-y font-mono">{}</textarea></label>
        <div class="flex justify-end">
          <button type="submit" class="rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Store Enrichment Event</button>
        </div>
      </form>
      <details class="group">
        <summary class="cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 select-none">Graph Debug</summary>
        <pre class="mt-2 rounded-md bg-gray-100 dark:bg-gray-900 p-3 text-xs font-mono overflow-x-auto leading-relaxed">${debugJson || "No Marble debug payload available."}</pre>
      </details>
    </div>

    <div class="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Runtime Controls</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Telegram, sidecar, and runtime overrides written at launch time.</p>
      </div>
      ${renderLaunchConfigForm(audience, instance)}
    </div>

  </div>`;
}

function renderAudienceTagBlock(label, values) {
  const items = normalizeAudienceList(values);
  return `<div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-2">
    <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">${escapeHtml(label)}</span>
    <div class="flex flex-wrap gap-1.5">${items.length
      ? items.map((v) => `<span class="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 px-2.5 py-0.5 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(v)}</span>`).join("")
      : `<span class="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 px-2.5 py-0.5 text-xs text-gray-400 dark:text-gray-500">None</span>`
    }</div>
  </div>`;
}

function renderAudienceHeroFact(label, value) {
  return `<div class="border-t border-gray-200 dark:border-gray-700 pt-2 first:border-0 first:pt-0">
    <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">${escapeHtml(label)}</span>
    <span class="block text-sm text-gray-900 dark:text-gray-100 mt-0.5 break-all">${escapeHtml(formatStructuredText(value, "unset"))}</span>
  </div>`;
}

function renderAudienceInspector(audience, selectedDeployment, deployments, chatHistory = []) {
  return `
    <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
      <div class="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Runtime Snapshot</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Current deployment status and service endpoints.</p>
      </div>
      <div class="px-4 py-4">${renderSelectedDeployment(selectedDeployment)}</div>
    </div>
    <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
      <div class="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Manager Console</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Send direct operator feedback to the selected OpenClaw audience manager.</p>
      </div>
      <div class="px-4 py-4">${renderOperatorConsole(audience, selectedDeployment, chatHistory)}</div>
    </div>
    <div class="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg shadow-sm overflow-hidden">
      <div class="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Live Deployments</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Instance index across the factory.</p>
      </div>
      <div class="px-4 py-4">${renderDeploymentIndex(deployments)}</div>
    </div>`;
}

function renderSelectedDeployment(instance) {
  if (!instance) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">No deployment selected.</div>`;
  }

  const actions = instance.source === "static"
    ? `<div class="flex flex-wrap gap-2 mt-3">
        <button type="button" data-instance-action="deploy" data-audience-id="${escapeAttribute(instance.audience_id)}" class="rounded-md bg-gray-900 dark:bg-gray-100 px-2.5 py-1 text-xs font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Deploy</button>
        <button type="button" data-instance-action="health" data-audience-id="${escapeAttribute(instance.audience_id)}" class="rounded-md bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Health</button>
        <button type="button" data-instance-action="report" data-audience-id="${escapeAttribute(instance.audience_id)}" class="rounded-md bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Report</button>
        <button type="button" data-instance-action="logs" data-audience-id="${escapeAttribute(instance.audience_id)}" class="rounded-md bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Logs</button>
      </div>`
    : "";

  return `<div class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <strong class="text-sm font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(instance.service_name ?? instance.audience_id)}</strong>
      ${renderTremorBadge(instance.status ?? "configured", { tone: instance.status === "active" ? "success" : "neutral" })}
    </div>
    <dl class="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
      <div class="flex justify-between gap-2"><dt>Audience</dt><dd class="text-gray-700 dark:text-gray-300 break-all">${escapeHtml(instance.audience_key ?? instance.audience_id)}</dd></div>
      <div class="flex justify-between gap-2"><dt>Chat</dt><dd class="text-gray-700 dark:text-gray-300">${escapeHtml(instance.telegram_chat_id || "unset")}</dd></div>
      <div class="flex justify-between gap-2"><dt>Report</dt><dd class="text-gray-700 dark:text-gray-300">${escapeHtml(instance.telegram_report_chat_id || "unset")}</dd></div>
      <div class="flex justify-between gap-2"><dt>Admin</dt><dd class="text-gray-700 dark:text-gray-300 break-all">${escapeHtml(instance.openclaw_admin_url || "unset")}</dd></div>
      <div class="flex justify-between gap-2"><dt>Profile</dt><dd class="text-gray-700 dark:text-gray-300">${escapeHtml(instance.profile_service_name || "unset")}</dd></div>
      <div class="flex justify-between gap-2"><dt>LLM</dt><dd class="text-gray-700 dark:text-gray-300">${escapeHtml(instance.llm_model || "default")}</dd></div>
      ${instance.env_file ? `<div class="flex justify-between gap-2"><dt>Env</dt><dd class="text-gray-700 dark:text-gray-300 break-all">${escapeHtml(instance.env_file)}</dd></div>` : ""}
    </dl>
    ${actions}
    <details class="group">
      <summary class="cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 select-none">Runtime Commands</summary>
      <div class="mt-2 space-y-2">
        ${renderCommandBlock("OpenClaw Shell", instance.commands?.openclaw_shell)}
        ${renderCommandBlock("Profile Shell", instance.commands?.profile_shell)}
        ${renderCommandBlock("OpenClaw Env", instance.commands?.openclaw_env)}
        ${renderCommandBlock("OpenClaw Logs", instance.commands?.openclaw_logs)}
        ${renderCommandBlock("Profile Logs", instance.commands?.profile_logs)}
      </div>
    </details>
  </div>`;
}

function renderChatBubble(msg) {
  if (msg.role === "user") {
    return `<div class="flex justify-end">
      <div class="max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 bg-blue-600 text-white text-sm leading-relaxed whitespace-pre-wrap">${escapeHtml(msg.content)}</div>
    </div>`;
  }
  return `<div class="flex items-start gap-2">
    <div class="flex-shrink-0 w-5 h-5 rounded-full bg-gray-600 dark:bg-gray-500 flex items-center justify-center" style="font-size:9px;color:#d1d5db;font-weight:600">AI</div>
    <div class="max-w-[82%] rounded-2xl rounded-tl-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm leading-relaxed prose prose-sm dark:prose-invert">${escapeHtml(msg.content)}</div>
  </div>`;
}

function renderOperatorConsole(audience, selectedDeployment, chatHistory = []) {
  const audienceId = audience?.id ?? selectedDeployment?.audience_id ?? "";
  if (!audienceId) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">Select an audience or launch a deployment to send operator feedback.</div>`;
  }

  const bubbles = chatHistory.map(renderChatBubble).join("\n");
  const inputClass = "flex-1 block rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none";

  return `<div class="flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden" style="height:460px">
    <div id="chat-thread-${escapeAttribute(audienceId)}" class="flex-1 overflow-y-auto p-3 space-y-3">${bubbles || '<div class="text-xs text-gray-400 dark:text-gray-500 text-center pt-4">No messages yet</div>'}</div>
    <div class="border-t border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
      <form class="flex gap-2 items-end" data-instance-chat-form="${escapeAttribute(audienceId)}">
        <input type="hidden" name="audience_id" value="${escapeAttribute(audienceId)}" />
        <input type="hidden" name="operator" value="operator@example.com" />
        <textarea name="message" rows="2" placeholder="Ask the audience manager…" class="${inputClass}"></textarea>
        <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors cursor-pointer flex-shrink-0">↑</button>
      </form>
    </div>
  </div>`;
}

function renderDeploymentIndex(deployments) {
  if (!deployments.length) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">No deployments</div>`;
  }
  return `<div class="divide-y divide-gray-100 dark:divide-gray-700">
    ${deployments.map((instance) => `<div class="flex items-center justify-between gap-2 py-2.5">
      <div>
        <strong class="block text-xs font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(instance.audience_key ?? instance.audience_id)}</strong>
        <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(instance.service_name ?? "unset")}</span>
      </div>
      ${renderTremorBadge(instance.status ?? "configured", { tone: instance.status === "active" ? "success" : "neutral" })}
    </div>`).join("")}
  </div>`;
}

function renderAudienceDrawer({ audience, instance, profileState = {}, deployment, deployments = [], chatHistory = [] }) {
  const closeHref = "/?tab=audiences";
  const audienceKey = audience.audience_key ?? audience.id;
  const photo = audience.photo_url ?? null;
  const initials = (audience.label ?? audienceKey ?? "?").slice(0, 2).toUpperCase();
  const thumbnail = photo
    ? `<img src="${escapeAttribute(photo)}" alt="" class="w-12 h-12 rounded-full object-cover flex-shrink-0" />`
    : `<div class="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-sm font-bold text-indigo-600 dark:text-indigo-300 flex-shrink-0">${escapeHtml(initials)}</div>`;
  const statusClass = audience.status === "active" ? "badge-active" : audience.status === "new" ? "badge-new" : "badge-neutral";

  const marbleUrl = deployment?.profile_base_url ? `${deployment.profile_base_url}/user-profile/graph/ui` : null;
  const openclawUrl = deployment?.openclaw_admin_url ?? null;

  const interests = normalizeAudienceList(audience.interests ?? []);
  const contentPillars = normalizeAudienceList(audience.content_pillars ?? []);
  const excludedTopics = normalizeAudienceList(audience.excluded_topics ?? []);

  const detailsTab = `
    <div class="space-y-5 p-5">
      <div class="grid grid-cols-2 gap-4">
        <div><span class="label">Audience Key</span><p class="text-sm text-gray-800 dark:text-gray-200 font-mono">${escapeHtml(audienceKey)}</p></div>
        <div><span class="label">Status</span><span class="${statusClass} mt-1 inline-flex">${escapeHtml(audience.status ?? "unknown")}</span></div>
        <div><span class="label">Location</span><p class="text-sm text-gray-800 dark:text-gray-200">${escapeHtml(formatStructuredText(audience.location, "—"))}</p></div>
        <div><span class="label">Language</span><p class="text-sm text-gray-800 dark:text-gray-200">${escapeHtml(audience.language ?? "en")}</p></div>
        <div class="col-span-2"><span class="label">Description</span><p class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">${escapeHtml(formatStructuredText(audience.family_context, "—"))}</p></div>
        <div class="col-span-2"><span class="label">Tone</span><p class="text-sm text-gray-800 dark:text-gray-200">${escapeHtml(formatStructuredText(audience.tone, "—"))}</p></div>
      </div>
      <div><span class="label">Interests</span>
        <div class="flex flex-wrap gap-1.5 mt-1">${interests.map((i) => `<span class="badge-neutral rounded-full px-2 py-0.5 text-xs">${escapeHtml(i)}</span>`).join("") || `<span class="text-xs text-gray-400">None</span>`}</div>
      </div>
      <div><span class="label">Content Pillars</span>
        <div class="flex flex-wrap gap-1.5 mt-1">${contentPillars.map((i) => `<span class="badge-neutral rounded-full px-2 py-0.5 text-xs">${escapeHtml(i)}</span>`).join("") || `<span class="text-xs text-gray-400">None</span>`}</div>
      </div>
      <div><span class="label">Excluded Topics</span>
        <div class="flex flex-wrap gap-1.5 mt-1">${excludedTopics.map((i) => `<span class="badge-neutral rounded-full px-2 py-0.5 text-xs">${escapeHtml(i)}</span>`).join("") || `<span class="text-xs text-gray-400">None</span>`}</div>
      </div>
      ${renderLaunchConfigForm(audience, instance)}
    </div>`;

  const linksTab = `
    <div class="space-y-3 p-5">
      ${marbleUrl
        ? `<a href="${escapeAttribute(marbleUrl)}" target="_blank" rel="noopener"
              class="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            <div class="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400 text-sm font-bold flex-shrink-0">M</div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">Marble Profile Graph</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 truncate">${escapeHtml(marbleUrl)}</p>
            </div>
            <span class="ml-auto text-gray-400 text-xs">↗</span>
          </a>`
        : `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">Marble URL not configured for this audience.</div>`}
      ${openclawUrl
        ? `<a href="${escapeAttribute(openclawUrl)}" target="_blank" rel="noopener"
              class="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            <div class="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm font-bold flex-shrink-0">O</div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">OpenClaw Manager</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 truncate">${escapeHtml(openclawUrl)}</p>
            </div>
            <span class="ml-auto text-gray-400 text-xs">↗</span>
          </a>`
        : `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">OpenClaw URL not configured.</div>`}
    </div>`;

  const chatTab = `
    <div class="p-4 h-full flex flex-col">
      ${renderOperatorConsole(audience, deployment, chatHistory)}
    </div>`;

  const audienceKeyJs = JSON.stringify(audienceKey);

  return `<div class="fixed inset-0 z-40" data-tremor-component="AudienceDrawerPortal">
    <a class="sheet-overlay" href="${escapeAttribute(closeHref)}" aria-label="Close audience details"></a>
    <aside class="sheet-panel w-[52rem]" aria-label="Audience details">

      <div class="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4">
        ${thumbnail}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-bold text-gray-900 dark:text-gray-100">${escapeHtml(audience.label ?? audienceKey)}</span>
            <span class="text-xs text-gray-500 dark:text-gray-400 font-mono">${escapeHtml(audienceKey)}</span>
            <span class="${statusClass}">${escapeHtml(audience.status ?? "unknown")}</span>
          </div>
          <div class="flex items-center gap-3 mt-1">
            <span class="badge-unknown text-xs" data-drawer-openclaw-badge>
              <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>OpenClaw …
            </span>
            <span class="badge-unknown text-xs" data-drawer-marble-badge>
              <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>Marble …
            </span>
          </div>
        </div>
        <a href="${escapeAttribute(closeHref)}"
           class="rounded p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 transition-colors ml-2"
           aria-label="Close">✕</a>
      </div>

      <div class="border-b border-gray-200 dark:border-gray-700 flex" role="tablist">
        <button class="audience-drawer-tab px-5 py-3 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400 -mb-px" data-tab="details" role="tab" aria-selected="true">Details</button>
        <button class="audience-drawer-tab px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 -mb-px" data-tab="links" role="tab" aria-selected="false">Links</button>
        <button class="audience-drawer-tab px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 -mb-px" data-tab="chat" role="tab" aria-selected="false">Chat</button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div data-tab-panel="details">${detailsTab}</div>
        <div data-tab-panel="links" class="hidden">${linksTab}</div>
        <div data-tab-panel="chat" class="hidden">${chatTab}</div>
      </div>

    </aside>
    <script>
    (function() {
      var audienceKey = ${audienceKeyJs};

      // Tab switching
      document.querySelectorAll('.audience-drawer-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var tab = btn.dataset.tab;
          document.querySelectorAll('.audience-drawer-tab').forEach(function(b) {
            var active = b.dataset.tab === tab;
            b.setAttribute('aria-selected', active ? 'true' : 'false');
            b.className = 'audience-drawer-tab px-5 py-3 text-sm font-medium border-b-2 -mb-px ' + (active
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300');
          });
          document.querySelectorAll('[data-tab-panel]').forEach(function(panel) {
            panel.classList.toggle('hidden', panel.dataset.tabPanel !== tab);
          });
        });
      });

      // Live status for drawer header badges
      async function refreshDrawerStatus() {
        try {
          var res = await fetch('/api/audiences/' + encodeURIComponent(audienceKey) + '/runtime-status');
          if (!res.ok) return;
          var data = await res.json();
          updateBadge(document.querySelector('[data-drawer-openclaw-badge]'), data.openclaw, 'OpenClaw');
          updateBadge(document.querySelector('[data-drawer-marble-badge]'), data.marble, 'Marble');
        } catch {}
      }

      function updateBadge(el, status, label) {
        if (!el) return;
        var cls = status === 'running' ? 'badge-running text-xs' : status === 'stopped' ? 'badge-stopped text-xs' : 'badge-unknown text-xs';
        el.className = cls;
        el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>' + label + ' ' + status;
      }

      refreshDrawerStatus();
      var drawerPoller = setInterval(refreshDrawerStatus, 10000);
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) clearInterval(drawerPoller);
        else { refreshDrawerStatus(); drawerPoller = setInterval(refreshDrawerStatus, 10000); }
      });
    })();
    </script>
  </div>`;
}

function renderAudienceWizard() {
  const stepTitles = ["Audience Details", "Publishing Channels", "Protagonist Photo"];

  const step1 = `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div class="col-span-2">
          <label class="label" for="wiz-label">Audience Name *</label>
          <input id="wiz-label" name="label" class="input" placeholder="e.g. Tech founder in Barcelona, 35" required />
        </div>
        <div class="col-span-2">
          <label class="label" for="wiz-description">Short Description *</label>
          <textarea id="wiz-description" name="description" rows="2" class="input resize-none" placeholder="One sentence about this audience persona"></textarea>
        </div>
        <div>
          <label class="label" for="wiz-location">Location</label>
          <input id="wiz-location" name="location" class="input" placeholder="Barcelona, Spain" />
        </div>
        <div>
          <label class="label" for="wiz-interests">Interests <span class="font-normal text-gray-400">(comma-separated)</span></label>
          <input id="wiz-interests" name="interests" class="input" placeholder="technology, AI, startups" />
        </div>
        <div class="col-span-2">
          <label class="label" for="wiz-profile">Profile Brief *</label>
          <textarea id="wiz-profile" name="profile_raw_text" rows="5" class="input resize-y" placeholder="Detailed description of this audience's personality, behaviour, lifestyle, values…"></textarea>
        </div>
      </div>
    </div>`;

  const step2 = `
    <div class="space-y-4">
      <div>
        <label class="label" for="wiz-bot-token">Telegram Bot Token *</label>
        <input id="wiz-bot-token" name="telegram_bot_token" class="input font-mono" placeholder="123456:ABC-DEF..." />
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Get from @BotFather on Telegram</p>
      </div>
      <div>
        <label class="label" for="wiz-chat-id">Telegram Chat ID *</label>
        <input id="wiz-chat-id" name="telegram_chat_id" class="input font-mono" placeholder="-100123456789" />
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Channel or group ID where posts will be sent</p>
      </div>
      <div>
        <label class="label" for="wiz-schedule">Posting Schedule</label>
        <select id="wiz-schedule" name="posting_schedule" class="input">
          <option value="twice_daily">Twice daily (9:00 and 18:00)</option>
          <option value="daily">Daily (9:00)</option>
          <option value="hourly">Hourly</option>
        </select>
      </div>
    </div>`;

  const step3 = `
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">Upload a photo that represents your audience protagonist. This will appear as the avatar in the dashboard.</p>
      <div id="wiz-drop-zone"
           class="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-10 cursor-pointer hover:border-indigo-400 transition-colors"
           onclick="document.getElementById('wiz-photo-file').click()">
        <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center">
          <img id="wiz-photo-preview" src="" alt="" class="w-full h-full object-cover hidden" />
          <span id="wiz-photo-placeholder" class="text-2xl">📷</span>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400">Click to select or drag &amp; drop</p>
        <p class="text-xs text-gray-400">JPEG, PNG or WebP · max 5 MB</p>
        <input type="file" id="wiz-photo-file" name="photo" accept="image/jpeg,image/png,image/webp" class="hidden" />
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 text-center">Photo is optional — you can add it later.</p>
    </div>`;

  return `<div id="audience-wizard" class="dialog-backdrop" style="display:none" role="dialog" aria-modal="true" aria-labelledby="wiz-title">
    <div class="dialog-panel">

      <div class="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h2 id="wiz-title" class="text-base font-semibold text-gray-900 dark:text-gray-100">New Audience</h2>
        <button onclick="closeAudienceWizard()" class="rounded p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="Close">✕</button>
      </div>

      <div class="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-1" id="wiz-stepper">
          ${stepTitles.map((title, i) => `
            <div class="flex items-center gap-1 flex-1 ${i < stepTitles.length - 1 ? "" : "flex-none"}">
              <div class="flex items-center gap-2">
                <span class="step-circle ${i === 0 ? "active" : "pending"}" data-step-circle="${i}">${i + 1}</span>
                <span class="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap" data-step-label="${i}">${escapeHtml(title)}</span>
              </div>
              ${i < stepTitles.length - 1 ? `<div class="step-connector flex-1" data-step-connector="${i}"></div>` : ""}
            </div>`).join("")}
        </div>
      </div>

      <form id="audience-wizard-form" class="flex-1 overflow-y-auto">
        <div class="px-6 py-5">
          <div data-wiz-step="0">${step1}</div>
          <div data-wiz-step="1" class="hidden">${step2}</div>
          <div data-wiz-step="2" class="hidden">${step3}</div>
        </div>
      </form>

      <div class="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
        <button id="wiz-back" class="btn btn-outline btn-sm hidden" onclick="wizardBack()">← Back</button>
        <div class="ml-auto flex items-center gap-3">
          <span id="wiz-error" class="text-xs text-red-600 dark:text-red-400 hidden"></span>
          <button id="wiz-next" class="btn btn-accent btn-sm" onclick="wizardNext()">Next →</button>
          <button id="wiz-submit" class="btn btn-accent btn-sm hidden" onclick="wizardSubmit()">Create Audience</button>
        </div>
      </div>

    </div>
  </div>`;
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

      document.getElementById("analyze-posts-button")?.addEventListener("click", async () => {
        const form = document.getElementById("create-audience-form");
        const fileInput = document.getElementById("posts-file-input");
        const statusEl = document.getElementById("analyze-status");
        const twitterHandle = (form.twitter_handle?.value ?? "").trim().replace(/^@+/, "");
        const file = fileInput?.files[0];

        if (!file && !twitterHandle) {
          alert("Provide a Twitter handle or upload a posts file.");
          return;
        }

        let postsText = "";
        if (file) {
          postsText = await file.text();
        }

        statusEl.textContent = "Inferring personality from posts…";
        statusEl.className = "text-xs text-gray-500 dark:text-gray-400";
        statusEl.classList.remove("hidden");

        try {
          const result = await sendJson("/api/audiences/infer-from-posts", "POST", {
            twitter_handle: twitterHandle || null,
            posts_text: postsText || null
          });
          if (result.raw_text) {
            form.raw_text.value = result.raw_text;
          }
          statusEl.textContent = "Personality inferred — review the brief and click Run LLM Investigation.";
          statusEl.className = "text-xs text-green-600 dark:text-green-400";
        } catch (err) {
          statusEl.textContent = "Error: " + err.message;
          statusEl.className = "text-xs text-red-600 dark:text-red-400";
        }
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

      function escapeHtmlClient(str) {
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function appendUserBubble(threadEl, text) {
        const div = document.createElement("div");
        div.className = "flex justify-end";
        div.innerHTML =
          '<div class="max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 bg-blue-600 text-white text-sm leading-relaxed whitespace-pre-wrap">' +
          escapeHtmlClient(text) +
          "</div>";
        threadEl.appendChild(div);
        threadEl.scrollTop = threadEl.scrollHeight;
      }

      function appendAssistantBubble(threadEl) {
        const wrapper = document.createElement("div");
        wrapper.className = "flex items-start gap-2";
        const avatar = document.createElement("div");
        avatar.className = "flex-shrink-0 w-5 h-5 rounded-full bg-gray-600 dark:bg-gray-500 flex items-center justify-center";
        avatar.style.cssText = "font-size:9px;color:#d1d5db;font-weight:600";
        avatar.textContent = "AI";
        const bubble = document.createElement("div");
        bubble.className = "max-w-[82%] rounded-2xl rounded-tl-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm leading-relaxed prose prose-sm dark:prose-invert";
        const cursor = document.createElement("span");
        cursor.className = "inline-block w-2 h-3 bg-blue-500 rounded-sm align-middle";
        cursor.style.animation = "pulse 1s step-end infinite";
        bubble.appendChild(cursor);
        wrapper.appendChild(avatar);
        wrapper.appendChild(bubble);
        threadEl.appendChild(wrapper);
        threadEl.scrollTop = threadEl.scrollHeight;
        return bubble;
      }

      function startTypewriter(bubble, fullText, threadEl) {
        let i = 0;
        let current = "";
        bubble.textContent = "";
        const cursor = document.createElement("span");
        cursor.className = "inline-block w-2 h-3 bg-blue-500 rounded-sm ml-0.5 align-middle";
        cursor.style.animation = "pulse 1s step-end infinite";
        bubble.appendChild(cursor);

        const timer = setInterval(() => {
          if (i >= fullText.length) {
            clearInterval(timer);
            if (window.marked) {
              const html = window.marked.parse(fullText);
              bubble.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
            } else {
              bubble.textContent = fullText;
            }
            threadEl.scrollTop = threadEl.scrollHeight;
            return;
          }
          current += fullText[i++];
          bubble.textContent = current;
          bubble.appendChild(cursor);
          threadEl.scrollTop = threadEl.scrollHeight;
        }, 20);
      }

      // ── Audience Wizard ──────────────────────────────────────────
      var _wizStep = 0;
      var _wizStepCount = 3;

      function openAudienceWizard() {
        _wizStep = 0;
        wizardRender();
        var wiz = document.getElementById('audience-wizard');
        wiz.style.display = '';
        wiz.addEventListener('click', function onBdClick(e) {
          if (e.target === wiz) closeAudienceWizard();
        }, { once: true });
      }

      function closeAudienceWizard() {
        document.getElementById('audience-wizard').style.display = 'none';
        document.getElementById('audience-wizard-form').reset();
        document.getElementById('wiz-photo-preview').classList.add('hidden');
        document.getElementById('wiz-photo-placeholder').classList.remove('hidden');
        showWizError('');
      }

      function wizardRender() {
        document.querySelectorAll('[data-wiz-step]').forEach(function(panel) {
          panel.classList.toggle('hidden', Number(panel.dataset.wizStep) !== _wizStep);
        });
        document.querySelectorAll('[data-step-circle]').forEach(function(el) {
          var idx = Number(el.dataset.stepCircle);
          el.className = 'step-circle ' + (idx < _wizStep ? 'done' : idx === _wizStep ? 'active' : 'pending');
        });
        document.querySelectorAll('[data-step-connector]').forEach(function(el) {
          el.className = 'step-connector flex-1 ' + (Number(el.dataset.stepConnector) < _wizStep ? 'done' : '');
        });
        document.getElementById('wiz-back').classList.toggle('hidden', _wizStep === 0);
        document.getElementById('wiz-next').classList.toggle('hidden', _wizStep === _wizStepCount - 1);
        document.getElementById('wiz-submit').classList.toggle('hidden', _wizStep !== _wizStepCount - 1);
        showWizError('');
      }

      function showWizError(msg) {
        var el = document.getElementById('wiz-error');
        el.textContent = msg;
        el.classList.toggle('hidden', !msg);
      }

      function validateWizardStep(step) {
        var form = document.getElementById('audience-wizard-form');
        if (step === 0) {
          if (!form.label.value.trim()) { showWizError('Audience Name is required.'); return false; }
          if (!form.profile_raw_text.value.trim()) { showWizError('Profile Brief is required.'); return false; }
        }
        if (step === 1) {
          if (!form.telegram_bot_token.value.trim()) { showWizError('Telegram Bot Token is required.'); return false; }
          if (!form.telegram_chat_id.value.trim()) { showWizError('Telegram Chat ID is required.'); return false; }
        }
        return true;
      }

      function wizardNext() {
        if (!validateWizardStep(_wizStep)) return;
        if (_wizStep < _wizStepCount - 1) { _wizStep++; wizardRender(); }
      }

      function wizardBack() {
        if (_wizStep > 0) { _wizStep--; wizardRender(); }
      }

      async function wizardSubmit() {
        if (!validateWizardStep(_wizStep)) return;
        var btn = document.getElementById('wiz-submit');
        btn.disabled = true;
        btn.textContent = 'Creating…';
        showWizError('');
        try {
          var form = document.getElementById('audience-wizard-form');
          var interestsRaw = form.interests?.value?.trim() ?? '';
          var interests = interestsRaw ? interestsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
          var photoFile = document.getElementById('wiz-photo-file')?.files[0] ?? null;
          var photoPayload = null;
          if (photoFile) {
            var b64 = await fileToBase64(photoFile);
            photoPayload = { file_name: photoFile.name, mime_type: photoFile.type, size_bytes: photoFile.size, file_data_base64: b64 };
          }
          var payload = {
            details: {
              label: form.label.value.trim(),
              description: form.description?.value?.trim() ?? '',
              location: form.location?.value?.trim() ?? '',
              interests,
              profile_raw_text: form.profile_raw_text.value.trim()
            },
            channels: {
              telegram_bot_token: form.telegram_bot_token.value.trim(),
              telegram_chat_id: form.telegram_chat_id.value.trim(),
              posting_schedule: form.posting_schedule?.value ?? 'twice_daily'
            },
            photo: photoPayload
          };
          var result = await sendJson('/api/audiences/create-full', 'POST', payload);
          closeAudienceWizard();
          window.location.href = '/?tab=audiences&audience_id=' + encodeURIComponent(result.audience_id ?? '');
        } catch (err) {
          showWizError(err.message);
          btn.disabled = false;
          btn.textContent = 'Create Audience';
        }
      }

      // Photo drop zone wiring
      var photoFile = document.getElementById('wiz-photo-file');
      if (photoFile) {
        photoFile.addEventListener('change', function() {
          var file = this.files[0];
          if (!file) return;
          var preview = document.getElementById('wiz-photo-preview');
          var placeholder = document.getElementById('wiz-photo-placeholder');
          var reader = new FileReader();
          reader.onload = function(e) {
            preview.src = e.target.result;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
          };
          reader.readAsDataURL(file);
        });
        var dropZone = document.getElementById('wiz-drop-zone');
        if (dropZone) {
          dropZone.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('border-indigo-400'); });
          dropZone.addEventListener('dragleave', function() { this.classList.remove('border-indigo-400'); });
          dropZone.addEventListener('drop', function(e) {
            e.preventDefault(); this.classList.remove('border-indigo-400');
            var file = e.dataTransfer.files[0];
            if (file) { photoFile.files = e.dataTransfer.files; photoFile.dispatchEvent(new Event('change')); }
          });
        }
      }

      // ── Runtime status poller ──────────────────────────────────────
      (function() {
        var rows = document.querySelectorAll('[data-runtime-audience-id]');
        if (!rows.length) return;

        function rtClass(status) {
          return status === 'running' ? 'badge-running' : status === 'stopped' ? 'badge-stopped' : 'badge-unknown';
        }
        function rtDot(status) {
          return '<span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>';
        }

        async function pollRow(row) {
          var key = row.dataset.runtimeAudienceId;
          try {
            var res = await fetch('/api/audiences/' + encodeURIComponent(key) + '/runtime-status');
            if (!res.ok) return;
            var data = await res.json();
            var oc = row.querySelector('[data-runtime-openclaw]');
            var mb = row.querySelector('[data-runtime-marble]');
            if (oc) { oc.className = rtClass(data.openclaw); oc.innerHTML = rtDot() + ' ' + data.openclaw; }
            if (mb) { mb.className = rtClass(data.marble); mb.innerHTML = rtDot() + ' ' + data.marble; }
          } catch {}
        }

        rows.forEach(pollRow);
        var poller = setInterval(function() { rows.forEach(pollRow); }, 10000);
        document.addEventListener('visibilitychange', function() {
          if (document.hidden) clearInterval(poller);
          else { rows.forEach(pollRow); poller = setInterval(function() { rows.forEach(pollRow); }, 10000); }
        });
      })();

      document.querySelectorAll("form[data-instance-chat-form]").forEach((form) => {
        const audienceId = form.dataset.instanceChatForm;
        const threadEl = document.getElementById("chat-thread-" + audienceId);
        if (!threadEl) return;

        threadEl.scrollTop = threadEl.scrollHeight;

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const message = form.message.value.trim();
          const operator = form.operator?.value || "operator@example.com";
          if (!message) return;

          form.message.value = "";
          const submitBtn = form.querySelector("button[type=submit]");
          submitBtn.disabled = true;

          appendUserBubble(threadEl, message);
          const bubble = appendAssistantBubble(threadEl);

          try {
            const result = await sendJson(
              "/api/instances/" + audienceId + "/chat",
              "POST",
              { message, operator }
            );
            startTypewriter(bubble, result.reply ?? "", threadEl);
          } catch (err) {
            bubble.className = bubble.className + " text-red-500";
            bubble.textContent = "Error: " + err.message;
          } finally {
            submitBtn.disabled = false;
          }
        });
      });
    </script>`;
}

function renderAssetCard(story, asset) {
  const replaceUrl = `/api/stories/${story.id}/assets/${asset.id}/replace`;
  const selectUrl = `/api/stories/${story.id}/assets/${asset.id}/select`;
  const previewUrl = asset.preview_url ?? asset.download_url ?? asset.source_asset_url ?? "";
  const preview = previewUrl
    ? renderAssetPreview(asset, previewUrl)
    : `<div class="flex items-center justify-center h-24 text-xs text-gray-400 dark:text-gray-500">${escapeHtml(asset.storage_object?.file_name ?? asset.source_asset_url ?? `${asset.asset_type} asset`)}</div>`;
  const isSelected = asset.is_selected;

  return `<article class="rounded-lg border ${isSelected ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-200 dark:border-gray-700"} bg-white dark:bg-gray-800 p-3 space-y-2" data-asset-card>
    <div class="rounded-md overflow-hidden bg-gray-100 dark:bg-gray-700 min-h-[96px] flex items-center justify-center">${preview}</div>
    <p class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(asset.asset_type)} · ${escapeHtml(asset.status)} · ${isSelected ? "selected" : "not selected"}</p>
    <button type="button" data-asset-select="${escapeAttribute(selectUrl)}"
            class="w-full rounded-md bg-white dark:bg-gray-700 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Select</button>
    <label class="block">
      <span class="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Replace Asset</span>
      <input type="file" accept="image/*,video/mp4"
             class="block w-full text-xs text-gray-500 dark:text-gray-400 file:mr-2 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-gray-700 dark:file:bg-gray-700 dark:file:text-gray-300" />
    </label>
    <button type="button" data-asset-replace="${escapeAttribute(replaceUrl)}"
            class="w-full rounded-md bg-gray-900 dark:bg-gray-100 px-2 py-1 text-xs font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Upload Replacement</button>
  </article>`;
}

function renderSetupChecklist(setupStatus) {
  const checks = setupStatus?.checks ?? {};
  return `<ul class="divide-y divide-gray-100 dark:divide-gray-700">
    ${Object.entries(checks).map(([key, value]) => `<li class="flex items-start justify-between gap-3 py-2.5">
      <span class="text-sm text-gray-900 dark:text-gray-100 capitalize">${escapeHtml(humanizeCheckName(key))}</span>
      <div class="flex items-center gap-2 text-right">
        <span class="${value?.ok ? "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}">${escapeHtml(value?.ok ? "ok" : "missing")}</span>
        <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(value?.message ?? "")}</span>
      </div>
    </li>`).join("")}
  </ul>`;
}

function renderAudienceImportPanel(preview) {
  if (!preview) {
    return `<div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-5 text-sm text-gray-500 dark:text-gray-400">Audience import is not configured.</div>`;
  }
  const sourceLabel = preview.source_file_name ?? "No audience source";
  const itemCount = preview.items?.length ?? preview.item_count ?? 0;
  const summary = preview.error
    ? escapeHtml(preview.error)
    : preview.import_required
      ? `${itemCount} audience updates ready to import`
      : "No audience import required";
  return `<div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
    <p class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Source</p>
    <p class="text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(sourceLabel)}</p>
    <p class="text-xs text-gray-500 dark:text-gray-400">LLM expansion runs before Supabase write.</p>
    <p class="text-xs text-gray-500 dark:text-gray-400">${summary}</p>
    ${preview.import_required ? `<div class="pt-1"><button type="button" id="import-audience-file-button" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Import ${escapeHtml(sourceLabel)}</button></div>` : ""}
  </div>`;
}

function renderLaunchConfigForm(audience, instance) {
  const runtime = instance?.runtime_config ?? {};
  const value = (key, fallback = "") => escapeAttribute(runtime[key] ?? instance?.[key] ?? fallback);
  const inputClass = "block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5";
  return `<form class="space-y-4" data-launch-audience-id="${escapeAttribute(audience.id)}">
    <div class="grid grid-cols-2 gap-3">
      <label class="block"><span class="${labelClass}">Telegram Bot Token</span><input name="telegram_bot_token" value="${value("telegram_bot_token")}" autocomplete="off" required class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Telegram Channel ID</span><input name="telegram_chat_id" value="${value("telegram_chat_id")}" placeholder="-100..." required class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Telegram Report ID</span><input name="telegram_report_chat_id" value="${value("telegram_report_chat_id", runtime.telegram_chat_id ?? "")}" placeholder="-100..." class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">OpenClaw Admin URL</span><input name="openclaw_admin_url" value="${value("openclaw_admin_url")}" placeholder="http://127.0.0.1:7610" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Base URL</span><input name="plugin_base_url" value="${value("plugin_base_url", instance?.profile_base_url ?? "")}" placeholder="http://127.0.0.1:5410" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Engine Image</span><input name="profile_engine_image" value="${value("profile_engine_image")}" placeholder="ghcr.io/openclaw/marble-profile-service:latest" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Engine Command</span><input name="profile_engine_command" value="${value("profile_engine_command")}" placeholder="node api/profile-server.js" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Health Path</span><input name="profile_engine_health_path" value="${value("profile_engine_health_path", "/healthz")}" placeholder="/healthz" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">Profile Storage Path</span><input name="profile_storage_path" value="${value("profile_storage_path")}" placeholder="/srv/marble-profile" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">LLM Provider</span><input name="llm_provider" value="${value("llm_provider", "openai")}" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">LLM Model</span><input name="llm_model" value="${value("llm_model")}" placeholder="global default" class="${inputClass}" /></label>
      <label class="block"><span class="${labelClass}">LLM Base URL</span><input name="llm_base_url" value="${value("llm_base_url")}" placeholder="global default" class="${inputClass}" /></label>
    </div>
    <div class="flex justify-end">
      <button type="submit" class="rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-700 transition-colors cursor-pointer">Launch Deployment</button>
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
  return `<div class="space-y-1">
    <span class="block text-xs font-medium text-gray-500 dark:text-gray-400">${escapeHtml(label)}</span>
    <code class="block rounded-md bg-gray-100 dark:bg-gray-900 px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-300 overflow-x-auto">${escapeHtml(command)}</code>
  </div>`;
}

function renderAudienceFields(audience) {
  const inputClass = "block w-full rounded-md border-0 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5";
  return `
    <label class="block"><span class="${labelClass}">Label</span><input name="label" value="${escapeAttribute(audience.label ?? "")}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Language</span><input name="language" value="${escapeAttribute(audience.language ?? "")}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Location</span><input name="location" value="${escapeAttribute(audience.location ?? "")}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Family Context</span><textarea name="family_context" class="${inputClass} resize-y">${escapeHtml(audience.family_context ?? "")}</textarea></label>
    <label class="block"><span class="${labelClass}">Interests</span><input name="interests" value="${escapeAttribute((audience.interests ?? []).join(", "))}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Content Pillars</span><input name="content_pillars" value="${escapeAttribute((audience.content_pillars ?? []).join(", "))}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Excluded Topics</span><input name="excluded_topics" value="${escapeAttribute((audience.excluded_topics ?? []).join(", "))}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Tone</span><input name="tone" value="${escapeAttribute(audience.tone ?? "")}" class="${inputClass}" /></label>
    <label class="block"><span class="${labelClass}">Status</span><input name="status" value="${escapeAttribute(audience.status ?? "")}" class="${inputClass}" /></label>
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
  return ["setup", "stories", "audiences", "merchants"].includes(value) ? value : "setup";
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
