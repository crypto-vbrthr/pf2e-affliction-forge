import { MODULE_ID, OUTCOME_KEYS } from "../../constants.js";
import { getAfflictionFlags, isAfflictionController } from "../documents/affliction-flags.js";
import { getCriticalForgeApi } from "../integration/critical-forge-adapter.js";
import { normalizeAfflictionDefinition, resolveSavePolicy } from "../schema/affliction-normalizer.js";
import { randomId } from "../schema/utils.js";
import {
  createPlayerSaveRequestMessage,
  emitPlayerSavePrompt,
  preferredPlayerOwnerId
} from "./affliction-save-runtime.js";
import { rollPf2eSave } from "./pf2e-save-roller.js";
import { adjustAfflictionSaveDegree, incapacitationDegreeAdjustment, normalizeDegreeOfSuccess } from "./affliction-engine-core.js";

const MAX_REACTION_HISTORY = 1000;
const processedReactionKeys = new Map();
const pendingReactionKeys = new Set();
const conditionValueCache = new Map();
let conditionEventSerial = 0;
let initialized = false;

function localize(key, fallback = key) {
  const value = globalThis.game?.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function format(key, data = {}, fallback = null) {
  const value = globalThis.game?.i18n?.format?.(key, data);
  if (value && value !== key) return value;
  return typeof fallback === "function" ? fallback(data) : (fallback ?? key);
}

function escapeHtml(value) {
  const helper = globalThis.foundry?.utils?.escapeHTML;
  if (typeof helper === "function") return helper(String(value ?? ""));
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function authoritativeGm() {
  const user = globalThis.game?.user;
  if (!user?.isGM) return false;
  const activeGM = globalThis.game?.users?.activeGM;
  return !activeGM?.id || activeGM.id === user.id;
}

function nowWorldTime() {
  const value = Number(globalThis.game?.time?.worldTime);
  return Number.isFinite(value) ? value : 0;
}

function itemCollection(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  try { return [...items]; } catch { return []; }
}

function isConditionItem(item) {
  if (!item) return false;
  if (item.type === "condition") return true;
  try { return item.isOfType?.("condition") === true; } catch { return false; }
}

function conditionSlug(item) {
  const candidates = [item?.slug, item?.system?.slug, item?.system?.slug?.value, item?.system?.condition?.slug];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim().toLowerCase();
    if (value) return value;
  }
  return String(item?.name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

function conditionMaximum(item) {
  const slug = conditionSlug(item);
  const candidates = [item?.system?.value?.max, item?.system?.badge?.max, item?.parent?.system?.attributes?.[slug]?.max];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number)) return Math.trunc(number);
  }
  return null;
}

function conditionCacheKey(item) {
  return item?.uuid ?? (item?.parent?.uuid && item?.id ? `${item.parent.uuid}.Item.${item.id}` : item?.id ?? null);
}

function reactionChainFromOptions(options = {}) {
  const chain = options?.[MODULE_ID]?.conditionReactionChain;
  return Array.isArray(chain) ? chain.map((entry) => String(entry)).filter(Boolean) : [];
}

function reactionIdentity(controller, reaction) {
  return `${controller?.uuid ?? controller?.id ?? "controller"}|${reaction?.id ?? "reaction"}`;
}

function pf2eFlags(message) {
  return message?.flags?.pf2e ?? message?.flags?.PF2E ?? {};
}

function messageActor(message) {
  try { return message?.actor ?? message?.speakerActor ?? null; } catch { return message?.speakerActor ?? null; }
}

function positiveDamageApplied(message) {
  const applied = pf2eFlags(message)?.appliedDamage;
  if (!applied || applied.isHealing === true || applied.isReverted === true) return false;
  const updates = Array.isArray(applied.updates) ? applied.updates : [];
  const hpDamage = updates.some((entry) =>
    typeof entry?.path === "string" && entry.path.includes("system.attributes.hp.value") && Number(entry?.value) > 0
  );
  const shieldDamage = Number(applied?.shield?.damage ?? 0) > 0;
  const persistent = Array.isArray(applied?.persistent) && applied.persistent.length > 0;
  return hpDamage || shieldDamage || persistent;
}

function damageTypeCandidates(value, output = new Set()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  // PF2e DamageRollFlag.types is keyed by damage type. The nested keys are
  // categories/buckets (for example `energy` or `normal`), not additional
  // damage types, so only the top-level keys are part of the event contract.
  for (const key of Object.keys(value)) {
    const normalized = String(key).trim().toLowerCase();
    if (normalized) output.add(normalized);
  }
  return output;
}

function damageTypesFromOptions(options = []) {
  const found = new Set();
  for (const raw of Array.isArray(options) ? options : []) {
    const option = String(raw).toLowerCase();
    for (const prefix of ["damage:type:", "damage:category:", "damage:"]) {
      if (option.startsWith(prefix)) {
        const value = option.slice(prefix.length).split(":")[0]?.trim();
        if (value) found.add(value);
      }
    }
  }
  return found;
}

function messageById(id) {
  if (!id) return null;
  const messages = globalThis.game?.messages;
  if (!messages) return null;
  if (typeof messages.get === "function") return messages.get(id) ?? null;
  const list = Array.isArray(messages) ? messages : [...messages];
  return list.find((message) => message?.id === id) ?? null;
}

export function resolvePf2eDamageTypes(message) {
  const flags = pf2eFlags(message);
  const found = new Set();
  for (const value of damageTypeCandidates(flags?.damageRoll?.types)) found.add(value);
  for (const value of damageTypesFromOptions(flags?.context?.options)) found.add(value);

  const originMessageId = flags?.origin?.messageId;
  const originMessage = messageById(originMessageId);
  if (originMessage && originMessage !== message) {
    const originFlags = pf2eFlags(originMessage);
    for (const value of damageTypeCandidates(originFlags?.damageRoll?.types)) found.add(value);
    for (const value of damageTypesFromOptions(originFlags?.context?.options)) found.add(value);
  }
  return [...found];
}

/** Convert PF2e's synchronized damage application ChatMessage into a stable
 * event that active Affliction controllers can consume. */
export function inspectPf2eAfflictionReactionEvent(message) {
  const flags = pf2eFlags(message);
  const type = flags?.context?.type ?? null;
  const actor = type === "damage-taken" ? messageActor(message) : null;
  const positiveDamage = type === "damage-taken" && positiveDamageApplied(message);
  const damageTypes = positiveDamage ? resolvePf2eDamageTypes(message) : [];
  return Object.freeze({
    matched: Boolean(actor && positiveDamage),
    event: type === "damage-taken" ? "damage-taken" : null,
    actor,
    actorUuid: actor?.uuid ?? null,
    messageId: message?.id ?? null,
    messageUuid: message?.uuid ?? (message?.id ? `ChatMessage.${message.id}` : null),
    damageTypes: Object.freeze(damageTypes),
    damageTypesKnown: damageTypes.length > 0
  });
}

/** Convert a PF2e embedded Condition creation/value increase into a stable
 * event. `condition-increased` includes the first gain of a valued condition
 * (0 -> value) as well as later increases. */
export function inspectPf2eConditionReactionEvent(item, { previousValue = null, options = {}, eventId = null } = {}) {
  const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
  if (!actor || !isConditionItem(item)) {
    return Object.freeze({ matched: false, event: null, actor: null, actorUuid: null });
  }
  const current = conditionValue(item);
  const previous = Number.isFinite(Number(previousValue)) ? Math.trunc(Number(previousValue)) : 0;
  const increased = Number.isInteger(current) && current > previous;
  const slug = conditionSlug(item);
  const id = eventId ?? `condition-${++conditionEventSerial}`;
  return Object.freeze({
    matched: Boolean(increased && slug),
    event: "condition-increased",
    eventId: id,
    actor,
    actorUuid: actor.uuid ?? null,
    conditionItem: item,
    conditionItemUuid: item.uuid ?? null,
    conditionSlug: slug,
    previousValue: previous,
    conditionValue: current,
    conditionDelta: increased ? current - previous : 0,
    reactionChain: Object.freeze(reactionChainFromOptions(options)),
    damageTypes: Object.freeze([]),
    damageTypesKnown: false
  });
}

export function inspectFoundryInitiativeReactionEvent(combatant, changes = {}, { eventId = null } = {}) {
  const hasInitiativeChange = changes && typeof changes === "object" && Object.prototype.hasOwnProperty.call(changes, "initiative");
  const actor = combatant?.actor ?? combatant?.token?.actor ?? null;
  const initiative = Number(combatant?.initiative ?? changes?.initiative);
  return Object.freeze({
    matched: Boolean(hasInitiativeChange && actor && Number.isFinite(initiative)),
    event: hasInitiativeChange ? "initiative-rolled" : null,
    eventId: eventId ?? `initiative-${++conditionEventSerial}`,
    actor,
    actorUuid: actor?.uuid ?? null,
    combatantUuid: combatant?.uuid ?? null,
    initiative: Number.isFinite(initiative) ? initiative : null,
    damageTypes: Object.freeze([]),
    damageTypesKnown: false,
    reactionChain: Object.freeze([])
  });
}

export function inspectFoundryTurnStartReactionEvent(combat, { eventId = null } = {}) {
  const combatant = combat?.combatant ?? null;
  const actor = combatant?.actor ?? combatant?.token?.actor ?? null;
  const round = Number(combat?.round);
  const turn = Number(combat?.turn);
  return Object.freeze({
    matched: Boolean(actor && combatant),
    event: actor && combatant ? "turn-start" : null,
    eventId: eventId ?? `turn-${combat?.id ?? "combat"}-${Number.isFinite(round) ? round : "r"}-${Number.isFinite(turn) ? turn : "t"}-${++conditionEventSerial}`,
    actor,
    actorUuid: actor?.uuid ?? null,
    combatUuid: combat?.uuid ?? null,
    combatantUuid: combatant?.uuid ?? null,
    round: Number.isFinite(round) ? round : null,
    turn: Number.isFinite(turn) ? turn : null,
    damageTypes: Object.freeze([]),
    damageTypesKnown: false,
    reactionChain: Object.freeze([])
  });
}

export function eventReactionMatches(reaction, event) {
  if (!reaction || !event?.matched || reaction?.trigger?.event !== event.event) return false;
  if (event.event === "damage-taken") {
    const required = Array.isArray(reaction?.trigger?.damageTypes)
      ? reaction.trigger.damageTypes.map((entry) => String(entry).toLowerCase()).filter(Boolean)
      : [];
    if (required.length === 0) return true;
    const actual = new Set((event.damageTypes ?? []).map((entry) => String(entry).toLowerCase()));
    return required.some((type) => actual.has(type));
  }
  if (event.event === "condition-increased") {
    const required = Array.isArray(reaction?.trigger?.conditionSlugs)
      ? reaction.trigger.conditionSlugs.map((entry) => String(entry).toLowerCase()).filter(Boolean)
      : [];
    return required.length === 0 || required.includes(String(event.conditionSlug ?? "").toLowerCase());
  }
  return true;
}

function reactionKey(event, controller, reaction) {
  return [event?.messageUuid ?? event?.messageId ?? event?.eventId ?? "event", controller?.uuid ?? controller?.id ?? "controller", reaction?.id ?? "reaction"].join("|");
}

function rememberProcessed(key) {
  processedReactionKeys.delete(key);
  processedReactionKeys.set(key, Date.now());
  while (processedReactionKeys.size > MAX_REACTION_HISTORY) {
    const oldest = processedReactionKeys.keys().next().value;
    processedReactionKeys.delete(oldest);
  }
}

function reactionContext(controller) {
  if (!isAfflictionController(controller)) return null;
  const flags = getAfflictionFlags(controller);
  if (!flags?.definitionSnapshot || !flags?.state) return null;
  const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
  const state = flags.state;
  if (state.status !== "active" || !Number.isInteger(state.currentStage) || state.currentStage < 1) return null;
  const stage = definition.stages.find((entry) => entry.number === state.currentStage) ?? null;
  return stage ? { controller, actor: controller.parent, definition, state, stage } : null;
}

function checkForReaction(definition, reaction) {
  return definition?.checks?.find((check) => check.id === reaction?.checkId) ?? null;
}

function outcomeApplies(reaction, degree) {
  return OUTCOME_KEYS.includes(degree) && reaction?.applyOn?.includes?.(degree);
}
function controllerActionForOutcome(reaction, degree) {
  if (!OUTCOME_KEYS.includes(degree)) return "none";
  const action = String(reaction?.controllerActions?.[degree] ?? "none").toLowerCase();
  return ["recover", "end"].includes(action) ? action : "none";
}

async function applyControllerOutcome({ controller, reaction, degree }) {
  const action = controllerActionForOutcome(reaction, degree);
  if (action === "none") return Object.freeze({ applied: false, action: "none" });
  const api = globalThis.game?.modules?.get?.(MODULE_ID)?.api;
  if (typeof api?.instances?.end !== "function") {
    throw new Error("Affliction instance end API is unavailable for reaction controller outcomes.");
  }
  await api.instances.end(controller, { reason: action === "recover" ? "recovered" : "reaction-ended" });
  return Object.freeze({ applied: true, action });
}


async function executeReactionEffect({ controller, actor, definition, stage, reaction, event, degree = null, direct = false }) {
  if ((!direct && !outcomeApplies(reaction, degree)) || !reaction.effect) return { applied: false, results: [] };
  const criticalApi = getCriticalForgeApi();
  if (typeof criticalApi?.effects?.execute !== "function") {
    throw new Error("Critical Forge Effect execution API is unavailable for Affliction event reactions.");
  }
  const results = await criticalApi.effects.execute(reaction.effect, actor, {
    context: {
      actor,
      target: actor,
      source: controller,
      affliction: definition,
      stage,
      reaction,
      event
    },
    item: controller,
    label: reaction.label || `${definition.name} · ${stage.name || stage.number}`
  });
  return { applied: true, results: Array.isArray(results) ? results : [results].filter(Boolean) };
}

async function applyTriggeringConditionDelta({ controller, reaction, event }) {
  const delta = Math.trunc(Number(reaction?.conditionValueDelta) || 0);
  const item = event?.conditionItem;
  if (delta === 0 || event?.event !== "condition-increased" || !item || !isConditionItem(item)) {
    return Object.freeze({ applied: false, previous: null, value: null, delta: 0 });
  }
  const current = conditionValue(item);
  if (!Number.isInteger(current)) return Object.freeze({ applied: false, previous: null, value: null, delta: 0 });
  const maximum = conditionMaximum(item);
  const next = Math.max(0, Number.isInteger(maximum) ? Math.min(maximum, current + delta) : current + delta);
  if (next === current) return Object.freeze({ applied: false, previous: current, value: current, delta: 0 });
  const identity = reactionIdentity(controller, reaction);
  const chain = [...new Set([...(event.reactionChain ?? []), identity])];
  await item.update({ "system.value.value": next }, {
    render: false,
    [MODULE_ID]: {
      conditionReactionChain: chain,
      conditionReactionSource: identity
    }
  });
  return Object.freeze({ applied: true, previous: current, value: next, delta: next - current });
}

function gmWhisperIds() {
  const users = globalThis.game?.users;
  const list = users ? (Array.isArray(users) ? users : [...users]) : [];
  return list.filter((user) => user?.isGM).map((user) => user.id);
}

async function createReactionSummary({ controller, actor, definition, stage, reaction, event, check = null, result = null, effectApplied, conditionAdjustment = null, controllerOutcome = null }) {
  if (!globalThis.ChatMessage?.create) return null;
  const checkLine = check && result
    ? `<p>${escapeHtml(check.label || check.statistic)} SG ${escapeHtml(check.dc)}: <strong>${escapeHtml(localize(`PF2E_AFFLICTION_FORGE.Runtime.Degree.${result.degree}`, result.degree))}</strong></p>`
    : `<p>${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Reaction.DirectResolved", "Auslöser ohne Zusatzwurf verarbeitet."))}</p>`;
  const conditionLine = conditionAdjustment?.applied
    ? `<p>${escapeHtml(format("PF2E_AFFLICTION_FORGE.Reaction.ConditionAdjusted", {
        condition: event?.conditionSlug ?? "",
        previous: conditionAdjustment.previous,
        value: conditionAdjustment.value
      }, ({ condition, previous, value }) => `${condition}: ${previous} → ${value}`))}</p>`
    : "";
  const controllerLine = controllerOutcome?.applied
    ? `<p>${escapeHtml(controllerOutcome.action === "recover"
        ? localize("PF2E_AFFLICTION_FORGE.Reaction.ControllerRecovered", "Leiden durch Reaktion geheilt.")
        : localize("PF2E_AFFLICTION_FORGE.Reaction.ControllerEnded", "Leiden durch Reaktion beendet."))}</p>`
    : "";
  const outputApplied = Boolean(effectApplied || conditionAdjustment?.applied || controllerOutcome?.applied);
  const content = `<div class="pf2e-affliction-reaction-summary">
    <h4><i class="fa-solid fa-bolt"></i> ${escapeHtml(definition.name)} · ${escapeHtml(actor?.name ?? "")}</h4>
    <p><strong>${escapeHtml(reaction.label || localize("PF2E_AFFLICTION_FORGE.Reaction.EventReaction", "Ereignisreaktion"))}</strong></p>
    ${checkLine}
    ${conditionLine}
    ${controllerLine}
    <p>${escapeHtml(outputApplied
      ? localize("PF2E_AFFLICTION_FORGE.Reaction.EffectApplied", "Reaktionseffekt angewendet.")
      : localize("PF2E_AFFLICTION_FORGE.Reaction.NoEffect", "Kein Reaktionseffekt bei diesem Ergebnis."))}</p>
  </div>`;
  return ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker?.({ actor }) ?? {},
    whisper: gmWhisperIds(),
    flags: {
      [MODULE_ID]: {
        runtimeEvent: "affliction-event-reaction-resolved",
        controllerUuid: controllerUuidSafe(controller),
        reactionId: reaction.id,
        sourceMessageUuid: event.messageUuid ?? null,
        sourceEventId: event.eventId ?? null,
        stageNumber: stage.number,
        degree: result?.degree ?? null
      }
    }
  });
}

function controllerUuidSafe(controller) {
  return controller?.uuid ?? null;
}

function requestMessageForReaction(requestId) {
  const messages = globalThis.game?.messages;
  if (!messages) return null;
  const list = Array.isArray(messages) ? messages : [...messages];
  return list.find((message) => {
    const request = message?.flags?.[MODULE_ID]?.saveRequest;
    return request?.purpose === "reaction" && request?.requestId === requestId;
  }) ?? null;
}

function serializeReactionEvent(event) {
  if (!event) return null;
  return {
    matched: Boolean(event.matched),
    event: event.event ?? null,
    eventId: event.eventId ?? null,
    actorUuid: event.actorUuid ?? event.actor?.uuid ?? null,
    messageId: event.messageId ?? null,
    messageUuid: event.messageUuid ?? null,
    conditionItemUuid: event.conditionItemUuid ?? event.conditionItem?.uuid ?? null,
    conditionSlug: event.conditionSlug ?? null,
    previousValue: Number.isInteger(event.previousValue) ? event.previousValue : null,
    conditionValue: Number.isInteger(event.conditionValue) ? event.conditionValue : null,
    conditionDelta: Number.isInteger(event.conditionDelta) ? event.conditionDelta : null,
    combatUuid: event.combatUuid ?? null,
    combatantUuid: event.combatantUuid ?? null,
    initiative: Number.isFinite(Number(event.initiative)) ? Number(event.initiative) : null,
    round: Number.isFinite(Number(event.round)) ? Number(event.round) : null,
    turn: Number.isFinite(Number(event.turn)) ? Number(event.turn) : null,
    reactionChain: [...(event.reactionChain ?? [])],
    damageTypes: [...(event.damageTypes ?? [])],
    damageTypesKnown: Boolean(event.damageTypesKnown)
  };
}

async function restoreReactionEvent(snapshot, actor) {
  if (!snapshot) return null;
  const conditionItem = snapshot.conditionItemUuid ? await globalThis.fromUuid?.(snapshot.conditionItemUuid) : null;
  return Object.freeze({
    ...snapshot,
    matched: true,
    actor,
    actorUuid: actor?.uuid ?? snapshot.actorUuid ?? null,
    conditionItem,
    reactionChain: Object.freeze([...(snapshot.reactionChain ?? [])]),
    damageTypes: Object.freeze([...(snapshot.damageTypes ?? [])])
  });
}

async function finalizeReaction({ controller, actor, definition, stage, reaction, event, check = null, result = null, key }) {
  const direct = !check;
  const outputEnabled = direct || outcomeApplies(reaction, result?.degree);
  const conditionAdjustment = outputEnabled
    ? await applyTriggeringConditionDelta({ controller, reaction, event })
    : Object.freeze({ applied: false, previous: null, value: null, delta: 0 });
  const effect = await executeReactionEffect({
    controller, actor, definition, stage, reaction, event, degree: result?.degree ?? null, direct
  });
  const controllerOutcome = check && result
    ? await applyControllerOutcome({ controller, reaction, degree: result.degree })
    : Object.freeze({ applied: false, action: "none" });
  rememberProcessed(key);
  pendingReactionKeys.delete(key);
  await createReactionSummary({
    controller, actor, definition, stage, reaction, event, check, result,
    effectApplied: effect.applied, conditionAdjustment, controllerOutcome
  });
  const payload = Object.freeze({
    controllerUuid: controller.uuid,
    actorUuid: actor?.uuid ?? null,
    reactionId: reaction.id,
    stageNumber: stage.number,
    event,
    checkId: check?.id ?? null,
    result: result ? Object.freeze({ ...result }) : null,
    effectApplied: effect.applied,
    conditionAdjustment,
    controllerOutcome
  });
  globalThis.Hooks?.callAll?.("pf2eAfflictionForgeReactionResolved", payload);
  return Object.freeze({
    status: "resolved", controller, reaction, event, result,
    effectApplied: effect.applied, conditionAdjustment, controllerOutcome
  });
}

async function requestPlayerReactionSave({ controller, actor, definition, stage, reaction, event, check, policy, key }) {
  const targetUserId = preferredPlayerOwnerId(actor);
  if (!targetUserId) return null;
  const requestId = randomId("affliction-reaction");
  const request = {
    purpose: "reaction",
    requestId,
    controllerUuid: controller.uuid,
    actorUuid: actor.uuid,
    checkId: check.id,
    label: reaction.label || check.label || "",
    statistic: check.statistic,
    dc: check.dc,
    visibility: policy.visibility,
    identificationState: getAfflictionFlags(controller)?.state?.identification?.state ?? "identified",
    targetUserId,
    userIds: [targetUserId],
    requestedByUserId: globalThis.game?.user?.id ?? null,
    reactionId: reaction.id,
    stageNumber: stage.number,
    eventMessageId: event.messageId ?? null,
    eventMessageUuid: event.messageUuid ?? null,
    eventSnapshot: serializeReactionEvent(event),
    reactionKey: key,
    degreeAdjustment: incapacitationDegreeAdjustment(definition, actor)
  };
  await createPlayerSaveRequestMessage(actor, request);
  emitPlayerSavePrompt(request);
  pendingReactionKeys.add(key);
  return Object.freeze({ status: "awaiting-player", controller, reaction, event, request });
}

async function processReaction(context, reaction, event) {
  const { controller, actor, definition, state, stage } = context;
  const identity = reactionIdentity(controller, reaction);
  if (event?.reactionChain?.includes?.(identity)) return Object.freeze({ status: "reaction-chain-suppressed", controller, reaction, event });
  const key = reactionKey(event, controller, reaction);
  if (processedReactionKeys.has(key) || pendingReactionKeys.has(key)) return Object.freeze({ status: "duplicate", controller, reaction, event });
  const hasCheck = reaction?.checkId != null && String(reaction.checkId).trim() !== "";
  const check = hasCheck ? checkForReaction(definition, reaction) : null;
  if (hasCheck && !check) return Object.freeze({ status: "invalid-check", controller, reaction, event });
  if (reaction?.trigger?.damageTypes?.length > 0 && !event.damageTypesKnown) {
    return Object.freeze({ status: "damage-type-unresolved", controller, reaction, event });
  }
  if (!hasCheck) {
    pendingReactionKeys.add(key);
    try {
      return await finalizeReaction({ controller, actor, definition, stage, reaction, event, check: null, result: null, key });
    } catch (error) {
      pendingReactionKeys.delete(key);
      throw error;
    }
  }
  const policy = resolveSavePolicy(definition, check) ?? { execution: "player", visibility: "public" };
  if (policy.execution === "player") {
    const requested = await requestPlayerReactionSave({ controller, actor, definition, stage, reaction, event, check, policy, key });
    if (requested) return requested;
  }
  const execution = policy.execution === "automatic" ? "automatic" : "gm";
  pendingReactionKeys.add(key);
  try {
    const result = await rollPf2eSave(actor, check, {
      skipDialog: execution === "automatic",
      visibility: policy.visibility,
      execution,
      dcVisible: state.identification?.state === "identified" || globalThis.game?.user?.isGM,
      extraRollOptions: [
        `affliction-forge:reaction:${encodeURIComponent(reaction.id)}`,
        `affliction-forge:controller:${encodeURIComponent(controller.uuid)}`,
        `affliction-forge:event:${encodeURIComponent(event.messageUuid ?? event.messageId ?? "")}`
      ]
    });
    if (!result) {
      pendingReactionKeys.delete(key);
      return Object.freeze({ status: "cancelled", controller, reaction, event });
    }
    const adjustedResult = {
      ...result,
      rawDegree: result.rawDegree ?? result.degree,
      degree: adjustAfflictionSaveDegree(definition, actor, result.rawDegree ?? result.degree)
    };
    return finalizeReaction({ controller, actor, definition, stage, reaction, event, check, result: adjustedResult, key });
  } catch (error) {
    pendingReactionKeys.delete(key);
    throw error;
  }
}

export async function processAfflictionReactionEvent(event, { force = false } = {}) {
  if (!force && !authoritativeGm()) return Object.freeze({ status: "not-authoritative", event, results: Object.freeze([]) });
  if (!event?.matched || !event.actor) return Object.freeze({ status: "ignored", event, results: Object.freeze([]) });
  const contexts = itemCollection(event.actor).map(reactionContext).filter(Boolean);
  const results = [];
  for (const context of contexts) {
    for (const reaction of context.stage.reactions ?? []) {
      if (!eventReactionMatches(reaction, event)) continue;
      try {
        results.push(await processReaction(context, reaction, event));
      } catch (error) {
        console.error(`${MODULE_ID} | Affliction event reaction failed.`, {
          controllerUuid: context.controller?.uuid,
          reactionId: reaction?.id,
          event,
          error
        });
        results.push(Object.freeze({ status: "error", controller: context.controller, reaction, event, error }));
      }
    }
  }
  return Object.freeze({ status: results.length > 0 ? "processed" : "no-match", event, results: Object.freeze(results) });
}

export async function processAfflictionEventReactionMessage(message, { force = false } = {}) {
  return processAfflictionReactionEvent(inspectPf2eAfflictionReactionEvent(message), { force });
}

export async function acceptAfflictionReactionPlayerResult(payload = {}) {
  if (!authoritativeGm()) return Object.freeze({ status: "not-authoritative" });
  if (payload?.purpose !== "reaction" || !payload?.requestId || !payload?.controllerUuid || !payload?.reactionId) {
    return Object.freeze({ status: "invalid" });
  }
  const requestMessage = requestMessageForReaction(payload.requestId);
  const request = requestMessage?.flags?.[MODULE_ID]?.saveRequest ?? null;
  if (!request || request.controllerUuid !== payload.controllerUuid || request.reactionId !== payload.reactionId) {
    return Object.freeze({ status: "orphaned" });
  }
  if (!request.userIds?.includes(payload.userId)) return Object.freeze({ status: "unauthorized" });
  const controller = await globalThis.fromUuid?.(payload.controllerUuid);
  const context = reactionContext(controller);
  if (!context || context.stage.number !== request.stageNumber) return Object.freeze({ status: "stale" });
  const reaction = (context.stage.reactions ?? []).find((entry) => entry.id === request.reactionId);
  const check = checkForReaction(context.definition, reaction);
  if (!reaction || !check || check.id !== request.checkId) return Object.freeze({ status: "stale" });
  const eventMessage = request.eventMessageId ? messageById(request.eventMessageId) : null;
  const event = eventMessage
    ? inspectPf2eAfflictionReactionEvent(eventMessage)
    : (await restoreReactionEvent(request.eventSnapshot, context.actor)) ?? Object.freeze({
        matched: true,
        event: reaction.trigger.event,
        actor: context.actor,
        actorUuid: context.actor?.uuid ?? null,
        messageId: request.eventMessageId ?? null,
        messageUuid: request.eventMessageUuid ?? null,
        damageTypes: Object.freeze([]),
        damageTypesKnown: false,
        reactionChain: Object.freeze([])
      });
  const key = request.reactionKey || reactionKey(event, controller, reaction);
  if (processedReactionKeys.has(key)) return Object.freeze({ status: "duplicate" });
  const rawDegree = normalizeDegreeOfSuccess(payload.rawDegree ?? payload.degree);
  if (!rawDegree || !OUTCOME_KEYS.includes(rawDegree)) return Object.freeze({ status: "invalid-result" });
  const degree = adjustAfflictionSaveDegree(context.definition, context.actor, rawDegree);
  const result = {
    degree,
    rawDegree,
    total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : null,
    d20: Number.isInteger(Number(payload.d20)) ? Number(payload.d20) : null,
    rollId: payload.rollId ?? null,
    execution: "player",
    visibility: request.visibility,
    userId: payload.userId,
    resolvedAt: nowWorldTime()
  };
  return finalizeReaction({ ...context, reaction, event, check, result, key });
}

function onCreateChatMessage(message) {
  if (!authoritativeGm()) return;
  if (message?.flags?.[MODULE_ID]?.runtimeEvent) return;
  void processAfflictionEventReactionMessage(message).catch((error) => {
    console.error(`${MODULE_ID} | Could not process Affliction event reaction ChatMessage.`, error);
  });
}

function cacheCondition(item) {
  if (!isConditionItem(item)) return;
  const key = conditionCacheKey(item);
  const value = conditionValue(item);
  if (key && Number.isInteger(value)) conditionValueCache.set(key, value);
}

function seedConditionValueCache() {
  conditionValueCache.clear();
  const actors = globalThis.game?.actors;
  const actorList = actors ? (Array.isArray(actors) ? actors : [...actors]) : [];
  const tokenActors = globalThis.canvas?.tokens?.placeables?.map?.((token) => token?.actor).filter(Boolean) ?? [];
  const seen = new Set();
  for (const actor of [...actorList, ...tokenActors]) {
    const key = actor?.uuid ?? actor?.id;
    if (!actor || (key && seen.has(key))) continue;
    if (key) seen.add(key);
    for (const item of itemCollection(actor)) cacheCondition(item);
  }
}

function onCreateItem(item, options = {}) {
  if (!isConditionItem(item)) return;
  const current = conditionValue(item);
  const key = conditionCacheKey(item);
  if (key && Number.isInteger(current)) conditionValueCache.set(key, current);
  if (!authoritativeGm()) return;
  const event = inspectPf2eConditionReactionEvent(item, { previousValue: 0, options });
  if (!event.matched) return;
  void processAfflictionReactionEvent(event).catch((error) => {
    console.error(`${MODULE_ID} | Could not process Affliction condition-created reaction.`, error);
  });
}

function onUpdateItem(item, _changes = {}, options = {}) {
  if (!isConditionItem(item)) return;
  const key = conditionCacheKey(item);
  const current = conditionValue(item);
  const previous = key && conditionValueCache.has(key) ? conditionValueCache.get(key) : current;
  if (key && Number.isInteger(current)) conditionValueCache.set(key, current);
  if (!authoritativeGm() || !Number.isInteger(current) || !Number.isInteger(previous) || current <= previous) return;
  const event = inspectPf2eConditionReactionEvent(item, { previousValue: previous, options });
  if (!event.matched) return;
  void processAfflictionReactionEvent(event).catch((error) => {
    console.error(`${MODULE_ID} | Could not process Affliction condition-increased reaction.`, error);
  });
}

function onDeleteItem(item) {
  if (!isConditionItem(item)) return;
  const key = conditionCacheKey(item);
  if (key) conditionValueCache.delete(key);
}

function onUpdateCombatant(combatant, changes = {}) {
  if (!authoritativeGm()) return;
  const event = inspectFoundryInitiativeReactionEvent(combatant, changes);
  if (!event.matched) return;
  void processAfflictionReactionEvent(event).catch((error) => {
    console.error(`${MODULE_ID} | Could not process Affliction initiative reaction.`, error);
  });
}

function onCombatTurnChange(combat) {
  if (!authoritativeGm()) return;
  const event = inspectFoundryTurnStartReactionEvent(combat);
  if (!event.matched) return;
  void processAfflictionReactionEvent(event).catch((error) => {
    console.error(`${MODULE_ID} | Could not process Affliction turn-start reaction.`, error);
  });
}

export function afflictionEventReactionRuntimeStatus() {
  return Object.freeze({
    initialized,
    authoritative: authoritativeGm(),
    processed: processedReactionKeys.size,
    pending: pendingReactionKeys.size,
    conditionCache: conditionValueCache.size
  });
}

export function initializeAfflictionEventReactionRuntime() {
  if (initialized) return;
  initialized = true;
  seedConditionValueCache();
  globalThis.Hooks?.on?.("createChatMessage", onCreateChatMessage);
  globalThis.Hooks?.on?.("createItem", onCreateItem);
  globalThis.Hooks?.on?.("updateItem", onUpdateItem);
  globalThis.Hooks?.on?.("deleteItem", onDeleteItem);
  globalThis.Hooks?.on?.("updateCombatant", onUpdateCombatant);
  globalThis.Hooks?.on?.("combatTurnChange", onCombatTurnChange);
  globalThis.Hooks?.on?.("canvasReady", seedConditionValueCache);
}
