import { DOCUMENT_KINDS, MODULE_ID } from "../../constants.js";
import { getAfflictionFlags, isAfflictionController } from "../documents/affliction-flags.js";
import { normalizeAfflictionDefinition, resolveAfflictionRestrictions } from "../schema/affliction-normalizer.js";
import { inspectPf2eAfflictionReactionEvent } from "./affliction-event-reaction-runtime.js";
import { deepClone } from "../schema/utils.js";

let initialized = false;
const bypassActors = new Map();

function itemCollection(actor) {
  if (!actor?.items) return [];
  if (Array.isArray(actor.items)) return actor.items;
  try { return [...actor.items]; } catch { return []; }
}

function actorKey(actorOrUuid) {
  if (typeof actorOrUuid === "string") return actorOrUuid;
  return actorOrUuid?.uuid ?? actorOrUuid?.id ?? null;
}

function beginBypass(actorOrUuid) {
  const key = actorKey(actorOrUuid);
  if (!key) return null;
  bypassActors.set(key, (bypassActors.get(key) ?? 0) + 1);
  return key;
}

function endBypass(key) {
  if (!key) return;
  const count = (bypassActors.get(key) ?? 1) - 1;
  if (count <= 0) bypassActors.delete(key);
  else bypassActors.set(key, count);
}

export async function withAfflictionRestrictionBypass(actorOrUuid, task) {
  const key = beginBypass(actorOrUuid);
  try {
    return await task();
  } finally {
    endBypass(key);
  }
}

export function restrictionBypassActive(actorOrUuid, options = null) {
  if (options?.[MODULE_ID]?.restrictionBypass === true) return true;
  const key = actorKey(actorOrUuid);
  return Boolean(key && (bypassActors.get(key) ?? 0) > 0);
}

function liveControllerState(state) {
  if (!state) return false;
  if (state.status === "active") return Number(state.currentStage) > 0;
  if (state.status === "paused") return state.pause?.previousStatus === "active" && Number(state.currentStage) > 0;
  return false;
}

export function inspectControllerRestrictions(controller) {
  if (!controller || !isAfflictionController(controller)) return null;
  const flags = getAfflictionFlags(controller);
  if (!flags?.definitionSnapshot || !flags?.state || !liveControllerState(flags.state)) return null;
  const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
  const stage = definition.stages?.[Number(flags.state.currentStage) - 1] ?? null;
  if (!stage) return null;
  return Object.freeze({
    controllerUuid: controller.uuid ?? null,
    instanceId: flags.instanceId ?? flags.state.instanceId ?? null,
    definitionId: definition.id,
    definitionName: definition.name,
    stageNumber: stage.number,
    stageId: stage.id,
    restrictions: resolveAfflictionRestrictions(definition, stage),
    unhealableDamage: Math.max(0, Math.trunc(Number(flags.state.unhealableDamage ?? 0))),
    unhealableDamageByType: Object.freeze({ ...(flags.state.unhealableDamageByType ?? {}) })
  });
}

export function collectActorRestrictions(actor) {
  const sources = itemCollection(actor)
    .filter(isAfflictionController)
    .map(inspectControllerRestrictions)
    .filter(Boolean);

  const conditionBySlug = new Map();
  const blockedCapabilities = new Set();
  let healing = "none";
  let unhealableDamage = 0;
  const unhealableDamageByType = new Map();
  const unhealableDamageTypes = new Set();
  const rank = { none: 0, "affliction-damage": 1, all: 2 };

  for (const source of sources) {
    const restrictions = source.restrictions;
    for (const lock of restrictions.conditionLocks ?? []) {
      const previous = conditionBySlug.get(lock.slug);
      const minimums = [previous?.minimum, lock.minimum].filter((value) => Number.isInteger(value));
      conditionBySlug.set(lock.slug, {
        slug: lock.slug,
        minimum: minimums.length > 0 ? Math.max(...minimums) : null,
        sources: [...new Set([...(previous?.sources ?? []), source.controllerUuid].filter(Boolean))]
      });
    }
    for (const capability of restrictions.blockedCapabilities ?? []) blockedCapabilities.add(capability);
    if ((rank[restrictions.healing] ?? 0) > (rank[healing] ?? 0)) healing = restrictions.healing;
    if (restrictions.healing === "affliction-damage") unhealableDamage += source.unhealableDamage;
    for (const type of restrictions.unhealableDamageTypes ?? []) unhealableDamageTypes.add(type);
    for (const [type, amount] of Object.entries(source.unhealableDamageByType ?? {})) {
      const numeric = Math.max(0, Math.trunc(Number(amount) || 0));
      if (numeric > (unhealableDamageByType.get(type) ?? 0)) unhealableDamageByType.set(type, numeric);
    }
  }

  const typedUnhealableDamage = [...unhealableDamageByType.values()].reduce((sum, amount) => sum + amount, 0);
  return Object.freeze({
    actorUuid: actor?.uuid ?? null,
    conditionLocks: Object.freeze([...conditionBySlug.values()].map((entry) => Object.freeze(entry))),
    healing,
    unhealableDamage,
    unhealableDamageTypes: Object.freeze([...unhealableDamageTypes]),
    unhealableDamageByType: Object.freeze(Object.fromEntries(unhealableDamageByType)),
    typedUnhealableDamage,
    blockedCapabilities: Object.freeze([...blockedCapabilities]),
    sources: Object.freeze(sources)
  });
}

export function isAfflictionCapabilityBlocked(actor, capability) {
  return collectActorRestrictions(actor).blockedCapabilities.includes(String(capability ?? "").trim().toLowerCase());
}

function isConditionItem(item) {
  if (!item) return false;
  if (item.type === "condition") return true;
  try { return item.isOfType?.("condition") === true; } catch { return false; }
}

function conditionSlug(item) {
  const candidates = [
    item?.slug,
    item?.system?.slug,
    item?.system?.slug?.value,
    item?.system?.condition?.slug
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim().toLowerCase();
    if (value) return value;
  }
  return String(item?.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function conditionValue(item) {
  const candidates = [
    item?.value,
    item?.badge?.value,
    item?.system?.value?.value,
    item?.system?.value,
    item?.system?.badge?.value,
    item?.system?.badge
  ];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number)) return Math.trunc(number);
  }
  return null;
}

function proposedConditionValue(changes) {
  const candidates = [
    changes?.system?.value?.value,
    changes?.system?.value,
    changes?.system?.badge?.value,
    changes?.system?.badge,
    changes?.value,
    changes?.badge?.value
  ];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number)) return Math.trunc(number);
  }
  return null;
}

function conditionLockFor(actor, item) {
  const slug = conditionSlug(item);
  return collectActorRestrictions(actor).conditionLocks.find((lock) => lock.slug === slug) ?? null;
}

function hpValues(actor) {
  const hp = actor?.system?.attributes?.hp ?? {};
  const current = Number(hp.value);
  const max = Number(hp.max);
  return {
    current: Number.isFinite(current) ? current : null,
    max: Number.isFinite(max) ? max : null
  };
}

function proposedHpValue(changes) {
  const value = changes?.system?.attributes?.hp?.value;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function setProposedHpValue(changes, value) {
  changes.system ??= {};
  changes.system.attributes ??= {};
  changes.system.attributes.hp ??= {};
  changes.system.attributes.hp.value = value;
}

function warnRestriction(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  const message = i18n?.format?.(key, data) ?? i18n?.localize?.(key) ?? key;
  globalThis.ui?.notifications?.warn?.(message);
}

export function guardConditionUpdate(item, changes, options = {}) {
  const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
  if (!actor || !isConditionItem(item) || restrictionBypassActive(actor, options)) return true;
  const lock = conditionLockFor(actor, item);
  if (!lock) return true;
  const current = conditionValue(item);
  const proposed = proposedConditionValue(changes);
  if (proposed == null) return true;
  const minimum = Number.isInteger(lock.minimum) ? lock.minimum : current;
  if (minimum == null || proposed >= minimum) return true;
  warnRestriction("PF2E_AFFLICTION_FORGE.Restrictions.ConditionLocked", { condition: item.name ?? lock.slug, minimum });
  return false;
}

export function guardConditionDelete(item, options = {}) {
  const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
  if (!actor || !isConditionItem(item) || restrictionBypassActive(actor, options)) return true;
  const lock = conditionLockFor(actor, item);
  if (!lock) return true;
  warnRestriction("PF2E_AFFLICTION_FORGE.Restrictions.ConditionRemovalLocked", { condition: item.name ?? lock.slug });
  return false;
}

export function guardHealingUpdate(actor, changes, options = {}) {
  if (!actor || restrictionBypassActive(actor, options)) return true;
  const proposed = proposedHpValue(changes);
  if (proposed == null) return true;
  const hp = hpValues(actor);
  if (hp.current == null || proposed <= hp.current) return true;

  const restrictions = collectActorRestrictions(actor);
  if (restrictions.healing === "all") {
    setProposedHpValue(changes, hp.current);
    warnRestriction("PF2E_AFFLICTION_FORGE.Restrictions.HealingBlocked");
    return true;
  }

  const protectedDamage = Math.max(0, restrictions.unhealableDamage + (restrictions.typedUnhealableDamage ?? 0));
  if (protectedDamage > 0 && hp.max != null) {
    const ceiling = Math.max(0, hp.max - protectedDamage);
    if (proposed > ceiling) {
      setProposedHpValue(changes, Math.max(hp.current, ceiling));
      const key = (restrictions.typedUnhealableDamage ?? 0) > 0
        ? "PF2E_AFFLICTION_FORGE.Restrictions.TypedDamageHealingBlocked"
        : "PF2E_AFFLICTION_FORGE.Restrictions.AfflictionDamageHealingBlocked";
      warnRestriction(key, { value: protectedDamage, types: restrictions.unhealableDamageTypes.join(", ") });
    }
  }
  return true;
}

function authoritativeGm() {
  const user = globalThis.game?.user;
  if (!user?.isGM) return false;
  const activeGM = globalThis.game?.users?.activeGM;
  return !activeGM?.id || activeGM.id === user.id;
}

function appliedHpDamageAmount(message) {
  const applied = message?.flags?.pf2e?.appliedDamage ?? message?.flags?.PF2E?.appliedDamage;
  if (!applied || applied.isHealing === true || applied.isReverted === true) return 0;
  return (Array.isArray(applied.updates) ? applied.updates : [])
    .filter((entry) => typeof entry?.path === "string" && entry.path.includes("system.attributes.hp.value"))
    .reduce((sum, entry) => sum + Math.max(0, Math.trunc(Number(entry?.value) || 0)), 0);
}

async function updateTypedDamageController(controller, damageType, amount, event) {
  const flags = getAfflictionFlags(controller);
  if (!flags?.state || amount <= 0) return false;
  const state = deepClone(flags.state);
  state.unhealableDamageByType ??= {};
  state.unhealableDamageByType[damageType] = Math.max(0, Math.trunc(Number(state.unhealableDamageByType[damageType]) || 0)) + amount;
  state.revision = Math.max(1, Math.trunc(Number(state.revision) || 0) + 1);
  await controller.update({ [`flags.${MODULE_ID}.state`]: state }, {
    render: false,
    [MODULE_ID]: { restrictionBypass: true, typedHealingLock: true, sourceMessageUuid: event?.messageUuid ?? null }
  });
  return true;
}

export async function recordTypedHealingLockDamage(message) {
  if (!authoritativeGm()) return Object.freeze({ status: "ignored", reason: "not-authoritative-gm" });
  const event = inspectPf2eAfflictionReactionEvent(message);
  if (!event.matched || !event.actor) return Object.freeze({ status: "ignored", reason: "not-positive-damage" });
  const amount = appliedHpDamageAmount(message);
  if (amount <= 0) return Object.freeze({ status: "ignored", reason: "no-hp-damage" });

  const damageTypes = [...new Set((event.damageTypes ?? []).map((type) => String(type).trim().toLowerCase()).filter(Boolean))];
  const controllers = itemCollection(event.actor).filter(isAfflictionController);
  const matching = controllers.map((controller) => ({ controller, info: inspectControllerRestrictions(controller) }))
    .filter(({ info }) => info?.restrictions?.unhealableDamageTypes?.some((type) => damageTypes.includes(type)));
  if (matching.length === 0) return Object.freeze({ status: "ignored", reason: "no-typed-healing-lock" });

  // PF2e's applied-damage flag exposes the final HP delta but not a post-IWR
  // per-damage-type breakdown. A single-type damage event is exact; mixed
  // damage is deliberately left for manual resolution rather than overblocking
  // healing by guessing which pool survived resistances/weaknesses.
  if (damageTypes.length !== 1) {
    globalThis.Hooks?.callAll?.("pf2eAfflictionForgeTypedHealingLockAmbiguous", Object.freeze({
      actorUuid: event.actorUuid,
      messageUuid: event.messageUuid,
      amount,
      damageTypes: Object.freeze(damageTypes)
    }));
    return Object.freeze({ status: "ambiguous", amount, damageTypes: Object.freeze(damageTypes) });
  }

  const damageType = damageTypes[0];
  let recorded = 0;
  for (const { controller, info } of matching) {
    if (!info.restrictions.unhealableDamageTypes.includes(damageType)) continue;
    if (await updateTypedDamageController(controller, damageType, amount, event)) recorded += 1;
  }
  return Object.freeze({ status: recorded > 0 ? "recorded" : "ignored", recorded, amount, damageType });
}

export function initializeAfflictionRestrictionRuntime() {
  if (initialized) return;
  initialized = true;
  Hooks.on("preUpdateItem", (item, changes, options) => guardConditionUpdate(item, changes, options));
  Hooks.on("preDeleteItem", (item, options) => guardConditionDelete(item, options));
  Hooks.on("preUpdateActor", (actor, changes, options) => guardHealingUpdate(actor, changes, options));
  Hooks.on("createChatMessage", (message) => { void recordTypedHealingLockDamage(message); });
  console.info(`${MODULE_ID} | Affliction restriction runtime initialized.`);
}

export function restrictionRuntimeStatus() {
  return Object.freeze({
    initialized,
    bypassActors: bypassActors.size,
    documentKind: DOCUMENT_KINDS.CONTROLLER
  });
}
