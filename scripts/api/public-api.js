import {
  AFFLICTION_SCHEMA_VERSION,
  AFFLICTION_TYPES,
  API_VERSION,
  CHECK_COMBINE_MODES,
  CONTROLLER_SCHEMA_VERSION,
  DOCUMENT_KINDS,
  DURATION_UNITS,
  MODULE_ID,
  MODULE_VERSION,
  RARITIES,
  SAVE_STATISTICS
} from "../constants.js";
import {
  AFFLICTION_DATA_CONTRACT_V1,
  createAfflictionDefinition,
  createDefaultInitialCheck,
  createDefaultSaveCheck,
  createDefaultStage,
  createDefaultStageCheck
} from "../affliction/schema/affliction-defaults.js";
import { normalizeAfflictionDefinition, resolveStageCheck } from "../affliction/schema/affliction-normalizer.js";
import { assertValidAfflictionDefinition, validateAfflictionDefinition } from "../affliction/schema/affliction-validator.js";
import {
  buildAfflictionTemplateItemSource,
  extractAfflictionDefinitionFromItem,
  inspectAfflictionItem
} from "../affliction/documents/affliction-item-adapter.js";
import {
  getDocumentKind,
  isAfflictionController,
  isAfflictionTemplate,
  isManagedAfflictionDocument
} from "../affliction/documents/affliction-flags.js";
import {
  createAfflictionControllerState,
  validateAfflictionControllerState
} from "../affliction/runtime/controller-state.js";
import { createAfflictionEditorUiApi } from "../affliction/editor/affliction-editor.js";
import {
  criticalForgeEffectValidator,
  getCriticalForgeApi,
  getCriticalForgeCompatibility
} from "../affliction/integration/critical-forge-adapter.js";

function effectValidatorOrNull() {
  try {
    return criticalForgeEffectValidator();
  } catch {
    return null;
  }
}

export function createPublicApi() {
  return Object.freeze({
    version: API_VERSION,
    moduleVersion: MODULE_VERSION,
    schemaVersion: AFFLICTION_SCHEMA_VERSION,
    controllerSchemaVersion: CONTROLLER_SCHEMA_VERSION,

    contract: AFFLICTION_DATA_CONTRACT_V1,

    catalogs: Object.freeze({
      afflictionTypes: () => [...AFFLICTION_TYPES],
      rarities: () => [...RARITIES],
      saveStatistics: () => [...SAVE_STATISTICS],
      durationUnits: () => [...DURATION_UNITS],
      checkCombineModes: () => [...CHECK_COMBINE_MODES],
      documentKinds: () => ({ ...DOCUMENT_KINDS })
    }),

    definitions: Object.freeze({
      create: (options = {}) => createAfflictionDefinition(options),
      createCheck: (options = {}) => createDefaultSaveCheck(options),
      createInitialCheck: () => createDefaultInitialCheck(),
      createStageCheck: () => createDefaultStageCheck(),
      createStage: (options = {}) => createDefaultStage(options),
      normalize: (definition, options = {}) => normalizeAfflictionDefinition(definition, options),
      validate: (definition, options = {}) => validateAfflictionDefinition(definition, {
        effectValidator: options.effectValidator ?? effectValidatorOrNull()
      }),
      assertValid: (definition, options = {}) => assertValidAfflictionDefinition(definition, {
        effectValidator: options.effectValidator ?? effectValidatorOrNull()
      }),
      resolveStageCheck: (definition, stageOrNumber) => resolveStageCheck(definition, stageOrNumber)
    }),

    documents: Object.freeze({
      buildTemplateSource: (definition, options = {}) => buildAfflictionTemplateItemSource(definition, {
        effectValidator: options.effectValidator ?? effectValidatorOrNull()
      }),
      readDefinition: (item, options = {}) => extractAfflictionDefinitionFromItem(item, options),
      inspect: (item) => inspectAfflictionItem(item),
      kindOf: (item) => getDocumentKind(item),
      isManaged: (item) => isManagedAfflictionDocument(item),
      isTemplate: (item) => isAfflictionTemplate(item),
      isController: (item) => isAfflictionController(item)
    }),

    controllers: Object.freeze({
      createState: (definition, options = {}) => createAfflictionControllerState(definition, options),
      validateState: (state, definition = null) => validateAfflictionControllerState(state, definition)
    }),

    ui: Object.freeze({
      afflictionEditor: createAfflictionEditorUiApi(),
      forge: Object.freeze({
        open: async (options = {}) => {
          const { openAfflictionForge } = await import("../affliction/forge/affliction-forge.js");
          return openAfflictionForge(options);
        }
      })
    }),

    integration: Object.freeze({
      criticalForge: Object.freeze({
        getApi: (options = {}) => getCriticalForgeApi(options),
        compatibility: () => getCriticalForgeCompatibility()
      })
    })
  });
}

export function initializePublicApi() {
  const module = game.modules.get(MODULE_ID);
  if (!module) throw new Error(`Module ${MODULE_ID} is unavailable.`);
  const api = createPublicApi();
  module.api = api;
  return api;
}
