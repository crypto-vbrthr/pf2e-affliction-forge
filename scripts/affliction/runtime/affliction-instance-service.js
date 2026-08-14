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
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}


const RUNTIME_EVENT_LIMIT = 50;
const GENERIC_AFFLICTION_IMG = "icons/svg/biohazard.svg";

function localize(key, fallback = key) {
  const value = globalThis.game?.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function formatMessage(key, data, fallback) {
  const value = globalThis.game?.i18n?.format?.(key, data);
  if (value && value !== key) return value;
  return typeof fallback === "function" ? fallback(data) : (fallback ?? key);
}

function escapeHtml(value) {
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") return foundry.utils.escapeHTML(String(value ?? ""));
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function runtimePresentation(definitionInput, state = {}) {
  const definition = normalizeAfflictionDefinition(definitionInput);
  const identification = state.identification?.state ?? "identified";
  if (identification === "hidden") {
    return Object.freeze({
      identification,
      controllerName: localize("PF2E_AFFLICTION_FORGE.Runtime.HiddenControllerName", "Unidentified Affliction"),
      controllerImg: GENERIC_AFFLICTION_IMG,
      controllerDescription: "",
      stageEffectName: localize("PF2E_AFFLICTION_FORGE.Runtime.HiddenStageEffectName", "Unidentified Effect"),
      stageEffectImg: GENERIC_AFFLICTION_IMG,
      showControllerTokenIcon: false,
      showStageTokenIcon: false,
      hideControllerFromPlayers: true,
      hideStageEffectsFromPlayers: true
    });
  }
  if (identification === "suspected") {
    return Object.freeze({
      identification,
      controllerName: localize("PF2E_AFFLICTION_FORGE.Runtime.SuspectedControllerName", "Suspected Affliction"),
      controllerImg: GENERIC_AFFLICTION_IMG,
      controllerDescription: localize("PF2E_AFFLICTION_FORGE.Runtime.SuspectedControllerDescription", "Something is wrong, but the affliction has not been identified."),
      stageEffectName: localize("PF2E_AFFLICTION_FORGE.Runtime.SuspectedStageEffectName", "Unidentified Affliction Effect"),
      stageEffectImg: GENERIC_AFFLICTION_IMG,
      showControllerTokenIcon: true,
      showStageTokenIcon: false,
      hideControllerFromPlayers: false,
      hideStageEffectsFromPlayers: true
    });
  }
  return Object.freeze({
    identification: "identified",
    controllerName: definition.name,
    controllerImg: definition.img,
    controllerDescription: definition.description ?? "",
    stageEffectName: null,
    stageEffectImg: null,
    showControllerTokenIcon: true,
    showStageTokenIcon: true,
    hideControllerFromPlayers: false,
    hideStageEffectsFromPlayers: false
  });
}

function appendRuntimeEvent(state, event = {}) {
  state.events = Array.isArray(state.events) ? state.events : [];
  const entry = {
    id: randomId("affliction-event"),
    type: String(event.type ?? "event"),
    at: finiteTime(event.at) ?? nowWorldTime(),
    stageNumber: Number.isInteger(event.stageNumber) ? event.stageNumber : null,
    stageId: typeof event.stageId === "string" ? event.stageId : null,
    data: event.data && typeof event.data === "object" ? deepClone(event.data) : {}
  };
  state.events.push(entry);
  if (state.events.length > RUNTIME_EVENT_LIMIT) state.events.splice(0, state.events.length - RUNTIME_EVENT_LIMIT);
  return entry;
}

function stageEventData(stage) {
  return stage ? { stageName: stage.name ?? "", stageNumber: stage.number, stageId: stage.id } : {};
}

async function createRuntimeChatMessage({ actor, definition, state, stage, type, category = null }) {
  const ChatMessage = globalThis.ChatMessage;
  if (!ChatMessage?.create) return null;
  const identification = state.identification?.state ?? "identified";
  const actorName = escapeHtml(actor?.name ?? "Actor");
  const afflictionName = escapeHtml(definition.name);
  const stageName = escapeHtml(stage?.name ?? `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage", "Stage")} ${stage?.number ?? ""}`);

  let content;
  let whisper;
  if (type === "death") {
    if (identification === "identified") {
      content = `<p><strong>${actorName}</strong>: ${formatMessage("PF2E_AFFLICTION_FORGE.Runtime.DeathChatIdentified", { affliction: afflictionName, stage: stageName }, () => `${afflictionName} (${stageName}) causes death.`)}</p>`;
    } else {
      content = `<p><strong>${actorName}</strong>: ${formatMessage("PF2E_AFFLICTION_FORGE.Runtime.DeathChatHidden", { affliction: afflictionName, stage: stageName }, () => `${afflictionName} (${stageName}) caused death.`)}</p>`;
      const recipients = ChatMessage.getWhisperRecipients?.("GM") ?? [];
      whisper = recipients.map((user) => user?.id ?? user).filter(Boolean);
    }
  } else if (type === "death-resisted") {
    content = `<p><strong>${actorName}</strong>: ${formatMessage("PF2E_AFFLICTION_FORGE.Runtime.DeathResistedChat", { affliction: afflictionName, stage: stageName }, () => `A death effect from ${afflictionName} (${stageName}) was prevented by immunity.`)}</p>`;
    const recipients = ChatMessage.getWhisperRecipients?.("GM") ?? [];
    whisper = recipients.map((user) => user?.id ?? user).filter(Boolean);
  } else {
    return null;
  }

  try {
    return await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker?.({ actor }) ?? {},
      ...(whisper?.length ? { whisper } : {}),
      flags: {
        [MODULE_ID]: {
          runtimeEvent: type,
          instanceId: state.instanceId,
          stageNumber: stage?.number ?? null,
          category
        }
      }
    });
  } catch (error) {
    console.warn(`${MODULE_ID} | Runtime chat message could not be created.`, error);
    return null;
  }
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
  const presentation = runtimePresentation(definition, state);
  const unidentified = presentation.identification !== "identified";
  const flags = buildControllerFlags({
    definitionSnapshot: definition,
    instanceId: state.instanceId,
    sourceTemplateUuid,
    sourceDefinitionVersion,
    origin,
    state
  });

  return {
    name: presentation.controllerName,
    type: "effect",
    img: presentation.controllerImg,
    system: {
      description: { value: presentation.controllerDescription, gm: definition.description ?? "" },
      rules: [],
      slug: null,
      traits: { value: unidentified ? [] : [...definition.traits], otherTags: unidentified ? [] : [...definition.themes] },
      level: { value: unidentified ? 0 : definition.level },
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
      start: { value: 0, initiative: null },
      badge: null,
      tokenIcon: { show: presentation.showControllerTokenIcon },
      unidentified
    },
    flags
  };
}

function stageDescriptor(definition, stageNumber) {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) return null;
  return definition.stages?.[stageNumber - 1] ?? null;
}

function stageEffectFlags({ definition, state, stage, controllerUuid, sourceTemplateUuid, identifiedPresentation = null }) {
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
    stageNumber: stage.number,
    identifiedPresentation: identifiedPresentation ? deepClone(identifiedPresentation) : null
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
  if (state.identification?.state !== "identified") {
    const genericLabel = state.identification?.state === "suspected"
      ? localize("PF2E_AFFLICTION_FORGE.Runtime.SuspectedStageEffectName", "Unidentified Affliction Effect")
      : localize("PF2E_AFFLICTION_FORGE.Runtime.HiddenStageEffectName", "Unidentified Effect");
    runtimeEffect.name = genericLabel;
    runtimeEffect.img = GENERIC_AFFLICTION_IMG;
    runtimeEffect.description = "";
    runtimeEffect.components = (runtimeEffect.components ?? []).map((component) => {
      const next = deepClone(component);
      if (typeof next.label === "string" && next.label.trim()) next.label = genericLabel;
      return next;
    });
  }
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
  const presentation = runtimePresentation(definition, state);
  const unidentified = presentation.identification !== "identified";

  return list.filter(Boolean).map((source) => {
    const result = deepClone(source);
    const identifiedPresentation = {
      name: stage.effect?.name ?? result.name ?? stage.name ?? `${definition.name} · ${stage.number}`,
      img: stage.effect?.img ?? result.img ?? definition.img,
      description: stage.effect?.description ?? result.system?.description?.value ?? ""
    };
    result.flags ??= {};
    result.flags[MODULE_ID] = stageEffectFlags({
      definition,
      state,
      stage,
      controllerUuid: controller.uuid,
      sourceTemplateUuid,
      identifiedPresentation
    });
    result.system ??= {};
    result.system.unidentified = unidentified;
    result.system.tokenIcon ??= {};
    result.system.tokenIcon.show = presentation.showStageTokenIcon;
    if (unidentified) {
      result.name = presentation.stageEffectName;
      result.img = presentation.stageEffectImg;
      result.system.description ??= { value: "", gm: "" };
      result.system.description.value = "";
    }
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


async function recordInstantExecutionResults({ actor, controller, definition, stage, results, at = nowWorldTime() }) {
  const deathResults = (Array.isArray(results) ? results : []).filter((result) => result?.kind === "death");
  if (deathResults.length === 0) return controller;

  const flags = getAfflictionFlags(controller);
  const state = deepClone(flags?.state ?? {});
  let changed = false;
  for (const result of deathResults) {
    const category = result.category === "death-effect" ? "death-effect" : "direct";
    if (result.applied === true) {
      state.mortality = {
        dead: true,
        at: finiteTime(at) ?? nowWorldTime(),
        stageNumber: stage?.number ?? state.currentStage ?? null,
        stageId: stage?.id ?? null,
        category,
        afflictionName: definition.name,
        stageName: stage?.name ?? ""
      };
      appendRuntimeEvent(state, {
        type: "death",
        at,
        stageNumber: stage?.number ?? null,
        stageId: stage?.id ?? null,
        data: { category, ...stageEventData(stage) }
      });
      await createRuntimeChatMessage({ actor, definition, state, stage, type: "death", category });
      globalThis.Hooks?.callAll?.("pf2eAfflictionForgeDeath", {
        controllerUuid: controller.uuid,
        actorUuid: actor.uuid,
        instanceId: state.instanceId,
        category,
        stageNumber: stage?.number ?? null,
        stageId: stage?.id ?? null
      });
      changed = true;
    } else if (result.immune === true) {
      appendRuntimeEvent(state, {
        type: "death-resisted",
        at,
        stageNumber: stage?.number ?? null,
        stageId: stage?.id ?? null,
        data: { category, ...stageEventData(stage) }
      });
      await createRuntimeChatMessage({ actor, definition, state, stage, type: "death-resisted", category });
      changed = true;
    }
  }

  if (changed) {
    state.revision = Number(state.revision ?? 0) + 1;
    await updateController(controller, definition, state);
  }
  return controller;
}

async function recordInstantExecutionResultsSafely(context) {
  try {
    return await recordInstantExecutionResults(context);
  } catch (error) {
    console.error(`${MODULE_ID} | Affliction instant-result audit logging failed.`, error);
    globalThis.Hooks?.callAll?.("pf2eAfflictionForgeRuntimeAuditFailed", {
      controllerUuid: context?.controller?.uuid ?? null,
      stageNumber: context?.stage?.number ?? null,
      error
    });
    return context?.controller ?? null;
  }
}

function stageEffectItems(actor, instanceId) {
  return itemCollection(actor).filter((item) => {
    const flags = getAfflictionFlags(item);
    return isAfflictionStageEffect(item) && flags?.instanceId === instanceId;
  });
}

function runtimeActorCollection() {
  const actors = new Map();
  const add = (actor) => {
    if (!actor || actor.documentName !== "Actor") return;
    const key = actor.uuid ?? `Actor.${actor.id ?? actors.size}`;
    if (!actors.has(key)) actors.set(key, actor);
  };

  const collect = (collection) => {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection.contents)) return collection.contents;
    try { return [...collection]; } catch { return []; }
  };

  for (const actor of collect(globalThis.game?.actors)) add(actor);
  for (const scene of collect(globalThis.game?.scenes)) {
    for (const token of collect(scene?.tokens)) add(token?.actor ?? token?.document?.actor ?? null);
  }
  return [...actors.values()];
}

function stageEffectMatchesController(item, controller, state, stage) {
  const flags = getAfflictionFlags(item);
  if (!flags || !stage) return false;
  return flags.instanceId === state.instanceId
    && flags.controllerUuid === controller.uuid
    && flags.stageId === stage.id
    && Number(flags.stageNumber) === Number(stage.number);
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
  // Maximum active duration begins once, when the first effective stage becomes active.
  // Later stage changes and same-stage renewals must never reset this clock.
  if (stageNumber > 0) next.activeStartedAt = finiteTime(previous.activeStartedAt) ?? enteredAt;
  else next.activeStartedAt = finiteTime(previous.activeStartedAt);
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
  const presentation = runtimePresentation(definition, state);
  const unidentified = presentation.identification !== "identified";
  await controller.update({
    name: presentation.controllerName,
    img: presentation.controllerImg,
    system: {
      description: { value: presentation.controllerDescription, gm: definition.description ?? "" },
      traits: { value: unidentified ? [] : [...definition.traits], otherTags: unidentified ? [] : [...definition.themes] },
      level: { value: unidentified ? 0 : definition.level },
      unidentified,
      tokenIcon: { show: presentation.showControllerTokenIcon }
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
  #mutationQueues = new Map();

  constructor({ effectValidator = null } = {}) {
    this.effectValidator = effectValidator;
  }

  #mutationKey(controllerOrUuid) {
    if (typeof controllerOrUuid === "string" && controllerOrUuid) return controllerOrUuid;
    return controllerOrUuid?.uuid ?? controllerOrUuid?.id ?? "__global__";
  }

  #serializeMutation(controllerOrUuid, task) {
    const key = this.#mutationKey(controllerOrUuid);
    const previous = this.#mutationQueues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.then(() => undefined, () => undefined);
    this.#mutationQueues.set(key, tail);
    void tail.then(() => {
      if (this.#mutationQueues.get(key) === tail) this.#mutationQueues.delete(key);
    });
    return run;
  }

  async get(controllerOrUuid) {
    return (await resolveController(controllerOrUuid)).controller;
  }

  inspect(controller) {
    if (!isAfflictionController(controller)) return null;
    return descriptor(controller);
  }

  async presentation(controllerOrUuid) {
    const controller = await this.get(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    return runtimePresentation(flags.definitionSnapshot, flags.state ?? {});
  }

  async events(controllerOrUuid) {
    const controller = await this.get(controllerOrUuid);
    const state = getAfflictionFlags(controller)?.state ?? {};
    return deepClone(Array.isArray(state.events) ? state.events : []);
  }

  async listForActor(actorOrUuid) {
    const actor = await resolveAfflictionActor(actorOrUuid);
    if (!actor) throw new TypeError("Actor not found.");
    return itemCollection(actor).filter(isAfflictionController).map(descriptor);
  }

  async listAll() {
    // World actors are not the whole runtime. Unlinked token actors can carry
    // embedded controllers too and must appear in the Active Afflictions view.
    return runtimeActorCollection()
      .flatMap((actor) => itemCollection(actor).filter(isAfflictionController).map(descriptor));
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
          activeStartedAt: initialStage > 0 ? appliedAt : null,
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
        appendRuntimeEvent(state, { type: "applied", at: appliedAt });
        if (initialStage > 0) {
          const firstStage = stageDescriptor(definition, initialStage);
          appendRuntimeEvent(state, {
            type: "stage-entered",
            at: appliedAt,
            stageNumber: initialStage,
            stageId: firstStage?.id ?? null,
            data: stageEventData(firstStage)
          });
        } else if (initialStatus === "incubating") {
          appendRuntimeEvent(state, { type: "onset-started", at: appliedAt });
        }
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
          }
          controllers.push(controller);
        } catch (error) {
          try { await removeStageEffects(actor, state); } catch { /* best effort */ }
          try { await actor.deleteEmbeddedDocuments("Item", [controller.id], { render: false }); } catch { /* best effort */ }
          throw error;
        }
      }

      // Only after every target has a valid controller and persistent stage
      // output do we execute irreversible stage-entry mechanics such as damage
      // or death. This preserves structural multi-target rollback: a later Actor
      // creation failure can never leave an earlier Actor damaged by an
      // application whose controller was subsequently rolled back.
      for (const controller of controllers) {
        const actor = controller.parent;
        const state = deepClone(getAfflictionFlags(controller)?.state ?? {});
        if (state.currentStage <= 0) continue;
        const stage = stageDescriptor(definition, state.currentStage);
        const instantResults = await executeStageInstantEffectsSafely({ actor, controller, definition, state, stage });
        await recordInstantExecutionResultsSafely({ actor, controller, definition, state, stage, results: instantResults, at: appliedAt });
      }
      return controllers;
    } catch (error) {
      // Persistent/controller creation is rollback-safe because irreversible
      // instant stage mechanics are deferred until all targets commit.
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

  async beginOnset(controllerOrUuid, targetStage = 1, options = {}) {
    return this.#serializeMutation(controllerOrUuid, () => this.#beginOnsetUnlocked(controllerOrUuid, targetStage, options));
  }

  async #beginOnsetUnlocked(controllerOrUuid, targetStage = 1, { startedAt = nowWorldTime(), lastCheck = null } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    if (!definition.onset) return this.#setStageUnlocked(controller, targetStage, { enteredAt: startedAt });
    const state = deepClone(flags.state);
    await removeStageEffects(actor, state);
    state.status = "incubating";
    state.currentStage = 0;
    state.stageEnteredAt = null;
    state.activeStartedAt = null;
    state.onsetStartedAt = startedAt;
    state.nextCheckAt = dueAt(definition.onset, startedAt);
    state.activeStageEffectUuids = [];
    state.pendingCheck = null;
    state.onsetTargetStage = Math.max(1, Math.min(definition.stages.length, Math.trunc(Number(targetStage) || 1)));
    state.lastCheck = lastCheck == null ? state.lastCheck ?? null : deepClone(lastCheck);
    appendRuntimeEvent(state, {
      type: "onset-started",
      at: startedAt,
      data: { targetStage: state.onsetTargetStage }
    });
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

  async setStage(controllerOrUuid, requestedStage, options = {}) {
    return this.#serializeMutation(controllerOrUuid, () => this.#setStageUnlocked(controllerOrUuid, requestedStage, options));
  }

  async #setStageUnlocked(controllerOrUuid, requestedStage, {
    enteredAt = nowWorldTime(),
    lastCheck = undefined,
    refreshPersistent = false,
    executeInstant = true
  } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    let previous = deepClone(flags.state);
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
      // Runtime drift can survive a crash or manual document edit even when no
      // delete hook was able to repair it. Reconcile persistent output before a
      // same-stage renewal so a successful save never perpetuates a missing
      // condition/modifier. Instant mechanics are not executed by reconciliation.
      await this.reconcile(controller, { recordEvent: true });
      previous = deepClone(getAfflictionFlags(controller)?.state ?? previous);
      const next = buildTransitionState(
        previous,
        definition,
        stageNumber,
        enteredAt,
        previous.activeStageEffectUuids ?? []
      );
      if (lastCheck !== undefined) next.lastCheck = lastCheck == null ? null : deepClone(lastCheck);
      appendRuntimeEvent(next, {
        type: "stage-renewed",
        at: enteredAt,
        stageNumber,
        stageId: stage?.id ?? null,
        data: stageEventData(stage)
      });
      await updateController(controller, definition, next);
      if (executeInstant && stage) {
        const instantResults = await executeStageInstantEffectsSafely({ actor, controller, definition, state: next, stage });
        await recordInstantExecutionResultsSafely({ actor, controller, definition, state: next, stage, results: instantResults, at: enteredAt });
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
      appendRuntimeEvent(next, {
        type: refreshPersistent && previous.currentStage === stageNumber ? "stage-reapplied" : (stageNumber > 0 ? "stage-entered" : "stage-cleared"),
        at: enteredAt,
        stageNumber: stageNumber > 0 ? stageNumber : null,
        stageId: stage?.id ?? null,
        data: { fromStage: previous.currentStage ?? 0, ...stageEventData(stage) }
      });
      await updateController(controller, definition, next);

      // Commit persistent state first. Instant effects such as damage are
      // irreversible, so execution failures are reported but never cause the
      // phase transition to roll back.
      if (executeInstant && stage) {
        const instantResults = await executeStageInstantEffectsSafely({ actor, controller, definition, state: next, stage });
        await recordInstantExecutionResultsSafely({ actor, controller, definition, state: next, stage, results: instantResults, at: enteredAt });
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
    return this.#serializeMutation(controllerOrUuid, () => this.#executeStageInstantUnlocked(controllerOrUuid));
  }

  async #executeStageInstantUnlocked(controllerOrUuid) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    const stage = stageDescriptor(definition, state.currentStage);
    if (!stage || state.status !== "active") return [];
    const results = await executeStageInstantEffects({ actor, controller, definition, state, stage });
    await recordInstantExecutionResultsSafely({ actor, controller, definition, state, stage, results, at: nowWorldTime() });
    return results;
  }

  async setIdentification(controllerOrUuid, identificationState, options = {}) {
    return this.#serializeMutation(controllerOrUuid, () => this.#setIdentificationUnlocked(controllerOrUuid, identificationState, options));
  }

  async #setIdentificationUnlocked(controllerOrUuid, identificationState, {
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
    const previousIdentification = state.identification?.state ?? "identified";
    state.identification = {
      state: identificationState,
      identifiedAt: identificationState === "identified" ? changedAt : null,
      identifiedBy: identificationState === "identified" ? identifiedBy : null
    };
    appendRuntimeEvent(state, {
      type: "identification-changed",
      at: changedAt,
      stageNumber: state.currentStage > 0 ? state.currentStage : null,
      data: { from: previousIdentification, to: identificationState, identifiedBy }
    });
    state.revision = Number(state.revision ?? 0) + 1;
    await updateController(controller, definition, state);

    const presentation = runtimePresentation(definition, state);
    const unidentified = identificationState !== "identified";
    const stageItems = stageEffectItems(actor, state.instanceId);
    for (const item of stageItems) {
      const itemFlags = getAfflictionFlags(item) ?? {};
      const identifiedPresentation = itemFlags.identifiedPresentation ?? {};
      await item.update({
        name: unidentified ? presentation.stageEffectName : (identifiedPresentation.name ?? item.name),
        img: unidentified ? presentation.stageEffectImg : (identifiedPresentation.img ?? item.img),
        system: {
          description: {
            value: unidentified ? "" : (identifiedPresentation.description ?? item.system?.description?.value ?? ""),
            gm: item.system?.description?.gm ?? ""
          },
          unidentified,
          tokenIcon: { show: presentation.showStageTokenIcon }
        }
      }, { render: false });
    }
    return controller;
  }

  async end(controllerOrUuid, options = {}) {
    return this.#serializeMutation(controllerOrUuid, () => this.#endUnlocked(controllerOrUuid, options));
  }

  async #endUnlocked(controllerOrUuid, { reason = "ended" } = {}) {
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
    appendRuntimeEvent(state, {
      type: reason === "recovered" ? "recovered" : "ended",
      at: nowWorldTime(),
      data: { reason }
    });
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

  async reconcile(controllerOrUuid, { cleanupOrphans = true, recordEvent = true, _attempt = 0 } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    const snapshot = {
      revision: Number(state.revision ?? 0),
      status: state.status,
      currentStage: Number(state.currentStage ?? 0),
      instanceId: state.instanceId
    };
    const stillCurrent = async () => {
      const refreshed = await this.get(controller.uuid).catch(() => null);
      const latest = getAfflictionFlags(refreshed)?.state ?? null;
      if (!latest) return { current: false, controller: refreshed };
      return {
        current: Number(latest.revision ?? 0) === snapshot.revision
          && latest.status === snapshot.status
          && Number(latest.currentStage ?? 0) === snapshot.currentStage
          && latest.instanceId === snapshot.instanceId,
        controller: refreshed
      };
    };
    const stage = state.status === "active" && Number(state.currentStage) > 0
      ? stageDescriptor(definition, Number(state.currentStage))
      : null;

    const currentItems = stageEffectItems(actor, state.instanceId);
    const expectedSources = stage
      ? await buildStageEffectSources({ actor, controller, definition, state, stage })
      : [];
    const matching = stage
      ? currentItems.filter((item) => stageEffectMatchesController(item, controller, state, stage))
      : [];
    const stale = currentItems.filter((item) => !matching.includes(item));

    const beforeMutation = await stillCurrent();
    if (!beforeMutation.current) {
      if (beforeMutation.controller && _attempt < 2) {
        return this.reconcile(beforeMutation.controller, { cleanupOrphans, recordEvent, _attempt: _attempt + 1 });
      }
      return Object.freeze({
        controllerUuid: controller.uuid,
        actorUuid: actor.uuid,
        repaired: false,
        stale: true,
        deleted: 0,
        created: 0,
        expected: expectedSources.length,
        active: 0
      });
    }

    let deleted = 0;
    let created = [];
    let repaired = false;

    // Generated stage Items are controller-owned output. If the active stage no
    // longer matches the generated Items, rebuild only persistent output. Instant
    // mechanics are deliberately NOT executed during reconciliation.
    const outputMismatch = matching.length !== expectedSources.length || stale.length > 0;
    if (outputMismatch) {
      const ids = currentItems.map((item) => item.id).filter(Boolean);
      if (ids.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", ids, {
          render: false,
          [MODULE_ID]: { afflictionReconcile: true }
        });
        deleted += ids.length;
      }
      if (expectedSources.length > 0) {
        created = await actor.createEmbeddedDocuments("Item", expectedSources, {
          renderSheet: false,
          [MODULE_ID]: { afflictionReconcile: true }
        });
      }
      repaired = true;
    }

    const afterMutation = await stillCurrent();
    if (!afterMutation.current) {
      // Another transition won the race while reconciliation was rebuilding
      // persistent output. Remove only the Items created by this stale pass and
      // retry against the current controller state. Never execute instant output.
      if (created.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", created.map((item) => item.id).filter(Boolean), {
          render: false,
          [MODULE_ID]: { afflictionReconcile: true, staleReconcileCleanup: true }
        });
      }
      if (afterMutation.controller && _attempt < 2) {
        return this.reconcile(afterMutation.controller, { cleanupOrphans, recordEvent, _attempt: _attempt + 1 });
      }
      return Object.freeze({
        controllerUuid: controller.uuid,
        actorUuid: actor.uuid,
        repaired: false,
        stale: true,
        deleted,
        created: 0,
        expected: expectedSources.length,
        active: 0
      });
    }

    const actual = outputMismatch ? created : matching;
    const actualUuids = actual.map((item) => item.uuid).filter(Boolean);
    const storedUuids = Array.isArray(state.activeStageEffectUuids) ? state.activeStageEffectUuids : [];
    const uuidMismatch = storedUuids.length !== actualUuids.length
      || storedUuids.some((uuid, index) => uuid !== actualUuids[index]);

    if (uuidMismatch || repaired) {
      state.activeStageEffectUuids = actualUuids;
      if (recordEvent && repaired) {
        appendRuntimeEvent(state, {
          type: "runtime-reconciled",
          at: nowWorldTime(),
          stageNumber: stage?.number ?? null,
          stageId: stage?.id ?? null,
          data: { deleted, created: created.length }
        });
      }
      state.revision = Number(state.revision ?? 0) + 1;
      await updateController(controller, definition, state);
    }

    return Object.freeze({
      controllerUuid: controller.uuid,
      actorUuid: actor.uuid,
      repaired,
      deleted,
      created: created.length,
      expected: expectedSources.length,
      active: actualUuids.length
    });
  }

  async reconcileActor(actorOrUuid, { cleanupOrphans = true } = {}) {
    const actor = await resolveAfflictionActor(actorOrUuid);
    if (!actor) throw new TypeError("Actor not found.");
    const controllers = itemCollection(actor).filter(isAfflictionController);
    const reports = [];
    const errors = [];
    for (const controller of controllers) {
      try {
        reports.push(await this.reconcile(controller, { cleanupOrphans: false }));
      } catch (error) {
        // One corrupt/legacy controller must not prevent healthy Afflictions on
        // the same Actor from reconciling during world startup. Preserve its
        // generated output and report the failure for diagnostics instead.
        console.warn(`${MODULE_ID} | Affliction controller reconciliation failed.`, {
          controllerUuid: controller.uuid,
          error
        });
        errors.push(Object.freeze({
          controllerUuid: controller.uuid,
          message: error?.message ?? String(error)
        }));
      }
    }

    let orphaned = 0;
    if (cleanupOrphans) {
      const instanceIds = new Set(controllers.map((controller) => getAfflictionFlags(controller)?.instanceId).filter(Boolean));
      const orphans = itemCollection(actor).filter((item) => {
        if (!isAfflictionStageEffect(item)) return false;
        const flags = getAfflictionFlags(item);
        return !flags?.instanceId || !instanceIds.has(flags.instanceId);
      });
      if (orphans.length > 0) {
        try {
          await actor.deleteEmbeddedDocuments("Item", orphans.map((item) => item.id), {
            render: false,
            [MODULE_ID]: { orphanCleanup: true, afflictionReconcile: true }
          });
          orphaned = orphans.length;
        } catch (error) {
          console.warn(`${MODULE_ID} | Affliction orphan cleanup failed.`, { actorUuid: actor.uuid, error });
          errors.push(Object.freeze({
            controllerUuid: null,
            message: error?.message ?? String(error),
            kind: "orphan-cleanup"
          }));
        }
      }
    }

    return Object.freeze({ actorUuid: actor.uuid, controllers: reports, orphaned, errors: Object.freeze(errors) });
  }

  async reconcileAll({ cleanupOrphans = true } = {}) {
    const reports = [];
    for (const actor of runtimeActorCollection()) {
      const hasRuntime = itemCollection(actor).some((item) => isAfflictionController(item) || isAfflictionStageEffect(item));
      if (!hasRuntime) continue;
      try {
        reports.push(await this.reconcileActor(actor, { cleanupOrphans }));
      } catch (error) {
        // Runtime recovery is best-effort across the whole world. A broken
        // synthetic Actor or document collection must not abort reconciliation
        // for every later Actor or prevent the scheduler from starting.
        console.warn(`${MODULE_ID} | Affliction Actor reconciliation failed.`, { actorUuid: actor.uuid, error });
        reports.push(Object.freeze({
          actorUuid: actor.uuid,
          controllers: Object.freeze([]),
          orphaned: 0,
          errors: Object.freeze([{ controllerUuid: null, message: error?.message ?? String(error), kind: "actor" }])
        }));
      }
    }
    return Object.freeze(reports);
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
