(function(){
const story = $('Story Loop').item.json || {};
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
}];
})();
