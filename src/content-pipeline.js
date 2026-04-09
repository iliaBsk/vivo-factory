import { buildContentBrief, normalizeProduct, rankProducts } from "./catalog.js";

export async function createContentCandidate({ audience, profileClient, merchant, products, context, sourceLinks }) {
  const summary = await profileClient.getSummary();
  const profile = summary.data?.profile ?? {};
  const mergedAudience = {
    ...audience,
    ...profile,
    audience_id: audience.audience_id
  };
  const normalizedProducts = products.map((product) => normalizeProduct(merchant, product));
  const rankedProducts = rankProducts({
    audience: mergedAudience,
    products: normalizedProducts,
    context
  });
  const selected = rankedProducts.slice(0, 3);
  const brief = buildContentBrief({
    audience: mergedAudience,
    topic: `${context.season} ${selected[0]?.category ?? "style"} picks for ${mergedAudience.location}`,
    products: selected,
    sourceLinks,
    format: "image"
  });

  return {
    review_id: `review-${audience.audience_id}-${Date.now()}`,
    audience_id: audience.audience_id,
    status: "pending",
    ...brief
  };
}
