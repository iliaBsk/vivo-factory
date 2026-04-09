(function(){
const assets = $input.all().map((item) => item.json || {});
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
}];
})();
