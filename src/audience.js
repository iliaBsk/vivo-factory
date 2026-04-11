const DEFAULT_CONTENT_PILLARS = ["shopping", "family", "style", "local_life"];

export function extractAudiences(markdown) {
  const source = typeof markdown === "string" ? markdown : "";
  const matches = [...source.matchAll(/<audience>([\s\S]*?)<\/audience>/g)];
  return matches.map((match) => match[1].trim()).filter(Boolean);
}

export function normalizeAudience(description) {
  const input = typeof description === "string" ? description.trim() : "";
  if (!input) {
    throw new Error("Audience description must not be empty");
  }

  const normalized = input
    .replace(/\b(in)\s+(his|her|their)\s+early\s+(\d{2})s/gi, "$1 early $3s")
    .replace(/\s+/g, " ");
  const age = normalized.match(/early\s+(\d{2})s/i)?.[1] ?? "40";
  const location = inferLocation(normalized);
  const label = normalized
    .split(/[,.]/)[0]
    .replace(/\s+Loves.*$/i, "")
    .trim();
  const baldHigh = normalized.match(/bald high man/i);
  const childMatch = normalized.match(/(\d{1,2})-(\d{1,2}) year old boy/i);
  const interests = [...normalized.matchAll(/\b(beachwear|sportswear|football|style|shopping|family|local life)\b/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((value, index, values) => values.indexOf(value) === index);

  const contentPillars = [...DEFAULT_CONTENT_PILLARS];
  if (normalized.match(/news|brief/i) && !contentPillars.includes("news")) {
    contentPillars.unshift("news");
  }

  const audienceIdSource = baldHigh
    ? `bald-high-man-early-${age}s-${slugify(location)}`
    : buildGenericAudienceId(label, location, age);

  return {
    audience_id: audienceIdSource.replace(/-+/g, "-"),
    label: label || normalized,
    language: "en",
    location,
    family_context: childMatch ? `Married with a boy aged ${childMatch[1]}-${childMatch[2]}` : inferFamilyContext(normalized),
    interests,
    shopping_bias: "mid-range",
    content_pillars: contentPillars,
    excluded_topics: [],
    tone: "helpful",
    posting_schedule: "0 9,18 * * *"
  };
}

function inferFamilyContext(input) {
  if (/married/i.test(input)) {
    return "Married";
  }
  return "Unknown";
}

function inferLocation(input) {
  const livingInMatch = input.match(/living in ([A-Za-zÀ-ÿ' -]+)/i)?.[1];
  if (livingInMatch) {
    return livingInMatch.split(/[,.]/)[0]?.trim() ?? "Unknown";
  }

  const genericMatches = [...input.matchAll(/\bin ([A-Za-zÀ-ÿ' -]+)/gi)];
  const locationMatch = genericMatches.at(-1)?.[1];
  return locationMatch?.split(/[,.]/)[0]?.trim() ?? "Unknown";
}

function buildGenericAudienceId(label, location, age) {
  const base = slugify(
    label
      .replace(/\bliving in\s+[A-Za-zÀ-ÿ' -]+/i, "")
      .replace(/\bin\s+early\s+\d{2}s/i, `in-early-${age}s`)
      .replace(/\bin\s+[A-Za-zÀ-ÿ' -]+/i, "")
      .trim()
  );
  const locationSlug = slugify(location);
  return [base, locationSlug].filter(Boolean).join("-");
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
