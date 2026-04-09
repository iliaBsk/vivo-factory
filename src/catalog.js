export function loadMerchantRegistry(config) {
  const merchants = (config?.merchants ?? []).map((merchant) => validateMerchant(merchant));
  const overrides = config?.audienceOverrides ?? [];
  return { merchants, overrides };
}

export function normalizeProduct(merchant, rawProduct) {
  return {
    product_id: rawProduct.product_id,
    merchant_id: merchant.merchant_id,
    title: rawProduct.title,
    brand: rawProduct.brand,
    category: rawProduct.category,
    price: rawProduct.price,
    currency: rawProduct.currency,
    availability: rawProduct.availability,
    canonical_url: rawProduct.canonical_url,
    affiliate_url: merchant.affiliate_url_template.replace("{{url}}", encodeURIComponent(rawProduct.canonical_url)),
    image_urls: rawProduct.image_urls ?? [],
    style_tags: rawProduct.style_tags ?? [],
    gender_fit: rawProduct.gender_fit ?? "unisex",
    occasion_tags: rawProduct.occasion_tags ?? [],
    season_tags: rawProduct.season_tags ?? [],
    locale_tags: rawProduct.locale_tags ?? [],
    last_checked_at: rawProduct.last_checked_at ?? new Date(0).toISOString()
  };
}

export function rankProducts({ audience, products, context }) {
  return [...products].sort((left, right) => scoreProduct(right, audience, context) - scoreProduct(left, audience, context));
}

export function buildContentBrief({ audience, topic, products, sourceLinks, format }) {
  return {
    audience_id: audience.audience_id,
    topic,
    why_now: `Seasonal relevance for ${audience.location}`,
    why_this_audience: `Selected for ${audience.label}`,
    recommended_format: format,
    selected_products: products.map((product) => product.product_id),
    visual_prompt: `Editorial ${format} for ${audience.label} featuring ${products.map((product) => product.title).join(", ")}`,
    video_prompt: `Short ${format} storyboard for ${topic}`,
    cta: "View the selected products",
    disclosure_text: "Affiliate links included. Products selected by the Vivo Factory operator workflow.",
    risk_flags: [],
    source_links: sourceLinks ?? []
  };
}

export async function validateCandidate(candidate, freshnessCheck) {
  if (!candidate.disclosure_text) {
    throw new Error("Affiliate disclosure is required");
  }
  const result = await freshnessCheck(candidate);
  if (!result.ok) {
    throw new Error(result.reason ?? "candidate failed freshness validation");
  }
  return result;
}

function validateMerchant(merchant) {
  if (!merchant.affiliate_url_template?.includes("{{url}}")) {
    throw new Error("merchant affiliate_url_template must include {{url}}");
  }
  return merchant;
}

function scoreProduct(product, audience, context) {
  let score = 0;
  for (const interest of audience.interests ?? []) {
    if (product.category === interest || product.style_tags?.includes(interest.replace(/wear$/, ""))) {
      score += 3;
    }
  }
  if (product.locale_tags?.includes(context.location)) {
    score += 2;
  }
  if (product.season_tags?.includes(context.season)) {
    score += 2;
  }
  if (product.occasion_tags?.includes(context.occasion)) {
    score += 1;
  }
  return score;
}
