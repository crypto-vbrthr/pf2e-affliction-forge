import { MODULE_ID } from "./constants.js";
import { initializePublicApi } from "./api/public-api.js";
import { getCriticalForgeCompatibility } from "./affliction/integration/critical-forge-adapter.js";
import { initializeAfflictionForgeUi } from "./affliction/forge/affliction-forge.js";

Hooks.once("init", () => {
  initializePublicApi();
});

Hooks.once("ready", () => {
  const api = game.modules.get(MODULE_ID)?.api;
  const compatibility = getCriticalForgeCompatibility();

  if (!compatibility.effectApiAvailable) {
    console.error(`${MODULE_ID} | Critical Forge Effect API is unavailable. Stage Effect validation will be incomplete.`);
  }
  if (!compatibility.effectEditorAvailable) {
    console.warn(`${MODULE_ID} | Critical Forge Embedded Effect Editor API is unavailable. Embedded Affliction Editor cannot mount stage Effect Editors.`);
  }

  initializeAfflictionForgeUi();

  Hooks.callAll("pf2eAfflictionForgeReady", api);
  console.info(`${MODULE_ID} | Ready`, {
    moduleVersion: api?.moduleVersion,
    apiVersion: api?.version,
    schemaVersion: api?.schemaVersion,
    controllerSchemaVersion: api?.controllerSchemaVersion,
    afflictionEditorAvailable: typeof api?.ui?.afflictionEditor?.create === "function",
    criticalForge: compatibility
  });
});
