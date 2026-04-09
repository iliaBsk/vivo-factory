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

const root = { ...items[0].json };
const images = [];
const seen = new Set();

for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex++) {
  const j = items[sourceIndex].json;
  const candidates = Array.isArray(j.images_results) ? j.images_results : [];

  for (const img of candidates) {
    const reviewUrl =
      img.original ||
      img.link ||
      img.image ||
      img.thumbnail ||
      img.url ||
      '';

    if (!isValidHttpUrl(reviewUrl)) continue;
    if (seen.has(reviewUrl)) continue;

    seen.add(reviewUrl);

    images.push({
      url: reviewUrl,
      original_url: img.original || reviewUrl,
      thumbnail_url: img.thumbnail || '',
      title: img.title || '',
      source: img.source || img.source_name || '',
      position: img.position ?? null,
      source_index: sourceIndex,
      width: img.original_width ?? null,
      height: img.original_height ?? null
    });
  }
}

images.sort((a, b) => {
  if (a.source_index !== b.source_index) {
    return a.source_index - b.source_index;
  }
  return (a.position ?? 9999) - (b.position ?? 9999);
});

return [{
  json: {
    ...root,
    raw_input_items: items.length,
    raw_candidates_first_item: Array.isArray(items[0].json.images_results) ? items[0].json.images_results.length : 0,
    image_count: images.length,
    images
  }
}];