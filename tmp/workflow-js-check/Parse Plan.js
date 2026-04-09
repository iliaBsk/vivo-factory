const item = $input.first().json;
const textField = item?.output?.[0]?.content?.[0]?.text;
let plan;
if (textField && typeof textField === 'object') plan = textField;
else if (typeof textField === 'string') plan = JSON.parse(textField.replace(/```json|```/g, '').trim());
else throw new Error('Unexpected OpenAI response: ' + JSON.stringify(item).substring(0, 200));
if (!Array.isArray(plan.queries) || !plan.queries.length) throw new Error('Plan missing queries');

const audience = $('GetAudienceProfile').first().json || {};
const storyItem = $('Loop Over Items').item.json || {};
const profileSnapshot = audience.profile_snapshot || {};
const protagonist = profileSnapshot.protagonist || {};
const userProfile = profileSnapshot.user_profile || {};

const classification = {
  category: storyItem.current_category || '',
  subcategory: storyItem.current_subcategory || '',
  is_deal: !!storyItem.is_deal
};

return plan.queries.map(query => ({
  json: {
    query,
    image_count: plan.image_count || 6,
    fashion_type: plan.fashion_type || 'none',
    reasoning: plan.reasoning || '',
    classification,
    category: storyItem.current_category || '',
    subcategory: storyItem.current_subcategory || '',
    is_deal: !!storyItem.is_deal,
    one_liner: storyItem.one_liner || '',
    story_title: storyItem.title || '',
    story_text: storyItem.story_text || '',
    story_content_strategy: storyItem.story_content_strategy || '',
    story: {
      title: storyItem.title || '',
      text: storyItem.story_text || ''
    },
    profile_snapshot: profileSnapshot,
    protagonist,
    user_profile: userProfile
  }
}));