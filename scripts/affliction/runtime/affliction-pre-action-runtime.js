import { AFFLICTION_PRE_ACTION_KINDS, MODULE_ID } from "../../constants.js";
import { getAfflictionFlags, isAfflictionController } from "../documents/affliction-flags.js";
import { normalizeAfflictionDefinition } from "../schema/affliction-normalizer.js";

const SPELLCAST_PATCH = Symbol.for(`${MODULE_ID}.pre-action.spellcast-patch`);
const CONSUMABLE_PATCH = Symbol.for(`${MODULE_ID}.pre-action.consumable-patch`);
const approvedSpellCasts = new Map();
let initialized = false;
let patchedSpellcastingPrototypes = 0;
let patchedConsumablePrototypes = 0;

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

function itemCollection(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  try { return [...items]; } catch { return []; }
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") {
    try { return [...collection.values()]; } catch { /* no-op */ }
  }
  try { return [...collection]; } catch { return []; }
}

function traitValues(source) {
  const output = new Set();
  const add = (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) output.add(normalized);
  };
  const candidates = [source?.traits, source?.system?.traits?.value, source?.system?.traits];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate instanceof Set || Array.isArray(candidate)) {
      for (const value of candidate) add(value);
    } else if (typeof candidate.values === "function") {
      try { for (const value of candidate.values()) add(value); } catch { /* no-op */ }
    }
  }
  return [...output];
}

function normalizeActionContext(context = {}) {
  const kind = String(context?.kind ?? "").trim().toLowerCase();
  return Object.freeze({
    kind,
    traits: Object.freeze([...new Set((context?.traits ?? []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))]),
    label: String(context?.label ?? context?.spell?.name ?? context?.item?.name ?? "").trim(),
    item: context?.item ?? null,
    spell: context?.spell ?? null,
    source: context?.source ?? null,
    metadata: Object.freeze({ ...(context?.metadata ?? {}) })
  });
}

function controllerContext(controller) {
  if (!isAfflictionController(controller)) return null;
  const flags = getAfflictionFlags(controller);
  if (!flags?.definitionSnapshot || !flags?.state) return null;
  const state = flags.state;
  if (state.status !== "active" || !Number.isInteger(state.currentStage) || state.currentStage < 1) return null;
  const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
  const stage = definition.stages.find((entry) => entry.number === state.currentStage) ?? null;
  return stage ? { controller, actor: controller.parent, definition, state, stage } : null;
}

export function preActionGateMatches(gate, actionContext) {
  const action = normalizeActionContext(actionContext);
  if (!gate || !AFFLICTION_PRE_ACTION_KINDS.includes(action.kind)) return false;
  const kinds = Array.isArray(gate?.trigger?.actionKinds) ? gate.trigger.actionKinds : [];
  if (!kinds.includes(action.kind)) return false;
  const actualTraits = new Set(action.traits);
  const requiredTraits = Array.isArray(gate?.trigger?.requiredTraits) ? gate.trigger.requiredTraits : [];
  return requiredTraits.every((trait) => actualTraits.has(String(trait).toLowerCase()));
}

export function collectActorPreActionGates(actor, actionContext = {}) {
  const action = normalizeActionContext(actionContext);
  if (!actor || !AFFLICTION_PRE_ACTION_KINDS.includes(action.kind)) return Object.freeze([]);
  const matches = [];
  for (const item of itemCollection(actor)) {
    const context = controllerContext(item);
    if (!context) continue;
    for (const gate of context.stage.preActionGates ?? []) {
      if (!preActionGateMatches(gate, action)) continue;
      matches.push(Object.freeze({ ...context, gate, action }));
    }
  }
  return Object.freeze(matches);
}

function speakerFor(actor) {
  return globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? {};
}

async function createFallbackFlatCheckMessage(actor, gate, action, total, success) {
  if (!globalThis.ChatMessage?.create) return null;
  const content = `<div class="pf2e-affliction-pre-action-result">
    <h4><i class="fa-solid fa-lungs"></i> ${escapeHtml(gate.label || localize("PF2E_AFFLICTION_FORGE.PreAction.Gate", "Prüfung vor Handlung"))}</h4>
    <p>${escapeHtml(action.label || localize("PF2E_AFFLICTION_FORGE.PreAction.Action", "Handlung"))}: <strong>${escapeHtml(total)}</strong> / SG ${escapeHtml(gate.check.dc)} · <strong>${escapeHtml(success ? localize("PF2E_AFFLICTION_FORGE.PreAction.Success", "Erfolg") : localize("PF2E_AFFLICTION_FORGE.PreAction.Failure", "Fehlschlag"))}</strong></p>
  </div>`;
  return globalThis.ChatMessage.create({
    content,
    speaker: speakerFor(actor),
    flags: { [MODULE_ID]: { runtimeEvent: "affliction-pre-action-flat-check", gateId: gate.id, dc: gate.check.dc, success } }
  });
}

export async function rollAfflictionFlatCheck(actor, gate, actionContext = {}, { createMessage = true } = {}) {
  const action = normalizeActionContext(actionContext);
  const RollClass = globalThis.Roll;
  if (typeof RollClass !== "function") throw new Error("Foundry Roll class is unavailable for Affliction pre-action flat checks.");
  const roll = new RollClass("1d20");
  if (typeof roll.evaluate === "function") await roll.evaluate();
  const total = Number(roll.total);
  if (!Number.isFinite(total)) throw new Error("Affliction pre-action flat check did not produce a numeric total.");
  const dc = Number(gate?.check?.dc);
  const success = total >= dc;
  if (createMessage) {
    const flavor = format("PF2E_AFFLICTION_FORGE.PreAction.RollFlavor", {
      gate: gate?.label || localize("PF2E_AFFLICTION_FORGE.PreAction.Gate", "Prüfung vor Handlung"),
      action: action.label || localize("PF2E_AFFLICTION_FORGE.PreAction.Action", "Handlung"),
      dc
    }, ({ gate: gateLabel, action: actionLabel, dc: checkDc }) => `${gateLabel} · ${actionLabel} · Einfacher Wurf SG ${checkDc}`);
    if (typeof roll.toMessage === "function") {
      await roll.toMessage({
        speaker: speakerFor(actor),
        flavor,
        flags: { [MODULE_ID]: { runtimeEvent: "affliction-pre-action-flat-check", gateId: gate?.id ?? null, dc, success } }
      });
    } else {
      await createFallbackFlatCheckMessage(actor, gate, action, total, success);
    }
  }
  return Object.freeze({ total, dc, success, roll, action });
}

export async function evaluateAfflictionPreAction(actor, actionContext = {}, {
  roller = rollAfflictionFlatCheck,
  createMessage = true
} = {}) {
  const action = normalizeActionContext(actionContext);
  const matches = collectActorPreActionGates(actor, action);
  const results = [];
  let allowed = true;
  for (const match of matches) {
    const result = await roller(actor, match.gate, action, { createMessage });
    const blocked = result?.success === false && match.gate.blockOnFailure !== false;
    results.push(Object.freeze({ ...match, result, blocked }));
    if (blocked) allowed = false;
    globalThis.Hooks?.callAll?.("pf2eAfflictionForgePreActionGateResolved", Object.freeze({
      actor,
      actorUuid: actor?.uuid ?? null,
      controllerUuid: match.controller?.uuid ?? null,
      afflictionId: match.definition?.id ?? null,
      stageNumber: match.stage?.number ?? null,
      gateId: match.gate?.id ?? null,
      action,
      result,
      blocked
    }));
    if (blocked) break;
  }
  const payload = Object.freeze({
    allowed,
    actor,
    actorUuid: actor?.uuid ?? null,
    action,
    results: Object.freeze(results)
  });
  globalThis.Hooks?.callAll?.("pf2eAfflictionForgePreActionEvaluated", payload);
  if (!allowed) {
    const label = results.at(-1)?.gate?.label || localize("PF2E_AFFLICTION_FORGE.PreAction.Gate", "Prüfung vor Handlung");
    globalThis.ui?.notifications?.warn?.(format("PF2E_AFFLICTION_FORGE.PreAction.Blocked", { gate: label }, ({ gate }) => `${gate}: Die Handlung wird durch den fehlgeschlagenen Wurf verhindert.`));
    globalThis.Hooks?.callAll?.("pf2eAfflictionForgePreActionBlocked", payload);
  }
  return payload;
}

function spellApprovalKey(actor, spell) {
  const actorKey = actor?.uuid ?? actor?.id ?? "actor";
  const spellKey = spell?.uuid ?? spell?.id ?? spell?.slug ?? spell?.name ?? "spell";
  return `${actorKey}|${spellKey}`;
}

function approveSpell(actor, spell) {
  const key = spellApprovalKey(actor, spell);
  approvedSpellCasts.set(key, (approvedSpellCasts.get(key) ?? 0) + 1);
  return () => {
    const remaining = (approvedSpellCasts.get(key) ?? 1) - 1;
    if (remaining > 0) approvedSpellCasts.set(key, remaining);
    else approvedSpellCasts.delete(key);
  };
}

function spellApproved(actor, spell) {
  return (approvedSpellCasts.get(spellApprovalKey(actor, spell)) ?? 0) > 0;
}

function actionForSpell(spell, { item = null, kind = "spell-cast" } = {}) {
  return {
    kind,
    traits: traitValues(spell),
    label: item?.name || spell?.name || "",
    item,
    spell,
    source: item ?? spell ?? null
  };
}

function consumableCategory(item) {
  return String(item?.category ?? item?.system?.category ?? "").trim().toLowerCase();
}

function isSpellConsumable(item) {
  return ["scroll", "spell-gem", "wand"].includes(consumableCategory(item)) && Boolean(item?.system?.spell || item?.embeddedSpell);
}

export function patchPf2eSpellcastingEntry(entry) {
  const prototype = entry && Object.getPrototypeOf(entry);
  if (!prototype || typeof prototype.cast !== "function" || prototype[SPELLCAST_PATCH]) return false;
  const original = prototype.cast;
  Object.defineProperty(prototype, SPELLCAST_PATCH, { value: original, configurable: false, enumerable: false });
  prototype.cast = async function afflictionForgePreActionCast(spell, options = {}) {
    const actor = this?.actor ?? spell?.actor ?? null;
    if (!actor || spellApproved(actor, spell)) return original.call(this, spell, options);
    try {
      const evaluation = await evaluateAfflictionPreAction(actor, actionForSpell(spell));
      if (!evaluation.allowed) return undefined;
    } catch (error) {
      console.error(`${MODULE_ID} | Pre-action check failed before spell casting.`, error);
      globalThis.ui?.notifications?.error?.(localize("PF2E_AFFLICTION_FORGE.PreAction.Error", "Die Leidensprüfung vor der Handlung konnte nicht ausgeführt werden."));
      return undefined;
    }
    return original.call(this, spell, options);
  };
  patchedSpellcastingPrototypes += 1;
  return true;
}

export function patchPf2eSpellConsumable(item) {
  const prototype = item && Object.getPrototypeOf(item);
  if (!prototype || typeof prototype.consume !== "function" || prototype[CONSUMABLE_PATCH]) return false;
  const original = prototype.consume;
  Object.defineProperty(prototype, CONSUMABLE_PATCH, { value: original, configurable: false, enumerable: false });
  prototype.consume = async function afflictionForgePreActionConsume(...args) {
    if (!isSpellConsumable(this)) return original.apply(this, args);
    const actor = this?.actor ?? null;
    const spell = this?.embeddedSpell ?? null;
    if (!actor || !spell) return original.apply(this, args);
    try {
      const evaluation = await evaluateAfflictionPreAction(actor, actionForSpell(spell, { item: this, kind: "spell-cast" }));
      if (!evaluation.allowed) return undefined;
      const release = approveSpell(actor, spell);
      try {
        return await original.apply(this, args);
      } finally {
        release();
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Pre-action check failed before spell-item consumption.`, error);
      globalThis.ui?.notifications?.error?.(localize("PF2E_AFFLICTION_FORGE.PreAction.Error", "Die Leidensprüfung vor der Handlung konnte nicht ausgeführt werden."));
      return undefined;
    }
  };
  patchedConsumablePrototypes += 1;
  return true;
}

export function patchActorPreActionSources(actor) {
  if (!actor) return Object.freeze({ spellcasting: 0, consumables: 0 });
  let spellcasting = 0;
  let consumables = 0;
  for (const entry of collectionValues(actor.spellcasting)) if (patchPf2eSpellcastingEntry(entry)) spellcasting += 1;
  const actorConsumables = Array.isArray(actor?.itemTypes?.consumable)
    ? actor.itemTypes.consumable
    : itemCollection(actor).filter((item) => item?.type === "consumable");
  for (const item of actorConsumables) if (patchPf2eSpellConsumable(item)) consumables += 1;
  return Object.freeze({ spellcasting, consumables });
}

function patchAllActors() {
  const actors = globalThis.game?.actors;
  const actorList = actors ? (Array.isArray(actors) ? actors : collectionValues(actors)) : [];
  const tokenActors = globalThis.canvas?.tokens?.placeables?.map?.((token) => token?.actor).filter(Boolean) ?? [];
  const seen = new Set();
  for (const actor of [...actorList, ...tokenActors]) {
    const key = actor?.uuid ?? actor?.id;
    if (!actor || (key && seen.has(key))) continue;
    if (key) seen.add(key);
    patchActorPreActionSources(actor);
  }
}

export function afflictionPreActionRuntimeStatus() {
  return Object.freeze({
    initialized,
    patchedSpellcastingPrototypes,
    patchedConsumablePrototypes,
    approvedSpellCasts: approvedSpellCasts.size,
    genericItemActivation: "api"
  });
}

export function initializeAfflictionPreActionRuntime() {
  if (initialized) return;
  initialized = true;
  patchAllActors();
  const patchActor = (actor) => patchActorPreActionSources(actor);
  globalThis.Hooks?.on?.("createActor", patchActor);
  globalThis.Hooks?.on?.("updateActor", patchActor);
  globalThis.Hooks?.on?.("renderActorSheet", (_app, _html, context = {}) => patchActorPreActionSources(context?.actor ?? _app?.actor));
  globalThis.Hooks?.on?.("canvasReady", patchAllActors);
}
