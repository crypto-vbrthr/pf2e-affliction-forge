import { CRITICAL_FORGE_MODULE_ID } from "../../constants.js";

export function getCriticalForgeApi({ required = false } = {}) {
  const api = globalThis.game?.modules?.get?.(CRITICAL_FORGE_MODULE_ID)?.api ?? null;
  if (!api && required) throw new Error("PF2E Critical Forge API is unavailable.");
  return api;
}

export function getCriticalForgeCompatibility() {
  const module = globalThis.game?.modules?.get?.(CRITICAL_FORGE_MODULE_ID) ?? null;
  const api = module?.api ?? null;
  return Object.freeze({
    available: Boolean(module?.active ?? module),
    apiAvailable: Boolean(api),
    moduleVersion: api?.moduleVersion ?? module?.version ?? null,
    apiVersion: api?.version ?? null,
    effectSchemaVersion: api?.schemaVersion ?? null,
    effectApiAvailable: typeof api?.effects?.validate === "function",
    effectSourceApiAvailable: typeof api?.effects?.toItemSources === "function",
    effectEditorAvailable: typeof api?.ui?.effectEditor?.create === "function"
  });
}

export function criticalForgeEffectValidator() {
  const api = getCriticalForgeApi({ required: true });
  if (typeof api.effects?.validate !== "function") throw new Error("Critical Forge Effect validation API is unavailable.");
  return (definition) => api.effects.validate(definition);
}
