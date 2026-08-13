import { MODULE_ID } from "./constants.js";
import { initializePublicApi } from "./api/public-api.js";
import { getCriticalForgeCompatibility } from "./affliction/integration/critical-forge-adapter.js";

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
    console.warn(`${MODULE_ID} | Critical Forge Embedded Effect Editor API is unavailable. The later embedded Affliction Editor cannot mount stage editors.`);
  }

  Hooks.callAll("pf2eAfflictionForgeReady", api);
  console.info(`${MODULE_ID} | Ready`, {
    moduleVersion: api?.moduleVersion,
    apiVersion: api?.version,
    schemaVersion: api?.schemaVersion,
    controllerSchemaVersion: api?.controllerSchemaVersion,
    criticalForge: compatibility
  });
});
