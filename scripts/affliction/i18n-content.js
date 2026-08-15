export const CONTENT_I18N_PREFIX = "@i18n:";

function clone(value) {
  if (value == null) return value;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

export function isContentI18nToken(value) {
  return typeof value === "string" && value.startsWith(CONTENT_I18N_PREFIX) && value.length > CONTENT_I18N_PREFIX.length;
}

export function localizeContentToken(value) {
  if (!isContentI18nToken(value)) return value;
  const key = value.slice(CONTENT_I18N_PREFIX.length);
  try {
    const localized = globalThis.game?.i18n?.localize?.(key);
    return localized && localized !== key ? localized : key;
  } catch {
    return key;
  }
}

export function localizeContentTree(value) {
  if (isContentI18nToken(value)) return localizeContentToken(value);
  if (Array.isArray(value)) return value.map((entry) => localizeContentTree(entry));
  if (!value || typeof value !== "object") return value;
  const source = clone(value);
  for (const [key, entry] of Object.entries(source)) source[key] = localizeContentTree(entry);
  return source;
}
