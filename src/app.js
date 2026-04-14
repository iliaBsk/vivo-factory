export function createApp(options) {
  const repository = options.repository;
  const instanceManager = options.instanceManager ?? null;
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

  if (request.method === "POST" && matchPath(request.pathname, /^\/api\/audiences\/([^/]+)\/launch$/)) {
    if (!audienceManagerLauncher) {
      return json(404, { error: "Audience manager launch is not configured." });
    }
    const audienceId = request.pathname.split("/")[3];
    const audience = await repository.getAudience(audienceId);
    if (!audience) {
      return json(404, { error: "Audience not found" });
    }
    const instance = await repository.getInstanceByAudience(audienceId);
    if (!instance) {
      return json(409, { error: "Audience instance configuration not found." });
    }
    const body = readBody(request.body);
    const result = await audienceManagerLauncher.launchAudienceManager(audience, instance, {
      operator: body.operator ?? body.actor_id ?? "unknown",
      timestamp: clock()
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
    const setupStatus = setupService ? await setupService.getStatus() : defaultSetupStatus();
    let audienceImportPreview = null;
    if (audienceImportService) {
      try {
        audienceImportPreview = audienceImportService.getImportStatus
          ? await audienceImportService.getImportStatus()
          : await audienceImportService.previewImport();
      } catch (error) {
        audienceImportPreview = { error: error.message, items: [], import_required: false };
      }
    }
    const audiences = await repository.listAudiences();
    const audienceInstances = repository.listInstances ? await repository.listInstances() : [];
    const stories = (await repository.listStories(filters)).map((story) => ({
      ...story,
      publication_target: publicationTargetResolver(story.audience, story)
    }));
    const selectedStoryId = request.query?.story_id || stories[0]?.id || "";
    const activeStoryRaw = selectedStoryId ? await repository.getStory(selectedStoryId) : null;
    const activeStory = activeStoryRaw
      ? {
          ...activeStoryRaw,
          publication_target: publicationTargetResolver(activeStoryRaw.audience, activeStoryRaw)
        }
      : null;
    const auditItems = (await repository.listAuditLog()).slice(0, 10);
    const analyticsItems = (await repository.listFeedbackEvents()).slice(0, 10);
    const instances = instanceManager ? instanceManager.listInstances() : [];
    return html(200, renderDashboard({
      filters,
      setupStatus,
      audienceImportPreview,
      audiences,
      audienceInstances,
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

function renderDashboard(model) {
  const setupChecklist = renderSetupChecklist(model.setupStatus);
  const audienceManagerCards = renderAudienceManagerCards(model.audiences, model.audienceInstances ?? []);
  const audienceImportPanel = renderAudienceImportPanel(model.audienceImportPreview);
  const storiesList = model.stories.map((story) => {
    const href = buildDashboardHref(model.filters, story.id);
    const isActive = model.activeStory?.id === story.id;
    const targetLabel = story.publication_target
      ? `${story.publication_target.channel}:${story.publication_target.target_identifier}`
      : "unconfigured";
    return `<a class="story-row${isActive ? " active" : ""}" href="${escapeAttribute(href)}">
      <strong>${escapeHtml(story.title)}</strong>
      <div class="story-row-meta">
        <span>${escapeHtml(story.audience?.label ?? "Unknown audience")}</span>
        <span>${escapeHtml(story.status)}</span>
        <span>${escapeHtml(story.operator_review_status)}</span>
      </div>
      <div class="story-row-meta">
        <span>Asset: ${escapeHtml(story.selected_asset_id ?? "none")}</span>
        <span>Target: ${escapeHtml(targetLabel)}</span>
      </div>
    </a>`;
  }).join("");

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
  const liveInstances = model.instances.length
    ? model.instances.map((instance) => `<li>
        <strong>${escapeHtml(instance.service_name ?? instance.audience_id)}</strong>
        <div>Audience: ${escapeHtml(instance.audience_key ?? instance.audience_id)}</div>
        <div>Chat ID: ${escapeHtml(instance.telegram_chat_id)}</div>
        <div>Report ID: ${escapeHtml(instance.telegram_report_chat_id ?? "")}</div>
        <div>Admin: ${escapeHtml(instance.openclaw_admin_url)}</div>
        <div>Profile Service: ${escapeHtml(instance.profile_service_name ?? "n/a")}</div>
        <div class="instance-actions">
          <button type="button" data-instance-action="deploy" data-audience-id="${escapeAttribute(instance.audience_id)}">Deploy</button>
          <button type="button" data-instance-action="health" data-audience-id="${escapeAttribute(instance.audience_id)}">Health</button>
          <button type="button" data-instance-action="report" data-audience-id="${escapeAttribute(instance.audience_id)}">Report</button>
          <button type="button" data-instance-action="logs" data-audience-id="${escapeAttribute(instance.audience_id)}">Logs</button>
        </div>
        <div class="command-list">
          ${renderCommandBlock("OpenClaw Shell", instance.commands?.openclaw_shell)}
          ${renderCommandBlock("Profile Shell", instance.commands?.profile_shell)}
          ${renderCommandBlock("OpenClaw Env", instance.commands?.openclaw_env)}
          ${renderCommandBlock("OpenClaw Logs", instance.commands?.openclaw_logs)}
          ${renderCommandBlock("Profile Logs", instance.commands?.profile_logs)}
        </div>
      </li>`).join("")
    : "<li>No instance config</li>";

  const audience = model.activeStory?.audience;
  const audienceFields = audience ? renderAudienceFields(audience) : `<p class="muted">No audience loaded.</p>`;
  const metadataJson = escapeHtml(JSON.stringify(model.activeStory?.metadata ?? {}, null, 2));
  const profileJson = escapeHtml(JSON.stringify(audience?.profile_snapshot ?? {}, null, 2));
  const selectedAssetId = model.activeStory?.selected_asset_id ?? "";
  const publicationTarget = model.activeStory?.publication_target ?? null;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Vivo Factory Story Operations</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #efe7db;
        --panel: #fff9f0;
        --panel-strong: #f8efe1;
        --line: rgba(53, 34, 22, 0.12);
        --accent: #a54c1f;
        --accent-soft: #f3c6a7;
        --text: #26180f;
        --muted: #775c4a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, serif;
        background:
          radial-gradient(circle at top left, rgba(196, 112, 53, 0.22), transparent 28%),
          linear-gradient(180deg, #f5efe4 0%, #e9dccb 100%);
        color: var(--text);
      }
      a { color: inherit; text-decoration: none; }
      main { max-width: 1440px; margin: 0 auto; padding: 28px 20px 56px; }
      h1, h2, h3 { margin: 0; }
      p { margin: 0; }
      .hero {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 16px;
        margin-bottom: 20px;
      }
      .hero p { color: var(--muted); max-width: 720px; }
      .layout {
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr);
        gap: 18px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: 0 20px 40px rgba(44, 26, 15, 0.08);
      }
      .panel-inner { padding: 18px; }
      .story-queue { position: sticky; top: 20px; align-self: start; }
      .filter-grid {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      .workspace-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 360px;
        gap: 18px;
      }
      .workspace-stack {
        display: grid;
        gap: 18px;
      }
      .story-list {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }
      .story-row {
        display: grid;
        gap: 4px;
        padding: 12px 14px;
        border-radius: 16px;
        background: #fff;
        border: 1px solid transparent;
      }
      .story-row-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--muted);
        font-size: 13px;
      }
      .story-row.active {
        border-color: var(--accent);
        background: #fff7f1;
      }
      .muted { color: var(--muted); }
      label { display: grid; gap: 6px; font-size: 14px; color: var(--muted); }
      input, select, textarea, button {
        font: inherit;
      }
      input, select, textarea {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--line);
        padding: 10px 12px;
        background: #fff;
        color: var(--text);
      }
      textarea { resize: vertical; min-height: 96px; }
      button {
        border: none;
        border-radius: 999px;
        padding: 10px 14px;
        background: var(--accent);
        color: #fff;
        cursor: pointer;
      }
      button.secondary {
        background: #e8d9c8;
        color: var(--text);
      }
      button.ghost {
        background: transparent;
        color: var(--accent);
        border: 1px solid var(--accent-soft);
      }
      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .section-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
      }
      .story-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }
      .meta-chip {
        padding: 10px 12px;
        border-radius: 14px;
        background: var(--panel-strong);
        border: 1px solid var(--line);
      }
      .asset-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      .asset-card, .empty-card {
        padding: 14px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #fff;
      }
      .asset-card.selected {
        border-color: var(--accent);
        box-shadow: inset 0 0 0 1px var(--accent-soft);
      }
      .asset-preview {
        min-height: 120px;
        border-radius: 14px;
        background: linear-gradient(135deg, #f3d8c6 0%, #f7efe8 100%);
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
        gap: 8px;
      }
      ul.compact li {
        padding: 10px 12px;
        border-radius: 14px;
        background: #fff;
        border: 1px solid var(--line);
      }
      .lower-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 18px;
        margin-top: 18px;
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
        margin-top: 12px;
      }
      .command-block {
        display: grid;
        gap: 4px;
      }
      .command-block code {
        display: block;
        padding: 8px 10px;
        border-radius: 12px;
        background: var(--panel-strong);
        overflow-x: auto;
      }
      .asset-preview-media {
        width: 100%;
        max-height: 240px;
        object-fit: cover;
        border-radius: 14px;
      }
      @media (max-width: 1080px) {
        .layout, .workspace-grid {
          grid-template-columns: 1fr;
        }
        .story-queue {
          position: static;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="hero">
        <div>
          <h1>Vivo Factory Story Operations</h1>
          <p>Review stories, swap assets, edit audiences, and queue Telegram publications without leaving the dashboard.</p>
        </div>
      </div>

      <div class="lower-grid" style="margin-top:0; margin-bottom:18px;">
        <section class="panel">
          <div class="panel-inner">
            <div class="section-title"><h2>Setup Checklist</h2><span class="muted">${escapeHtml(model.setupStatus?.ready ? "ready" : "action required")}</span></div>
            ${setupChecklist}
          </div>
        </section>
        <section class="panel">
          <div class="panel-inner">
            <div class="section-title"><h2>Audience Managers</h2><span class="muted">${escapeHtml(String(model.audiences.length))} audiences</span></div>
            ${audienceImportPanel}
            <div class="asset-grid" style="margin-top:12px;">${audienceManagerCards}</div>
          </div>
        </section>
      </div>

      <div class="layout">
        <aside class="panel story-queue">
          <div class="panel-inner">
            <div class="section-title">
              <h2>Story Queue</h2>
              <span class="muted">${escapeHtml(String(model.stories.length))} stories</span>
            </div>
            <form method="GET" class="filter-grid">
              <label>Status
                <select name="status">
                  ${renderStatusOptions(model.filters.status)}
                </select>
              </label>
              <label>Review
                <select name="review_status">
                  ${renderReviewOptions(model.filters.review_status)}
                </select>
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
            <div class="story-list">
              ${storiesList || `<div class="empty-card">No stories match these filters.</div>`}
            </div>
          </div>
        </aside>

        <section class="workspace-grid">
          <div class="workspace-stack">
            <section class="panel">
              <div class="panel-inner">
                <div class="section-title">
                  <h2>Story Editor</h2>
                  <button type="button" class="ghost" id="toggle-audience-button">Audience Drawer</button>
                </div>
                ${model.activeStory ? `
                  <div class="story-meta">
                    <div class="meta-chip"><strong>Pipeline</strong><div>${escapeHtml(model.activeStory.status)}</div></div>
                    <div class="meta-chip"><strong>Review</strong><div>${escapeHtml(model.activeStory.operator_review_status)}</div></div>
                    <div class="meta-chip"><strong>Selected Asset</strong><div>${escapeHtml(selectedAssetId || "none")}</div></div>
                    <div class="meta-chip"><strong>Audience</strong><div>${escapeHtml(model.activeStory.audience?.label ?? "unknown")}</div></div>
                    <div class="meta-chip"><strong>Instance</strong><div>${escapeHtml(model.activeStory.instance?.service_name ?? "unassigned")}</div></div>
                    <div class="meta-chip"><strong>Channel Target</strong><div>${escapeHtml(publicationTarget ? `${publicationTarget.channel}:${publicationTarget.target_identifier}` : "unconfigured")}</div></div>
                  </div>
                  <form id="story-form" data-story-id="${escapeAttribute(model.activeStory.id)}" class="filter-grid">
                    <label>Title
                      <input name="title" value="${escapeAttribute(model.activeStory.title)}" />
                    </label>
                    <label>Story Text
                      <textarea name="story_text">${escapeHtml(model.activeStory.story_text)}</textarea>
                    </label>
                    <label>Summary
                      <textarea name="summary">${escapeHtml(model.activeStory.summary ?? "")}</textarea>
                    </label>
                    <label>Metadata JSON
                      <textarea name="metadata">${metadataJson}</textarea>
                    </label>
                    <div class="button-row">
                      <button type="submit">Save Story</button>
                    </div>
                  </form>
                ` : `<div class="empty-card">Select a story from the queue.</div>`}
              </div>
            </section>

            <section class="panel">
              <div class="panel-inner">
                <div class="section-title">
                  <h2>Asset Panel</h2>
                  <span class="muted">Select or replace the publish asset</span>
                </div>
                <div class="asset-grid">
                  ${assetCards}
                </div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-inner">
                <div class="section-title">
                  <h2>Publication Queue</h2>
                  <span class="muted">Select asset, approve, then queue channel publication</span>
                </div>
                ${model.activeStory ? `
                  <div class="story-meta" style="margin-bottom:12px;">
                    <div class="meta-chip"><strong>Channel</strong><div>${escapeHtml(publicationTarget?.channel ?? "unconfigured")}</div></div>
                    <div class="meta-chip"><strong>Target</strong><div>${escapeHtml(publicationTarget?.target_identifier ?? "unconfigured")}</div></div>
                  </div>
                  <form id="review-form" data-story-id="${escapeAttribute(model.activeStory.id)}" class="filter-grid">
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
                    <button type="button" id="queue-publication-button" data-story-id="${escapeAttribute(model.activeStory.id)}">Queue Channel Publication</button>
                  </div>
                ` : ""}
                <h3 style="margin:18px 0 10px;">Queued Publications</h3>
                <ul class="compact">${publicationItems}</ul>
                <h3 style="margin:18px 0 10px;">Review History</h3>
                <ul class="compact">${reviewItems}</ul>
              </div>
            </section>
          </div>

          <aside class="panel drawer" id="audience-drawer">
            <div class="panel-inner">
              <div class="section-title">
                <h2>Audience Drawer</h2>
                <button type="button" class="secondary" id="close-audience-button">Close</button>
              </div>
              ${audience ? `
                <form id="audience-form" data-audience-id="${escapeAttribute(audience.id)}" class="filter-grid">
                  ${audienceFields}
                  <label>Profile Snapshot JSON
                    <textarea name="profile_snapshot">${profileJson}</textarea>
                  </label>
                  <button type="submit">Save Audience</button>
                </form>
              ` : `<div class="empty-card">No audience selected.</div>`}
            </div>
          </aside>
        </section>
      </div>

      <div class="lower-grid">
        <section class="panel">
          <div class="panel-inner">
            <div class="section-title"><h2>Audit Log</h2></div>
            <ul class="compact">${auditItems}</ul>
          </div>
        </section>
        <section class="panel">
          <div class="panel-inner">
            <div class="section-title"><h2>Analytics Snapshot</h2></div>
            <ul class="compact">${analyticsItems}</ul>
          </div>
        </section>
        <section class="panel">
          <div class="panel-inner">
            <div class="section-title"><h2>Live Instances</h2><button type="button" id="deploy-all-button">Deploy All</button></div>
            <ul class="compact">${liveInstances}</ul>
          </div>
        </section>
        <section class="panel">
          <div class="panel-inner">
            <div class="section-title"><h2>Operator Console</h2></div>
            <form id="chat-form" class="filter-grid">
              <label>Audience ID
                <input name="audience_id" placeholder="barcelona-family" />
              </label>
              <label>Message
                <textarea name="message" rows="4" placeholder="status report"></textarea>
              </label>
              <label>Operator
                <input name="operator" placeholder="operator@example.com" />
              </label>
              <button type="submit">Send To Instance</button>
            </form>
          </div>
        </section>
      </div>
    </main>

    <script>
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

      document.getElementById("toggle-audience-button")?.addEventListener("click", () => {
        document.getElementById("audience-drawer")?.classList.add("open");
      });

      document.getElementById("close-audience-button")?.addEventListener("click", () => {
        document.getElementById("audience-drawer")?.classList.remove("open");
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
        window.location.reload();
      });

      function splitList(value) {
        return value.split(",").map((item) => item.trim()).filter(Boolean);
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

      document.querySelectorAll("[data-launch-audience-id]").forEach((button) => {
        button.addEventListener("click", async () => {
          await postInstance("/api/audiences/" + button.dataset.launchAudienceId + "/launch", {
            operator: "operator@example.com"
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
    </script>
  </body>
</html>`;
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
  const summary = preview.error
    ? escapeHtml(preview.error)
    : preview.import_required
      ? `${preview.items?.length ?? 0} audience updates ready to import`
      : "No audience import required";
  return `<div class="empty-card">
    <strong>Source</strong>
    <div class="muted">${escapeHtml(sourceLabel)}</div>
    <div class="muted">${summary}</div>
    ${preview.import_required ? `<div class="button-row" style="margin-top:10px;"><button type="button" id="import-audience-file-button">Import ${escapeHtml(sourceLabel)}</button></div>` : ""}
  </div>`;
}

function renderAudienceManagerCards(audiences, audienceInstances) {
  const instancesByAudienceId = new Map((audienceInstances ?? []).map((instance) => [instance.audience_id, instance]));
  if (!audiences.length) {
    return `<div class="empty-card">No audiences are configured.</div>`;
  }
  return audiences.map((audience) => {
    const instance = instancesByAudienceId.get(audience.id) ?? null;
    const runtimeConfig = instance?.runtime_config ?? {};
    const llmLabel = runtimeConfig.llm_model ?? "global default";
    return `<article class="asset-card">
      <strong>${escapeHtml(audience.label ?? audience.audience_key ?? audience.id)}</strong>
      <div class="muted">${escapeHtml(audience.audience_key ?? audience.id)}</div>
      <div class="muted">LLM: ${escapeHtml(llmLabel)}</div>
      <div class="muted">Instance: ${escapeHtml(instance?.service_name ?? "not provisioned")}</div>
      <div class="button-row" style="margin-top:10px;">
        <button type="button" data-launch-audience-id="${escapeAttribute(audience.id)}">Launch Audience Manager</button>
      </div>
    </article>`;
  }).join("");
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
  return renderOptions(["", "new", "classifying", "classified", "media_decided", "asset_generating", "ready_to_publish", "published", "failed", "archived"], selected, "All statuses");
}

function renderReviewOptions(selected) {
  return renderOptions(["", "pending", "approved", "rejected", "changes_requested"], selected, "All review states");
}

function renderOptions(values, selected, blankLabel) {
  return values.map((value) => {
    const label = value === "" ? blankLabel : value;
    return `<option value="${escapeAttribute(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function buildDashboardHref(filters, storyId) {
  const url = new URL("http://localhost/");
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
  url.searchParams.set("story_id", storyId);
  return `${url.pathname}${url.search}`;
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
