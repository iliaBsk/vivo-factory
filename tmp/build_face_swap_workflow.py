import json
from pathlib import Path


def node(name, node_type, position, parameters=None, credentials=None, node_id=None, type_version=None):
    item = {
        "parameters": parameters or {},
        "id": node_id or name,
        "name": name,
        "type": node_type,
        "position": position,
    }
    if type_version is not None:
        item["typeVersion"] = type_version
    if credentials:
        item["credentials"] = credentials
    return item


prepare_story_bundle_js = r"""const story = $('Story Loop').item.json || {};
const audience = $('GetAudienceProfile').first().json || {};
let heroStorageObject = {};
try {
  heroStorageObject = $('GetHeroImageStorageObject').first().json || {};
} catch {
  heroStorageObject = {};
}
const profileSnapshot = audience.profile_snapshot || {};
const assets = $input.all().map((item) => item.json || {});

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidHttpUrl(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s) return false;
  if (s.startsWith('data:')) return false;
  if (s.startsWith('blob:')) return false;
  return s.startsWith('http://') || s.startsWith('https://');
}

function getByPath(obj, path) {
  return path.reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function buildStoragePublicUrl(storageObject) {
  const bucketName = asString(storageObject.bucket_name);
  const objectPath = asString(storageObject.object_path);

  if (!bucketName || !objectPath) return '';

  const encodedPath = objectPath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');

  if (!encodedPath) return '';

  return `https://ujfcoveypojivevpepoo.supabase.co/storage/v1/object/public/${encodeURIComponent(bucketName)}/${encodedPath}`;
}

function collectFaceImageCandidates(obj) {
  const candidates = [];
  const seen = new Set();
  const preferredPaths = [
    ['hero_image_url'],
    ['heroImageUrl'],
    ['face_image_url'],
    ['faceImageUrl'],
    ['profile_image_url'],
    ['profileImageUrl'],
    ['profile_photo_url'],
    ['profilePhotoUrl'],
    ['avatar_url'],
    ['avatarUrl'],
    ['portrait_url'],
    ['portraitUrl'],
    ['headshot_url'],
    ['headshotUrl'],
    ['reference_image_url'],
    ['referenceImageUrl'],
    ['protagonist', 'image_url'],
    ['protagonist', 'hero_image_url'],
    ['protagonist', 'avatar_url'],
    ['user_profile', 'image_url'],
    ['user_profile', 'avatar_url']
  ];

  for (const path of preferredPaths) {
    const value = asString(getByPath(obj, path));
    if (isValidHttpUrl(value) && !seen.has(value)) {
      seen.add(value);
      candidates.push(value);
    }
  }

  function walk(value, keyPath = []) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, keyPath.concat(String(index))));
      return;
    }

    if (!value || typeof value !== 'object') return;

    for (const [key, entry] of Object.entries(value)) {
      const nextPath = keyPath.concat(key);
      if (typeof entry === 'string') {
        const normalized = entry.trim();
        if (!isValidHttpUrl(normalized)) continue;
        const pathText = nextPath.join('.').toLowerCase();
        if (!/(hero|face|avatar|portrait|headshot|reference|profile.*(image|photo)|image|photo)/i.test(pathText)) {
          continue;
        }
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        candidates.push(normalized);
        continue;
      }

      walk(entry, nextPath);
    }
  }

  walk(obj);

  return candidates;
}

const faceCandidates = collectFaceImageCandidates(profileSnapshot);
const sourceFaceUrl =
  buildStoragePublicUrl(heroStorageObject) ||
  faceCandidates[0] ||
  '';

const eligibleAssets = [];
const preflightErrors = [];

for (const asset of assets) {
  if (asset.decision !== 'edit_image') continue;
  if (['ready', 'skipped', 'failed'].includes(asset.status)) continue;

  const sourceAssetUrl = asString(asset.source_asset_url);
  if (!isValidHttpUrl(sourceAssetUrl)) {
    preflightErrors.push(`Asset ${asset.id || asset.asset_slot || 'unknown'} is missing a valid source_asset_url`);
    continue;
  }

  eligibleAssets.push({
    asset_id: asset.id,
    asset_slot: asset.asset_slot,
    asset_type: asset.asset_type,
    asset_status: asset.status,
    decision: asset.decision,
    is_required: !!asset.is_required,
    source_asset_url: sourceAssetUrl,
    personalization_angle: asString(asset.personalization_angle),
    scene_description: asString(asset.scene_description)
  });
}

if (eligibleAssets.length > 0 && !sourceFaceUrl) {
  preflightErrors.unshift('Missing hero face image URL from vivo_audiences.hero_image_asset_storage_id or vivo_audiences.profile_snapshot');
}

return [{
  json: {
    story_id: story.id,
    audience_id: story.audience_id,
    story_status: story.status,
    hero_image_asset_storage_id: audience.hero_image_asset_storage_id || null,
    source_face_url: sourceFaceUrl,
    eligible_assets: eligibleAssets,
    eligible_asset_count: eligibleAssets.length,
    has_preflight_error: preflightErrors.length > 0,
    preflight_error: preflightErrors.join('; '),
    profile_snapshot: profileSnapshot
  }
}];"""


expand_assets_js = r"""const bundle = $input.first().json || {};
const assets = Array.isArray(bundle.eligible_assets) ? bundle.eligible_assets : [];

return assets.map((asset) => ({
  json: {
    story_id: bundle.story_id,
    audience_id: bundle.audience_id,
    source_face_url: bundle.source_face_url,
    asset_id: asset.asset_id,
    asset_slot: asset.asset_slot,
    asset_type: asset.asset_type,
    asset_status: asset.asset_status,
    decision: asset.decision,
    is_required: !!asset.is_required,
    source_asset_url: asset.source_asset_url,
    personalization_angle: asset.personalization_angle || '',
    scene_description: asset.scene_description || '',
    face_swap_request: {
      source_face_url: bundle.source_face_url,
      target_video_url: asset.source_asset_url
    }
  }
}));"""


run_face_swap_js = r"""const item = $input.first().json || {};

const apiBaseUrl = (process.env.FACE_SWAP_BASE_URL || 'http://192.168.1.79:13451').replace(/\/+$/, '');
const apiKey = process.env.FACE_SWAP_API_KEY || process.env.GPU_API_KEY || 'YOUR_GPU_API_KEY';
const pollIntervalMs = Number(process.env.FACE_SWAP_POLL_INTERVAL_MS || 5000);
const maxPollAttempts = Number(process.env.FACE_SWAP_MAX_POLLS || 120);

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(payload) {
  const statusText = asString(
    payload?.status ??
    payload?.state ??
    payload?.job_status ??
    payload?.phase
  ).toLowerCase();

  const done = payload?.done === true || ['done', 'completed', 'complete', 'success', 'succeeded', 'finished', 'ready'].includes(statusText);
  const failed = payload?.failed === true || payload?.ok === false || ['failed', 'error', 'errored', 'cancelled', 'canceled'].includes(statusText);
  const message = asString(payload?.error || payload?.message || payload?.detail);

  return { done, failed, statusText, message };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw_text: text };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }

  return payload;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const requestPayload = {
  source_face_url: item.source_face_url,
  target_video_url: item.source_asset_url
};

async function main() {
  let startPayload = null;
  let statusPayload = null;
  let jobId = '';

  try {
    startPayload = await requestJson(`${apiBaseUrl}/api/video/face-swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(requestPayload)
    });

    jobId = asString(startPayload?.job_id || startPayload?.id);
    if (!jobId) {
      throw new Error(`Face swap API did not return a job_id: ${JSON.stringify(startPayload).slice(0, 500)}`);
    }

    for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
      statusPayload = await requestJson(`${apiBaseUrl}/status/${encodeURIComponent(jobId)}`, {
        headers: {
          'x-api-key': apiKey
        }
      });

      const normalized = normalizeStatus(statusPayload);
      if (normalized.failed) {
        throw new Error(normalized.message || `Face swap job ${jobId} failed: ${JSON.stringify(statusPayload).slice(0, 500)}`);
      }

      if (normalized.done) {
        return [{
          json: {
            ...item,
            face_swap_ok: true,
            face_swap_job_id: jobId,
            face_swap_start_response: startPayload,
            face_swap_status_response: statusPayload,
            download_url: `${apiBaseUrl}/download/${encodeURIComponent(jobId)}`
          }
        }];
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`Face swap polling timed out after ${maxPollAttempts} attempts for job ${jobId}`);
  } catch (error) {
    return [{
      json: {
        ...item,
        face_swap_ok: false,
        face_swap_job_id: jobId,
        face_swap_start_response: startPayload,
        face_swap_status_response: statusPayload,
        error_message: error?.message || String(error)
      }
    }];
  }
}

return main();"""


prepare_upload_js = r"""const item = $input.first();
const json = item.json || {};
const binary = item.binary || {};
const file = binary.data || {};

const extension = file.fileExtension ? `.${file.fileExtension}` : '';
const fileName = `${json.asset_slot}-faceswap-${json.asset_id}${extension}`;

return [{
  json: {
    ...json,
    file_name: fileName,
    object_path: fileName,
    mime_type: file.mimeType || 'application/octet-stream'
  },
  binary
}];"""


check_story_ready_js = r"""const assets = $input.all().map((item) => item.json || {});
const story = $('Story Loop').item.json || {};

const publishableAssets = assets.filter((asset) => ['image', 'video'].includes(asset.asset_type));
const unreadyRequiredAssets = assets.filter((asset) => asset.is_required === true && asset.status !== 'ready');

return [{
  json: {
    story_id: story.id,
    should_mark_ready: publishableAssets.length > 0 && unreadyRequiredAssets.length === 0,
    publishable_asset_count: publishableAssets.length,
    unready_required_count: unreadyRequiredAssets.length
  }
}];"""


workflow = {
    "name": "994. VIVO Edit Image Face Swap Generator",
    "nodes": [
        node(
            "When clicking ‘Execute workflow’",
            "n8n-nodes-base.manualTrigger",
            [-2784, -32],
            {},
            node_id="manual-trigger",
            type_version=1,
        ),
        node(
            "GetStoriesToProcess",
            "n8n-nodes-base.supabase",
            [-2496, -32],
            {
                "operation": "getAll",
                "tableId": "vivo_stories",
                "limit": 10,
                "filters": {
                    "conditions": [
                        {
                            "keyName": "status",
                            "condition": "eq",
                            "keyValue": "asset_generating",
                        }
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="get-stories",
            type_version=1,
        ),
        node(
            "Story Loop",
            "n8n-nodes-base.splitInBatches",
            [-2208, -32],
            {"options": {}},
            node_id="story-loop",
            type_version=3,
        ),
        node(
            "GetAudienceProfile",
            "n8n-nodes-base.supabase",
            [-1920, -32],
            {
                "operation": "get",
                "tableId": "vivo_audiences",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "keyValue": "={{ $('Story Loop').item.json.audience_id }}",
                        }
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="get-audience",
            type_version=1,
        ),
        node(
            "GetHeroImageStorageObject",
            "n8n-nodes-base.supabase",
            [-1776, 128],
            {
                "operation": "get",
                "tableId": "vivo_storage_objects",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "keyValue": "={{ $('GetAudienceProfile').first().json.hero_image_asset_storage_id }}",
                        }
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="get-hero-image-storage-object",
            type_version=1,
        ),
        node(
            "GetStoryAssets",
            "n8n-nodes-base.supabase",
            [-1632, -32],
            {
                "operation": "getAll",
                "tableId": "vivo_story_assets",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "story_id",
                            "keyValue": "={{ $('Story Loop').item.json.id }}",
                        }
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="get-story-assets",
            type_version=1,
        ),
        node(
            "Prepare Story Bundle",
            "n8n-nodes-base.code",
            [-1344, -32],
            {"jsCode": prepare_story_bundle_js},
            node_id="prepare-story-bundle",
            type_version=2,
        ),
        node(
            "If Preflight Error",
            "n8n-nodes-base.if",
            [-1056, -144],
            {
                "conditions": {
                    "options": {
                        "caseSensitive": True,
                        "leftValue": "",
                        "typeValidation": "strict",
                        "version": 3,
                    },
                    "conditions": [
                        {
                            "leftValue": "={{ $json.has_preflight_error }}",
                            "rightValue": True,
                            "operator": {"type": "boolean", "operation": "equals"},
                        }
                    ],
                    "combinator": "and",
                },
                "options": {},
            },
            node_id="if-preflight-error",
            type_version=2.3,
        ),
        node(
            "Mark Story Failed",
            "n8n-nodes-base.supabase",
            [-768, -224],
            {
                "operation": "update",
                "tableId": "vivo_stories",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $json.story_id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "status", "fieldValue": "failed"}
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="mark-story-failed",
            type_version=1,
        ),
        node(
            "Audit Preflight Failure",
            "n8n-nodes-base.supabase",
            [-480, -224],
            {
                "tableId": "vivo_audit_events",
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "entity_type", "fieldValue": "story"},
                        {"fieldId": "entity_id", "fieldValue": "={{ $json.story_id }}"},
                        {"fieldId": "event_type", "fieldValue": "asset_failed"},
                        {"fieldId": "actor_type", "fieldValue": "automation"},
                        {"fieldId": "actor_id", "fieldValue": "=n8n-{{ $workflow.name }}"},
                        {"fieldId": "payload", "fieldValue": "={{ { stage: 'preflight', error_message: $json.preflight_error } }}"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="audit-preflight-failure",
            type_version=1,
        ),
        node(
            "If Has Eligible Assets",
            "n8n-nodes-base.if",
            [-768, 64],
            {
                "conditions": {
                    "options": {
                        "caseSensitive": True,
                        "leftValue": "",
                        "typeValidation": "strict",
                        "version": 3,
                    },
                    "conditions": [
                        {
                            "leftValue": "={{ $json.eligible_asset_count }}",
                            "rightValue": 0,
                            "operator": {"type": "number", "operation": "gt"},
                        }
                    ],
                    "combinator": "and",
                },
                "options": {},
            },
            node_id="if-has-eligible-assets",
            type_version=2.3,
        ),
        node(
            "Expand Eligible Assets",
            "n8n-nodes-base.code",
            [-480, 160],
            {"jsCode": expand_assets_js},
            node_id="expand-eligible-assets",
            type_version=2,
        ),
        node(
            "Asset Loop",
            "n8n-nodes-base.splitInBatches",
            [-192, 160],
            {"options": {}},
            node_id="asset-loop",
            type_version=3,
        ),
        node(
            "Update Asset Queued",
            "n8n-nodes-base.supabase",
            [96, 160],
            {
                "operation": "update",
                "tableId": "vivo_story_assets",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $json.asset_id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "status", "fieldValue": "queued"}
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="update-asset-queued",
            type_version=1,
        ),
        node(
            "Create Asset Job",
            "n8n-nodes-base.supabase",
            [384, 160],
            {
                "tableId": "vivo_pipeline_jobs",
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "story_id", "fieldValue": "={{ $json.story_id }}"},
                        {"fieldId": "asset_id", "fieldValue": "={{ $json.asset_id }}"},
                        {"fieldId": "job_type", "fieldValue": "face_swap_edit_image"},
                        {"fieldId": "trigger_status", "fieldValue": "asset_generating"},
                        {"fieldId": "status", "fieldValue": "running"},
                        {"fieldId": "endpoint_name", "fieldValue": "local_face_swap_server"},
                        {"fieldId": "request_payload", "fieldValue": "={{ $json.face_swap_request }}"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="create-asset-job",
            type_version=1,
        ),
        node(
            "Update Asset Processing",
            "n8n-nodes-base.supabase",
            [672, 160],
            {
                "operation": "update",
                "tableId": "vivo_story_assets",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $json.asset_id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "status", "fieldValue": "processing"}
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="update-asset-processing",
            type_version=1,
        ),
        node(
            "Run Face Swap Job",
            "n8n-nodes-base.code",
            [960, 160],
            {"jsCode": run_face_swap_js},
            node_id="run-face-swap-job",
            type_version=2,
        ),
        node(
            "If Face Swap OK",
            "n8n-nodes-base.if",
            [1248, 160],
            {
                "conditions": {
                    "options": {
                        "caseSensitive": True,
                        "leftValue": "",
                        "typeValidation": "strict",
                        "version": 3,
                    },
                    "conditions": [
                        {
                            "leftValue": "={{ $json.face_swap_ok }}",
                            "rightValue": True,
                            "operator": {"type": "boolean", "operation": "equals"},
                        }
                    ],
                    "combinator": "and",
                },
                "options": {},
            },
            node_id="if-face-swap-ok",
            type_version=2.3,
        ),
        node(
            "Download Result",
            "n8n-nodes-base.httpRequest",
            [1536, 48],
            {
                "url": "={{ $json.download_url }}",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {
                            "name": "x-api-key",
                            "value": "={{ $env.FACE_SWAP_API_KEY || $env.GPU_API_KEY || 'YOUR_GPU_API_KEY' }}"
                        }
                    ]
                },
                "options": {},
            },
            node_id="download-result",
            type_version=4.3,
        ),
        node(
            "Prepare Upload Metadata",
            "n8n-nodes-base.code",
            [1824, 48],
            {"jsCode": prepare_upload_js},
            node_id="prepare-upload-metadata",
            type_version=2,
        ),
        node(
            "Upload To Supabase",
            "n8n-nodes-base.httpRequest",
            [2112, 48],
            {
                "method": "PUT",
                "url": "=https://ujfcoveypojivevpepoo.supabase.co/storage/v1/object/vivo-content/{{ $json.object_path }}",
                "authentication": "predefinedCredentialType",
                "nodeCredentialType": "supabaseApi",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {"name": "Content-type", "value": "={{ $json.mime_type }}"},
                        {"name": "x-upsert", "value": "true"},
                    ]
                },
                "sendBody": True,
                "contentType": "binaryData",
                "inputDataFieldName": "data",
                "options": {},
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="upload-to-supabase",
            type_version=4.3,
        ),
        node(
            "Create Storage Object",
            "n8n-nodes-base.supabase",
            [2400, 48],
            {
                "tableId": "vivo_storage_objects",
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "bucket_name", "fieldValue": "vivo-content"},
                        {"fieldId": "object_path", "fieldValue": "={{ $('Prepare Upload Metadata').item.json.object_path }}"},
                        {"fieldId": "file_name", "fieldValue": "={{ $('Prepare Upload Metadata').item.json.file_name }}"},
                        {"fieldId": "mime_type", "fieldValue": "={{ $('Prepare Upload Metadata').item.json.mime_type }}"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="create-storage-object",
            type_version=1,
        ),
        node(
            "Update Asset Ready",
            "n8n-nodes-base.supabase",
            [2688, 48],
            {
                "operation": "update",
                "tableId": "vivo_story_assets",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $('Asset Loop').item.json.asset_id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "storage_object_id", "fieldValue": "={{ $json.id }}"},
                        {"fieldId": "mime_type", "fieldValue": "={{ $('Prepare Upload Metadata').item.json.mime_type }}"},
                        {"fieldId": "status", "fieldValue": "ready"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="update-asset-ready",
            type_version=1,
        ),
        node(
            "Update Job Success",
            "n8n-nodes-base.supabase",
            [2976, 48],
            {
                "operation": "update",
                "tableId": "vivo_pipeline_jobs",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $('Create Asset Job').item.json.id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "status", "fieldValue": "succeeded"},
                        {"fieldId": "response_payload", "fieldValue": "={{ $('Run Face Swap Job').item.json.face_swap_status_response || {} }}"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="update-job-success",
            type_version=1,
        ),
        node(
            "Update Asset Failed",
            "n8n-nodes-base.supabase",
            [1536, 272],
            {
                "operation": "update",
                "tableId": "vivo_story_assets",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $json.asset_id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "status", "fieldValue": "failed"},
                        {"fieldId": "error_message", "fieldValue": "={{ $json.error_message }}"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="update-asset-failed",
            type_version=1,
        ),
        node(
            "Update Job Failed",
            "n8n-nodes-base.supabase",
            [1824, 272],
            {
                "operation": "update",
                "tableId": "vivo_pipeline_jobs",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $('Create Asset Job').item.json.id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "status", "fieldValue": "failed"},
                        {"fieldId": "error_message", "fieldValue": "={{ $json.error_message }}"},
                        {"fieldId": "response_payload", "fieldValue": "={{ $json.face_swap_status_response || {} }}"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="update-job-failed",
            type_version=1,
        ),
        node(
            "Audit Asset Failed",
            "n8n-nodes-base.supabase",
            [2112, 272],
            {
                "tableId": "vivo_audit_events",
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "entity_type", "fieldValue": "story"},
                        {"fieldId": "entity_id", "fieldValue": "={{ $json.story_id }}"},
                        {"fieldId": "event_type", "fieldValue": "asset_failed"},
                        {"fieldId": "actor_type", "fieldValue": "automation"},
                        {"fieldId": "actor_id", "fieldValue": "=n8n-{{ $workflow.name }}"},
                        {"fieldId": "payload", "fieldValue": "={{ { asset_id: $json.asset_id, error_message: $json.error_message, face_swap_job_id: $json.face_swap_job_id } }}"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="audit-asset-failed",
            type_version=1,
        ),
        node(
            "If Required Asset",
            "n8n-nodes-base.if",
            [2400, 272],
            {
                "conditions": {
                    "options": {
                        "caseSensitive": True,
                        "leftValue": "",
                        "typeValidation": "strict",
                        "version": 3,
                    },
                    "conditions": [
                        {
                            "leftValue": "={{ $json.is_required }}",
                            "rightValue": True,
                            "operator": {"type": "boolean", "operation": "equals"},
                        }
                    ],
                    "combinator": "and",
                },
                "options": {},
            },
            node_id="if-required-asset",
            type_version=2.3,
        ),
        node(
            "Update Story Failed From Asset",
            "n8n-nodes-base.supabase",
            [2688, 272],
            {
                "operation": "update",
                "tableId": "vivo_stories",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $json.story_id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "status", "fieldValue": "failed"}
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="update-story-failed-from-asset",
            type_version=1,
        ),
        node(
            "Get Final Story Assets",
            "n8n-nodes-base.supabase",
            [384, 432],
            {
                "operation": "getAll",
                "tableId": "vivo_story_assets",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "story_id",
                            "keyValue": "={{ $('Story Loop').item.json.id }}",
                        }
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="get-final-story-assets",
            type_version=1,
        ),
        node(
            "Check Story Ready",
            "n8n-nodes-base.code",
            [672, 432],
            {"jsCode": check_story_ready_js},
            node_id="check-story-ready",
            type_version=2,
        ),
        node(
            "If Story Ready",
            "n8n-nodes-base.if",
            [960, 432],
            {
                "conditions": {
                    "options": {
                        "caseSensitive": True,
                        "leftValue": "",
                        "typeValidation": "strict",
                        "version": 3,
                    },
                    "conditions": [
                        {
                            "leftValue": "={{ $json.should_mark_ready }}",
                            "rightValue": True,
                            "operator": {"type": "boolean", "operation": "equals"},
                        }
                    ],
                    "combinator": "and",
                },
                "options": {},
            },
            node_id="if-story-ready",
            type_version=2.3,
        ),
        node(
            "Update Story Ready",
            "n8n-nodes-base.supabase",
            [1248, 432],
            {
                "operation": "update",
                "tableId": "vivo_stories",
                "filters": {
                    "conditions": [
                        {
                            "keyName": "id",
                            "condition": "eq",
                            "keyValue": "={{ $json.story_id }}",
                        }
                    ]
                },
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "status", "fieldValue": "ready_to_publish"}
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="update-story-ready",
            type_version=1,
        ),
        node(
            "Audit Story Ready",
            "n8n-nodes-base.supabase",
            [1536, 432],
            {
                "tableId": "vivo_audit_events",
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "entity_type", "fieldValue": "story"},
                        {"fieldId": "entity_id", "fieldValue": "={{ $json.story_id }}"},
                        {"fieldId": "event_type", "fieldValue": "story_ready_to_publish"},
                        {"fieldId": "actor_type", "fieldValue": "automation"},
                        {"fieldId": "actor_id", "fieldValue": "=n8n-{{ $workflow.name }}"},
                        {"fieldId": "payload", "fieldValue": "={{ { publishable_asset_count: $json.publishable_asset_count, unready_required_count: $json.unready_required_count } }}"},
                    ]
                },
            },
            credentials={"supabaseApi": {"id": "0WLaj3uAF5TRP3Ej", "name": "Vivo Supabase"}},
            node_id="audit-story-ready",
            type_version=1,
        ),
    ],
    "pinData": {
        "When clicking ‘Execute workflow’": [
            {"json": {}, "pairedItem": {"item": 0}}
        ]
    },
    "connections": {
        "When clicking ‘Execute workflow’": {"main": [[{"node": "GetStoriesToProcess", "type": "main", "index": 0}]]},
        "GetStoriesToProcess": {"main": [[{"node": "Story Loop", "type": "main", "index": 0}]]},
        "Story Loop": {"main": [[], [{"node": "GetAudienceProfile", "type": "main", "index": 0}]]},
        "GetAudienceProfile": {"main": [[{"node": "GetHeroImageStorageObject", "type": "main", "index": 0}]]},
        "GetHeroImageStorageObject": {"main": [[{"node": "GetStoryAssets", "type": "main", "index": 0}]]},
        "GetStoryAssets": {"main": [[{"node": "Prepare Story Bundle", "type": "main", "index": 0}]]},
        "Prepare Story Bundle": {"main": [[{"node": "If Preflight Error", "type": "main", "index": 0}]]},
        "If Preflight Error": {
            "main": [
                [{"node": "Mark Story Failed", "type": "main", "index": 0}],
                [{"node": "If Has Eligible Assets", "type": "main", "index": 0}],
            ]
        },
        "Mark Story Failed": {"main": [[{"node": "Audit Preflight Failure", "type": "main", "index": 0}]]},
        "Audit Preflight Failure": {"main": [[{"node": "Story Loop", "type": "main", "index": 0}]]},
        "If Has Eligible Assets": {
            "main": [
                [{"node": "Expand Eligible Assets", "type": "main", "index": 0}],
                [{"node": "Get Final Story Assets", "type": "main", "index": 0}],
            ]
        },
        "Expand Eligible Assets": {"main": [[{"node": "Asset Loop", "type": "main", "index": 0}]]},
        "Asset Loop": {
            "main": [
                [{"node": "Get Final Story Assets", "type": "main", "index": 0}],
                [{"node": "Update Asset Queued", "type": "main", "index": 0}],
            ]
        },
        "Update Asset Queued": {"main": [[{"node": "Create Asset Job", "type": "main", "index": 0}]]},
        "Create Asset Job": {"main": [[{"node": "Update Asset Processing", "type": "main", "index": 0}]]},
        "Update Asset Processing": {"main": [[{"node": "Run Face Swap Job", "type": "main", "index": 0}]]},
        "Run Face Swap Job": {"main": [[{"node": "If Face Swap OK", "type": "main", "index": 0}]]},
        "If Face Swap OK": {
            "main": [
                [{"node": "Download Result", "type": "main", "index": 0}],
                [{"node": "Update Asset Failed", "type": "main", "index": 0}],
            ]
        },
        "Download Result": {"main": [[{"node": "Prepare Upload Metadata", "type": "main", "index": 0}]]},
        "Prepare Upload Metadata": {"main": [[{"node": "Upload To Supabase", "type": "main", "index": 0}]]},
        "Upload To Supabase": {"main": [[{"node": "Create Storage Object", "type": "main", "index": 0}]]},
        "Create Storage Object": {"main": [[{"node": "Update Asset Ready", "type": "main", "index": 0}]]},
        "Update Asset Ready": {"main": [[{"node": "Update Job Success", "type": "main", "index": 0}]]},
        "Update Job Success": {"main": [[{"node": "Asset Loop", "type": "main", "index": 0}]]},
        "Update Asset Failed": {"main": [[{"node": "Update Job Failed", "type": "main", "index": 0}]]},
        "Update Job Failed": {"main": [[{"node": "Audit Asset Failed", "type": "main", "index": 0}]]},
        "Audit Asset Failed": {"main": [[{"node": "If Required Asset", "type": "main", "index": 0}]]},
        "If Required Asset": {
            "main": [
                [{"node": "Update Story Failed From Asset", "type": "main", "index": 0}],
                [{"node": "Asset Loop", "type": "main", "index": 0}],
            ]
        },
        "Update Story Failed From Asset": {"main": [[{"node": "Asset Loop", "type": "main", "index": 0}]]},
        "Get Final Story Assets": {"main": [[{"node": "Check Story Ready", "type": "main", "index": 0}]]},
        "Check Story Ready": {"main": [[{"node": "If Story Ready", "type": "main", "index": 0}]]},
        "If Story Ready": {
            "main": [
                [{"node": "Update Story Ready", "type": "main", "index": 0}],
                [{"node": "Story Loop", "type": "main", "index": 0}],
            ]
        },
        "Update Story Ready": {"main": [[{"node": "Audit Story Ready", "type": "main", "index": 0}]]},
        "Audit Story Ready": {"main": [[{"node": "Story Loop", "type": "main", "index": 0}]]},
    },
}


output_path = Path("/Users/ilia/dev/openclaw-aharoll/vivo-factory/tmp/994. VIVO Edit Image Face Swap Generator.json")
output_path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n")
print(output_path)
