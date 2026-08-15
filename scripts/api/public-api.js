import {
  AFFLICTION_CAPABILITIES,
  AFFLICTION_REACTION_EVENTS,
  AFFLICTION_SCHEMA_VERSION,
  AFFLICTION_TYPES,
  API_VERSION,
  CHECK_COMBINE_MODES,
  CONTROLLER_SCHEMA_VERSION,
  DOCUMENT_KINDS,
  DURATION_UNITS,
  HEALING_RESTRICTION_MODES,
  IDENTIFICATION_STATES,
  MODULE_ID,
  MODULE_VERSION,
  RARITIES,
  SAVE_DC_MODES,
  SAVE_EXECUTION_MODES,
  SAVE_STATISTICS,
  SAVE_VISIBILITY_MODES,
  STAGE_EFFECT_PERSISTENCE_MODES
} from "../constants.js";
import {
  AFFLICTION_DATA_CONTRACT_V2,
  createAfflictionDefinition,
  createDefaultEventReaction,
  createDefaultInitialCheck,
  createDefaultRestrictions,
  createDefaultSaveCheck,
  createDefaultSavePolicy,
  createDefaultStage,
  createDefaultStageCheck
} from "../affliction/schema/affliction-defaults.js";
import {
  mergeRestrictions,
  normalizeAfflictionDefinition,
  normalizeRestrictions,
  resolveAfflictionRestrictions,
  resolveStageComponentPersistence,
  resolveSavePolicy,
  resolveStageCheck
} from "../affliction/schema/affliction-normalizer.js";
import { assertValidAfflictionDefinition, validateAfflictionDefinition } from "../affliction/schema/affliction-validator.js";
import {
  buildAfflictionTemplateItemSource,
  extractAfflictionDefinitionFromItem,
  inspectAfflictionItem
} from "../affliction/documents/affliction-item-adapter.js";
import { createAfflictionTemplateService } from "../affliction/documents/affliction-template-service.js";
import { createAfflictionLibraryService } from "../affliction/library/affliction-library-service.js";
import { createAfflictionApplicationService } from "../affliction/integration/affliction-application-service.js";
import {
  afflictionCombatTriggerRuntimeStatus,
  afflictionReferenceMatchesTrigger,
  inspectPf2eAfflictionTriggerMessage,
  processPf2eAfflictionTriggerMessage
} from "../affliction/integration/affliction-combat-trigger-runtime.js";
import {
  AFFLICTION_REFERENCE_APPLICATION_MODES,
  AFFLICTION_REFERENCE_DELIVERY_TYPES,
  AFFLICTION_REFERENCE_HOST_ITEM_TYPES,
  AFFLICTION_REFERENCE_SCHEMA_VERSION,
  AFFLICTION_REFERENCE_TRIGGERS,
  afflictionReferenceHostDefaults,
  addAfflictionReferenceToSource,
  addDocumentAfflictionReference,
  afflictionReferenceSummary,
  afflictionReferenceText,
  consumeInjuryPoisonCharge,
  createAfflictionReference,
  createInjuryPoisonReference,
  findAfflictionReference,
  injuryPoisonCharges,
  isAfflictionReferenceHostItem,
  isInjuryPoisonHostItem,
  isInjuryPoisonReference,
  normalizeAfflictionReference,
  readAfflictionReferences,
  removeAfflictionReferenceFromSource,
  removeDocumentAfflictionReference,
  setDocumentAfflictionReferences,
  validateAfflictionReference,
  withAfflictionReferences
} from "../affliction/integration/affliction-reference-service.js";
import {
  getDocumentKind,
  isAfflictionController,
  isAfflictionResidualEffect,
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
import {
  collectActorRestrictions,
  inspectControllerRestrictions,
  isAfflictionCapabilityBlocked,
  recordTypedHealingLockDamage,
  restrictionRuntimeStatus
} from "../affliction/runtime/affliction-restriction-runtime.js";
import {
  acceptAfflictionReactionPlayerResult,
  afflictionEventReactionRuntimeStatus,
  eventReactionMatches,
  inspectPf2eAfflictionReactionEvent,
  processAfflictionEventReactionMessage,
  resolvePf2eDamageTypes
} from "../affliction/runtime/affliction-event-reaction-runtime.js";
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
  const libraryService = createAfflictionLibraryService({ templateService });
  const instanceService = createAfflictionInstanceService({ effectValidator });
  const afflictionEngine = createAfflictionEngine({ instanceService });
  const scheduler = createAfflictionScheduler({ engine: afflictionEngine, instanceService });
  const applicationService = createAfflictionApplicationService({ engine: afflictionEngine, templateService });
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
      saveDcModes: () => [...SAVE_DC_MODES],
      saveExecutionModes: () => [...SAVE_EXECUTION_MODES],
      saveVisibilityModes: () => [...SAVE_VISIBILITY_MODES],
      identificationStates: () => [...IDENTIFICATION_STATES],
      healingRestrictionModes: () => [...HEALING_RESTRICTION_MODES],
      afflictionCapabilities: () => [...AFFLICTION_CAPABILITIES],
      reactionEvents: () => [...AFFLICTION_REACTION_EVENTS],
      stageEffectPersistenceModes: () => [...STAGE_EFFECT_PERSISTENCE_MODES],
      durationUnits: () => [...DURATION_UNITS],
      checkCombineModes: () => [...CHECK_COMBINE_MODES],
      documentKinds: () => ({ ...DOCUMENT_KINDS }),
      referenceTriggers: () => [...AFFLICTION_REFERENCE_TRIGGERS],
      referenceApplicationModes: () => [...AFFLICTION_REFERENCE_APPLICATION_MODES],
      referenceDeliveryTypes: () => [...AFFLICTION_REFERENCE_DELIVERY_TYPES],
      referenceHostItemTypes: () => [...AFFLICTION_REFERENCE_HOST_ITEM_TYPES]
    }),

    definitions: Object.freeze({
      create: (options = {}) => createAfflictionDefinition(options),
      createReaction: (options = {}) => createDefaultEventReaction(options),
      createCheck: (options = {}) => createDefaultSaveCheck(options),
      createSavePolicy: (options = {}) => createDefaultSavePolicy(options),
      createRestrictions: () => createDefaultRestrictions(),
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
      normalizeRestrictions: (restrictions) => normalizeRestrictions(restrictions),
      mergeRestrictions: (...restrictions) => mergeRestrictions(...restrictions),
      resolveRestrictions: (definition, stageOrNumber = null) => resolveAfflictionRestrictions(definition, stageOrNumber),
      resolveComponentPersistence: (stage, componentIndex) => resolveStageComponentPersistence(stage, componentIndex),
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
      isStageEffect: (item) => isAfflictionStageEffect(item),
      isResidualEffect: (item) => isAfflictionResidualEffect(item)
    }),

    templates: Object.freeze({
      create: (definition, options = {}) => {
        if (!libraryService.canWriteDestination(options.pack ?? null)) throw new Error("Destination belongs to a read-only Affliction library.");
        return templateService.create(definition, options);
      },
      get: (itemOrUuid) => templateService.get(itemOrUuid),
      read: (itemOrUuid) => templateService.read(itemOrUuid),
      update: async (itemOrUuid, definition) => {
        const document = await templateService.get(itemOrUuid);
        if (!libraryService.canUpdate(document)) throw new Error("Affliction template belongs to a read-only library and cannot be updated in place.");
        return templateService.update(document, definition);
      },
      clone: (itemOrUuid, options = {}) => {
        if (!libraryService.canWriteDestination(options.pack ?? null)) throw new Error("Destination belongs to a read-only Affliction library.");
        return templateService.clone(itemOrUuid, options);
      },
      copyDefinition: (definition, options = {}) => {
        if (!libraryService.canWriteDestination(options.pack ?? null)) throw new Error("Destination belongs to a read-only Affliction library.");
        return templateService.copyDefinition(definition, options);
      },
      list: (options = {}) => libraryService.templates(options),
      inspect: (item) => libraryService.inspect(item),
      canUpdate: (item) => libraryService.canUpdate(item),
      writableDestinations: () => libraryService.writableDestinations()
    }),

    libraries: Object.freeze({
      register: (library) => libraryService.registerLibrary(library),
      list: (options = {}) => libraryService.list(options),
      get: (libraryId, options = {}) => libraryService.get(libraryId, options),
      search: (options = {}) => libraryService.search(options),
      templates: (options = {}) => libraryService.templates(options),
      setEnabled: (libraryId, enabled) => libraryService.setEnabled(libraryId, enabled),
      isEnabled: (libraryId) => libraryService.isEnabled(libraryId),
      forDocument: (document) => libraryService.libraryForDocument(document),
      forPack: (collection) => libraryService.libraryForPack(collection),
      canWriteDestination: (pack = null) => libraryService.canWriteDestination(pack),
      summary: () => libraryService.summary()
    }),

    providers: Object.freeze({
      register: (provider) => libraryService.registerProvider(provider),
      unregister: (providerId) => libraryService.unregisterProvider(providerId),
      list: () => libraryService.providerList()
    }),

    references: Object.freeze({
      schemaVersion: AFFLICTION_REFERENCE_SCHEMA_VERSION,
      create: (options = {}) => createAfflictionReference(options),
      createInjuryPoison: (options = {}) => createInjuryPoisonReference(options),
      normalize: (reference) => normalizeAfflictionReference(reference),
      validate: (reference) => validateAfflictionReference(reference),
      list: (documentOrSource) => readAfflictionReferences(documentOrSource),
      get: (documentOrSource, referenceId) => findAfflictionReference(documentOrSource, referenceId),
      set: (document, references = []) => setDocumentAfflictionReferences(document, references),
      add: (document, reference) => addDocumentAfflictionReference(document, reference),
      remove: (document, referenceId) => removeDocumentAfflictionReference(document, referenceId),
      withReferences: (source, references = []) => withAfflictionReferences(source, references),
      addToSource: (source, reference) => addAfflictionReferenceToSource(source, reference),
      removeFromSource: (source, referenceId) => removeAfflictionReferenceFromSource(source, referenceId),
      toText: (referenceOrUuid, options = {}) => afflictionReferenceText(referenceOrUuid, options),
      summary: (reference) => afflictionReferenceSummary(reference),
      isHostItem: (documentOrSource) => isAfflictionReferenceHostItem(documentOrSource),
      isInjuryPoisonHost: (documentOrSource) => isInjuryPoisonHostItem(documentOrSource),
      isInjuryPoison: (reference) => isInjuryPoisonReference(reference),
      injuryPoisonCharges: (reference) => injuryPoisonCharges(reference),
      consumeInjuryPoisonCharge: (document, referenceId, options = {}) => consumeInjuryPoisonCharge(document, referenceId, options),
      hostDefaults: (documentOrSource) => afflictionReferenceHostDefaults(documentOrSource)
    }),

    application: Object.freeze({
      apply: (options = {}) => applicationService.apply(options),
      applyReference: (referenceOrSource, targets, options = {}) => applicationService.applyReference(referenceOrSource, targets, options),
      applyItemReference: (itemOrUuid, referenceId, targets, options = {}) => applicationService.applyItemReference(itemOrUuid, referenceId, targets, options),
      resolveReference: (referenceOrSource, options = {}) => applicationService.resolveReference(referenceOrSource, options),
      createDragData: (templateOrUuid, options = {}) => applicationService.createDragData(templateOrUuid, options),
      parseDropData: (data = {}) => applicationService.parseDropData(data),
      applyDropData: (data, target, options = {}) => applicationService.applyDropData(data, target, options)
    }),

    triggers: Object.freeze({
      inspectMessage: (message) => inspectPf2eAfflictionTriggerMessage(message),
      matches: (reference, event) => afflictionReferenceMatchesTrigger(reference, event),
      processMessage: (message, options = {}) => processPf2eAfflictionTriggerMessage(message, options),
      status: () => afflictionCombatTriggerRuntimeStatus()
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
      resumePending: (controllerOrUuid, options = {}) => afflictionEngine.resumePending(controllerOrUuid, options),
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
      listAll: () => instanceService.listAll(),
      setStage: (controllerOrUuid, stage, options = {}) => instanceService.setStage(controllerOrUuid, stage, options),
      advance: (controllerOrUuid, delta = 1, options = {}) => instanceService.advance(controllerOrUuid, delta, options),
      reapplyStage: (controllerOrUuid, options = {}) => instanceService.reapplyStage(controllerOrUuid, options),
      executeStageInstant: (controllerOrUuid) => instanceService.executeStageInstant(controllerOrUuid),
      completeOnset: (controllerOrUuid, options = {}) => instanceService.completeOnset(controllerOrUuid, options),
      setIdentification: (controllerOrUuid, state, options = {}) => instanceService.setIdentification(controllerOrUuid, state, options),
      pause: (controllerOrUuid, options = {}) => instanceService.pause(controllerOrUuid, options),
      resume: (controllerOrUuid, options = {}) => instanceService.resume(controllerOrUuid, options),
      end: (controllerOrUuid, options = {}) => instanceService.end(controllerOrUuid, options),
      reconcile: (controllerOrUuid, options = {}) => instanceService.reconcile(controllerOrUuid, options),
      reconcileActor: (actorOrUuid, options = {}) => instanceService.reconcileActor(actorOrUuid, options),
      reconcileAll: (options = {}) => instanceService.reconcileAll(options),
      cleanupDeletedController: (controller) => instanceService.cleanupDeletedController(controller)
    }),

    restrictions: Object.freeze({
      forActor: (actor) => collectActorRestrictions(actor),
      forController: (controller) => inspectControllerRestrictions(controller),
      isCapabilityBlocked: (actor, capability) => isAfflictionCapabilityBlocked(actor, capability),
      recordDamageMessage: (message) => recordTypedHealingLockDamage(message),
      status: () => restrictionRuntimeStatus()
    }),

    reactions: Object.freeze({
      inspectMessage: (message) => inspectPf2eAfflictionReactionEvent(message),
      damageTypes: (message) => resolvePf2eDamageTypes(message),
      matches: (reaction, event) => eventReactionMatches(reaction, event),
      processMessage: (message, options = {}) => processAfflictionEventReactionMessage(message, options),
      acceptPlayerResult: (payload = {}) => acceptAfflictionReactionPlayerResult(payload),
      status: () => afflictionEventReactionRuntimeStatus()
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
