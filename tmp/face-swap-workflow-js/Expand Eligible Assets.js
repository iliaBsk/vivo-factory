(function(){
const bundle = $input.first().json || {};
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
}));
})();
