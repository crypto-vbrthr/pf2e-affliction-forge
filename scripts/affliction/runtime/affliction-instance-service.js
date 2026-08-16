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
  isAfflictionResidualEffect,
  isAfflictionStageEffect,
  isAfflictionTemplate
} from "../documents/affliction-flags.js";
import { normalizeAfflictionDefinition, resolveAfflictionRestrictions, resolveStageComponentPersistence, resolveStageComponentPersistenceDuration } from "../schema/affliction-normalizer.js";
import { assertValidAfflictionDefinition } from "../schema/affliction-validator.js";
import { deepClone, randomId } from "../schema/utils.js";
import {
  createAfflictionControllerState,
  validateAfflictionControllerState
} from "./controller-state.js";
import { withAfflictionRestrictionBypass } from "./affliction-restriction-runtime.js";

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
  if (String(duration.formula ?? "").trim()) return null;
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

function unitToWorldSeconds(value, unit) {
  return durationToWorldSeconds({ value, unit });
}

async function evaluateDurationFormula(formula, { label = "Affliction duration" } = {}) {
  const RollClass = globalThis.Roll;
  if (!RollClass) throw new Error(`Foundry Roll API is unavailable for ${label}.`);
  const roll = typeof RollClass.create === "function" ? RollClass.create(formula) : new RollClass(formula);
  const evaluated = await roll.evaluate?.({ async: true }) ?? roll;
  const total = Number(evaluated?.total ?? roll?.total);
  if (!Number.isFinite(total) || total <= 0) throw new Error(`${label} formula must resolve to a positive number: ${formula}`);
  return total;
}

export async function resolvedDurationToWorldSeconds(duration, { label = "Affliction duration" } = {}) {
  if (!duration || duration.unit === "unlimited") return null;
  const formula = String(duration.formula ?? "").trim();
  if (formula) {
    const value = await evaluateDurationFormula(formula, { label });
    return unitToWorldSeconds(value, duration.unit);
  }
  return durationToWorldSeconds(duration);
}

async function resolvedDueAt(duration, enteredAt, options = {}) {
  const seconds = await resolvedDurationToWorldSeconds(duration, options);
  return seconds == null || !Number.isFinite(enteredAt) ? null : enteredAt + seconds;
}

export async function periodicIntervalToWorldSeconds(interval) {
  return resolvedDurationToWorldSeconds(interval, { label: "Periodic Affliction interval" });
}

async function buildPeriodicSchedule(stage, enteredAt, previousSchedule = null, { preserve = false } = {}) {
  const schedule = {};
  const source = previousSchedule && typeof previousSchedule === "object" && !Array.isArray(previousSchedule) ? previousSchedule : {};
  for (const periodic of stage?.periodicEffects ?? []) {
    const existing = source[periodic.id];
    if (preserve && Number.isFinite(Number(existing?.nextAt))) {
      schedule[periodic.id] = deepClone(existing);
      continue;
    }
    const seconds = await periodicIntervalToWorldSeconds(periodic.interval);
    schedule[periodic.id] = {
      nextAt: seconds == null || !Number.isFinite(enteredAt) ? null : enteredAt + seconds,
      lastAt: null,
      sequence: 0,
      lastIntervalSeconds: seconds
    };
  }
  return schedule;
}

export function scheduledPeriodicEvent(definitionInput, state = {}) {
  const definition = normalizeAfflictionDefinition(definitionInput);
  if (state.status !== "active" || Number(state.currentStage) < 1) return null;
  const stage = stageDescriptor(definition, Number(state.currentStage));
  if (!stage || (stage.periodicEffects?.length ?? 0) === 0) return null;
  const activeIds = new Set(stage.periodicEffects.map((entry) => entry.id));
  const candidates = Object.entries(state.periodicSchedule ?? {})
    .filter(([id]) => activeIds.has(id))
    .map(([id, entry]) => ({ periodicId: id, dueAt: finiteTime(entry?.nextAt) }))
    .filter((entry) => entry.dueAt != null)
    .sort((a, b) => a.dueAt - b.dueAt || a.periodicId.localeCompare(b.periodicId));
  return candidates[0] ?? null;
}

export function scheduledPeriodicDueAt(definitionInput, state = {}) {
  return scheduledPeriodicEvent(definitionInput, state)?.dueAt ?? null;
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

function cleanDescription(value) {
  return String(value ?? "").trim();
}

function joinUniqueDescriptions(...values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const text = cleanDescription(value);
    if (!text) continue;
    const key = text.replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output.join("\n\n");
}

function descriptionFields(value, gm = "") {
  const publicDescription = cleanDescription(value);
  const gmDescription = cleanDescription(gm);
  return {
    value: publicDescription,
    gm: gmDescription && gmDescription !== publicDescription ? gmDescription : ""
  };
}

function controllerDescriptionFields(definition, presentation) {
  return descriptionFields(presentation.controllerDescription, definition.description ?? "");
}

function stageItemDescription(stage, existing = "") {
  return joinUniqueDescriptions(stage?.description ?? "", stage?.effect?.description ?? "", existing);
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

function gmWhisperIds() {
  const ChatMessage = globalThis.ChatMessage;
  const recipients = ChatMessage?.getWhisperRecipients?.("GM") ?? [];
  const ids = recipients.map((user) => user?.id ?? user).filter(Boolean);
  if (ids.length > 0) return ids;
  const users = [...(globalThis.game?.users ?? [])];
  const gmIds = users.filter((user) => user?.isGM).map((user) => user.id).filter(Boolean);
  if (gmIds.length > 0) return gmIds;
  return globalThis.game?.user?.isGM && globalThis.game.user.id ? [globalThis.game.user.id] : [];
}

function afflictionChatReference(controller, definition) {
  const templateUuid = String(getAfflictionFlags(controller)?.sourceTemplateUuid ?? "").trim();
  return templateUuid
    ? `@Affliction[${templateUuid}]`
    : `<strong>${escapeHtml(definition?.name ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction", "Affliction"))}</strong>`;
}

async function createRuntimeChatMessage({
  actor,
  controller = null,
  definition,
  state,
  stage,
  type,
  category = null,
  fromStage = null,
  reason = null
}) {
  const ChatMessage = globalThis.ChatMessage;
  if (!ChatMessage?.create) return null;
  const identification = state.identification?.state ?? "identified";
  const actorName = escapeHtml(actor?.name ?? "Actor");
  const afflictionName = escapeHtml(definition.name);
  const afflictionRef = afflictionChatReference(controller, definition);
  const stageName = escapeHtml(stage?.name ?? `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage", "Stage")} ${stage?.number ?? ""}`);

  let content;
  let whisper;
  if (type === "death") {
    const key = identification === "identified"
      ? "PF2E_AFFLICTION_FORGE.Runtime.DeathChatIdentified"
      : "PF2E_AFFLICTION_FORGE.Runtime.DeathChatHidden";
    content = `<p><strong>${actorName}</strong>: ${formatMessage(key, { affliction: afflictionRef, stage: stageName }, () => `${afflictionRef} (${stageName}) caused death.`)}</p>`;
    // Lifecycle reporting is a GM audit channel. Keep death notifications on the
    // same privacy contract as stage changes, recovery, and expiry even when the
    // Affliction itself has already been identified.
    whisper = gmWhisperIds();
  } else if (type === "death-resisted") {
    content = `<p><strong>${actorName}</strong>: ${formatMessage("PF2E_AFFLICTION_FORGE.Runtime.DeathResistedChat", { affliction: afflictionName, stage: stageName }, () => `A death effect from ${afflictionName} (${stageName}) was prevented by immunity.`)}</p>`;
    whisper = gmWhisperIds();
  } else if (type === "stage-changed") {
    const toStage = Number(stage?.number ?? state.currentStage ?? 0);
    const from = Number(fromStage ?? 0);
    const key = from > 0
      ? "PF2E_AFFLICTION_FORGE.Runtime.StageChangedGmChat"
      : "PF2E_AFFLICTION_FORGE.Runtime.StageEnteredGmChat";
    const text = formatMessage(key, {
      actor: actorName,
      affliction: afflictionRef,
      from,
      to: toStage,
      stage: stageName
    }, () => from > 0
      ? `${actorName}: ${afflictionRef} changes from stage ${from} to stage ${toStage} (${stageName}).`
      : `${actorName}: ${afflictionRef} enters stage ${toStage} (${stageName}).`);
    content = `<p><i class="fa-solid fa-biohazard"></i> ${text}</p>`;
    whisper = gmWhisperIds();
  } else if (type === "recovered") {
    const text = formatMessage("PF2E_AFFLICTION_FORGE.Runtime.RecoveredGmChat", {
      actor: actorName,
      affliction: afflictionRef
    }, () => `${actorName} has recovered from ${afflictionRef}.`);
    content = `<p><i class="fa-solid fa-heart-pulse"></i> ${text}</p>`;
    whisper = gmWhisperIds();
  } else if (type === "maximum-duration") {
    const text = formatMessage("PF2E_AFFLICTION_FORGE.Runtime.MaximumDurationGmChat", {
      actor: actorName,
      affliction: afflictionRef
    }, () => `${afflictionRef} on ${actorName} ends when its maximum duration expires.`);
    content = `<p><i class="fa-solid fa-hourglass-end"></i> ${text}</p>`;
    whisper = gmWhisperIds();
  } else if (type === "ended") {
    const text = formatMessage("PF2E_AFFLICTION_FORGE.Runtime.EndedGmChat", {
      actor: actorName,
      affliction: afflictionRef
    }, () => `${afflictionRef} on ${actorName} has ended.`);
    content = `<p><i class="fa-solid fa-circle-stop"></i> ${text}</p>`;
    whisper = gmWhisperIds();
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
          controllerUuid: controller?.uuid ?? null,
          sourceTemplateUuid: getAfflictionFlags(controller)?.sourceTemplateUuid ?? null,
          stageNumber: stage?.number ?? null,
          fromStage: Number.isFinite(Number(fromStage)) ? Number(fromStage) : null,
          category,
          reason
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
    // Formula durations are rolled once when onset begins and persisted as the
    // next-check clock. They cannot be reconstructed synchronously later.
    if (String(definition.onset?.formula ?? "").trim()) return stored;
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
    if (String(stage?.duration?.formula ?? "").trim()) return stored;
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
      description: controllerDescriptionFields(definition, presentation),
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

function stageEffectFlags({ definition, state, stage, controllerUuid, sourceTemplateUuid, identifiedPresentation = null, effectPersistence = null, effectPersistenceDuration = null, componentIndices = [], nativeKind = null }) {
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
    effectPersistence: effectPersistence ?? stage.effectPersistence ?? "stage",
    effectPersistenceDuration: effectPersistenceDuration == null ? null : deepClone(effectPersistenceDuration),
    componentIndices: Array.isArray(componentIndices) ? [...componentIndices] : [],
    nativeKind,
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

async function buildCriticalStageEffectSources({ actor, controller, definition, state, stage }) {
  const runtimeEffect = buildRuntimeStageEffectDefinition(stage, state);
  if (!runtimeEffect) return [];
  const criticalApi = getCriticalForgeApi({ required: true });
  if (typeof criticalApi.effects?.toItemSources !== "function") {
    throw new Error("Critical Forge Effect source API is unavailable.");
  }

  const components = Array.isArray(runtimeEffect.components) ? runtimeEffect.components : [];
  const grouped = new Map();
  for (const [index, component] of components.entries()) {
    const persistence = resolveStageComponentPersistence(stage, index);
    const persistenceDuration = resolveStageComponentPersistenceDuration(stage, index);
    const key = `${persistence}:${JSON.stringify(persistenceDuration ?? null)}`;
    const entry = grouped.get(key) ?? { persistence, persistenceDuration, indices: [], components: [] };
    entry.indices.push(index);
    entry.components.push(component);
    grouped.set(key, entry);
  }

  const sourceTemplateUuid = getAfflictionFlags(controller)?.sourceTemplateUuid ?? null;
  const presentation = runtimePresentation(definition, state);
  const unidentified = presentation.identification !== "identified";
  const output = [];

  for (const group of grouped.values()) {
    const groupedEffect = deepClone(runtimeEffect);
    groupedEffect.components = deepClone(group.components);
    if (grouped.size > 1) groupedEffect.id = `${runtimeEffect.id}.p-${group.persistence}-${output.length + 1}`;
    const sources = await criticalApi.effects.toItemSources(groupedEffect, {
      actor,
      target: actor,
      source: controller
    });
    const list = Array.isArray(sources) ? sources : [sources];
    for (const source of list.filter(Boolean)) {
      const result = deepClone(source);
      const generatedDescription = result.system?.description?.value ?? "";
      const stageDescription = stageItemDescription(stage, generatedDescription);
      const identifiedPresentation = {
        name: stage.effect?.name ?? result.name ?? stage.name ?? `${definition.name} · ${stage.number}`,
        img: stage.effect?.img ?? result.img ?? definition.img,
        description: stageDescription
      };
      result.flags ??= {};
      result.flags[MODULE_ID] = stageEffectFlags({
        definition,
        state,
        stage,
        controllerUuid: controller.uuid,
        sourceTemplateUuid,
        identifiedPresentation,
        effectPersistence: group.persistence,
        effectPersistenceDuration: group.persistenceDuration,
        componentIndices: group.indices
      });
      result.system ??= {};
      const generatedGmDescription = result.system?.description?.gm ?? "";
      result.system.description = unidentified
        ? descriptionFields("", joinUniqueDescriptions(stageDescription, generatedGmDescription))
        : descriptionFields(stageDescription, generatedGmDescription);
      result.system.unidentified = unidentified;
      result.system.tokenIcon ??= {};
      result.system.tokenIcon.show = presentation.showStageTokenIcon;
      if (unidentified) {
        result.name = presentation.stageEffectName;
        result.img = presentation.stageEffectImg;
      }
      output.push(result);
    }
  }

  return output;
}

function buildNumericModifierStageSource({ controller, definition, state, stage }) {
  const modifiers = Array.isArray(stage?.numericModifiers) ? stage.numericModifiers : [];
  if (modifiers.length === 0) return null;
  const presentation = runtimePresentation(definition, state);
  const unidentified = presentation.identification !== "identified";
  const stageLabel = stage.name || `Stage ${stage.number}`;
  const name = unidentified ? presentation.stageEffectName : `${definition.name} · ${stageLabel}`;
  const rules = modifiers.map((modifier, index) => ({
    key: "FlatModifier",
    selector: modifier.selectors.length === 1 ? modifier.selectors[0] : [...modifier.selectors],
    type: modifier.type ?? "untyped",
    value: Number(modifier.value),
    slug: `affliction-${state.instanceId}-${stage.id}-${modifier.id || index + 1}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
    label: modifier.label || name
  }));
  const sourceTemplateUuid = getAfflictionFlags(controller)?.sourceTemplateUuid ?? null;
  return {
    name,
    type: "effect",
    img: unidentified ? presentation.stageEffectImg : definition.img,
    system: {
      description: unidentified
        ? descriptionFields("", stage.description ?? "")
        : descriptionFields(stage.description ?? "", ""),
      rules,
      slug: null,
      traits: { value: unidentified ? [] : [...definition.traits], otherTags: unidentified ? [] : [...definition.themes] },
      level: { value: unidentified ? 0 : definition.level },
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
      start: { value: 0, initiative: null },
      badge: null,
      tokenIcon: { show: presentation.showStageTokenIcon },
      unidentified
    },
    flags: {
      [MODULE_ID]: stageEffectFlags({
        definition,
        state,
        stage,
        controllerUuid: controller.uuid,
        sourceTemplateUuid,
        effectPersistence: "stage",
        nativeKind: "numeric-modifiers",
        identifiedPresentation: { name: `${definition.name} · ${stageLabel}`, img: definition.img, description: stage.description ?? "" }
      })
    }
  };
}

async function buildStageEffectSources(context) {
  const sources = await buildCriticalStageEffectSources(context);
  const numeric = buildNumericModifierStageSource(context);
  if (numeric) sources.push(numeric);
  return sources;
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

function actorHitPoints(actor) {
  const value = Number(actor?.system?.attributes?.hp?.value);
  return Number.isFinite(value) ? value : null;
}

async function executeStageInstantEffectsSafely(context) {
  try {
    return await executeStageInstantEffects(context);
  } catch (error) {
    notifyInstantExecutionFailure({ ...context, error });
    return [];
  }
}


function buildRuntimePeriodicEffectDefinition(periodic, definition, stage, state) {
  if (!periodic?.effect) return null;
  const runtimeEffect = deepClone(periodic.effect);
  const sourceEffectDefinitionId = runtimeEffect.id;
  runtimeEffect.id = `${sourceEffectDefinitionId}.${state.instanceId}.${periodic.id}.${Number(state.periodicSchedule?.[periodic.id]?.sequence ?? 0) + 1}`;
  runtimeEffect.metadata = {
    ...(runtimeEffect.metadata ?? {}),
    sourceEffectDefinitionId,
    afflictionInstanceId: state.instanceId,
    afflictionStageId: stage.id,
    afflictionPeriodicEffectId: periodic.id
  };
  if (state.identification?.state !== "identified") {
    runtimeEffect.name = localize("PF2E_AFFLICTION_FORGE.Runtime.HiddenStageEffectLabel", "Unidentified affliction");
    runtimeEffect.img = GENERIC_AFFLICTION_IMG;
    runtimeEffect.description = "";
  }
  return runtimeEffect;
}

async function executePeriodicEffect({ actor, controller, definition, state, stage, periodic, at }) {
  const runtimeEffect = buildRuntimePeriodicEffectDefinition(periodic, definition, stage, state);
  if (!runtimeEffect) return [];
  const criticalApi = getCriticalForgeApi({ required: true });
  if (typeof criticalApi.effects?.execute !== "function") throw new Error("Critical Forge Effect execution API is unavailable.");
  return criticalApi.effects.execute(runtimeEffect, actor, {
    context: { actor, target: actor, source: controller, affliction: definition, stage, periodic, at },
    item: controller,
    label: periodic.label || `${definition.name} · ${stage.name || `Stage ${stage.number}`}`
  });
}

function notifyPeriodicExecutionFailure({ controller, stage, periodic, error }) {
  console.error(`${MODULE_ID} | Periodic Affliction effect execution failed.`, {
    controllerUuid: controller?.uuid ?? null,
    stageId: stage?.id ?? null,
    stageNumber: stage?.number ?? null,
    periodicId: periodic?.id ?? null,
    error
  });
  globalThis.Hooks?.callAll?.("pf2eAfflictionForgePeriodicExecutionFailed", {
    controllerUuid: controller?.uuid ?? null,
    stageId: stage?.id ?? null,
    stageNumber: stage?.number ?? null,
    periodicId: periodic?.id ?? null,
    error
  });
  const key = "PF2E_AFFLICTION_FORGE.Periodic.ExecutionFailed";
  globalThis.ui?.notifications?.error?.(globalThis.game?.i18n?.localize?.(key) ?? key);
}

async function recordInstantExecutionResults({ actor, controller, definition, stage, results, hpBefore = null, hpAfter = null, at = nowWorldTime() }) {
  const deathResults = (Array.isArray(results) ? results : []).filter((result) => result?.kind === "death");
  const flags = getAfflictionFlags(controller);
  const state = deepClone(flags?.state ?? {});
  let changed = false;

  const lostHp = Number.isFinite(hpBefore) && Number.isFinite(hpAfter)
    ? Math.max(0, Math.trunc(hpBefore - hpAfter))
    : 0;
  const restrictions = resolveAfflictionRestrictions(definition, stage);
  if (lostHp > 0 && restrictions.healing === "affliction-damage") {
    state.unhealableDamage = Math.max(0, Math.trunc(Number(state.unhealableDamage ?? 0))) + lostHp;
    appendRuntimeEvent(state, {
      type: "unhealable-damage-recorded",
      at,
      stageNumber: stage?.number ?? null,
      stageId: stage?.id ?? null,
      data: { amount: lostHp, total: state.unhealableDamage }
    });
    changed = true;
  }
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
      await createRuntimeChatMessage({ actor, controller, definition, state, stage, type: "death", category });
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
      await createRuntimeChatMessage({ actor, controller, definition, state, stage, type: "death-resisted", category });
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

async function executeAndRecordStageInstantEffectsSafely(context) {
  const hpBefore = actorHitPoints(context?.actor);
  const results = await executeStageInstantEffectsSafely(context);
  const hpAfter = actorHitPoints(context?.actor);
  await recordInstantExecutionResultsSafely({ ...context, results, hpBefore, hpAfter });
  return results;
}

function stageEffectItems(actor, instanceId) {
  return itemCollection(actor).filter((item) => {
    const flags = getAfflictionFlags(item);
    return isAfflictionStageEffect(item) && flags?.instanceId === instanceId;
  });
}

function residualEffectItems(actor, instanceId) {
  return itemCollection(actor).filter((item) => {
    const flags = getAfflictionFlags(item);
    return isAfflictionResidualEffect(item) && flags?.instanceId === instanceId;
  });
}

async function preserveStageEffects(actor, state, { at = nowWorldTime() } = {}) {
  if (!actor || !state?.instanceId) return [];
  const items = stageEffectItems(actor, state.instanceId).filter((item) => {
    const persistence = getAfflictionFlags(item)?.effectPersistence ?? "stage";
    return ["affliction", "permanent", "timed"].includes(persistence);
  });
  if (items.length === 0) return [];
  const updates = [];
  for (const item of items) {
    const flags = deepClone(getAfflictionFlags(item) ?? {});
    const persistence = flags.effectPersistence ?? "stage";
    flags.documentKind = DOCUMENT_KINDS.RESIDUAL_EFFECT;
    flags.residualPersistence = persistence;
    flags.residualCreatedAt = at;
    if (persistence === "permanent") flags.detachOnControllerEnd = true;
    if (persistence === "timed") {
      const duration = flags.effectPersistenceDuration ?? null;
      const seconds = await resolvedDurationToWorldSeconds(duration, { label: "Timed Affliction residual duration" });
      if (seconds == null || seconds <= 0) throw new Error("Timed Affliction residual requires a positive finite duration.");
      flags.residualDurationSeconds = seconds;
      flags.residualExpiresAt = at + seconds;
      flags.detachOnControllerEnd = true;
    }
    updates.push({ _id: item.id, [`flags.${MODULE_ID}`]: flags });
  }
  await actor.updateEmbeddedDocuments("Item", updates, {
    render: false,
    [MODULE_ID]: { restrictionBypass: true, afflictionResidualize: true }
  });
  return residualEffectItems(actor, state.instanceId);
}

async function restoreResidualEffectsAsStage(actor, state, stage) {
  if (!actor || !state?.instanceId || !stage) return [];
  const items = residualEffectItems(actor, state.instanceId).filter((item) => {
    const flags = getAfflictionFlags(item);
    return flags?.stageId === stage.id && Number(flags?.stageNumber) === Number(stage.number);
  });
  if (items.length === 0) return [];
  const updates = items.map((item) => {
    const flags = deepClone(getAfflictionFlags(item) ?? {});
    flags.documentKind = DOCUMENT_KINDS.STAGE_EFFECT;
    delete flags.residualPersistence;
    delete flags.residualCreatedAt;
    delete flags.residualDurationSeconds;
    delete flags.residualExpiresAt;
    delete flags.detachOnControllerEnd;
    delete flags.detachedAt;
    return { _id: item.id, [`flags.${MODULE_ID}`]: flags };
  });
  await actor.updateEmbeddedDocuments("Item", updates, {
    render: false,
    [MODULE_ID]: { restrictionBypass: true, afflictionResidualRollback: true }
  });
  return stageEffectItems(actor, state.instanceId);
}

async function removeResidualEffects(actor, state, { includePersistent = false } = {}) {
  const items = residualEffectItems(actor, state.instanceId).filter((item) => {
    const persistence = getAfflictionFlags(item)?.residualPersistence ?? "affliction";
    return includePersistent || persistence === "affliction";
  });
  if (items.length === 0) return [];
  return actor.deleteEmbeddedDocuments("Item", items.map((item) => item.id), {
    render: false,
    [MODULE_ID]: { restrictionBypass: true, afflictionResidualCleanup: true }
  });
}

async function detachPersistentResidualEffects(actor, state) {
  const items = residualEffectItems(actor, state.instanceId).filter((item) => ["permanent", "timed"].includes(getAfflictionFlags(item)?.residualPersistence));
  if (items.length === 0) return [];
  const updates = items.map((item) => {
    const flags = deepClone(getAfflictionFlags(item) ?? {});
    flags.controllerUuid = null;
    flags.detachedAt = nowWorldTime();
    return { _id: item.id, [`flags.${MODULE_ID}`]: flags };
  });
  return actor.updateEmbeddedDocuments("Item", updates, {
    render: false,
    [MODULE_ID]: { restrictionBypass: true, afflictionResidualDetach: true }
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

function sourceObject(item) {
  try {
    if (typeof item?.toObject === "function") return item.toObject(false);
  } catch {
    // Fall through to the document-shaped object below.
  }
  return item ?? {};
}

function expectedSubsetMatches(actual, expected) {
  if (expected === undefined) return true;
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((entry, index) => expectedSubsetMatches(actual[index], entry));
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => expectedSubsetMatches(actual[key], value));
}

function stageEffectContentMatchesSource(item, expectedSource) {
  return expectedSubsetMatches(sourceObject(item), expectedSource);
}

function strictStageOutputMatches(items, expectedSources) {
  if (items.length !== expectedSources.length) return false;
  const unused = new Set(items.map((_, index) => index));
  for (const expected of expectedSources) {
    const match = [...unused].find((index) => stageEffectContentMatchesSource(items[index], expected));
    if (match === undefined) return false;
    unused.delete(match);
  }
  return unused.size === 0;
}

async function removeStageEffects(actor, state) {
  const candidates = new Map();
  for (const item of stageEffectItems(actor, state.instanceId)) candidates.set(item.id, item);

  if (typeof globalThis.fromUuid === "function") {
    for (const uuid of state.activeStageEffectUuids ?? []) {
      try {
        const item = await globalThis.fromUuid(uuid);
        if (item?.parent?.uuid === actor.uuid && item?.id && isAfflictionStageEffect(item)) candidates.set(item.id, item);
      } catch {
        // Stale UUIDs are expected after manual cleanup and are handled by the actor scan above.
      }
    }
  }

  const ids = [...candidates.keys()].filter(Boolean);
  if (ids.length === 0) return [];
  return actor.deleteEmbeddedDocuments("Item", ids, {
    render: false,
    [MODULE_ID]: { afflictionStageCleanup: true, restrictionBypass: true }
  });
}

function buildTransitionState(previous, definition, stageNumber, enteredAt, effectUuids = [], periodicSchedule = {}, { nextCheckAt = undefined, maximumDurationAt = undefined } = {}) {
  const next = deepClone(previous);
  next.status = stageNumber > 0 ? "active" : (definition.onset ? "incubating" : "pending");
  next.currentStage = stageNumber;
  next.stageEnteredAt = stageNumber > 0 ? enteredAt : null;
  // Maximum active duration begins once, when the first effective stage becomes active.
  // Later stage changes and same-stage renewals must never reset this clock.
  if (stageNumber > 0) next.activeStartedAt = finiteTime(previous.activeStartedAt) ?? enteredAt;
  else next.activeStartedAt = finiteTime(previous.activeStartedAt);
  if (maximumDurationAt !== undefined) next.maximumDurationAt = maximumDurationAt;
  next.onsetStartedAt = stageNumber > 0 ? null : next.onsetStartedAt ?? null;
  const duration = stageNumber > 0
    ? stageDescriptor(definition, stageNumber)?.duration
    : definition.onset;
  next.nextCheckAt = nextCheckAt === undefined ? dueAt(duration, enteredAt) : nextCheckAt;
  next.activeStageEffectUuids = [...effectUuids];
  next.periodicSchedule = stageNumber > 0 ? deepClone(periodicSchedule ?? {}) : {};
  const nextStage = stageNumber > 0 ? stageDescriptor(definition, stageNumber) : null;
  const nextRestrictions = resolveAfflictionRestrictions(definition, nextStage);
  if (nextRestrictions.healing !== "affliction-damage") next.unhealableDamage = 0;
  const activeTypedLocks = new Set(nextRestrictions.unhealableDamageTypes ?? []);
  next.unhealableDamageByType = Object.fromEntries(Object.entries(next.unhealableDamageByType ?? {})
    .filter(([type, amount]) => activeTypedLocks.has(type) && Number(amount) > 0));
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
      description: controllerDescriptionFields(definition, presentation),
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

function normalizeApplicationDc(value, label = "save DC") {
  const dc = Number(value);
  if (!Number.isInteger(dc) || dc < 1 || dc > 100) {
    throw new RangeError(`${label} must be an integer from 1 to 100.`);
  }
  return dc;
}

function resolveSourceDcDefinition(definition, { saveDc = null, saveDcs = null, origin = {} } = {}) {
  const resolved = deepClone(definition);
  const mapped = saveDcs && typeof saveDcs === "object" && !Array.isArray(saveDcs)
    ? saveDcs
    : origin?.context?.saveDcs && typeof origin.context.saveDcs === "object" && !Array.isArray(origin.context.saveDcs)
      ? origin.context.saveDcs
      : {};
  const shared = saveDc ?? origin?.context?.saveDc ?? null;

  for (const check of resolved.checks ?? []) {
    if (check.dcMode !== "source") continue;
    const candidate = Object.prototype.hasOwnProperty.call(mapped, check.id) ? mapped[check.id] : shared;
    if (candidate == null || candidate === "") {
      throw new Error(`Affliction save check "${check.id}" requires an external source DC. Pass saveDc or saveDcs when applying it.`);
    }
    check.dc = normalizeApplicationDc(candidate, `Source DC for check ${check.id}`);
  }
  return resolved;
}

export class AfflictionInstanceService {
  #mutationQueues = new Map();
  #applicationQueues = new Map();

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

  #applicationKey(actor, definitionId) {
    return `${actor?.uuid ?? actor?.id ?? "unknown-actor"}::${definitionId}`;
  }

  async #withApplicationLocks(keys, task) {
    const normalizedKeys = [...new Set(keys.filter(Boolean))].sort();
    const acquired = [];

    try {
      // Acquire all Actor/definition locks in stable order so overlapping
      // multi-target applications cannot deadlock one another. Each lock stays
      // held through controller/persistent-output creation and instant effects,
      // making the duplicate check atomic from the runtime's point of view.
      for (const key of normalizedKeys) {
        const previous = this.#applicationQueues.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const tail = previous.catch(() => undefined).then(() => gate);
        this.#applicationQueues.set(key, tail);
        await previous.catch(() => undefined);
        acquired.push({ key, release, tail });
      }
      return await task();
    } finally {
      for (const { key, release, tail } of [...acquired].reverse()) {
        release?.();
        void tail.then(() => {
          if (this.#applicationQueues.get(key) === tail) this.#applicationQueues.delete(key);
        });
      }
    }
  }

  #hasActiveDefinition(actor, definitionId) {
    return itemCollection(actor).some((item) => {
      if (!isAfflictionController(item)) return false;
      return getAfflictionFlags(item)?.definitionId === definitionId;
    });
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

  async findActiveDefinition(actorOrUuid, definitionId) {
    const actor = await resolveAfflictionActor(actorOrUuid);
    if (!actor) return null;
    const id = String(definitionId ?? "").trim();
    if (!id) return null;
    const controller = itemCollection(actor).find((item) => (
      isAfflictionController(item) && getAfflictionFlags(item)?.definitionId === id
    )) ?? null;
    return controller;
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
    saveDc = null,
    saveDcs = null,
    appliedAt = nowWorldTime()
  } = {}) {
    const templateDefinition = normalizeAfflictionDefinition(definitionInput);
    assertValidAfflictionDefinition(templateDefinition, { effectValidator: this.effectValidator });
    const definition = resolveSourceDcDefinition(templateDefinition, { saveDc, saveDcs, origin });
    assertValidAfflictionDefinition(definition, { effectValidator: this.effectValidator });
    const list = Array.isArray(targets) ? targets : [targets];
    const actors = [];
    for (const target of list) {
      const actor = await resolveAfflictionActor(target);
      if (actor && !actors.includes(actor)) actors.push(actor);
    }
    if (actors.length === 0) throw new Error("No valid Actor targets were supplied.");

    for (const actor of actors) assertWritableActor(actor);

    const lockKeys = actors.map((actor) => this.#applicationKey(actor, definition.id));
    return this.#withApplicationLocks(lockKeys, async () => {
      // A controller reserves the Affliction identity immediately, including
      // pending exposure saves and incubation. Repeated application attempts
      // therefore skip that Actor until the existing controller is ended or
      // removed. Different definitionIds remain independent and may coexist.
      const eligibleActors = actors.filter((actor) => !this.#hasActiveDefinition(actor, definition.id));
      if (eligibleActors.length === 0) return [];

      const controllers = [];
      try {
        for (const actor of eligibleActors) {
          const hasInitialCheck = Boolean(definition.initialCheck);
          const hasOnset = Boolean(definition.onset);
          const initialStage = hasInitialCheck || hasOnset ? 0 : 1;
          const initialStatus = hasInitialCheck ? "pending" : hasOnset ? "incubating" : "active";
          const initialNextCheckAt = hasInitialCheck
            ? null
            : hasOnset
              ? await resolvedDueAt(definition.onset, appliedAt, { label: "Affliction onset duration" })
              : await resolvedDueAt(definition.stages?.[0]?.duration, appliedAt, { label: "Affliction stage duration" });
          const initialMaximumDurationAt = initialStage > 0
            ? await resolvedDueAt(definition.maximumDuration, appliedAt, { label: "Affliction maximum duration" })
            : null;
          const state = createAfflictionControllerState(definition, {
            instanceId: randomId("affliction-instance"),
            appliedAt,
            currentStage: initialStage,
            stageEnteredAt: initialStage > 0 ? appliedAt : null,
            activeStartedAt: initialStage > 0 ? appliedAt : null,
            maximumDurationAt: initialMaximumDurationAt,
            onsetStartedAt: hasOnset && !hasInitialCheck ? appliedAt : null,
            status: initialStatus,
            onsetTargetStage: hasOnset && !hasInitialCheck ? 1 : null,
            // The initial exposure save is not a timed event. It is resolved by
            // AfflictionEngine.apply*() immediately after controller creation.
            // Keeping nextCheckAt null prevents the world-time scheduler from
            // racing that interactive save if time advances while its dialog is open.
            nextCheckAt: initialNextCheckAt
          });
          if (initialStage > 0) {
            state.periodicSchedule = await buildPeriodicSchedule(stageDescriptor(definition, initialStage), appliedAt);
          }
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
          await executeAndRecordStageInstantEffectsSafely({ actor, controller, definition, state, stage, at: appliedAt });
        }
        return controllers;
      } catch (error) {
        // Persistent/controller creation is rollback-safe because irreversible
        // instant stage mechanics are deferred until all targets commit.
        for (const controller of [...controllers].reverse()) {
          try { await this.end(controller, { reason: "ended", notifyLifecycle: false }); } catch (cleanupError) {
            console.error(`${MODULE_ID} | Failed to roll back a partial multi-target Affliction application.`, cleanupError);
          }
        }
        throw error;
      }
    });
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
    state.maximumDurationAt = null;
    state.onsetStartedAt = startedAt;
    state.nextCheckAt = await resolvedDueAt(definition.onset, startedAt, { label: "Affliction onset duration" });
    state.activeStageEffectUuids = [];
    state.periodicSchedule = {};
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
    recoverySuccesses = undefined,
    refreshPersistent = false,
    executeInstant = true,
    notifyLifecycle = true
  } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    let previous = deepClone(flags.state);
    if (previous.status === "paused") throw new Error("Paused Afflictions must be resumed before changing stage.");
    if (previous.mortality?.dead === true) throw new Error("A lethal Affliction cannot change stage after death has been recorded.");
    const max = definition.stages.length;
    const numericStage = Number(requestedStage);
    if (!Number.isFinite(numericStage)) throw new TypeError("Stage number must be numeric.");
    const stageNumber = Math.max(0, Math.min(max, Math.trunc(numericStage)));
    if (previous.status === "active" && stageNumber === 0) {
      throw new RangeError("Active Afflictions cannot transition to stage 0. End or recover the Affliction instead.");
    }

    const stage = stageDescriptor(definition, stageNumber);
    const sameActiveStage = stageNumber > 0
      && previous.status === "active"
      && previous.currentStage === stageNumber;
    const nextCheckAt = stage
      ? await resolvedDueAt(stage.duration, enteredAt, { label: "Affliction stage duration" })
      : null;
    let maximumDurationAt = finiteTime(previous.maximumDurationAt);
    if (stageNumber > 0 && finiteTime(previous.activeStartedAt) == null && maximumDurationAt == null) {
      maximumDurationAt = await resolvedDueAt(definition.maximumDuration, enteredAt, { label: "Affliction maximum duration" });
    }
    const nextPeriodicSchedule = stage
      ? await buildPeriodicSchedule(stage, enteredAt, previous.periodicSchedule, { preserve: sameActiveStage })
      : {};

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
        previous.activeStageEffectUuids ?? [],
        nextPeriodicSchedule,
        { nextCheckAt, maximumDurationAt }
      );
      if (lastCheck !== undefined) next.lastCheck = lastCheck == null ? null : deepClone(lastCheck);
      if (recoverySuccesses !== undefined) next.recoverySuccesses = Math.max(0, Math.trunc(Number(recoverySuccesses) || 0));
      appendRuntimeEvent(next, {
        type: "stage-renewed",
        at: enteredAt,
        stageNumber,
        stageId: stage?.id ?? null,
        data: stageEventData(stage)
      });
      await updateController(controller, definition, next);
      if (executeInstant && stage) {
        await executeAndRecordStageInstantEffectsSafely({ actor, controller, definition, state: next, stage, at: enteredAt });
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

    let created = [];
    let preservedOld = [];
    try {
      await withAfflictionRestrictionBypass(actor, async () => {
        if (oldStage) preservedOld = await preserveStageEffects(actor, previous, { at: enteredAt });
        await removeStageEffects(actor, previous);
        if (preparedSources.length > 0) {
          created = await actor.createEmbeddedDocuments("Item", preparedSources, {
            renderSheet: false,
            [MODULE_ID]: { afflictionStageApplication: true, restrictionBypass: true }
          });
        }
      });
      const next = buildTransitionState(
        previous,
        definition,
        stageNumber,
        enteredAt,
        created.map((item) => item.uuid),
        nextPeriodicSchedule,
        { nextCheckAt, maximumDurationAt }
      );
      if (lastCheck !== undefined) next.lastCheck = lastCheck == null ? null : deepClone(lastCheck);
      next.recoverySuccesses = recoverySuccesses !== undefined
        ? Math.max(0, Math.trunc(Number(recoverySuccesses) || 0))
        : (Number(previous.currentStage ?? 0) === stageNumber ? Number(previous.recoverySuccesses ?? 0) : 0);
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
        await executeAndRecordStageInstantEffectsSafely({ actor, controller, definition, state: next, stage, at: enteredAt });
      }
      if (notifyLifecycle && stageNumber > 0 && Number(previous.currentStage ?? 0) !== stageNumber) {
        await createRuntimeChatMessage({
          actor,
          controller,
          definition,
          state: next,
          stage,
          type: "stage-changed",
          fromStage: Number(previous.currentStage ?? 0)
        });
      }
      return controller;
    } catch (error) {
      try {
        let restored = [];
        await withAfflictionRestrictionBypass(actor, async () => {
          if (created.length > 0) await actor.deleteEmbeddedDocuments("Item", created.map((item) => item.id), {
            render: false,
            [MODULE_ID]: { restrictionBypass: true, afflictionStageRollback: true }
          });
          if (preservedOld.length > 0 && oldStage) {
            restored = await restoreResidualEffectsAsStage(actor, previous, oldStage);
          } else if (oldSources.length > 0) {
            restored = await actor.createEmbeddedDocuments("Item", oldSources, {
              renderSheet: false,
              [MODULE_ID]: { afflictionStageRollback: true, restrictionBypass: true }
            });
          }
        });
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
    if (!stage || state.status !== "active" || state.mortality?.dead === true) return [];
    return executeAndRecordStageInstantEffectsSafely({ actor, controller, definition, state, stage, at: nowWorldTime() });
  }

  async executePeriodic(controllerOrUuid, periodicId, { at = nowWorldTime() } = {}) {
    return this.#serializeMutation(controllerOrUuid, () => this.#executePeriodicUnlocked(controllerOrUuid, periodicId, { at }));
  }

  async #executePeriodicUnlocked(controllerOrUuid, periodicId, { at = nowWorldTime() } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    let state = deepClone(flags.state);
    const stage = stageDescriptor(definition, state.currentStage);
    if (!stage || state.status !== "active" || state.mortality?.dead === true) return { status: "inactive", results: [] };
    const periodic = stage.periodicEffects?.find((entry) => entry.id === periodicId) ?? null;
    if (!periodic) return { status: "missing", results: [] };
    const scheduled = state.periodicSchedule?.[periodic.id];
    if (!scheduled || !Number.isFinite(Number(scheduled.nextAt))) return { status: "unscheduled", results: [] };

    const effectiveAt = finiteTime(at) ?? nowWorldTime();
    const hpBefore = actorHitPoints(actor);
    let results = [];
    let failed = false;
    try {
      results = await executePeriodicEffect({ actor, controller, definition, state, stage, periodic, at: effectiveAt });
    } catch (error) {
      failed = true;
      notifyPeriodicExecutionFailure({ controller, stage, periodic, error });
    }
    const hpAfter = actorHitPoints(actor);
    await recordInstantExecutionResultsSafely({ actor, controller, definition, stage, results, hpBefore, hpAfter, at: effectiveAt });

    const refreshed = getAfflictionFlags(controller);
    state = deepClone(refreshed?.state ?? state);
    const previousEntry = state.periodicSchedule?.[periodic.id] ?? scheduled;
    let nextSeconds = null;
    if (state.mortality?.dead !== true) {
      try { nextSeconds = await periodicIntervalToWorldSeconds(periodic.interval); }
      catch (error) {
        failed = true;
        notifyPeriodicExecutionFailure({ controller, stage, periodic, error });
      }
    }
    state.periodicSchedule ??= {};
    state.periodicSchedule[periodic.id] = {
      ...deepClone(previousEntry),
      lastAt: effectiveAt,
      sequence: Math.max(0, Math.trunc(Number(previousEntry?.sequence ?? 0))) + 1,
      lastIntervalSeconds: nextSeconds,
      nextAt: nextSeconds == null ? null : effectiveAt + nextSeconds
    };
    appendRuntimeEvent(state, {
      type: failed ? "periodic-effect-failed" : "periodic-effect",
      at: effectiveAt,
      stageNumber: stage.number,
      stageId: stage.id,
      data: { periodicId: periodic.id, label: periodic.label ?? "", nextAt: state.periodicSchedule[periodic.id].nextAt }
    });
    state.revision = Number(state.revision ?? 0) + 1;
    await updateController(controller, definition, state);
    return { status: failed ? "failed" : "executed", results, nextAt: state.periodicSchedule[periodic.id].nextAt };
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
    const stageItems = [
      ...stageEffectItems(actor, state.instanceId),
      ...residualEffectItems(actor, state.instanceId)
    ];
    const updates = stageItems.map((item) => {
      const itemFlags = getAfflictionFlags(item) ?? {};
      const identifiedPresentation = itemFlags.identifiedPresentation ?? {};
      return {
        _id: item.id,
        name: unidentified ? presentation.stageEffectName : (identifiedPresentation.name ?? item.name),
        img: unidentified ? presentation.stageEffectImg : (identifiedPresentation.img ?? item.img),
        system: {
          description: unidentified
            ? descriptionFields("", identifiedPresentation.description ?? item.system?.description?.gm ?? "")
            : descriptionFields(identifiedPresentation.description ?? item.system?.description?.value ?? "", ""),
          unidentified,
          tokenIcon: { show: presentation.showStageTokenIcon }
        }
      };
    });
    try {
      if (updates.length > 0 && typeof actor.updateEmbeddedDocuments === "function") {
        await actor.updateEmbeddedDocuments("Item", updates, {
          render: false,
          [MODULE_ID]: { afflictionIdentification: true }
        });
      } else {
        for (let index = 0; index < stageItems.length; index += 1) {
          const { _id, ...changes } = updates[index];
          await stageItems[index].update(changes, { render: false });
        }
      }
    } catch (error) {
      // The controller is already committed to the new identification state.
      // Rebuild the derived stage presentation against that committed state so
      // a partial item update cannot leave the Actor visually inconsistent.
      try {
        await this.reconcile(controller, { strict: true, recordEvent: false });
      } catch (reconcileError) {
        console.error(`${MODULE_ID} | Identification recovery reconciliation failed.`, reconcileError);
      }
      throw error;
    }
    return controller;
  }

  async pause(controllerOrUuid, options = {}) {
    return this.#serializeMutation(controllerOrUuid, () => this.#pauseUnlocked(controllerOrUuid, options));
  }

  async #pauseUnlocked(controllerOrUuid, { pausedAt = nowWorldTime() } = {}) {
    const { controller } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    if (state.status === "paused") return controller;
    if (state.mortality?.dead === true) throw new Error("A lethal Affliction cannot be paused after death has been recorded.");
    if (!["incubating", "active"].includes(state.status)) throw new Error("Only incubating or active Afflictions can be paused.");
    if (state.pendingCheck) throw new Error("An Affliction with a pending save cannot be paused.");
    const at = finiteTime(pausedAt) ?? nowWorldTime();
    state.pause = {
      pausedAt: at,
      previousStatus: state.status,
      nextCheckAt: finiteTime(state.nextCheckAt)
    };
    state.status = "paused";
    state.nextCheckAt = null;
    appendRuntimeEvent(state, {
      type: "paused",
      at,
      stageNumber: state.currentStage > 0 ? state.currentStage : null
    });
    state.revision = Number(state.revision ?? 0) + 1;
    await updateController(controller, definition, state);
    return controller;
  }

  async resume(controllerOrUuid, options = {}) {
    return this.#serializeMutation(controllerOrUuid, () => this.#resumeUnlocked(controllerOrUuid, options));
  }

  async #resumeUnlocked(controllerOrUuid, { resumedAt = nowWorldTime() } = {}) {
    const { controller } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    if (state.status !== "paused" || !state.pause) throw new Error("Affliction is not paused.");
    const at = finiteTime(resumedAt) ?? nowWorldTime();
    const pausedAt = finiteTime(state.pause.pausedAt) ?? at;
    const elapsed = Math.max(0, at - pausedAt);
    const shift = (value) => {
      const finite = finiteTime(value);
      return finite == null ? null : finite + elapsed;
    };
    state.status = state.pause.previousStatus;
    state.stageEnteredAt = shift(state.stageEnteredAt);
    state.activeStartedAt = shift(state.activeStartedAt);
    state.maximumDurationAt = shift(state.maximumDurationAt);
    state.onsetStartedAt = shift(state.onsetStartedAt);
    state.nextCheckAt = shift(state.pause.nextCheckAt);
    state.periodicSchedule = Object.fromEntries(Object.entries(state.periodicSchedule ?? {}).map(([id, entry]) => [id, {
      ...deepClone(entry),
      nextAt: shift(entry?.nextAt),
      lastAt: shift(entry?.lastAt)
    }]));
    state.pause = null;
    appendRuntimeEvent(state, {
      type: "resumed",
      at,
      stageNumber: state.currentStage > 0 ? state.currentStage : null,
      data: { pausedSeconds: elapsed }
    });
    state.revision = Number(state.revision ?? 0) + 1;
    await updateController(controller, definition, state);
    return controller;
  }

  async end(controllerOrUuid, options = {}) {
    return this.#serializeMutation(controllerOrUuid, () => this.#endUnlocked(controllerOrUuid, options));
  }

  async #endUnlocked(controllerOrUuid, { reason = "ended", notifyLifecycle = true } = {}) {
    const { controller, actor } = await resolveController(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    const state = deepClone(flags.state);
    const endedAt = nowWorldTime();
    state.status = reason === "recovered" ? "recovered" : "ended";
    state.currentStage = 0;
    state.stageEnteredAt = null;
    state.maximumDurationAt = null;
    state.onsetStartedAt = null;
    state.nextCheckAt = null;
    state.activeStageEffectUuids = [];
    state.periodicSchedule = {};
    state.pendingCheck = null;
    state.onsetTargetStage = null;
    state.pause = null;
    appendRuntimeEvent(state, {
      type: reason === "recovered" ? "recovered" : "ended",
      at: endedAt,
      data: { reason }
    });
    state.revision = Number(state.revision ?? 0) + 1;

    const endingStage = stageDescriptor(definition, flags.state?.currentStage);
    await withAfflictionRestrictionBypass(actor, async () => {
      // Preserve any current-stage output whose own persistence contract
      // survives the stage. Affliction-bound residuals are removed below;
      // permanent and timed residuals are detached from the ending controller.
      if (endingStage) await preserveStageEffects(actor, flags.state, { at: endedAt });
      await removeStageEffects(actor, flags.state);
      await removeResidualEffects(actor, flags.state, { includePersistent: false });
      await detachPersistentResidualEffects(actor, flags.state);
    });
    // Persist the terminal state before deletion so hooks and integrations can
    // observe a coherent final controller if they listen to updateItem.
    await updateController(controller, definition, state);
    if (notifyLifecycle && reason !== "rejected") {
      const messageType = reason === "recovered"
        ? "recovered"
        : reason === "maximum-duration"
          ? "maximum-duration"
          : "ended";
      await createRuntimeChatMessage({
        actor,
        controller,
        definition,
        state,
        stage: null,
        type: messageType,
        reason
      });
    }
    await actor.deleteEmbeddedDocuments("Item", [controller.id], {
      render: false,
      [MODULE_ID]: { afflictionControllerEnd: reason }
    });
    return true;
  }

  async reconcile(controllerOrUuid, { cleanupOrphans = true, recordEvent = true, strict = false, _attempt = 0 } = {}) {
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
    const stage = ["active", "paused"].includes(state.status) && Number(state.currentStage) > 0
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
        return this.reconcile(beforeMutation.controller, { cleanupOrphans, recordEvent, strict, _attempt: _attempt + 1 });
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
    const strictMismatch = strict && !strictStageOutputMatches(matching, expectedSources);
    const outputMismatch = matching.length !== expectedSources.length || stale.length > 0 || strictMismatch;
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
        return this.reconcile(afterMutation.controller, { cleanupOrphans, recordEvent, strict, _attempt: _attempt + 1 });
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
      strict,
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
    const state = flags.state ?? { instanceId: flags.instanceId };
    await withAfflictionRestrictionBypass(actor, async () => {
      // A controller deleted outside the service still has to honor permanent
      // and timed component persistence on its current stage.
      await preserveStageEffects(actor, state, { at: nowWorldTime() });
      const stale = stageEffectItems(actor, flags.instanceId);
      if (stale.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", stale.map((item) => item.id), {
          render: false,
          [MODULE_ID]: { orphanCleanup: true, restrictionBypass: true }
        });
      }
      await removeResidualEffects(actor, state, { includePersistent: false });
      await detachPersistentResidualEffects(actor, state);
    });
    return true;
  }
}

export function createAfflictionInstanceService(options = {}) {
  return new AfflictionInstanceService(options);
}
