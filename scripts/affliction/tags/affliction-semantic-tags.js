export const AFFLICTION_SEMANTIC_TAG_CONTRACT_VERSION = "1.0.0";

export const AFFLICTION_SEMANTIC_TAG_NAMESPACES = Object.freeze([
  "creature",
  "family",
  "habitat",
  "theme",
  "origin",
  "delivery"
]);

export const AFFLICTION_SEMANTIC_TAG_VOCABULARY = Object.freeze({
  creature: Object.freeze([
    "aberration", "animal", "beast", "celestial", "construct", "dragon", "elemental",
    "fey", "fiend", "fungus", "humanoid", "monitor", "ooze", "plant", "spirit", "undead"
  ]),
  family: Object.freeze([
    "amphibian", "arachnid", "bat", "bird", "canine", "cat", "fish", "insect", "parasite",
    "rat", "reptile", "scorpion", "shark", "snake", "spider", "worm"
  ]),
  habitat: Object.freeze([
    "aquatic", "arctic", "coastal", "desert", "forest", "jungle", "mountain", "plains",
    "swamp", "underground", "urban", "volcanic", "planar"
  ]),
  theme: Object.freeze([
    "blood", "corruption", "curse", "disease", "dream", "elemental", "fungal", "mental",
    "mutation", "necrotic", "parasite", "poison", "shadow", "spores", "toxin", "venom"
  ]),
  origin: Object.freeze([
    "alchemical", "arcane", "divine", "magical", "natural", "occult", "planar", "primal",
    "technological", "undead"
  ]),
  delivery: Object.freeze([
    "ability", "aura", "bite", "breath", "claw", "contact", "ingested", "inhaled", "injury",
    "spit", "sting", "weapon"
  ])
});

export const AFFLICTION_SEMANTIC_TAG_DEFAULT_WEIGHTS = Object.freeze({
  creature: 3,
  family: 5,
  habitat: 2,
  theme: 4,
  origin: 2,
  delivery: 5
});

function strings(value) {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(source.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}

export function normalizeSemanticTagValue(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeSemanticTagNamespace(value) {
  const namespace = String(value ?? "").trim().toLowerCase();
  return AFFLICTION_SEMANTIC_TAG_NAMESPACES.includes(namespace) ? namespace : null;
}

export function buildSemanticTag(namespace, value) {
  const normalizedNamespace = normalizeSemanticTagNamespace(namespace);
  const normalizedValue = normalizeSemanticTagValue(value);
  return normalizedNamespace && normalizedValue ? `${normalizedNamespace}:${normalizedValue}` : null;
}

export function parseSemanticTag(value) {
  const raw = String(value ?? "").trim();
  const separator = raw.indexOf(":");
  if (separator <= 0 || separator === raw.length - 1) return null;
  const namespace = normalizeSemanticTagNamespace(raw.slice(0, separator));
  if (!namespace) return null;
  const normalizedValue = normalizeSemanticTagValue(raw.slice(separator + 1));
  if (!normalizedValue) return null;
  return Object.freeze({
    namespace,
    value: normalizedValue,
    tag: `${namespace}:${normalizedValue}`,
    canonical: raw === `${namespace}:${normalizedValue}`
  });
}

export function isSemanticTag(value) {
  return Boolean(parseSemanticTag(value));
}

export function semanticProfile(input = {}) {
  const result = {};
  for (const namespace of AFFLICTION_SEMANTIC_TAG_NAMESPACES) {
    result[namespace] = Object.freeze([...new Set(strings(input?.[namespace]).map(normalizeSemanticTagValue).filter(Boolean))]);
  }
  return Object.freeze(result);
}

export function splitAfflictionThemes(themes = []) {
  const tags = Object.fromEntries(AFFLICTION_SEMANTIC_TAG_NAMESPACES.map((namespace) => [namespace, []]));
  const free = [];
  for (const theme of strings(themes)) {
    const parsed = parseSemanticTag(theme);
    if (!parsed) {
      free.push(theme);
      continue;
    }
    if (!tags[parsed.namespace].includes(parsed.value)) tags[parsed.namespace].push(parsed.value);
  }
  return Object.freeze({
    tags: Object.freeze(Object.fromEntries(Object.entries(tags).map(([namespace, values]) => [namespace, Object.freeze(values)]))),
    free: Object.freeze(free),
    semantic: Object.freeze(AFFLICTION_SEMANTIC_TAG_NAMESPACES.flatMap((namespace) => tags[namespace].map((value) => `${namespace}:${value}`)))
  });
}

export function mergeAfflictionThemes({ free = [], tags = {} } = {}) {
  const result = [];
  for (const theme of strings(free)) {
    if (!result.includes(theme)) result.push(theme);
  }
  const profile = semanticProfile(tags);
  for (const namespace of AFFLICTION_SEMANTIC_TAG_NAMESPACES) {
    for (const value of profile[namespace]) {
      const tag = `${namespace}:${value}`;
      if (!result.includes(tag)) result.push(tag);
    }
  }
  return result;
}

export function semanticTagsFromProfile(profile = {}) {
  const normalized = semanticProfile(profile);
  return AFFLICTION_SEMANTIC_TAG_NAMESPACES.flatMap((namespace) => normalized[namespace].map((value) => `${namespace}:${value}`));
}

export function matchesSemanticTags(themes = [], requested = {}, { mode = "all" } = {}) {
  const wanted = semanticTagsFromProfile(requested);
  if (wanted.length === 0) return true;
  const present = new Set(splitAfflictionThemes(themes).semantic);
  if (String(mode).toLowerCase() === "any") return wanted.some((tag) => present.has(tag));
  return wanted.every((tag) => present.has(tag));
}

export function scoreSemanticTags(themes = [], requested = {}, { weights = {} } = {}) {
  const profile = semanticProfile(requested);
  const present = splitAfflictionThemes(themes);
  const effectiveWeights = { ...AFFLICTION_SEMANTIC_TAG_DEFAULT_WEIGHTS, ...(weights ?? {}) };
  const matched = [];
  const missing = [];
  let score = 0;
  let possible = 0;

  for (const namespace of AFFLICTION_SEMANTIC_TAG_NAMESPACES) {
    const presentValues = new Set(present.tags[namespace]);
    const weight = Number(effectiveWeights[namespace]);
    const safeWeight = Number.isFinite(weight) ? weight : 0;
    for (const value of profile[namespace]) {
      const tag = `${namespace}:${value}`;
      possible += safeWeight;
      if (presentValues.has(value)) {
        score += safeWeight;
        matched.push(tag);
      } else {
        missing.push(tag);
      }
    }
  }

  return Object.freeze({
    score,
    possible,
    coverage: possible > 0 ? score / possible : 1,
    matched: Object.freeze(matched),
    missing: Object.freeze(missing)
  });
}
