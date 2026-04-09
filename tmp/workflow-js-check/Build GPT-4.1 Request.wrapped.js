(function(){
const items = $input.all();

function isValidHttpUrl(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s) return false;
  if (s.startsWith('data:')) return false;
  if (s.startsWith('blob:')) return false;
  if (s.startsWith('x-raw-image:')) return false;
  return s.startsWith('http://') || s.startsWith('https://');
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractImagesFromItem(j, sourceIndexFallback = 0) {
  const out = [];

  if (Array.isArray(j.images)) {
    for (const img of j.images) {
      const reviewUrl =
        typeof img === 'string'
          ? img
          : img?.original_url || img?.url || img?.original || img?.link || img?.image || img?.thumbnail || '';

      out.push({
        url: reviewUrl,
        original_url: typeof img === 'object' ? (img.original_url || reviewUrl) : reviewUrl,
        thumbnail_url: typeof img === 'object' ? (img.thumbnail_url || '') : '',
        title: typeof img === 'object' ? (img.title || '') : '',
        source: typeof img === 'object' ? (img.source || img.source_name || '') : '',
        position: typeof img === 'object' ? (img.position ?? null) : null,
        source_index: typeof img === 'object' ? (img.source_index ?? sourceIndexFallback) : sourceIndexFallback
      });
    }
  } else if (Array.isArray(j.images_results)) {
    for (const img of j.images_results) {
      const reviewUrl = img.original || img.link || img.image || img.thumbnail || '';
      out.push({
        url: reviewUrl,
        original_url: img.original || reviewUrl,
        thumbnail_url: img.thumbnail || '',
        title: img.title || '',
        source: img.source || img.source_name || '',
        position: img.position ?? null,
        source_index: sourceIndexFallback
      });
    }
  }

  return out;
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const first = items[0]?.json || {};

const classification = first.classification || {};
const userProfile = first.user_profile || {};
const protagonist = first.protagonist || {};

const storyTitle =
  asString(first?.story?.title) ||
  asString(first.story_title);

const storyText =
  asString(first?.story?.text) ||
  asString(first.article) ||
  asString(first.text) ||
  asString(first.story_text);

const story = [storyTitle, storyText].filter(Boolean).join('\n\n');

const category =
  asString(classification.category) ||
  asString(first.category) ||
  'general';

const normalizedCategory = category.toLowerCase();
const isDeal = !!classification.is_deal || !!first.is_deal;

const isFashionCategory = normalizedCategory.includes('fashion');
const isTravelCategory = normalizedCategory.includes('travel');
const isFashionTravelDeal =
  (isFashionCategory || isTravelCategory) &&
  (isDeal || normalizedCategory.includes('deal'));

const targetSelectionCount = isFashionTravelDeal ? 5 : 3;

const protagonistDescription =
  asString(protagonist.description) ||
  asString(first.protagonist_description);

const protagonistTraits = {
  gender: pickFirst(protagonist, ['gender', 'sex', 'presentation']),
  hair_color: pickFirst(protagonist, ['hair_color', 'hairColour', 'hair']),
  hair_style: pickFirst(protagonist, ['hair_style', 'hairStyle']),
  skin_tone: pickFirst(protagonist, ['skin_tone', 'skinTone', 'skin_color', 'skinColor', 'complexion']),
  age_range: pickFirst(protagonist, ['age_range', 'ageRange', 'age_group', 'ageGroup']),
  height_or_stature: pickFirst(protagonist, ['height', 'stature', 'body_height']),
  build_or_body_type: pickFirst(protagonist, ['body_type', 'bodyType', 'build', 'physique']),
  ethnicity: pickFirst(protagonist, ['ethnicity', 'ethnic_background', 'race']),
  physical_composure: pickFirst(protagonist, ['physical_composure', 'composure', 'vibe', 'presence']),
  style: pickFirst(protagonist, ['style'])
};

const protagonistSummary = [
  protagonistDescription,
  protagonistTraits.gender ? `gender/presentation: ${protagonistTraits.gender}` : '',
  protagonistTraits.hair_color ? `hair_color: ${protagonistTraits.hair_color}` : '',
  protagonistTraits.hair_style ? `hair_style: ${protagonistTraits.hair_style}` : '',
  protagonistTraits.skin_tone ? `skin_tone: ${protagonistTraits.skin_tone}` : '',
  protagonistTraits.age_range ? `age_range: ${protagonistTraits.age_range}` : '',
  protagonistTraits.height_or_stature ? `height_or_stature: ${protagonistTraits.height_or_stature}` : '',
  protagonistTraits.build_or_body_type ? `build_or_body_type: ${protagonistTraits.build_or_body_type}` : '',
  protagonistTraits.ethnicity ? `ethnicity: ${protagonistTraits.ethnicity}` : '',
  protagonistTraits.physical_composure ? `physical_composure: ${protagonistTraits.physical_composure}` : '',
  protagonistTraits.style ? `style: ${protagonistTraits.style}` : ''
].filter(Boolean).join('; ');

const userInterests = asArray(userProfile.interests)
  .map(asString)
  .filter(Boolean);

const userProfileSummary = [
  userInterests.length ? `interests: ${userInterests.join(', ')}` : '',
  asString(userProfile.location) ? `location: ${asString(userProfile.location)}` : '',
  asString(userProfile.age_group) ? `age_group: ${asString(userProfile.age_group)}` : ''
].filter(Boolean).join('; ');

const rawImages = items.flatMap((item, i) => extractImagesFromItem(item.json, i));

const seen = new Set();
const validImages = [];
const skippedImages = [];

for (const img of rawImages) {
  const url = typeof img.url === 'string' ? img.url.trim() : '';

  if (!isValidHttpUrl(url)) {
    skippedImages.push({
      raw_url: url || null,
      reason: 'invalid_url',
      source_index: img.source_index ?? null
    });
    continue;
  }

  if (seen.has(url)) continue;
  seen.add(url);

  validImages.push({
    url,
    original_url: img.original_url || url,
    thumbnail_url: img.thumbnail_url || '',
    title: img.title || '',
    source: img.source || '',
    position: img.position ?? null,
    source_index: img.source_index ?? 0
  });
}

validImages.sort((a, b) => {
  if (a.source_index !== b.source_index) return a.source_index - b.source_index;
  return (a.position ?? 9999) - (b.position ?? 9999);
});

const selectedImages = validImages;

if (selectedImages.length === 0) {
  return [{
    json: {
      ...first,
      image_count_raw: rawImages.length,
      image_count_valid: 0,
      image_count_sent: 0,
      target_selection_count: targetSelectionCount,
      is_fashion_travel_deal: isFashionTravelDeal,
      skipped_images: skippedImages.slice(0, 20),
      body: null,
      error: 'No valid HTTP/HTTPS image URLs found'
    }
  }];
}

const finalSelectionCount = Math.min(targetSelectionCount, selectedImages.length);

const candidateList = selectedImages
  .map((img, i) => `${i + 1}. ${img.original_url}`)
  .join('\n');

const prompt = `
You are an expert selector for edit-image face-swap source photos.

Story:
"${story}"

Category:
${category}

User profile:
${userProfileSummary || 'none'}

Protagonist description:
${protagonistSummary || 'none'}

Protagonist JSON:
${JSON.stringify(protagonist || {}, null, 2)}

Candidate images:
${candidateList}

Selection target:
Select exactly ${finalSelectionCount} images.

Task:
Analyze every candidate image separately and choose the best images for a face swap.

Hard requirements:
1. The image should contain exactly one clearly visible person.
2. The face should be visible and front-facing or near-front-facing.
3. The pose must be swappable: not from behind, not fully profile-only, not heavily cropped, not heavily obscured, not tiny, not motion-blurred.
4. The person's visible physical traits should match the protagonist as closely as reasonably possible.

Trait matching priority:
- hair color
- hair texture / hairstyle
- skin tone / skin color / complexion
- approximate age range
- gender / presentation when relevant
- height / stature / build / body type when inferable
- physical composure / overall vibe when useful

Selection logic:
- Reject images with multiple people, no people, hidden faces, back views, masks covering the face, sunglasses hiding too much of the face, extreme angles, or unusable low-quality framing.
- Prefer clean editorial/lifestyle/product-context images that still preserve a clearly swappable face.
- If two images are similarly swappable, break ties using stronger protagonist trait match and then stronger story relevance.
- For factual news about a specific real event, company, or public figure, keep story relevance important, but still reject unswappable photos.
- Reject generic unrelated stock images.

Return exactly one result for each image URL listed above.
Preserve the exact image_url string.

Scoring:
- single_person_score: 0 to 1
- face_visibility_score: 0 to 1
- frontal_face_score: 0 to 1
- physical_match_score: 0 to 1
- story_fit_score: 0 to 1
- swap_readiness_score: 0 to 1
- overall_score: 0 to 1
- confidence: 0 to 1

Ranking rules:
- rank selected images from 1 to ${finalSelectionCount}
- non-selected images must have rank = 0
- selected must be true only for the top ${finalSelectionCount} images
- decision must be "ok" for selected images and "nok" for non-selected images
- swap_ready should be true only when the image is realistically usable for a face swap

Reasoning:
- Keep reasoning short and specific.
- Mention the acceptance/rejection cause directly.

Return JSON only.
`.trim();

const content = [
  { type: 'input_text', text: prompt },
  ...selectedImages.map(img => ({
    type: 'input_image',
    image_url: img.original_url || img.url,
    detail: 'low'
  }))
];

const body = {
  model: 'gpt-4.1',
  input: [
    {
      role: 'user',
      content
    }
  ],
  text: {
    format: {
      type: 'json_schema',
      name: 'face_swap_image_rankings',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                image_url: { type: 'string' },
                decision: { type: 'string', enum: ['ok', 'nok'] },
                selected: { type: 'boolean' },
                rank: { type: 'integer' },
                has_single_person: { type: 'boolean' },
                face_visible: { type: 'boolean' },
                frontal_or_near_frontal: { type: 'boolean' },
                swap_ready: { type: 'boolean' },
                single_person_score: { type: 'number' },
                face_visibility_score: { type: 'number' },
                frontal_face_score: { type: 'number' },
                physical_match_score: { type: 'number' },
                story_fit_score: { type: 'number' },
                swap_readiness_score: { type: 'number' },
                overall_score: { type: 'number' },
                reasoning: { type: 'string' },
                confidence: { type: 'number' }
              },
              required: [
                'image_url',
                'decision',
                'selected',
                'rank',
                'has_single_person',
                'face_visible',
                'frontal_or_near_frontal',
                'swap_ready',
                'single_person_score',
                'face_visibility_score',
                'frontal_face_score',
                'physical_match_score',
                'story_fit_score',
                'swap_readiness_score',
                'overall_score',
                'reasoning',
                'confidence'
              ]
            }
          },
          selected_image_urls: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['results', 'selected_image_urls']
      }
    }
  }
};

return [{
  json: {
    ...first,
    is_fashion_travel_deal: isFashionTravelDeal,
    target_selection_count: finalSelectionCount,
    image_count_raw: rawImages.length,
    image_count_valid: validImages.length,
    image_count_sent: selectedImages.length,
    skipped_images: skippedImages.slice(0, 20),
    body
  }
}];
})();
