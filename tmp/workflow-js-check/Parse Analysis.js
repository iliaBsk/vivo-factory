const item = $input.first().json;

const buildData = $('Build GPT-4.1 Request').first().json;
const imageLookup = {};
for (const img of (buildData.images || [])) {
  const canonical = img.original_url || img.url;
  for (const key of [img.url, img.original_url, img.thumbnail_url]) {
    if (!key) continue;
    imageLookup[key] = {
      original_url: canonical,
      thumbnail_url: img.thumbnail_url || img.url || canonical
    };
  }
}

let parsed;
let rawText = '';

if (item.output_text) {
  rawText = item.output_text;
} else if (item.output && Array.isArray(item.output)) {
  const message = item.output.find(x => x.type === 'message');
  if (message && Array.isArray(message.content)) {
    const textPart = message.content.find(x => x.type === 'output_text');
    rawText = textPart?.text || '';
  }
}

try {
  parsed = JSON.parse(rawText);
} catch (e) {
  parsed = {
    results: [],
    parse_error: true,
    raw_output: rawText
  };
}

const enriched = (parsed.results || []).map(r => {
  const match = imageLookup[r.image_url] || {};
  const originalUrl = match.original_url || r.image_url;
  return {
    ...r,
    image_url: originalUrl,
    original_url: originalUrl,
    thumbnail_url: match.thumbnail_url || originalUrl
  };
});

return [{
  json: {
    analysis: enriched,
    selected_image_urls: parsed.selected_image_urls || [],
    raw_output: rawText,
    parse_error: !!parsed.parse_error
  }
}];