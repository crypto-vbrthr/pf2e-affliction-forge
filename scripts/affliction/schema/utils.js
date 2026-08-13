export function deepClone(value) {
  const clone = globalThis.foundry?.utils?.deepClone;
  if (typeof clone === "function") return clone(value);
  return value === undefined ? undefined : structuredClone(value);
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function randomId(prefix = "affliction") {
  const randomID = globalThis.foundry?.utils?.randomID;
  const suffix = typeof randomID === "function"
    ? randomID()
    : globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 16)
      ?? Math.random().toString(36).slice(2, 18);
  return `${prefix}.${suffix}`;
}

export function cleanString(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

export function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((entry) => cleanString(entry))
    .filter(Boolean))];
}

export function finiteNumber(value, fallback = null) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}
