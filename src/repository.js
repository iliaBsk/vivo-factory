import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_STORAGE_BUCKET = "vivo-content";

export function createRepository(seed = {}) {
  const state = normalizeState(seed);

  return {
    listStories(filters = {}) {
      return listStoriesFromState(state, filters);
    },
    getStory(storyId) {
      const story = state.stories.get(storyId);
      return story ? hydrateStory(state, story) : null;
    },
    updateStory(storyId, changes = {}, options = {}) {
      const story = requireStory(state, storyId);
      const allowed = {
        title: changes.title ?? story.title,
        story_text: changes.story_text ?? story.story_text,
        summary: changes.summary ?? story.summary,
        metadata: changes.metadata ?? story.metadata
      };
      const updated = {
        ...story,
        ...allowed,
        updated_at: options.timestamp ?? story.updated_at ?? nowIso()
      };
      state.stories.set(storyId, updated);
      appendAudit(state, {
        type: "story_updated",
        entity_type: "story",
        entity_id: storyId,
        actor_id: options.actorId ?? "unknown",
        timestamp: updated.updated_at,
        payload: { changes: allowed }
      });
      return hydrateStory(state, updated);
    },
    listAudiences() {
      return [...state.audiences.values()].sort(compareByUpdatedDesc);
    },
    getAudience(audienceId) {
      return state.audiences.get(audienceId) ?? null;
    },
    listInstances() {
      return [...state.instances.values()].sort(compareByUpdatedDesc);
    },
    getInstance(instanceId) {
      return state.instances.get(instanceId) ?? null;
    },
    getInstanceByAudience(audienceId) {
      return [...state.instances.values()].find((instance) => instance.audience_id === audienceId) ?? null;
    },
    createInstanceForAudience(audience, instance = {}, options = {}) {
      const now = options.timestamp ?? nowIso();
      const created = {
        id: instance.id ?? crypto.randomUUID(),
        factory_id: instance.factory_id ?? audience.factory_id ?? null,
        audience_id: audience.id,
        instance_key: instance.instance_key,
        service_name: instance.service_name,
        openclaw_admin_url: instance.openclaw_admin_url ?? "",
        profile_base_url: instance.profile_base_url ?? "",
        runtime_config: instance.runtime_config ?? {},
        status: instance.status ?? "created",
        last_heartbeat_at: instance.last_heartbeat_at ?? null,
        created_at: instance.created_at ?? now,
        updated_at: instance.updated_at ?? now
      };
      state.instances.set(created.id, created);
      appendAudit(state, {
        type: "instance_created",
        entity_type: "instance",
        entity_id: created.id,
        actor_id: options.actorId ?? "unknown",
        timestamp: now,
        payload: { audience_id: audience.id, service_name: created.service_name }
      });
      return created;
    },
    updateInstance(instanceId, changes = {}, options = {}) {
      const instance = requireInstance(state, instanceId);
      const updated = {
        ...instance,
        ...changes,
        updated_at: options.timestamp ?? instance.updated_at ?? nowIso()
      };
      state.instances.set(instanceId, updated);
      appendAudit(state, {
        type: "instance_updated",
        entity_type: "instance",
        entity_id: instanceId,
        actor_id: options.actorId ?? "unknown",
        timestamp: updated.updated_at,
        payload: { changes }
      });
      return updated;
    },
    updateAudience(audienceId, changes = {}, options = {}) {
      const audience = requireAudience(state, audienceId);
      const updated = {
        ...audience,
        ...changes,
        updated_at: options.timestamp ?? audience.updated_at ?? nowIso()
      };
      state.audiences.set(audienceId, updated);
      appendAudit(state, {
        type: "audience_updated",
        entity_type: "audience",
        entity_id: audienceId,
        actor_id: options.actorId ?? "unknown",
        timestamp: updated.updated_at,
        payload: { changes }
      });
      return updated;
    },
    createStory(story, options = {}) {
      const now = options.timestamp ?? nowIso();
      if (!story.story_key) throw new Error("story_key is required");
      if (!story.audience_id) throw new Error("audience_id is required");
      if (!story.title) throw new Error("title is required");
      // Enforce story_key uniqueness
      const exists = [...state.stories.values()].some(s => s.story_key === story.story_key);
      if (exists) {
        throw new Error(`Duplicate story_key: ${story.story_key}`);
      }
      const created = {
        id: story.id ?? crypto.randomUUID(),
        factory_id: story.factory_id ?? null,
        audience_id: story.audience_id,
        instance_id: story.instance_id ?? null,
        story_key: story.story_key,
        title: story.title,
        story_text: story.story_text ?? "",
        summary: story.summary ?? story.story_text?.slice(0, 200) ?? "",
        source_kind: story.source_kind ?? "rss",
        primary_source_url: story.primary_source_url ?? null,
        status: "new",
        is_deal: story.is_deal ?? false,
        is_local: story.is_local ?? false,
        operator_review_status: "pending",
        operator_reviewed_at: null,
        operator_reviewed_by: null,
        operator_review_note: "",
        metadata: story.metadata ?? {},
        created_at: story.created_at ?? now,
        updated_at: story.updated_at ?? now
      };
      state.stories.set(created.id, created);
      appendAudit(state, {
        type: "story_created",
        entity_type: "story",
        entity_id: created.id,
        actor_id: options.actorId ?? "system",
        timestamp: now,
        payload: { audience_id: created.audience_id, source_kind: created.source_kind }
      });
      return hydrateStory(state, created);
    },
    transitionStoryStatus(storyId, status, options = {}) {
      const VALID_STATUSES = new Set([
        "new", "classifying", "classified", "media_decided",
        "asset_generating", "ready_to_publish", "published", "failed", "archived"
      ]);
      if (!VALID_STATUSES.has(status)) {
        throw new Error(`Invalid story status: ${status}`);
      }
      const story = requireStory(state, storyId);
      const now = options.timestamp ?? nowIso();
      const updated = { ...story, status, updated_at: now };
      state.stories.set(storyId, updated);
      appendAudit(state, {
        type: "story_status_changed",
        entity_type: "story",
        entity_id: storyId,
        actor_id: options.actorId ?? "system",
        timestamp: now,
        payload: { from: story.status, to: status }
      });
      return hydrateStory(state, updated);
    },
    selectStoryAsset(storyId, assetId, options = {}) {
      const assets = getStoryAssets(state, storyId);
      if (!assets.some((asset) => asset.id === assetId)) {
        throw new Error(`Unknown asset ${assetId} for story ${storyId}`);
      }

      const updatedAt = options.timestamp ?? nowIso();
      for (const asset of assets) {
        state.storyAssets.set(asset.id, {
          ...asset,
          is_selected: asset.id === assetId,
          updated_at: updatedAt
        });
      }

      appendAudit(state, {
        type: "story_asset_selected",
        entity_type: "story_asset",
        entity_id: assetId,
        actor_id: options.actorId ?? "unknown",
        timestamp: updatedAt,
        payload: { story_id: storyId }
      });
      return hydrateAsset(state, state.storyAssets.get(assetId));
    },
    replaceStoryAsset(storyId, assetId, file = {}, options = {}) {
      const asset = requireStoryAsset(state, storyId, assetId);
      const timestamp = options.timestamp ?? nowIso();
      const buffer = Buffer.from(file.file_data_base64 ?? "", "base64");
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
      const fileName = file.file_name ?? `${asset.asset_slot}.bin`;
      const objectPath = `stories/${storyId}/${Date.parse(timestamp)}-${sanitizeFileName(fileName)}`;
      const storageObjectId = file.storage_object_id ?? crypto.randomUUID();

      const storageObject = {
        id: storageObjectId,
        bucket_name: options.bucketName ?? DEFAULT_STORAGE_BUCKET,
        object_path: objectPath,
        file_name: fileName,
        mime_type: file.mime_type ?? asset.mime_type ?? "application/octet-stream",
        size_bytes: file.size_bytes ?? buffer.length,
        width: file.width ?? asset.width ?? null,
        height: file.height ?? asset.height ?? null,
        duration_seconds: file.duration_seconds ?? asset.duration_seconds ?? null,
        checksum,
        storage_metadata: {
          uploaded_by: options.actorId ?? "unknown"
        },
        created_at: timestamp,
        updated_at: timestamp
      };
      state.storageObjects.set(storageObjectId, storageObject);

      const updatedAsset = {
        ...asset,
        storage_object_id: storageObjectId,
        source_asset_url: null,
        mime_type: storageObject.mime_type,
        size_bytes: storageObject.size_bytes,
        width: storageObject.width,
        height: storageObject.height,
        duration_seconds: storageObject.duration_seconds,
        checksum,
        status: "ready",
        ready_at: timestamp,
        updated_at: timestamp
      };
      state.storyAssets.set(assetId, updatedAsset);

      appendAudit(state, {
        type: "story_asset_replaced",
        entity_type: "story_asset",
        entity_id: assetId,
        actor_id: options.actorId ?? "unknown",
        timestamp,
        payload: {
          story_id: storyId,
          storage_object_id: storageObjectId,
          file_name: fileName
        }
      });
      return hydrateAsset(state, updatedAsset);
    },
    submitStoryReview(storyId, review = {}) {
      requireStory(state, storyId);
      const timestamp = review.created_at ?? nowIso();
      if (review.selected_asset_id) {
        this.selectStoryAsset(storyId, review.selected_asset_id, {
          actorId: review.actor_id,
          timestamp
        });
      }

      const reviewRow = {
        id: review.id ?? crypto.randomUUID(),
        story_id: storyId,
        review_status: review.review_status ?? "pending",
        selected_asset_id: review.selected_asset_id ?? null,
        review_notes: review.review_notes ?? "",
        actor_id: review.actor_id ?? "unknown",
        payload: review.payload ?? {},
        created_at: timestamp
      };
      state.storyReviews.push(reviewRow);

      const story = requireStory(state, storyId);
      const statusFromReview = reviewRow.review_status === "approved"
        ? "ready_to_publish"
        : reviewRow.review_status === "rejected"
          ? "archived"
          : story.status;
      state.stories.set(storyId, {
        ...story,
        status: statusFromReview,
        operator_review_status: reviewRow.review_status,
        operator_reviewed_at: timestamp,
        operator_reviewed_by: reviewRow.actor_id,
        operator_review_note: reviewRow.review_notes,
        updated_at: timestamp
      });

      appendAudit(state, {
        type: "story_review_submitted",
        entity_type: "story_review",
        entity_id: reviewRow.id,
        actor_id: reviewRow.actor_id,
        timestamp,
        payload: {
          story_id: storyId,
          review_status: reviewRow.review_status,
          selected_asset_id: reviewRow.selected_asset_id
        }
      });
      return { ...reviewRow };
    },
    queueStoryPublication(storyId, publication = {}, options = {}) {
      requireStory(state, storyId);
      const timestamp = options.timestamp ?? nowIso();
      const queued = {
        id: publication.id ?? crypto.randomUUID(),
        story_id: storyId,
        asset_id: publication.asset_id ?? null,
        channel: publication.channel ?? "telegram",
        target_identifier: publication.target_identifier ?? "",
        external_message_id: null,
        status: "queued",
        publish_payload: publication.publish_payload ?? {},
        publish_response: {},
        published_at: null,
        created_at: timestamp,
        updated_at: timestamp
      };
      state.storyPublications.push(queued);
      appendAudit(state, {
        type: "story_publication_queued",
        entity_type: "story_publication",
        entity_id: queued.id,
        actor_id: options.actorId ?? "unknown",
        timestamp,
        payload: {
          story_id: storyId,
          asset_id: queued.asset_id,
          channel: queued.channel,
          target_identifier: queued.target_identifier
        }
      });
      return { ...queued };
    },
    listFeedbackEvents() {
      return [...state.feedbackEvents].map(augmentFeedbackEvent).sort(compareByTimestampDesc);
    },
    saveFeedbackEvent(event) {
      state.feedbackEvents.push({ ...event });
      appendAudit(state, {
        type: "feedback_event",
        entity_type: "feedback_event",
        entity_id: event.publication_id ?? event.message_id ?? crypto.randomUUID(),
        actor_id: "system",
        timestamp: event.snapshot_time ?? event.publish_time ?? nowIso(),
        payload: event
      });
      return augmentFeedbackEvent(event);
    },
    listAuditLog() {
      return [...state.auditEvents].sort(compareByTimestampDesc);
    },
    saveInstanceReport(report) {
      state.instanceReports.push({ ...report });
      appendAudit(state, {
        type: "instance_report",
        entity_type: "instance_report",
        entity_id: report.audience_id ?? crypto.randomUUID(),
        actor_id: "system",
        timestamp: report.timestamp ?? nowIso(),
        payload: report
      });
      return report;
    },
    listInstanceReports() {
      return [...state.instanceReports].sort(compareByTimestampDesc);
    },
    saveOperatorChat(chat) {
      state.operatorChats.push({ ...chat });
      appendAudit(state, {
        type: "operator_chat",
        entity_type: "operator_chat",
        entity_id: chat.audience_id ?? crypto.randomUUID(),
        actor_id: chat.operator ?? "unknown",
        timestamp: chat.timestamp ?? nowIso(),
        payload: chat
      });
      return chat;
    },
    listOperatorChats() {
      return [...state.operatorChats].sort(compareByTimestampDesc);
    },
    saveDeploymentResult(deployment) {
      state.deployments.push({ ...deployment });
      appendAudit(state, {
        type: "deployment",
        entity_type: "deployment",
        entity_id: deployment.audience_id ?? crypto.randomUUID(),
        actor_id: deployment.operator ?? "unknown",
        timestamp: deployment.timestamp ?? nowIso(),
        payload: deployment
      });
      return deployment;
    },
    listDeployments() {
      return [...state.deployments].sort(compareByTimestampDesc);
    },
    async getOrCreateConversation(audienceId, channel) {
      const key = `${audienceId}::${channel}`;
      if (!state.conversations[key]) {
        state.conversations[key] = {
          id: crypto.randomUUID(),
          audienceId,
          channel,
          externalId: null,
          title: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          _messages: []
        };
      }
      const { _messages, ...conv } = state.conversations[key];
      return { ...conv };
    },

    async appendChatMessage(conversationId, message) {
      const entry = Object.values(state.conversations).find(c => c.id === conversationId);
      if (!entry) throw new Error(`Conversation ${conversationId} not found`);
      const msg = {
        id: crypto.randomUUID(),
        conversationId,
        audienceId: message.audienceId,
        role: message.role,
        content: message.content,
        senderId: message.senderId ?? null,
        senderName: message.senderName ?? null,
        metadata: message.metadata ?? {},
        createdAt: new Date().toISOString()
      };
      entry._messages.push(msg);
      entry.updatedAt = new Date().toISOString();
      return { ...msg };
    },

    async getConversationMessages(conversationId) {
      const entry = Object.values(state.conversations).find(c => c.id === conversationId);
      if (!entry) return [];
      return entry._messages.map(m => ({ ...m }));
    },

    exportState() {
      return exportState(state);
    }
  };
}

export function createFileRepository(fileUrlOrPath, seed = {}) {
  const filePath = fileUrlOrPath instanceof URL ? fileUrlOrPath : new URL(`file://${path.resolve(fileUrlOrPath)}`);
  const pathname = filePath.pathname;
  ensureParentDirectory(pathname);
  const repository = createRepository(fs.existsSync(pathname) ? readState(pathname) : seed);

  return withPersistence(repository, pathname);
}

export function createSQLiteRepository(dbPath, stateFilePath = "data/dashboard-state.json") {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS vivo_conversations (
      id TEXT PRIMARY KEY,
      audience_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      external_id TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_no_ext
      ON vivo_conversations(audience_id, channel)
      WHERE external_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_with_ext
      ON vivo_conversations(audience_id, channel, external_id)
      WHERE external_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS vivo_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES vivo_conversations(id) ON DELETE CASCADE,
      audience_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msgs_conv ON vivo_messages(conversation_id, created_at);
  `);

  const fileRepo = createFileRepository(path.resolve(stateFilePath));

  return {
    ...fileRepo,

    async getOrCreateConversation(audienceId, channel) {
      const existing = db.prepare(
        `SELECT * FROM vivo_conversations
         WHERE audience_id = ? AND channel = ? AND external_id IS NULL LIMIT 1`
      ).get(audienceId, channel);
      if (existing) {
        return {
          id: existing.id, audienceId: existing.audience_id, channel: existing.channel,
          externalId: existing.external_id, title: existing.title,
          createdAt: existing.created_at, updatedAt: existing.updated_at
        };
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO vivo_conversations (id, audience_id, channel, external_id, title, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`
      ).run(id, audienceId, channel, now, now);
      return { id, audienceId, channel, externalId: null, title: null, createdAt: now, updatedAt: now };
    },

    async appendChatMessage(conversationId, message) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO vivo_messages
           (id, conversation_id, audience_id, role, content, sender_id, sender_name, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, conversationId, message.audienceId, message.role, message.content,
        message.senderId ?? null, message.senderName ?? null,
        JSON.stringify(message.metadata ?? {}), now
      );
      db.prepare(`UPDATE vivo_conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
      return {
        id, conversationId, audienceId: message.audienceId, role: message.role,
        content: message.content, senderId: message.senderId ?? null,
        senderName: message.senderName ?? null, metadata: message.metadata ?? {},
        createdAt: now
      };
    },

    async getConversationMessages(conversationId) {
      const rows = db.prepare(
        `SELECT * FROM vivo_messages WHERE conversation_id = ? ORDER BY created_at ASC`
      ).all(conversationId);
      return rows.map(r => ({
        id: r.id, conversationId: r.conversation_id, audienceId: r.audience_id,
        role: r.role, content: r.content, senderId: r.sender_id,
        senderName: r.sender_name, metadata: r.metadata ? JSON.parse(r.metadata) : {},
        createdAt: r.created_at
      }));
    }
  };
}

export function createSupabaseRepository(options) {
  const client = createSupabaseClient(options);
  const localState = normalizeState(options.seed ?? {});

  return {
    async listStories(filters = {}) {
      const stories = await client.selectStories(filters);
      return hydrateSupabaseStories(client, stories);
    },
    async getStory(storyId) {
      const stories = await client.select("vivo_stories", {
        id: `eq.${storyId}`,
        limit: "1"
      });
      if (stories.length === 0) {
        return null;
      }
      const hydrated = await hydrateSupabaseStories(client, stories);
      return hydrated[0] ?? null;
    },
    async updateStory(storyId, changes = {}, options = {}) {
      const rows = await client.update("vivo_stories", { id: `eq.${storyId}` }, {
        title: changes.title,
        story_text: changes.story_text,
        summary: changes.summary,
        metadata: changes.metadata
      });
      await insertAuditEvent(client, {
        entity_type: "story",
        entity_id: storyId,
        event_type: "story_updated",
        actor_id: options.actorId ?? "unknown",
        payload: { changes }
      });
      return hydrateSupabaseStories(client, rows).then((items) => items[0]);
    },
    async listAudiences() {
      return client.select("vivo_audiences", {
        order: "updated_at.desc"
      });
    },
    async getAudience(audienceId) {
      const rows = await client.select("vivo_audiences", {
        id: `eq.${audienceId}`,
        limit: "1"
      });
      return rows[0] ?? null;
    },
    async listInstances() {
      return client.select("vivo_instances", {
        order: "updated_at.desc"
      });
    },
    async getInstance(instanceId) {
      const rows = await client.select("vivo_instances", {
        id: `eq.${instanceId}`,
        limit: "1"
      });
      return rows[0] ?? null;
    },
    async getInstanceByAudience(audienceId) {
      const rows = await client.select("vivo_instances", {
        audience_id: `eq.${audienceId}`,
        limit: "1"
      });
      return rows[0] ?? null;
    },
    async createInstanceForAudience(audience, instance = {}, options = {}) {
      const rows = await client.insert("vivo_instances", {
        factory_id: instance.factory_id ?? audience.factory_id,
        audience_id: audience.id,
        instance_key: instance.instance_key,
        service_name: instance.service_name,
        openclaw_admin_url: instance.openclaw_admin_url ?? "",
        profile_base_url: instance.profile_base_url ?? "",
        runtime_config: instance.runtime_config ?? {},
        status: instance.status ?? "created",
        last_heartbeat_at: instance.last_heartbeat_at ?? null
      });
      const created = rows[0] ?? null;
      if (created) {
        await insertAuditEvent(client, {
          entity_type: "instance",
          entity_id: created.id,
          event_type: "instance_created",
          actor_id: options.actorId ?? "unknown",
          payload: { audience_id: audience.id, service_name: created.service_name }
        });
      }
      return created;
    },
    async updateInstance(instanceId, changes = {}, options = {}) {
      const rows = await client.update("vivo_instances", { id: `eq.${instanceId}` }, changes);
      await insertAuditEvent(client, {
        entity_type: "instance",
        entity_id: instanceId,
        event_type: "instance_updated",
        actor_id: options.actorId ?? "unknown",
        payload: { changes }
      });
      return rows[0] ?? null;
    },
    async updateAudience(audienceId, changes = {}, options = {}) {
      const rows = await client.update("vivo_audiences", { id: `eq.${audienceId}` }, changes);
      await insertAuditEvent(client, {
        entity_type: "audience",
        entity_id: audienceId,
        event_type: "audience_updated",
        actor_id: options.actorId ?? "unknown",
        payload: { changes }
      });
      return rows[0] ?? null;
    },
    async createStory(story, options = {}) {
      const rows = await client.insert("vivo_stories", {
        factory_id: story.factory_id ?? null,
        audience_id: story.audience_id,
        instance_id: story.instance_id ?? null,
        story_key: story.story_key,
        title: story.title,
        story_text: story.story_text ?? "",
        summary: story.summary ?? story.story_text?.slice(0, 200) ?? "",
        source_kind: story.source_kind ?? "rss",
        primary_source_url: story.primary_source_url ?? null,
        status: "new",
        is_deal: story.is_deal ?? false,
        is_local: story.is_local ?? false,
        metadata: story.metadata ?? {}
      });
      await insertAuditEvent(client, {
        entity_type: "story",
        entity_id: rows[0].id,
        event_type: "story_created",
        actor_id: options.actorId ?? "system",
        payload: { audience_id: story.audience_id, source_kind: story.source_kind }
      });
      const hydrated = await hydrateSupabaseStories(client, rows);
      return hydrated[0] ?? null;
    },
    async transitionStoryStatus(storyId, status, options = {}) {
      const currentRows = await client.select("vivo_stories", { id: `eq.${storyId}`, limit: "1" });
      const fromStatus = currentRows[0]?.status ?? null;
      const rows = await client.update("vivo_stories", { id: `eq.${storyId}` }, { status });
      await insertAuditEvent(client, {
        entity_type: "story",
        entity_id: storyId,
        event_type: "story_status_changed",
        actor_id: options.actorId ?? "system",
        payload: { from: fromStatus, to: status }
      });
      const hydrated = await hydrateSupabaseStories(client, rows);
      return hydrated[0] ?? null;
    },
    async selectStoryAsset(storyId, assetId, options = {}) {
      await client.update("vivo_story_assets", { story_id: `eq.${storyId}` }, { is_selected: false });
      const rows = await client.update("vivo_story_assets", {
        id: `eq.${assetId}`,
        story_id: `eq.${storyId}`
      }, {
        is_selected: true
      });
      await insertAuditEvent(client, {
        entity_type: "story_asset",
        entity_id: assetId,
        event_type: "story_asset_selected",
        actor_id: options.actorId ?? "unknown",
        payload: { story_id: storyId }
      });
      const hydrated = await hydrateSupabaseAssets(client, rows);
      return hydrated[0] ?? null;
    },
    async replaceStoryAsset(storyId, assetId, file = {}, options = {}) {
      const buffer = Buffer.from(file.file_data_base64 ?? "", "base64");
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
      const fileName = file.file_name ?? `${assetId}.bin`;
      const objectPath = `stories/${storyId}/${Date.now()}-${sanitizeFileName(fileName)}`;

      await client.uploadObject(options.bucketName ?? DEFAULT_STORAGE_BUCKET, objectPath, buffer, {
        contentType: file.mime_type ?? "application/octet-stream"
      });

      const storageRows = await client.insert("vivo_storage_objects", {
        bucket_name: options.bucketName ?? DEFAULT_STORAGE_BUCKET,
        object_path: objectPath,
        file_name: fileName,
        mime_type: file.mime_type ?? "application/octet-stream",
        size_bytes: file.size_bytes ?? buffer.length,
        width: file.width ?? null,
        height: file.height ?? null,
        duration_seconds: file.duration_seconds ?? null,
        checksum,
        storage_metadata: {
          uploaded_by: options.actorId ?? "unknown"
        }
      });
      const storageObject = storageRows[0];

      const assetRows = await client.update("vivo_story_assets", {
        id: `eq.${assetId}`,
        story_id: `eq.${storyId}`
      }, {
        storage_object_id: storageObject.id,
        source_asset_url: null,
        mime_type: storageObject.mime_type,
        width: storageObject.width,
        height: storageObject.height,
        duration_seconds: storageObject.duration_seconds,
        checksum,
        status: "ready",
        ready_at: nowIso()
      });

      await insertAuditEvent(client, {
        entity_type: "story_asset",
        entity_id: assetId,
        event_type: "story_asset_replaced",
        actor_id: options.actorId ?? "unknown",
        payload: { story_id: storyId, storage_object_id: storageObject.id, file_name: fileName }
      });
      const hydrated = await hydrateSupabaseAssets(client, assetRows);
      return hydrated[0] ?? null;
    },
    async submitStoryReview(storyId, review = {}) {
      if (review.selected_asset_id) {
        await this.selectStoryAsset(storyId, review.selected_asset_id, {
          actorId: review.actor_id
        });
      }
      const rows = await client.insert("vivo_story_reviews", {
        story_id: storyId,
        review_status: review.review_status ?? "pending",
        selected_asset_id: review.selected_asset_id ?? null,
        review_notes: review.review_notes ?? "",
        actor_id: review.actor_id ?? "unknown",
        payload: review.payload ?? {}
      });
      const statusFromReview = rows[0].review_status === "approved"
        ? "ready_to_publish"
        : rows[0].review_status === "rejected"
          ? "archived"
          : undefined;
      await client.update("vivo_stories", { id: `eq.${storyId}` }, {
        ...(statusFromReview ? { status: statusFromReview } : {}),
        operator_review_status: rows[0].review_status,
        operator_reviewed_at: rows[0].created_at,
        operator_reviewed_by: rows[0].actor_id,
        operator_review_note: rows[0].review_notes
      });
      await insertAuditEvent(client, {
        entity_type: "story_review",
        entity_id: rows[0].id,
        event_type: "story_review_submitted",
        actor_id: rows[0].actor_id,
        payload: {
          story_id: storyId,
          review_status: rows[0].review_status,
          selected_asset_id: rows[0].selected_asset_id
        }
      });
      return rows[0];
    },
    async queueStoryPublication(storyId, publication = {}, options = {}) {
      const rows = await client.insert("vivo_story_publications", {
        story_id: storyId,
        asset_id: publication.asset_id ?? null,
        channel: publication.channel ?? "telegram",
        target_identifier: publication.target_identifier,
        status: "queued",
        publish_payload: publication.publish_payload ?? {}
      });
      await insertAuditEvent(client, {
        entity_type: "story_publication",
        entity_id: rows[0].id,
        event_type: "story_publication_queued",
        actor_id: options.actorId ?? "unknown",
        payload: {
          story_id: storyId,
          channel: rows[0].channel,
          target_identifier: rows[0].target_identifier
        }
      });
      return rows[0];
    },
    async listFeedbackEvents() {
      const items = await client.select("vivo_feedback_events", {
        order: "snapshot_time.desc"
      });
      return items.map(augmentFeedbackEvent);
    },
    async saveFeedbackEvent(event) {
      const rows = await client.insert("vivo_feedback_events", event);
      return augmentFeedbackEvent(rows[0]);
    },
    async listAuditLog() {
      return client.select("vivo_audit_events", {
        order: "created_at.desc"
      }).then((items) => items.map(mapSupabaseAuditEvent));
    },
    saveInstanceReport(report) {
      localState.instanceReports.push({ ...report });
      return report;
    },
    listInstanceReports() {
      return [...localState.instanceReports].sort(compareByTimestampDesc);
    },
    saveOperatorChat(chat) {
      localState.operatorChats.push({ ...chat });
      return chat;
    },
    listOperatorChats() {
      return [...localState.operatorChats].sort(compareByTimestampDesc);
    },
    saveDeploymentResult(deployment) {
      localState.deployments.push({ ...deployment });
      return deployment;
    },
    listDeployments() {
      return [...localState.deployments].sort(compareByTimestampDesc);
    },
    async getOrCreateConversation(audienceId, channel) {
      const { data: existing, error: selectErr } = await client
        .from("vivo_conversations")
        .select("*")
        .eq("audience_id", audienceId)
        .eq("channel", channel)
        .is("external_id", null)
        .limit(1)
        .maybeSingle();
      if (selectErr) throw new Error(selectErr.message);
      if (existing) {
        return {
          id: existing.id, audienceId: existing.audience_id, channel: existing.channel,
          externalId: existing.external_id, title: existing.title,
          createdAt: existing.created_at, updatedAt: existing.updated_at
        };
      }
      const { data: created, error: insertErr } = await client
        .from("vivo_conversations")
        .insert({ audience_id: audienceId, channel })
        .select()
        .single();
      if (insertErr) throw new Error(insertErr.message);
      return {
        id: created.id, audienceId: created.audience_id, channel: created.channel,
        externalId: created.external_id, title: created.title,
        createdAt: created.created_at, updatedAt: created.updated_at
      };
    },
    async appendChatMessage(conversationId, message) {
      const { data, error } = await client
        .from("vivo_messages")
        .insert({
          conversation_id: conversationId,
          audience_id: message.audienceId,
          role: message.role,
          content: message.content,
          sender_id: message.senderId ?? null,
          sender_name: message.senderName ?? null,
          metadata: message.metadata ?? {}
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return {
        id: data.id, conversationId: data.conversation_id, audienceId: data.audience_id,
        role: data.role, content: data.content, senderId: data.sender_id,
        senderName: data.sender_name, metadata: data.metadata, createdAt: data.created_at
      };
    },
    async getConversationMessages(conversationId) {
      const { data, error } = await client
        .from("vivo_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map(r => ({
        id: r.id, conversationId: r.conversation_id, audienceId: r.audience_id,
        role: r.role, content: r.content, senderId: r.sender_id,
        senderName: r.sender_name, metadata: r.metadata, createdAt: r.created_at
      }));
    },
    exportState() {
      return exportState(localState);
    }
  };
}

function normalizeState(seed) {
  return {
    audiences: new Map((seed.audiences ?? []).map((item) => [item.id, { ...item }])),
    instances: new Map((seed.instances ?? []).map((item) => [item.id, { ...item }])),
    stories: new Map((seed.stories ?? []).map((item) => [item.id, { ...item }])),
    storyAssets: new Map((seed.storyAssets ?? []).map((item) => [item.id, { ...item }])),
    storageObjects: new Map((seed.storageObjects ?? []).map((item) => [item.id, { ...item }])),
    storyReviews: [...(seed.storyReviews ?? [])],
    storyPublications: [...(seed.storyPublications ?? [])],
    auditEvents: [...(seed.auditEvents ?? seed.auditLog ?? [])].map(normalizeAuditEvent),
    feedbackEvents: [...(seed.feedbackEvents ?? [])],
    instanceReports: [...(seed.instanceReports ?? [])],
    operatorChats: [...(seed.operatorChats ?? [])],
    deployments: [...(seed.deployments ?? [])],
    conversations: Object.fromEntries(
      Object.entries(seed.conversations ?? {}).map(([k, v]) => [k, { ...v, _messages: [] }])
    )
  };
}

function exportState(state) {
  return {
    audiences: [...state.audiences.values()],
    instances: [...state.instances.values()],
    stories: [...state.stories.values()],
    storyAssets: [...state.storyAssets.values()],
    storageObjects: [...state.storageObjects.values()],
    storyReviews: [...state.storyReviews],
    storyPublications: [...state.storyPublications],
    auditEvents: [...state.auditEvents],
    feedbackEvents: [...state.feedbackEvents],
    instanceReports: [...state.instanceReports],
    operatorChats: [...state.operatorChats],
    deployments: [...state.deployments],
    conversations: Object.fromEntries(
      Object.entries(state.conversations).map(([k, { _messages, ...rest }]) => [k, rest])
    )
  };
}

function listStoriesFromState(state, filters) {
  return [...state.stories.values()]
    .filter((story) => matchesStoryFilters(story, filters))
    .sort(compareByCreatedDesc)
    .map((story) => hydrateStory(state, story));
}

function hydrateStory(state, story) {
  const audience = state.audiences.get(story.audience_id) ?? null;
  const instance = story.instance_id
    ? state.instances.get(story.instance_id) ?? null
    : [...state.instances.values()].find((item) => item.audience_id === story.audience_id) ?? null;
  const assets = getStoryAssets(state, story.id).map((asset) => hydrateAsset(state, asset));
  const reviews = state.storyReviews
    .filter((entry) => entry.story_id === story.id)
    .sort(compareByCreatedDesc);
  const publications = state.storyPublications
    .filter((entry) => entry.story_id === story.id)
    .sort(compareByCreatedDesc);

  return {
    ...story,
    audience,
    instance,
    assets,
    reviews,
    publications,
    selected_asset_id: assets.find((asset) => asset.is_selected)?.id ?? null
  };
}

function hydrateAsset(state, asset) {
  const storageObject = asset.storage_object_id ? state.storageObjects.get(asset.storage_object_id) ?? null : null;
  return {
    ...asset,
    storage_object: storageObject,
    download_url: storageObject?.download_url ?? asset.source_asset_url ?? null,
    preview_url: storageObject?.download_url ?? asset.source_asset_url ?? null
  };
}

function getStoryAssets(state, storyId) {
  return [...state.storyAssets.values()]
    .filter((asset) => asset.story_id === storyId)
    .sort(compareByCreatedDesc);
}

function matchesStoryFilters(story, filters) {
  if (filters.status && story.status !== filters.status) {
    return false;
  }
  if (filters.review_status && story.operator_review_status !== filters.review_status) {
    return false;
  }
  if (filters.audience_id && story.audience_id !== filters.audience_id) {
    return false;
  }
  if (filters.search) {
    const needle = String(filters.search).toLowerCase();
    const haystack = [story.title, story.story_text, story.summary]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  return true;
}

function requireStory(state, storyId) {
  const story = state.stories.get(storyId);
  if (!story) {
    throw new Error(`Unknown story id: ${storyId}`);
  }
  return story;
}

function requireAudience(state, audienceId) {
  const audience = state.audiences.get(audienceId);
  if (!audience) {
    throw new Error(`Unknown audience id: ${audienceId}`);
  }
  return audience;
}

function requireInstance(state, instanceId) {
  const instance = state.instances.get(instanceId);
  if (!instance) {
    throw new Error(`Unknown instance id: ${instanceId}`);
  }
  return instance;
}

function requireStoryAsset(state, storyId, assetId) {
  const asset = state.storyAssets.get(assetId);
  if (!asset || asset.story_id !== storyId) {
    throw new Error(`Unknown asset ${assetId} for story ${storyId}`);
  }
  return asset;
}

function appendAudit(state, entry) {
  state.auditEvents.push(normalizeAuditEvent(entry));
}

function normalizeAuditEvent(entry) {
  return {
    id: entry.id ?? crypto.randomUUID(),
    type: entry.type ?? entry.event_type ?? "event",
    entity_type: entry.entity_type ?? null,
    entity_id: entry.entity_id ?? null,
    actor_id: entry.actor_id ?? null,
    timestamp: entry.timestamp ?? entry.created_at ?? nowIso(),
    payload: entry.payload ?? {}
  };
}

function augmentFeedbackEvent(event) {
  return {
    ...event,
    engagement_score:
      Number(event.impression_count ?? 0) +
      Number(event.reply_count ?? 0) +
      Number(event.reaction_count ?? 0) +
      Number(event.button_click_count ?? 0) +
      Number(event.share_count ?? 0) +
      Number(event.save_count ?? 0) +
      Number(event.moderator_score ?? 0)
  };
}

function compareByCreatedDesc(left, right) {
  return String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""));
}

function compareByUpdatedDesc(left, right) {
  return String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
}

function compareByTimestampDesc(left, right) {
  return String(right.timestamp ?? right.created_at ?? "").localeCompare(String(left.timestamp ?? left.created_at ?? ""));
}

function withPersistence(repository, pathname) {
  const write = () => writeState(pathname, repository.exportState());
  const wrapped = { ...repository };
  for (const methodName of [
    "createStory",
    "transitionStoryStatus",
    "updateStory",
    "updateAudience",
    "createInstanceForAudience",
    "updateInstance",
    "selectStoryAsset",
    "replaceStoryAsset",
    "submitStoryReview",
    "queueStoryPublication",
    "saveFeedbackEvent",
    "saveInstanceReport",
    "saveOperatorChat",
    "saveDeploymentResult"
  ]) {
    const method = repository[methodName].bind(repository);
    wrapped[methodName] = (...args) => {
      const result = method(...args);
      if (result && typeof result.then === "function") {
        return result.then((resolved) => {
          write();
          return resolved;
        });
      }
      write();
      return result;
    };
  }
  return wrapped;
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeState(filePath, state) {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeFileName(value) {
  return String(value).replaceAll(/[^a-zA-Z0-9._-]/g, "-");
}

function createSupabaseClient(options) {
  const baseUrl = String(options.url ?? "").replace(/\/+$/, "");
  const serviceRoleKey = options.serviceRoleKey;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!baseUrl || !serviceRoleKey || !fetchImpl) {
    throw new Error("Supabase repository requires url, serviceRoleKey, and fetch");
  }

  return {
    async selectStories(filters) {
      const query = {
        select: "*",
        order: "created_at.desc"
      };
      if (filters.status) {
        query.status = `eq.${filters.status}`;
      }
      if (filters.review_status) {
        query.operator_review_status = `eq.${filters.review_status}`;
      }
      if (filters.audience_id) {
        query.audience_id = `eq.${filters.audience_id}`;
      }
      if (filters.search) {
        const term = escapePostgrestLike(filters.search);
        query.or = `(title.ilike.*${term}*,story_text.ilike.*${term}*,summary.ilike.*${term}*)`;
      }
      return this.select("vivo_stories", query);
    },
    async select(table, query = {}) {
      const url = new URL(`${baseUrl}/rest/v1/${table}`);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, value);
        }
      }
      const response = await fetchImpl(url, {
        headers: createSupabaseHeaders(serviceRoleKey)
      });
      return parseSupabaseResponse(response);
    },
    async insert(table, body) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          ...createSupabaseHeaders(serviceRoleKey),
          "content-type": "application/json",
          prefer: "return=representation"
        },
        body: JSON.stringify(body)
      });
      return parseSupabaseResponse(response);
    },
    async update(table, filters, body) {
      const url = new URL(`${baseUrl}/rest/v1/${table}`);
      for (const [key, value] of Object.entries(filters)) {
        url.searchParams.set(key, value);
      }
      const response = await fetchImpl(url, {
        method: "PATCH",
        headers: {
          ...createSupabaseHeaders(serviceRoleKey),
          "content-type": "application/json",
          prefer: "return=representation"
        },
        body: JSON.stringify(body)
      });
      return parseSupabaseResponse(response);
    },
    async uploadObject(bucketName, objectPath, body, options = {}) {
      const encodedSegments = objectPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      const response = await fetchImpl(`${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodedSegments}`, {
        method: "POST",
        headers: {
          ...createSupabaseHeaders(serviceRoleKey),
          "content-type": options.contentType ?? "application/octet-stream",
          "x-upsert": "true"
        },
        body
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json().catch(() => ({}));
    },
    async signObjectUrl(bucketName, objectPath, expiresIn = 3600) {
      // Strip bucket name prefix if it was stored as part of the path
      const normalizedPath = objectPath.startsWith(`${bucketName}/`)
        ? objectPath.slice(bucketName.length + 1)
        : objectPath;
      const encodedSegments = normalizedPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      const response = await fetchImpl(`${baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucketName)}/${encodedSegments}`, {
        method: "POST",
        headers: {
          ...createSupabaseHeaders(serviceRoleKey),
          "content-type": "application/json"
        },
        body: JSON.stringify({ expiresIn })
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = typeof response.json === "function"
        ? await response.json()
        : JSON.parse(await response.text());
      const signedPath = payload.signedURL ?? payload.signedUrl ?? payload.url ?? "";
      if (!signedPath) {
        return null;
      }
      return signedPath.startsWith("http") ? signedPath : `${baseUrl}${signedPath}`;
    }
  };
}

async function hydrateSupabaseStories(client, stories) {
  if (stories.length === 0) {
    return [];
  }

  const storyIds = uniqueValues(stories.map((story) => story.id));
  const audienceIds = uniqueValues(stories.map((story) => story.audience_id));
  const instanceIds = uniqueValues(stories.map((story) => story.instance_id).filter(Boolean));

  const [audiences, instances, assets, reviews, publications] = await Promise.all([
    audienceIds.length > 0 ? client.select("vivo_audiences", { id: `in.(${audienceIds.join(",")})` }) : [],
    instanceIds.length > 0 ? client.select("vivo_instances", { id: `in.(${instanceIds.join(",")})` }) : [],
    client.select("vivo_story_assets", { story_id: `in.(${storyIds.join(",")})`, order: "created_at.desc" }),
    client.select("vivo_story_reviews", { story_id: `in.(${storyIds.join(",")})`, order: "created_at.desc" }),
    client.select("vivo_story_publications", { story_id: `in.(${storyIds.join(",")})`, order: "created_at.desc" })
  ]);

  const hydratedAssets = await hydrateSupabaseAssets(client, assets);
  const audiencesById = new Map(audiences.map((item) => [item.id, item]));
  const instancesById = new Map(instances.map((item) => [item.id, item]));
  const assetsByStoryId = groupBy(hydratedAssets, (item) => item.story_id);
  const reviewsByStoryId = groupBy(reviews, (item) => item.story_id);
  const publicationsByStoryId = groupBy(publications, (item) => item.story_id);

  return stories.map((story) => {
    const storyAssets = assetsByStoryId.get(story.id) ?? [];
    return {
      ...story,
      audience: audiencesById.get(story.audience_id) ?? null,
      instance: story.instance_id ? instancesById.get(story.instance_id) ?? null : null,
      assets: storyAssets,
      reviews: reviewsByStoryId.get(story.id) ?? [],
      publications: publicationsByStoryId.get(story.id) ?? [],
      selected_asset_id: storyAssets.find((asset) => asset.is_selected)?.id ?? null
    };
  });
}

async function hydrateSupabaseAssets(client, assets) {
  if (assets.length === 0) {
    return [];
  }
  const storageIds = uniqueValues(assets.map((asset) => asset.storage_object_id).filter(Boolean));
  const storageObjects = storageIds.length > 0
    ? await client.select("vivo_storage_objects", { id: `in.(${storageIds.join(",")})` })
    : [];
  const storageById = new Map(storageObjects.map((item) => [item.id, item]));
  return Promise.all(assets.map(async (asset) => {
    const storageObject = asset.storage_object_id ? storageById.get(asset.storage_object_id) ?? null : null;
    const downloadUrl = storageObject
      ? await client.signObjectUrl(storageObject.bucket_name ?? DEFAULT_STORAGE_BUCKET, storageObject.object_path)
      : asset.source_asset_url ?? null;
    return {
      ...asset,
      storage_object: storageObject,
      download_url: downloadUrl,
      preview_url: downloadUrl
    };
  }));
}

async function insertAuditEvent(client, event) {
  const rows = await client.insert("vivo_audit_events", {
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    event_type: event.event_type,
    actor_type: "operator",
    actor_id: event.actor_id ?? "unknown",
    payload: event.payload ?? {}
  });
  return rows[0];
}

function mapSupabaseAuditEvent(entry) {
  return {
    id: entry.id,
    type: entry.event_type,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    actor_id: entry.actor_id,
    timestamp: entry.created_at,
    payload: entry.payload ?? {}
  };
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return grouped;
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function createSupabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

async function parseSupabaseResponse(response) {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function escapePostgrestLike(value) {
  return String(value).replaceAll("%", "\\%").replaceAll(",", "\\,");
}
