import { MODULE_ID } from "./constants.js";
import { initializePublicApi } from "./api/public-api.js";
import { getCriticalForgeCompatibility } from "./affliction/integration/critical-forge-adapter.js";
import { initializeAfflictionForgeUi } from "./affliction/forge/affliction-forge.js";
import { initializeAfflictionSaveRuntime } from "./affliction/runtime/affliction-save-runtime.js";
import { initializeAfflictionVisibilityRuntime } from "./affliction/runtime/affliction-visibility-runtime.js";
import { registerAfflictionForgeSettings } from "./settings.js";

Hooks.once("init", () => {
  registerAfflictionForgeSettings();
  initializePublicApi();
});

Hooks.once("ready", async () => {
  const api = game.modules.get(MODULE_ID)?.api;
  const compatibility = getCriticalForgeCompatibility();

  if (!compatibility.effectApiAvailable) {
    console.error(`${MODULE_ID} | Critical Forge Effect API is unavailable. Stage Effect validation will be incomplete.`);
  }
  if (!compatibility.effectSourceApiAvailable) {
    console.error(`${MODULE_ID} | Critical Forge Effect source API is unavailable. Affliction stage effects cannot be applied.`);
  }
  if (!compatibility.effectExecutionApiAvailable) {
    console.error(`${MODULE_ID} | Critical Forge Effect execution API is unavailable. Affliction stage instant effects cannot be executed.`);
  }
  if (!compatibility.deathComponentAvailable) {
    console.error(`${MODULE_ID} | Critical Forge death component is unavailable. Lethal Affliction stages cannot execute direct death semantics.`);
  }
  if (!compatibility.effectEditorAvailable) {
    console.warn(`${MODULE_ID} | Critical Forge Embedded Effect Editor API is unavailable. Embedded Affliction Editor cannot mount stage Effect Editors.`);
  }

  initializeAfflictionForgeUi();
  initializeAfflictionSaveRuntime();
  initializeAfflictionVisibilityRuntime();

  // Repair stale generated runtime output before the scheduler is allowed to
  // process overdue transitions. This prevents a time catch-up from operating
  // on missing or orphaned persistent stage output.
  if (api?.scheduler?.isAuthoritative?.()) {
    try {
      await api.instances?.reconcileAll?.({ cleanupOrphans: true });
    } catch (error) {
      console.warn(`${MODULE_ID} | Initial Affliction runtime reconciliation failed.`, error);
    }
  }
  api?.scheduler?.start?.();

  Hooks.callAll("pf2eAfflictionForgeReady", api);
  console.info(`${MODULE_ID} | Ready`, {
    moduleVersion: api?.moduleVersion,
    apiVersion: api?.version,
    schemaVersion: api?.schemaVersion,
    controllerSchemaVersion: api?.controllerSchemaVersion,
    afflictionEditorAvailable: typeof api?.ui?.afflictionEditor?.create === "function",
    instanceRuntimeAvailable: typeof api?.instances?.apply === "function",
    afflictionEngineAvailable: typeof api?.engine?.process === "function",
    schedulerAvailable: typeof api?.scheduler?.processDue === "function",
    scheduler: api?.scheduler?.status?.(),
    libraries: api?.libraries?.summary?.(),
    criticalForge: compatibility
  });
});
