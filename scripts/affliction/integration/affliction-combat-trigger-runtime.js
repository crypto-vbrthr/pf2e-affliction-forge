import { MODULE_ID } from "../../constants.js";
import {
  consumeInjuryPoisonCharge,
  findAfflictionReference,
  isInjuryPoisonReference,
  readAfflictionReferences
} from "./affliction-reference-service.js";
import { resolvePf2eDamageTypes } from "../runtime/affliction-event-reaction-runtime.js";

const MAX_PROCESSED_TRIGGER_KEYS = 500;
let triggerRuntimeInitialized = false;
const processedTriggerKeys = new Map();
const inFlightTriggerKeys = new Set();
const consumableReferenceQueues = new Map();

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function format(key, data = {}) {
  return globalThis.game?.i18n?.format?.(key, data) ?? localize(key);
}

function moduleApi() {
  return globalThis.game?.modules?.get?.(MODULE_ID)?.api ?? null;
}

function authoritativeGm() {
  if (!globalThis.game?.user?.isGM) return false;
  const activeGM = globalThis.game?.users?.activeGM;
  return !activeGM?.id || activeGM.id === globalThis.game.user.id;
}

function safeUuid(document) {
  return typeof document?.uuid === "string" && document.uuid ? document.uuid : null;
}

function pf2eFlags(message) {
  return message?.flags?.pf2e ?? message?.flags?.PF2E ?? {};
}

function messageContext(message) {
  return pf2eFlags(message)?.context ?? null;
}

function messageOutcome(message) {
  const context = messageContext(message);
  const outcome = context?.outcome ?? pf2eFlags(message)?.damageRoll?.outcome ?? null;
  return typeof outcome === "string" ? outcome : null;
}

function messageActor(message) {
  try {
    return message?.actor ?? message?.speakerActor ?? null;
  } catch {
    return message?.speakerActor ?? null;
  }
}

function messageItem(message) {
  try {
    return message?.item ?? null;
  } catch {
    return null;
  }
}

function resolveUuidSync(uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  try {
    if (typeof globalThis.fromUuidSync === "function") return globalThis.fromUuidSync(uuid);
  } catch {
    // Fall through to null. Trigger processing can only safely continue with
    // source/target documents that are already locally resolvable.
  }
  return null;
}

async function resolveUuid(uuid) {
  const sync = resolveUuidSync(uuid);
  if (sync) return sync;
  try {
    if (typeof globalThis.fromUuid === "function") return await globalThis.fromUuid(uuid);
  } catch {
    // Ignore invalid/deleted UUIDs.
  }
  return null;
}

async function sourceItemForMessage(message) {
  const direct = messageItem(message);
  if (direct?.documentName === "Item" || direct?.constructor?.documentName === "Item") return direct;

  const flags = pf2eFlags(message);
  const originUuid = typeof flags?.origin?.uuid === "string" ? flags.origin.uuid : null;
  const origin = await resolveUuid(originUuid);
  if (origin?.documentName === "Item" || origin?.constructor?.documentName === "Item") return origin;

  const context = flags?.context;
  const actor = messageActor(message);
  const itemId = typeof context?.item === "string" ? context.item : null;
  return itemId ? actor?.items?.get?.(itemId) ?? null : null;
}

async function actorFromActorOrTokenUuid(uuid) {
  const document = await resolveUuid(uuid);
  if (!document) return null;
  if (document.documentName === "Actor" || document.constructor?.documentName === "Actor") return document;
  if (document.documentName === "Token" || document.documentName === "TokenDocument" || document.constructor?.documentName === "TokenDocument") {
    return document.actor ?? null;
  }
  return document.actor ?? null;
}

async function contextTargetActor(message) {
  try {
    const target = message?.target?.actor;
    if (target) return target;
  } catch {
    // Fall back to the serialized context below.
  }

  const target = messageContext(message)?.target ?? null;
  const uuid = typeof target?.actor === "string"
    ? target.actor
    : typeof target?.token === "string"
      ? target.token
      : null;
  return actorFromActorOrTokenUuid(uuid);
}

function appliedPositiveDamage(message) {
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

function appliedDirectPositiveDamage(message) {
  const applied = pf2eFlags(message)?.appliedDamage;
  if (!applied || applied.isHealing === true || applied.isReverted === true) return false;
  const updates = Array.isArray(applied.updates) ? applied.updates : [];
  const hpDamage = updates.some((entry) =>
    typeof entry?.path === "string" && entry.path.includes("system.attributes.hp.value") && Number(entry?.value) > 0
  );
  const shieldDamage = Number(applied?.shield?.damage ?? 0) > 0;
  return hpDamage || shieldDamage;
}

function triggerLabels(triggers = []) {
  return [...new Set(triggers)].filter(Boolean);
}

/**
 * Convert a PF2e ChatMessage into semantic Affliction trigger events.
 *
 * Runtime semantics intentionally use PF2e's serialized chat context rather
 * than DOM/chat-card structure. PF2e check messages provide context.type,
 * outcome, target and origin, while damage application emits a dedicated
 * damage-taken message with appliedDamage and origin metadata.
 */
export async function inspectPf2eAfflictionTriggerMessage(message) {
  if (!message) return Object.freeze({ matched: false, triggers: Object.freeze([]) });

  const context = messageContext(message);
  const type = typeof context?.type === "string" ? context.type : null;
  const outcome = messageOutcome(message);
  const sourceItem = await sourceItemForMessage(message);
  if (!sourceItem) {
    return Object.freeze({
      matched: false,
      type,
      outcome,
      sourceItem: null,
      sourceItemUuid: null,
      targetActor: null,
      targetActorUuid: null,
      directPositiveDamage: false,
      damageTypes: Object.freeze([]),
      damageTypesKnown: false,
      triggers: Object.freeze([])
    });
  }

  let targetActor = null;
  const triggers = [];

  if (type === "attack-roll") {
    targetActor = await contextTargetActor(message);
    triggers.push("on-use");
    if (["success", "criticalSuccess"].includes(outcome)) triggers.push("on-hit");
  } else if (type === "damage-taken") {
    targetActor = messageActor(message);
    if (appliedPositiveDamage(message)) triggers.push("on-damage");
  } else if (type === "saving-throw") {
    targetActor = messageActor(message);
    if (["failure", "criticalFailure"].includes(outcome)) triggers.push("failed-save");
    if (outcome === "criticalFailure") triggers.push("critical-failure");
  } else if (type === "spell-cast") {
    targetActor = await contextTargetActor(message);
    triggers.push("on-use");
  } else if (type !== "damage-roll") {
    // PF2e action/feat Item cards do not always carry a dedicated context type.
    // Posting the host Item to chat is the best available system-level "use"
    // event in that workflow. A target is still required before application.
    targetActor = await contextTargetActor(message);
    triggers.push("on-use");
  }

  const damageTypes = type === "damage-taken" ? resolvePf2eDamageTypes(message) : [];
  const specificDamageTypes = damageTypes.filter((damageType) => !["physical", "energy"].includes(String(damageType).toLowerCase()));
  const uniqueTriggers = triggerLabels(triggers);
  return Object.freeze({
    // A damage-taken message is semantically relevant to an injury poison even
    // when it dealt no qualifying damage. The coating can be consumed without
    // exposing the target, so keep the event inspectable with an empty trigger list.
    matched: uniqueTriggers.length > 0 || type === "damage-taken",
    type,
    outcome,
    sourceItem,
    sourceItemUuid: safeUuid(sourceItem),
    sourceActorUuid:
      sourceItem?.actor?.uuid
      ?? sourceItem?.parent?.uuid
      ?? pf2eFlags(message)?.origin?.actor
      ?? null,
    targetActor,
    targetActorUuid: safeUuid(targetActor),
    targetTokenUuid: messageContext(message)?.target?.token ?? null,
    messageId: message?.id ?? null,
    messageUuid: message?.uuid ?? (message?.id ? `ChatMessage.${message.id}` : null),
    directPositiveDamage: type === "damage-taken" && appliedDirectPositiveDamage(message),
    damageTypes: Object.freeze(damageTypes),
    damageTypesKnown: specificDamageTypes.length > 0,
    triggers: Object.freeze(uniqueTriggers)
  });
}

export function injuryPoisonReferenceAction(reference, event) {
  if (!isInjuryPoisonReference(reference) || reference.enabled === false || !event) return null;
  if (event.type === "attack-roll" && event.outcome === "criticalFailure") return "consume";
  if (event.type !== "damage-taken") return null;

  const damageTypes = new Set((event.damageTypes ?? []).map((type) => String(type).toLowerCase()));
  if (event.damageTypesKnown === true) {
    const qualifying = damageTypes.has("slashing") || damageTypes.has("piercing");
    return event.directPositiveDamage === true && qualifying ? "apply-consume" : "consume";
  }

  // Never apply an injury poison when PF2e did not serialize enough damage
  // type information to prove slashing or piercing delivery. Preserve the
  // charge for a GM decision rather than silently poisoning on bludgeoning or
  // another non-qualifying damage type.
  if (event.directPositiveDamage === true) return "ambiguous";
  return "consume";
}

export function afflictionReferenceMatchesTrigger(reference, event) {
  if (!reference || reference.enabled === false || !event?.matched) return false;
  if (isInjuryPoisonReference(reference)) return injuryPoisonReferenceAction(reference, event) !== null;
  if (["manual", "custom"].includes(reference.trigger)) return false;
  return event.triggers?.includes?.(reference.trigger) ?? false;
}

function rememberProcessed(key) {
  processedTriggerKeys.delete(key);
  processedTriggerKeys.set(key, Date.now());
  while (processedTriggerKeys.size > MAX_PROCESSED_TRIGGER_KEYS) {
    const oldest = processedTriggerKeys.keys().next().value;
    processedTriggerKeys.delete(oldest);
  }
}

function alreadyProcessed(key) {
  return processedTriggerKeys.has(key);
}

function alreadyInFlight(key) {
  return inFlightTriggerKeys.has(key);
}

function triggerKey(message, reference, event) {
  return [
    message?.id ?? message?.uuid ?? "message",
    event?.sourceItemUuid ?? "source",
    reference?.id ?? "reference",
    reference?.trigger ?? "trigger",
    event?.targetActorUuid ?? "no-target"
  ].join("|");
}

function consumableReferenceKey(event, reference) {
  return [event?.sourceItemUuid ?? "source", reference?.id ?? "reference"].join("|");
}

async function withConsumableReferenceLock(key, task) {
  const previous = consumableReferenceQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  consumableReferenceQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (consumableReferenceQueues.get(key) === current) consumableReferenceQueues.delete(key);
  }
}

async function liveSourceItem(event) {
  if (event?.sourceItem?.update) return event.sourceItem;
  const resolved = await resolveUuid(event?.sourceItemUuid);
  return resolved?.update ? resolved : event?.sourceItem ?? resolved ?? null;
}

function notifyChargeResult(reference, sourceItem, charge) {
  if (!charge?.consumed) return;
  const key = charge.depleted
    ? "PF2E_AFFLICTION_FORGE.Reference.InjuryPoisonDepleted"
    : "PF2E_AFFLICTION_FORGE.Reference.InjuryPoisonChargeConsumed";
  globalThis.ui?.notifications?.info?.(format(key, {
    affliction: reference?.label ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction"),
    item: sourceItem?.name ?? "",
    charges: charge.after
  }));
}

async function processInjuryPoisonReference(message, reference, event) {
  const action = injuryPoisonReferenceAction(reference, event);
  if (!action) return Object.freeze({ status: "not-applicable", result: null, charge: null, event });
  if (action === "ambiguous") {
    globalThis.ui?.notifications?.warn?.(format("PF2E_AFFLICTION_FORGE.Reference.InjuryPoisonDamageTypeAmbiguous", {
      affliction: reference?.label ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction"),
      item: event?.sourceItem?.name ?? ""
    }));
    globalThis.Hooks?.callAll?.("pf2eAfflictionForgeInjuryPoisonAmbiguous", { message, event, reference });
    return Object.freeze({ status: "ambiguous-damage-type", result: null, charge: null, event });
  }
  const resourceKey = consumableReferenceKey(event, reference);
  return withConsumableReferenceLock(resourceKey, async () => {
    const sourceItem = await liveSourceItem(event);
    if (!sourceItem?.update) throw new Error("Injury poison source Item is not writable.");
    const current = findAfflictionReference(sourceItem, reference.id);
    if (!current || !isInjuryPoisonReference(current)) {
      return Object.freeze({ status: "depleted", result: null, charge: null, event });
    }

    const liveEvent = { ...event, sourceItem, sourceItemUuid: safeUuid(sourceItem) ?? event.sourceItemUuid };
    if (action === "consume") {
      const charge = await consumeInjuryPoisonCharge(sourceItem, current.id);
      notifyChargeResult(current, sourceItem, charge);
      globalThis.Hooks?.callAll?.("pf2eAfflictionForgeChargeConsumed", {
        message, event: liveEvent, reference: current, charge, reason: event.type === "attack-roll" ? "critical-failure" : "no-qualifying-damage"
      });
      sourceItem.actor?.sheet?.render?.(false);
      sourceItem.parent?.sheet?.render?.(false);
      return Object.freeze({ status: "consumed", result: null, charge, event: liveEvent });
    }

    if (!liveEvent.targetActor) {
      notifyNoTarget(current, liveEvent);
      return Object.freeze({ status: "no-target", result: null, charge: null, event: liveEvent });
    }

    // Rules ordering is intentional: first expose the target to the poison,
    // then consume the coating charge. A failed runtime application remains
    // retryable and therefore does not silently destroy the charge.
    const result = await applyTriggeredReference(message, current, liveEvent);
    const charge = await consumeInjuryPoisonCharge(sourceItem, current.id);
    notifyChargeResult(current, sourceItem, charge);
    globalThis.Hooks?.callAll?.("pf2eAfflictionForgeChargeConsumed", {
      message, event: liveEvent, reference: current, charge, reason: "damage"
    });
    sourceItem.actor?.sheet?.render?.(false);
    sourceItem.parent?.sheet?.render?.(false);
    return Object.freeze({ status: "applied", result, charge, event: liveEvent });
  });
}

async function templateLabel(reference) {
  if (reference?.label) return reference.label;
  const template = await resolveUuid(reference?.templateUuid);
  return template?.name ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction");
}

function makePromptContent({ affliction, source, target, trigger }) {
  if (typeof document === "undefined") {
    return format("PF2E_AFFLICTION_FORGE.Trigger.PromptText", {
      affliction,
      source,
      target,
      trigger
    });
  }
  const root = document.createElement("div");
  const wrapper = document.createElement("div");
  wrapper.className = "pf2e-affliction-trigger-prompt";
  const p = document.createElement("p");
  p.textContent = format("PF2E_AFFLICTION_FORGE.Trigger.PromptText", {
    affliction,
    source,
    target,
    trigger
  });
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = localize("PF2E_AFFLICTION_FORGE.Trigger.PromptHint");
  wrapper.append(p, hint);
  root.append(wrapper);
  return root;
}

async function confirmPrompt(reference, event) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.confirm) return true;
  const affliction = await templateLabel(reference);
  const source = event?.sourceItem?.name ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction");
  const target = event?.targetActor?.name ?? localize("PF2E_AFFLICTION_FORGE.Trigger.UnknownTarget");
  const trigger = localize(`PF2E_AFFLICTION_FORGE.Reference.Trigger.${reference.trigger}`);
  const result = await DialogV2.confirm({
    window: {
      title: format("PF2E_AFFLICTION_FORGE.Trigger.PromptTitle", { affliction })
    },
    content: makePromptContent({ affliction, source, target, trigger }),
    yes: { label: localize("PF2E_AFFLICTION_FORGE.Trigger.Apply") },
    no: { label: localize("PF2E_AFFLICTION_FORGE.Trigger.Skip") },
    modal: true,
    rejectClose: false
  });
  return result === true;
}

function notifyNoTarget(reference, event) {
  const source = event?.sourceItem?.name ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction");
  globalThis.ui?.notifications?.warn?.(format("PF2E_AFFLICTION_FORGE.Trigger.NoTarget", {
    source,
    trigger: localize(`PF2E_AFFLICTION_FORGE.Reference.Trigger.${reference.trigger}`)
  }));
}

async function applyTriggeredReference(message, reference, event) {
  const api = moduleApi();
  if (!api?.application?.applyItemReference || !event?.sourceItem || !event?.targetActor) return null;
  return api.application.applyItemReference(event.sourceItem, reference.id, event.targetActor, {
    application: "combat-trigger",
    origin: {
      sourceActorUuid: event.sourceActorUuid,
      sourceItemUuid: event.sourceItemUuid,
      referenceId: reference.id,
      trigger: reference.trigger,
      applicationMode: reference.application,
      chatMessageUuid: event.messageUuid,
      chatMessageId: event.messageId,
      targetActorUuid: event.targetActorUuid,
      targetTokenUuid: event.targetTokenUuid
    },
    context: {
      workflow: "pf2e-chat-message",
      messageType: event.type,
      outcome: event.outcome,
      triggers: [...event.triggers],
      trigger: reference.trigger,
      chatMessageUuid: event.messageUuid,
      chatMessageId: event.messageId
    }
  });
}

/**
 * Evaluate all enabled Affliction references on the source Item represented by
 * a PF2e combat/save/damage ChatMessage.
 */
export async function processPf2eAfflictionTriggerMessage(message, { force = false } = {}) {
  if (!force && !authoritativeGm()) {
    return Object.freeze({ handled: false, reason: "not-authoritative-gm", event: null, results: Object.freeze([]) });
  }

  const event = await inspectPf2eAfflictionTriggerMessage(message);
  if (!event.sourceItem || !event.matched) {
    return Object.freeze({ handled: false, reason: "no-trigger-event", event, results: Object.freeze([]) });
  }

  const references = readAfflictionReferences(event.sourceItem)
    .filter((reference) => afflictionReferenceMatchesTrigger(reference, event));
  if (references.length === 0) {
    return Object.freeze({ handled: false, reason: "no-matching-references", event, results: Object.freeze([]) });
  }

  const results = [];
  for (const reference of references) {
    const key = triggerKey(message, reference, event);
    if (alreadyProcessed(key)) {
      results.push(Object.freeze({ reference, status: "duplicate", result: null }));
      continue;
    }
    if (alreadyInFlight(key)) {
      results.push(Object.freeze({ reference, status: "in-flight", result: null }));
      continue;
    }
    inFlightTriggerKeys.add(key);

    try {
      if (isInjuryPoisonReference(reference)) {
        try {
          const poison = await processInjuryPoisonReference(message, reference, event);
          if (["applied", "consumed", "depleted", "no-target"].includes(poison.status)) rememberProcessed(key);
          results.push(Object.freeze({
            reference,
            status: poison.status,
            result: poison.result,
            charge: poison.charge ?? null
          }));
          if (poison.status === "applied") {
            globalThis.Hooks?.callAll?.("pf2eAfflictionForgeTriggerApplied", {
              message,
              event: poison.event ?? event,
              reference,
              result: poison.result
            });
          }
        } catch (error) {
          console.error(`${MODULE_ID} | Injury-poison Affliction processing failed.`, error);
          globalThis.ui?.notifications?.error?.(format("PF2E_AFFLICTION_FORGE.Trigger.ApplyFailed", {
            affliction: await templateLabel(reference)
          }));
          results.push(Object.freeze({ reference, status: "error", result: null, charge: null, error }));
        }
        continue;
      }

      if (!event.targetActor) {
        notifyNoTarget(reference, event);
        rememberProcessed(key);
        results.push(Object.freeze({ reference, status: "no-target", result: null }));
        continue;
      }

      if (reference.application === "manual") {
        rememberProcessed(key);
        results.push(Object.freeze({ reference, status: "manual", result: null }));
        continue;
      }

      if (reference.application === "prompt") {
        const approved = await confirmPrompt(reference, event);
        if (!approved) {
          rememberProcessed(key);
          results.push(Object.freeze({ reference, status: "skipped", result: null }));
          continue;
        }
      }

      try {
        const result = await applyTriggeredReference(message, reference, event);
        // Only commit idempotency after the application has actually succeeded.
        // A transient runtime failure can therefore be retried explicitly with
        // the same PF2e ChatMessage instead of being poisoned as a duplicate.
        rememberProcessed(key);
        results.push(Object.freeze({ reference, status: "applied", result }));
        globalThis.Hooks?.callAll?.("pf2eAfflictionForgeTriggerApplied", {
          message,
          event,
          reference,
          result
        });
      } catch (error) {
        console.error(`${MODULE_ID} | Combat-trigger Affliction application failed.`, error);
        globalThis.ui?.notifications?.error?.(format("PF2E_AFFLICTION_FORGE.Trigger.ApplyFailed", {
          affliction: await templateLabel(reference)
        }));
        results.push(Object.freeze({ reference, status: "error", result: null, error }));
      }
    } finally {
      inFlightTriggerKeys.delete(key);
    }
  }

  return Object.freeze({
    handled: results.some((entry) => ["applied", "consumed", "depleted", "skipped", "manual", "no-target"].includes(entry.status)),
    reason: null,
    event,
    results: Object.freeze(results)
  });
}

export function initializeAfflictionCombatTriggerRuntime() {
  if (triggerRuntimeInitialized) return true;
  triggerRuntimeInitialized = true;
  globalThis.Hooks?.on?.("createChatMessage", (message) => {
    if (!authoritativeGm()) return;
    void processPf2eAfflictionTriggerMessage(message).catch((error) => {
      console.error(`${MODULE_ID} | Combat-trigger evaluation failed.`, error);
    });
  });
  return true;
}

export function afflictionCombatTriggerRuntimeStatus() {
  return Object.freeze({
    initialized: triggerRuntimeInitialized,
    authoritative: authoritativeGm(),
    processedKeys: processedTriggerKeys.size,
    inFlightKeys: inFlightTriggerKeys.size,
    consumableLocks: consumableReferenceQueues.size
  });
}
