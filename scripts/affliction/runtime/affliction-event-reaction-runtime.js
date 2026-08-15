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

const MAX_REACTION_HISTORY = 1000;
const processedReactionKeys = new Map();
const pendingReactionKeys = new Set();
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
  if (!value || typeof value !== "object") return output;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = String(key).trim().toLowerCase();
    if (normalized) output.add(normalized);
    if (nested && typeof nested === "object") damageTypeCandidates(nested, output);
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

export function eventReactionMatches(reaction, event) {
  if (!reaction || !event?.matched || reaction?.trigger?.event !== event.event) return false;
  const required = Array.isArray(reaction?.trigger?.damageTypes)
    ? reaction.trigger.damageTypes.map((entry) => String(entry).toLowerCase()).filter(Boolean)
    : [];
  if (required.length === 0) return true;
  const actual = new Set((event.damageTypes ?? []).map((entry) => String(entry).toLowerCase()));
  return required.some((type) => actual.has(type));
}

function reactionKey(event, controller, reaction) {
  return [event?.messageUuid ?? event?.messageId ?? "event", controller?.uuid ?? controller?.id ?? "controller", reaction?.id ?? "reaction"].join("|");
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

async function executeReactionEffect({ controller, actor, definition, stage, reaction, event, degree }) {
  if (!outcomeApplies(reaction, degree) || !reaction.effect) return { applied: false, results: [] };
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

function gmWhisperIds() {
  const users = globalThis.game?.users;
  const list = users ? (Array.isArray(users) ? users : [...users]) : [];
  return list.filter((user) => user?.isGM).map((user) => user.id);
}

async function createReactionSummary({ controller, actor, definition, stage, reaction, event, check, result, effectApplied }) {
  if (!globalThis.ChatMessage?.create) return null;
  const degree = localize(`PF2E_AFFLICTION_FORGE.Runtime.Degree.${result.degree}`, result.degree);
  const content = `<div class="pf2e-affliction-reaction-summary">
    <h4><i class="fa-solid fa-bolt"></i> ${escapeHtml(definition.name)} · ${escapeHtml(actor?.name ?? "")}</h4>
    <p><strong>${escapeHtml(reaction.label || localize("PF2E_AFFLICTION_FORGE.Reaction.EventReaction", "Ereignisreaktion"))}</strong></p>
    <p>${escapeHtml(check.label || check.statistic)} SG ${escapeHtml(check.dc)}: <strong>${escapeHtml(degree)}</strong></p>
    <p>${escapeHtml(effectApplied
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
        sourceMessageUuid: event.messageUuid,
        stageNumber: stage.number,
        degree: result.degree
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

async function finalizeReaction({ controller, actor, definition, stage, reaction, event, check, result, key }) {
  const effect = await executeReactionEffect({ controller, actor, definition, stage, reaction, event, degree: result.degree });
  rememberProcessed(key);
  pendingReactionKeys.delete(key);
  await createReactionSummary({ controller, actor, definition, stage, reaction, event, check, result, effectApplied: effect.applied });
  globalThis.Hooks?.callAll?.("pf2eAfflictionForgeReactionResolved", Object.freeze({
    controllerUuid: controller.uuid,
    actorUuid: actor?.uuid ?? null,
    reactionId: reaction.id,
    stageNumber: stage.number,
    event,
    checkId: check.id,
    result: Object.freeze({ ...result }),
    effectApplied: effect.applied
  }));
  return Object.freeze({ status: "resolved", controller, reaction, event, result, effectApplied: effect.applied });
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
    eventMessageId: event.messageId,
    eventMessageUuid: event.messageUuid,
    reactionKey: key
  };
  await createPlayerSaveRequestMessage(actor, request);
  emitPlayerSavePrompt(request);
  pendingReactionKeys.add(key);
  return Object.freeze({ status: "awaiting-player", controller, reaction, event, request });
}

async function processReaction(context, reaction, event) {
  const { controller, actor, definition, state, stage } = context;
  const key = reactionKey(event, controller, reaction);
  if (processedReactionKeys.has(key) || pendingReactionKeys.has(key)) return Object.freeze({ status: "duplicate", controller, reaction, event });
  const check = checkForReaction(definition, reaction);
  if (!check) return Object.freeze({ status: "invalid-check", controller, reaction, event });
  if (reaction?.trigger?.damageTypes?.length > 0 && !event.damageTypesKnown) {
    return Object.freeze({ status: "damage-type-unresolved", controller, reaction, event });
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
    return finalizeReaction({ controller, actor, definition, stage, reaction, event, check, result, key });
  } catch (error) {
    pendingReactionKeys.delete(key);
    throw error;
  }
}

export async function processAfflictionEventReactionMessage(message, { force = false } = {}) {
  if (!force && !authoritativeGm()) return Object.freeze({ status: "not-authoritative", event: null, results: Object.freeze([]) });
  const event = inspectPf2eAfflictionReactionEvent(message);
  if (!event.matched) return Object.freeze({ status: "ignored", event, results: Object.freeze([]) });
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
  const event = eventMessage ? inspectPf2eAfflictionReactionEvent(eventMessage) : Object.freeze({
    matched: true,
    event: reaction.trigger.event,
    actor: context.actor,
    actorUuid: context.actor?.uuid ?? null,
    messageId: request.eventMessageId ?? null,
    messageUuid: request.eventMessageUuid ?? null,
    damageTypes: Object.freeze([]),
    damageTypesKnown: false
  });
  const key = request.reactionKey || reactionKey(event, controller, reaction);
  if (processedReactionKeys.has(key)) return Object.freeze({ status: "duplicate" });
  const degree = OUTCOME_KEYS.includes(payload.degree) ? payload.degree : null;
  if (!degree) return Object.freeze({ status: "invalid-result" });
  const result = {
    degree,
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

export function afflictionEventReactionRuntimeStatus() {
  return Object.freeze({
    initialized,
    authoritative: authoritativeGm(),
    processed: processedReactionKeys.size,
    pending: pendingReactionKeys.size
  });
}

export function initializeAfflictionEventReactionRuntime() {
  if (initialized) return;
  initialized = true;
  globalThis.Hooks?.on?.("createChatMessage", onCreateChatMessage);
}
