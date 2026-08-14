import {
  AFFLICTION_SCHEMA_VERSION,
  AFFLICTION_TYPES,
  API_VERSION,
  CHECK_COMBINE_MODES,
  CONTROLLER_SCHEMA_VERSION,
  DOCUMENT_KINDS,
  DURATION_UNITS,
  IDENTIFICATION_STATES,
  MODULE_ID,
  MODULE_VERSION,
  RARITIES,
  SAVE_EXECUTION_MODES,
  SAVE_STATISTICS,
  SAVE_VISIBILITY_MODES
} from "../constants.js";
import {
  AFFLICTION_DATA_CONTRACT_V2,
  createAfflictionDefinition,
  createDefaultInitialCheck,
  createDefaultSaveCheck,
  createDefaultSavePolicy,
  createDefaultStage,
  createDefaultStageCheck
} from "../affliction/schema/affliction-defaults.js";
import { normalizeAfflictionDefinition, resolveSavePolicy, resolveStageCheck } from "../affliction/schema/affliction-normalizer.js";
import { assertValidAfflictionDefinition, validateAfflictionDefinition } from "../affliction/schema/affliction-validator.js";
import {
  buildAfflictionTemplateItemSource,
  extractAfflictionDefinitionFromItem,
  inspectAfflictionItem
} from "../affliction/documents/affliction-item-adapter.js";
import { createAfflictionTemplateService } from "../affliction/documents/affliction-template-service.js";
import {
  getDocumentKind,
  isAfflictionController,
  isAfflictionStageEffect,
  isAfflictionTemplate,
  isManagedAfflictionDocument
} from "../affliction/documents/affliction-flags.js";
import {
  createAfflictionControllerState,
  validateAfflictionControllerState
} from "../affliction/runtime/controller-state.js";
import { createAfflictionInstanceService } from "../affliction/runtime/affliction-instance-service.js";
import { createAfflictionEngine } from "../affliction/runtime/affliction-engine.js";
import { createAfflictionScheduler } from "../affliction/runtime/affliction-scheduler.js";
import { combineDegrees, normalizeDegreeOfSuccess, resolveDirective } from "../affliction/runtime/affliction-engine-core.js";
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
  const effectValidator = effectValidatorOrNull();
  const templateService = createAfflictionTemplateService({ effectValidator });
  const instanceService = createAfflictionInstanceService({ effectValidator });
  const afflictionEngine = createAfflictionEngine({ instanceService });
  const scheduler = createAfflictionScheduler({ engine: afflictionEngine, instanceService });
  return Object.freeze({
    version: API_VERSION,
    moduleVersion: MODULE_VERSION,
    schemaVersion: AFFLICTION_SCHEMA_VERSION,
    controllerSchemaVersion: CONTROLLER_SCHEMA_VERSION,

    contract: AFFLICTION_DATA_CONTRACT_V2,

    catalogs: Object.freeze({
      afflictionTypes: () => [...AFFLICTION_TYPES],
      rarities: () => [...RARITIES],
      saveStatistics: () => [...SAVE_STATISTICS],
      saveExecutionModes: () => [...SAVE_EXECUTION_MODES],
      saveVisibilityModes: () => [...SAVE_VISIBILITY_MODES],
      identificationStates: () => [...IDENTIFICATION_STATES],
      durationUnits: () => [...DURATION_UNITS],
      checkCombineModes: () => [...CHECK_COMBINE_MODES],
      documentKinds: () => ({ ...DOCUMENT_KINDS })
    }),

    definitions: Object.freeze({
      create: (options = {}) => createAfflictionDefinition(options),
      createCheck: (options = {}) => createDefaultSaveCheck(options),
      createSavePolicy: (options = {}) => createDefaultSavePolicy(options),
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
      resolveStageCheck: (definition, stageOrNumber) => resolveStageCheck(definition, stageOrNumber),
      resolveSavePolicy: (definition, checkOrId) => resolveSavePolicy(definition, checkOrId)
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
      isController: (item) => isAfflictionController(item),
      isStageEffect: (item) => isAfflictionStageEffect(item)
    }),

    templates: Object.freeze({
      create: (definition, options = {}) => templateService.create(definition, options),
      get: (itemOrUuid) => templateService.get(itemOrUuid),
      read: (itemOrUuid) => templateService.read(itemOrUuid),
      update: (itemOrUuid, definition) => templateService.update(itemOrUuid, definition),
      clone: (itemOrUuid, options = {}) => templateService.clone(itemOrUuid, options),
      copyDefinition: (definition, options = {}) => templateService.copyDefinition(definition, options),
      list: (options = {}) => templateService.list(options),
      inspect: (item) => templateService.inspect(item),
      canUpdate: (item) => templateService.canUpdate(item),
      writableDestinations: () => templateService.writableDestinations()
    }),

    controllers: Object.freeze({
      createState: (definition, options = {}) => createAfflictionControllerState(definition, options),
      validateState: (state, definition = null) => validateAfflictionControllerState(state, definition)
    }),

    engine: Object.freeze({
      apply: ({ templateUuid = null, definition = null, targets = null, targetActorUuid = null, ...options } = {}) => {
        const resolvedTargets = targets ?? targetActorUuid;
        if (templateUuid) return afflictionEngine.applyTemplate(templateUuid, resolvedTargets, options);
        if (definition) return afflictionEngine.applyDefinition(definition, resolvedTargets, options);
        throw new TypeError("engine.apply() requires templateUuid or definition.");
      },
      applyTemplate: (templateOrUuid, targets, options = {}) => afflictionEngine.applyTemplate(templateOrUuid, targets, options),
      applyDefinition: (definition, targets, options = {}) => afflictionEngine.applyDefinition(definition, targets, options),
      inspect: (controllerOrUuid) => afflictionEngine.inspect(controllerOrUuid),
      process: (controllerOrUuid, options = {}) => afflictionEngine.process(controllerOrUuid, options),
      processInitial: (controllerOrUuid) => afflictionEngine.processInitial(controllerOrUuid),
      acceptPlayerResult: async (payload = {}) => {
        const result = await afflictionEngine.acceptPlayerResult(payload);
        // A historical player save can complete a transition whose next interval
        // is already due at the current world time. Queue a catch-up pass after
        // accepting it instead of waiting for the next manual time advance.
        void scheduler.requestProcess({ reason: "player-result" });
        return result;
      },
      normalizeDegree: (value) => normalizeDegreeOfSuccess(value),
      combineDegrees: (values, mode = "single") => combineDegrees(values, mode),
      resolveDirective: (definition, state, directive) => resolveDirective(definition, state, directive)
    }),

    scheduler: Object.freeze({
      start: () => scheduler.start(),
      stop: () => scheduler.stop(),
      status: () => scheduler.status(),
      processDue: (options = {}) => scheduler.processDue(options),
      requestProcess: (options = {}) => scheduler.requestProcess(options),
      isAuthoritative: () => scheduler.authoritative
    }),

    instances: Object.freeze({
      apply: ({ templateUuid = null, definition = null, targets = null, targetActorUuid = null, ...options } = {}) => {
        const resolvedTargets = targets ?? targetActorUuid;
        if (templateUuid) return instanceService.applyTemplate(templateUuid, resolvedTargets, options);
        if (definition) return instanceService.applyDefinition(definition, resolvedTargets, options);
        throw new TypeError("instances.apply() requires templateUuid or definition.");
      },
      applyTemplate: (templateOrUuid, targets, options = {}) => instanceService.applyTemplate(templateOrUuid, targets, options),
      applyDefinition: (definition, targets, options = {}) => instanceService.applyDefinition(definition, targets, options),
      get: (controllerOrUuid) => instanceService.get(controllerOrUuid),
      inspect: (controller) => instanceService.inspect(controller),
      presentation: (controllerOrUuid) => instanceService.presentation(controllerOrUuid),
      events: (controllerOrUuid) => instanceService.events(controllerOrUuid),
      listForActor: (actorOrUuid) => instanceService.listForActor(actorOrUuid),
      setStage: (controllerOrUuid, stage, options = {}) => instanceService.setStage(controllerOrUuid, stage, options),
      advance: (controllerOrUuid, delta = 1, options = {}) => instanceService.advance(controllerOrUuid, delta, options),
      reapplyStage: (controllerOrUuid, options = {}) => instanceService.reapplyStage(controllerOrUuid, options),
      executeStageInstant: (controllerOrUuid) => instanceService.executeStageInstant(controllerOrUuid),
      completeOnset: (controllerOrUuid, options = {}) => instanceService.completeOnset(controllerOrUuid, options),
      setIdentification: (controllerOrUuid, state, options = {}) => instanceService.setIdentification(controllerOrUuid, state, options),
      end: (controllerOrUuid, options = {}) => instanceService.end(controllerOrUuid, options),
      cleanupDeletedController: (controller) => instanceService.cleanupDeletedController(controller)
    }),

    ui: Object.freeze({
      afflictionEditor: createAfflictionEditorUiApi(),
      forge: Object.freeze({
        open: async (options = {}) => {
          const { openAfflictionForge } = await import("../affliction/forge/affliction-forge.js");
          return openAfflictionForge(options);
        }
      }),
      controller: Object.freeze({
        open: async (controllerOrUuid, options = {}) => {
          const { openAfflictionController } = await import("../affliction/runtime/affliction-controller-app.js");
          return openAfflictionController(controllerOrUuid, options);
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
