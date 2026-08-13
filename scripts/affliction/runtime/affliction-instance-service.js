import {
  AFFLICTION_SCHEMA_VERSION,
  CONTROLLER_SCHEMA_VERSION,
  DOCUMENT_KINDS,
  IDENTIFICATION_STATES,
  MODULE_ID
} from "../../constants.js";
import { getCriticalForgeApi } from "../integration/critical-forge-adapter.js";
import { extractAfflictionDefinitionFromItem } from "../documents/affliction-item-adapter.js";
import {
  buildControllerFlags,
  getAfflictionFlags,
  isAfflictionController,
  isAfflictionStageEffect,
  isAfflictionTemplate
} from "../documents/affliction-flags.js";
import { normalizeAfflictionDefinition } from "../schema/affliction-normalizer.js";
import { assertValidAfflictionDefinition } from "../schema/affliction-validator.js";
import { deepClone, randomId } from "../schema/utils.js";
import {
  createAfflictionControllerState,
  validateAfflictionControllerState
} from "./controller-state.js";

function nowWorldTime() {
  const value = Number(globalThis.game?.time?.worldTime);
  return Number.isFinite(value) ? value : 0;
}

function roundTimeSeconds() {
  const value = Number(globalThis.CONFIG?.time?.roundTime);
  return Number.isFinite(value) && value > 0 ? value : 6;
}

export function durationToWorldSeconds(duration) {
  if (!duration || duration.unit === "unlimited") return null;
  const value = Number(duration.value);
  if (!Number.isFinite(value) || value < 0) return null;
  const factors = {
    rounds: roundTimeSeconds(),
    minutes: 60,
    hours: 3600,
    days: 86400
  };
  const factor = factors[duration.unit];
  return Number.isFinite(factor) ? value * factor : null;
}

function dueAt(duration, enteredAt) {
  const seconds = durationToWorldSeconds(duration);
  return seconds == null || !Number.isFinite(enteredAt) ? null : enteredAt + seconds;
}

function finiteTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Derive the earliest valid due time from the Affliction definition and runtime
 * state. `nextCheckAt` is treated as a persisted schedule override/cache, but it
 * can never shorten the definition's onset or stage duration.
 */
export function scheduledDueAt(definitionInput, state = {}) {
  const definition = normalizeAfflictionDefinition(definitionInput);
  const stored = finiteTime(state.nextCheckAt);

  if (state.status === "incubating") {
    const seconds = durationToWorldSeconds(definition.onset);
    if (seconds == null) return null;
    // Onset owns an explicit clock. Older 0.1.x controllers did not persist
    // onsetStartedAt, so lastCheck/appliedAt remain migration fallbacks only.
    // Once a start is known, the definition-derived duration is authoritative:
    // a stale nextCheckAt can neither shorten nor otherwise redefine it.
    const startedAt = finiteTime(state.onsetStartedAt)
      ?? finiteTime(state.lastCheck?.effectiveAt)
      ?? finiteTime(state.appliedAt);
    if (startedAt == null) return stored;
    const canonical = startedAt + seconds;
    return stored == null ? canonical : Math.max(stored, canonical);
  }

  if (state.status === "active" && Number(state.currentStage) > 0) {
    const stage = definition.stages?.[Number(state.currentStage) - 1] ?? null;
    const seconds = durationToWorldSeconds(stage?.duration);
    if (seconds == null) return null;
    const startedAt = finiteTime(state.stageEnteredAt);
    if (startedAt == null) return stored;
    const canonical = startedAt + seconds;
    // A persisted schedule may intentionally delay processing, but may never
    // shorten the definition-owned stage duration.
    return stored == null ? canonical : Math.max(stored, canonical);
  }

  // Initial exposure checks are not clock-driven.
  return null;
}

function itemCollection(actor) {
  if (!actor?.items) return [];
  if (Array.isArray(actor.items)) return actor.items;
  if (typeof actor.items.filter === "function") return [...actor.items.filter(() => true)];
  return [...actor.items];
}

async function resolveUuid(uuid) {
  if (typeof globalThis.fromUuid !== "function") throw new Error("Foundry fromUuid() is unavailable.");
  return globalThis.fromUuid(uuid);
}

export async function resolveAfflictionActor(actorOrTarget) {
  if (!actorOrTarget) return null;
  if (typeof actorOrTarget === "string") {
    const document = await resolveUuid(actorOrTarget);
    return resolveAfflictionActor(document);
  }
  if (actorOrTarget.documentName === "Actor") return actorOrTarget;
  if (actorOrTarget.actor?.documentName === "Actor") return actorOrTarget.actor;
  if (actorOrTarget.document?.actor?.documentName === "Actor") return actorOrTarget.document.actor;
  return null;
}

async function resolveController(controllerOrUuid) {
  const controller = typeof controllerOrUuid === "string"
    ? await resolveUuid(controllerOrUuid)
    : controllerOrUuid;
  if (!controller || !isAfflictionController(controller)) {
    throw new TypeError("An active Affliction Forge controller Item is required.");
  }
  const actor = controller.parent?.documentName === "Actor" ? controller.parent : null;
  if (!actor) throw new Error("Affliction controller is not embedded in an Actor.");
  return { controller, actor };
}

function assertWritableActor(actor) {
  if (!actor || actor.documentName !== "Actor" || typeof actor.createEmbeddedDocuments !== "function") {
    throw new TypeError("A writable Actor target is required.");
  }
  if (typeof actor.canUserModify === "function" && globalThis.game?.user && !actor.canUserModify(game.user, "update")) {
    throw new Error(`Actor is not writable: ${actor.name ?? actor.uuid ?? "unknown"}`);
  }
}

function controllerItemSource(definition, state, {
  sourceTemplateUuid = null,
  sourceDefinitionVersion = null,
  origin = {}
} = {}) {
  const unidentified = state.identification?.state !== "identified";
  const flags = buildControllerFlags({
    definitionSnapshot: definition,
    instanceId: state.instanceId,
    sourceTemplateUuid,
    sourceDefinitionVersion,
    origin,
    state
  });

  return {
    name: definition.name,
    type: "effect",
    img: definition.img,
    system: {
      description: { value: definition.description ?? "", gm: "" },
      rules: [],
      slug: null,
      traits: { value: [...definition.traits], otherTags: [...definition.themes] },
      level: { value: definition.level },
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
      start: { value: 0, initiative: null },
      badge: null,
      tokenIcon: { show: !unidentified },
      unidentified
    },
    flags
  };
}

function stageDescriptor(definition, stageNumber) {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) return null;
  return definition.stages?.[stageNumber - 1] ?? null;
}

function stageEffectFlags({ definition, state, stage, controllerUuid, sourceTemplateUuid }) {
  return {
    managed: true,
    documentKind: DOCUMENT_KINDS.STAGE_EFFECT,
    schemaVersion: AFFLICTION_SCHEMA_VERSION,
    controllerSchemaVersion: CONTROLLER_SCHEMA_VERSION,
    definitionId: definition.id,
    instanceId: state.instanceId,
    controllerUuid,
    sourceTemplateUuid: sourceTemplateUuid ?? null,
    stageId: stage.id,
    stageNumber: stage.number
  };
}

function mechanicalEffectPresent(stage) {
  return Boolean(stage?.effect && Array.isArray(stage.effect.components) && stage.effect.components.length > 0);
}

function buildRuntimeStageEffectDefinition(stage, state) {
  if (!mechanicalEffectPresent(stage)) return null;
  const runtimeEffect = deepClone(stage.effect);
  const sourceEffectDefinitionId = runtimeEffect.id;
  // Critical Forge removes effects by EffectDefinition id. Runtime ids must be
  // instance-specific so two applications of the same Affliction template can
  // never collide if a Critical Forge consumer performs definition-id cleanup.
  runtimeEffect.id = `${sourceEffectDefinitionId}.${state.instanceId}`;
  runtimeEffect.metadata = {
    ...(runtimeEffect.metadata ?? {}),
    sourceEffectDefinitionId,
    afflictionInstanceId: state.instanceId,
    afflictionStageId: stage.id
  };
  return runtimeEffect;
}

async function buildStageEffectSources({ actor, controller, definition, state, stage }) {
  const runtimeEffect = buildRuntimeStageEffectDefinition(stage, state);
  if (!runtimeEffect) return [];
  const criticalApi = getCriticalForgeApi({ required: true });
  if (typeof criticalApi.effects?.toItemSources !== "function") {
    throw new Error("Critical Forge Effect source API is unavailable.");
  }

  const sources = await criticalApi.effects.toItemSources(runtimeEffect, {
    actor,
    target: actor,
    source: controller
  });
  const list = Array.isArray(sources) ? sources : [sources];
  const sourceTemplateUuid = getAfflictionFlags(controller)?.sourceTemplateUuid ?? null;
  const unidentified = state.identification?.state !== "identified";

  return list.filter(Boolean).map((source) => {
    const result = deepClone(source);
    result.flags ??= {};
    result.flags[MODULE_ID] = stageEffectFlags({
      definition,
      state,
      stage,
      controllerUuid: controller.uuid,
      sourceTemplateUuid
    });
    result.system ??= {};
    result.system.unidentified = unidentified;
    result.system.tokenIcon ??= {};
    result.system.tokenIcon.show = !unidentified;
    return result;
  });
}

async function createStageEffects({ actor, controller, definition, state, stage }) {
  const sources = await buildStageEffectSources({ actor, controller, definition, state, stage });
  if (sources.length === 0) return [];
  return actor.createEmbeddedDocuments("Item", sources, {
    renderSheet: false,
    [MODULE_ID]: { afflictionStageApplication: true }
  });
}

function stageExecutionLabel(definition, state, stage) {
  if (state.identification?.state === "identified") {
    return `${definition.name} · ${stage.name ?? `Stage ${stage.number}`}`;
  }
  const key = "PF2E_AFFLICTION_FORGE.Runtime.HiddenStageEffectLabel";
  return globalThis.game?.i18n?.localize?.(key) ?? "Unidentified affliction";
}

async function executeStageInstantEffects({ actor, controller, definition, state, stage }) {
  const runtimeEffect = buildRuntimeStageEffectDefinition(stage, state);
  if (!runtimeEffect) return [];
  const criticalApi = getCriticalForgeApi({ required: true });
  if (typeof criticalApi.effects?.execute !== "function") {
    throw new Error("Critical Forge Effect execution API is unavailable.");
  }

  return criticalApi.effects.execute(runtimeEffect, actor, {
    context: { actor, target: actor, source: controller },
    item: controller,
    label: stageExecutionLabel(definition, state, stage)
  });
}

function notifyInstantExecutionFailure({ controller, stage, error }) {
  console.error(`${MODULE_ID} | Affliction stage instant effect execution failed.`, {
    controllerUuid: controller?.uuid ?? null,
    stageId: stage?.id ?? null,
    stageNumber: stage?.number ?? null,
    error
  });
  globalThis.Hooks?.callAll?.("pf2eAfflictionForgeInstantExecutionFailed", {
    controllerUuid: controller?.uuid ?? null,
    stageId: stage?.id ?? null,
    stageNumber: stage?.number ?? null,
    error
  });
  const key = "PF2E_AFFLICTION_FORGE.Runtime.InstantExecutionFailed";
  const message = globalThis.game?.i18n?.localize?.(key) ?? key;
  globalThis.ui?.notifications?.error?.(message);
}

async function executeStageInstantEffectsSafely(context) {
  try {
    return await executeStageInstantEffects(context);
  } catch (error) {
    notifyInstantExecutionFailure({ ...context, error });
    return [];
  }
}

function stageEffectItems(actor, instanceId) {
  return itemCollection(actor).filter((item) => {
    const flags = getAfflictionFlags(item);
    return isAfflictionStageEffect(item) && flags?.instanceId === instanceId;
  });
}

async function removeStageEffects(actor, state) {
  const candidates = new Map();
  for (const item of stageEffectItems(actor, state.instanceId)) candidates.set(item.id, item);

  if (typeof globalThis.fromUuid === "function") {
    for (const uuid of state.activeStageEffectUuids ?? []) {
      try {
        const item = await globalThis.fromUuid(uuid);
        if (item?.parent?.uuid === actor.uuid && item?.id) candidates.set(item.id, item);
      } catch {
        // Stale UUIDs are expected after manual cleanup and are handled by the actor scan above.
      }
    }
  }

  const ids = [...candidates.keys()].filter(Boolean);
  if (ids.length === 0) return [];
  return actor.deleteEmbeddedDocuments("Item", ids, {
    render: false,
    [MODULE_ID]: { afflictionStageCleanup: true }
  });
}

function buildTransitionState(previous, definition, stageNumber, enteredAt, effectUuids = []) {
  const next = deepClone(previous);
  next.status = stageNumber > 0 ? "active" : (definition.onset ? "incubating" : "pending");
  next.currentStage = stageNumber;
  next.stageEnteredAt = stageNumber > 0 ? enteredAt : null;
  next.onsetStartedAt = stageNumber > 0 ? null : next.onsetStartedAt ?? null;
  const duration = stageNumber > 0
    ? stageDescriptor(definition, stageNumber)?.duration
    : definition.onset;
  next.nextCheckAt = dueAt(duration, enteredAt);
  next.activeStageEffectUuids = [...effectUuids];
  next.pendingCheck = null;
  next.onsetTargetStage = null;
  next.revision = Number(previous.revision ?? 0) + 1;
  return next;
}

async function updateController(controller, definition, state) {
  const report = validateAfflictionControllerState(state, definition);
  if (!report.valid) throw new Error(`Invalid Affliction controller state: ${report.errors.join(" ")}`);
  const previous = getAfflictionFlags(controller) ?? {};
  const moduleFlags = {
    ...deepClone(previous),
    state: deepClone(state)
  };
  const unidentified = state.identification?.state !== "identified";
  await controller.update({
    system: {
      unidentified,
      tokenIcon: { show: !unidentified }
    },
    flags: { [MODULE_ID]: moduleFlags }
  }, { render: false });
  return controller;
}

function descriptor(controller) {
  const flags = getAfflictionFlags(controller) ?? {};
  const definition = normalizeAfflictionDefinition(flags.definitionSnapshot ?? {});
  const state = deepClone(flags.state ?? {});
  const stage = stageDescriptor(definition, state.currentStage);
  return Object.freeze({
    uuid: controller.uuid,
    id: controller.id,
    actorUuid: controller.parent?.uuid ?? null,
    actorName: controller.parent?.name ?? null,
    name: definition.name,
    img: definition.img,
    definitionId: definition.id,
    sourceTemplateUuid: flags.sourceTemplateUuid ?? null,
    sourceDefinitionVersion: flags.sourceDefinitionVersion ?? null,
    origin: deepClone(flags.origin ?? {}),
    instanceId: flags.instanceId ?? state.instanceId ?? null,
    state,
    currentStage: stage ? deepClone(stage) : null,
    stageCount: definition.stages.length
  });
}

export class AfflictionInstanceService {
  constructor({ effectValidator = null } = {}) {
    this.effectValidator = effectValidator;
  }

  async get(controllerOrUuid) {
    return (await resolveController(controllerOrUuid)).controller;
  }

  inspect(controller) {
    if (!isAfflictionController(controller)) return null;
    return descriptor(controller);
  }

  async listForActor(actorOrUuid) {
    const actor = await resolveAfflictionActor(actorOrUuid);
    if (!actor) throw new TypeError("Actor not found.");
    return itemCollection(actor).filter(isAfflictionController).map(descriptor);
  }

  async applyTemplate(templateOrUuid, targets, options = {}) {
    const template = typeof templateOrUuid === "string" ? await resolveUuid(templateOrUuid) : templateOrUuid;
    if (!template || !isAfflictionTemplate(template)) throw new TypeError("An Affliction template Item is required.");
    const definition = extractAfflictionDefinitionFromItem(template);
    const flags = getAfflictionFlags(template) ?? {};
    return this.applyDefinition(definition, targets, {
      ...options,
      sourceTemplateUuid: template.uuid,
      sourceDefinitionVersion: Number(flags.definitionVersion ?? 1)
    });
  }

  async applyDefinition(definitionInput, targets, {
    sourceTemplateUuid = null,
    sourceDefinitionVersion = null,
    origin = {},
    appliedAt = nowWorldTime()
  } = {}) {
    const definition = normalizeAfflictionDefinition(definitionInput);
    assertValidAfflictionDefinition(definition, { effectValidator: this.effectValidator });
    const list = Array.isArray(targets) ? targets : [targets];
    const actors = [];
    for (const target of list) {
      const actor = await resolveAfflictionActor(target);
      if (actor && !actors.includes(actor)) actors.push(actor);
    }
    if (actors.length === 0) throw new Error("No valid Actor targets were supplied.");

    for (const actor of actors) assertWritableActor(actor);

    const controllers = [];
    try {
      for (const actor of actors) {
        const hasInitialCheck = Boolean(definition.initialCheck);
        const hasOnset = Boolean(definition.onset);
        const initialStage = hasInitialCheck || hasOnset ? 0 : 1;
        const initialStatus = hasInitialCheck ? "pending" : hasOnset ? "incubating" : "active";
        const state = createAfflictionControllerState(definition, {
          instanceId: randomId("affliction-instance"),
          appliedAt,
          currentStage: initialStage,
          stageEnteredAt: initialStage > 0 ? appliedAt : null,
          onsetStartedAt: hasOnset && !hasInitialCheck ? appliedAt : null,
          status: initialStatus,
          onsetTargetStage: hasOnset && !hasInitialCheck ? 1 : null,
          // The initial exposure save is not a timed event. It is resolved by
          // AfflictionEngine.apply*() immediately after controller creation.
          // Keeping nextCheckAt null prevents the world-time scheduler from
          // racing that interactive save if time advances while its dialog is open.
          nextCheckAt: hasInitialCheck
            ? null
            : hasOnset
              ? dueAt(definition.onset, appliedAt)
              : dueAt(definition.stages?.[0]?.duration, appliedAt)
        });
        const [controller] = await actor.createEmbeddedDocuments("Item", [controllerItemSource(definition, state, {
          sourceTemplateUuid,
          sourceDefinitionVersion,
          origin
        })], {
          renderSheet: false,
          [MODULE_ID]: { afflictionControllerApplication: true }
        });
        if (!controller) throw new Error(`Affliction controller could not be created on ${actor.name ?? actor.uuid}.`);

        try {
          if (state.currentStage > 0) {
            const stage = stageDescriptor(definition, state.currentStage);
            const createdEffects = await createStageEffects({ actor, controller, definition, state, stage });
            state.activeStageEffectUuids = createdEffects.map((item) => item.uuid);
            await updateController(controller, definition, state);
            // Stage entry is committed before instant mechanics run. Damage and
            // other future instant components are irreversible, so a failed
            // execution must never roll the controller back to a phase whose
            // persistent effects have already been replaced.
            await executeStageInstantEffectsSafely({ actor, controller, definition, state, stage });
          }
          controllers.push(controller);
        } catch (error) {
          try { await removeStageEffects(actor, state); } catch { /* best effort */ }
          try { await actor.deleteEmbeddedDocuments("Item", [controller.id], { render: false }); } catch { /* best effort */ }
          throw error;
        }
      }
      return controllers;
    } catch (error) {
      // Multi-target application is atomic from the user's point of view. If a
      // later target fails, remove already-created instances from earlier targets.
      for (const controller of [...controllers].reverse()) {
        try { await this.end(controller, { reason: "ended" }); } catch (cleanupError) {
          console.error(`${MODULE_ID} | Failed to roll back a partial multi-target Affliction application.`, cleanupError);
        }
      }
      throw error;
    }
  }

  async updateRuntimeState(controllerOrUuid, stateInput) {
    const { controller } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(stateInput);
    await updateController(controller, definition, state);
    return controller;
  }

  async setPendingCheck(controllerOrUuid, pendingCheck, { incrementRevision = true } = {}) {
    const { controller } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    state.pendingCheck = pendingCheck == null ? null : deepClone(pendingCheck);
    if (incrementRevision) state.revision = Number(state.revision ?? 0) + 1;
    await updateController(controller, definition, state);
    return controller;
  }

  async beginOnset(controllerOrUuid, targetStage = 1, { startedAt = nowWorldTime(), lastCheck = null } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    if (!definition.onset) return this.setStage(controller, targetStage, { enteredAt: startedAt });
    const state = deepClone(flags.state);
    await removeStageEffects(actor, state);
    state.status = "incubating";
    state.currentStage = 0;
    state.stageEnteredAt = null;
    state.onsetStartedAt = startedAt;
    state.nextCheckAt = dueAt(definition.onset, startedAt);
    state.activeStageEffectUuids = [];
    state.pendingCheck = null;
    state.onsetTargetStage = Math.max(1, Math.min(definition.stages.length, Math.trunc(Number(targetStage) || 1)));
    state.lastCheck = lastCheck == null ? state.lastCheck ?? null : deepClone(lastCheck);
    state.revision = Number(state.revision ?? 0) + 1;
    await updateController(controller, definition, state);
    return controller;
  }

  async completeOnset(controllerOrUuid, { enteredAt = nowWorldTime() } = {}) {
    const controller = await this.get(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const state = flags?.state ?? {};
    if (state.status !== "incubating") throw new Error("Affliction is not incubating.");
    const targetStage = Number(state.onsetTargetStage ?? 1);
    return this.setStage(controller, targetStage, { enteredAt });
  }

  async setStage(controllerOrUuid, requestedStage, {
    enteredAt = nowWorldTime(),
    lastCheck = undefined,
    refreshPersistent = false,
    executeInstant = true
  } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const previous = deepClone(flags.state);
    const max = definition.stages.length;
    const stageNumber = Math.max(0, Math.min(max, Math.trunc(Number(requestedStage))));
    if (!Number.isFinite(stageNumber)) throw new TypeError("Stage number must be numeric.");

    const stage = stageDescriptor(definition, stageNumber);
    const sameActiveStage = stageNumber > 0
      && previous.status === "active"
      && previous.currentStage === stageNumber;

    // A save can resolve to the same stage. Persistent stage mechanics are
    // already present and must not flicker through remove/recreate cycles. The
    // interval is renewed and only instant mechanics (for example damage) run
    // again. Manual repair/reapply can explicitly request a persistent refresh.
    if (sameActiveStage && !refreshPersistent) {
      const next = buildTransitionState(
        previous,
        definition,
        stageNumber,
        enteredAt,
        previous.activeStageEffectUuids ?? []
      );
      if (lastCheck !== undefined) next.lastCheck = lastCheck == null ? null : deepClone(lastCheck);
      await updateController(controller, definition, next);
      if (executeInstant && stage) {
        await executeStageInstantEffectsSafely({ actor, controller, definition, state: next, stage });
      }
      return controller;
    }

    // Compile the new persistent stage output before any destructive operation.
    // Critical Forge's toItemSources() intentionally excludes instant
    // components, so damage can never become a persistent stage Item.
    const preparedSources = stage
      ? await buildStageEffectSources({ actor, controller, definition, state: previous, stage })
      : [];

    const oldStage = stageDescriptor(definition, previous.currentStage);
    let oldSources = [];
    if (oldStage) {
      try {
        oldSources = await buildStageEffectSources({ actor, controller, definition, state: previous, stage: oldStage });
      } catch (error) {
        console.warn(`${MODULE_ID} | Previous Affliction stage could not be precompiled for rollback.`, error);
      }
    }

    await removeStageEffects(actor, previous);
    let created = [];
    try {
      if (preparedSources.length > 0) {
        created = await actor.createEmbeddedDocuments("Item", preparedSources, {
          renderSheet: false,
          [MODULE_ID]: { afflictionStageApplication: true }
        });
      }
      const next = buildTransitionState(previous, definition, stageNumber, enteredAt, created.map((item) => item.uuid));
      if (lastCheck !== undefined) next.lastCheck = lastCheck == null ? null : deepClone(lastCheck);
      await updateController(controller, definition, next);

      // Commit persistent state first. Instant effects such as damage are
      // irreversible, so execution failures are reported but never cause the
      // phase transition to roll back.
      if (executeInstant && stage) {
        await executeStageInstantEffectsSafely({ actor, controller, definition, state: next, stage });
      }
      return controller;
    } catch (error) {
      try {
        if (created.length > 0) await actor.deleteEmbeddedDocuments("Item", created.map((item) => item.id), { render: false });
        let restored = [];
        if (oldSources.length > 0) {
          restored = await actor.createEmbeddedDocuments("Item", oldSources, {
            renderSheet: false,
            [MODULE_ID]: { afflictionStageRollback: true }
          });
        }
        const restoredState = deepClone(previous);
        restoredState.activeStageEffectUuids = restored.map((item) => item.uuid);
        await updateController(controller, definition, restoredState);
      } catch (rollbackError) {
        console.error(`${MODULE_ID} | Affliction stage rollback failed.`, rollbackError);
      }
      throw error;
    }
  }

  async advance(controllerOrUuid, delta = 1, options = {}) {
    const controller = await this.get(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const current = Number(flags?.state?.currentStage ?? 0);
    return this.setStage(controller, current + Math.trunc(Number(delta) || 0), options);
  }

  async reapplyStage(controllerOrUuid, { enteredAt = nowWorldTime() } = {}) {
    const controller = await this.get(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    return this.setStage(controller, Number(flags?.state?.currentStage ?? 0), {
      enteredAt,
      refreshPersistent: true,
      executeInstant: true
    });
  }

  async executeStageInstant(controllerOrUuid) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    const stage = stageDescriptor(definition, state.currentStage);
    if (!stage || state.status !== "active") return [];
    return executeStageInstantEffects({ actor, controller, definition, state, stage });
  }

  async setIdentification(controllerOrUuid, identificationState, {
    identifiedBy = globalThis.game?.user?.id ?? null,
    changedAt = nowWorldTime()
  } = {}) {
    if (!IDENTIFICATION_STATES.includes(identificationState)) {
      throw new RangeError(`Unsupported identification state: ${identificationState}`);
    }
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    state.identification = {
      state: identificationState,
      identifiedAt: identificationState === "identified" ? changedAt : null,
      identifiedBy: identificationState === "identified" ? identifiedBy : null
    };
    state.revision = Number(state.revision ?? 0) + 1;
    await updateController(controller, definition, state);

    const unidentified = identificationState !== "identified";
    const stageItems = stageEffectItems(actor, state.instanceId);
    for (const item of stageItems) {
      await item.update({
        system: {
          unidentified,
          tokenIcon: { show: !unidentified }
        }
      }, { render: false });
    }
    return controller;
  }

  async end(controllerOrUuid, { reason = "ended" } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    state.status = reason === "recovered" ? "recovered" : "ended";
    state.currentStage = 0;
    state.stageEnteredAt = null;
    state.onsetStartedAt = null;
    state.nextCheckAt = null;
    state.activeStageEffectUuids = [];
    state.pendingCheck = null;
    state.onsetTargetStage = null;
    state.revision = Number(state.revision ?? 0) + 1;

    await removeStageEffects(actor, flags.state);
    // Persist the terminal state before deletion so hooks and integrations can
    // observe a coherent final controller if they listen to updateItem.
    await updateController(controller, definition, state);
    await actor.deleteEmbeddedDocuments("Item", [controller.id], {
      render: false,
      [MODULE_ID]: { afflictionControllerEnd: reason }
    });
    return true;
  }

  async cleanupDeletedController(controller) {
    if (!controller || !isAfflictionController(controller)) return false;
    const actor = controller.parent?.documentName === "Actor" ? controller.parent : null;
    const flags = getAfflictionFlags(controller);
    if (!actor || !flags?.instanceId) return false;
    const stale = stageEffectItems(actor, flags.instanceId);
    if (stale.length > 0) {
      await actor.deleteEmbeddedDocuments("Item", stale.map((item) => item.id), {
        render: false,
        [MODULE_ID]: { orphanCleanup: true }
      });
    }
    return true;
  }
}

export function createAfflictionInstanceService(options = {}) {
  return new AfflictionInstanceService(options);
}
