import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, DOCUMENT_KINDS } from "../scripts/constants.js";
import {
  eventReactionMatches,
  inspectPf2eAfflictionReactionEvent,
  inspectPf2eConditionReactionEvent,
  inspectFoundryInitiativeReactionEvent,
  inspectFoundryTurnStartReactionEvent,
  processAfflictionReactionEvent,
  processAfflictionEventReactionMessage,
  resolvePf2eDamageTypes
} from "../scripts/affliction/runtime/affliction-event-reaction-runtime.js";
import { normalizeAfflictionDefinition } from "../scripts/affliction/schema/affliction-normalizer.js";
import { validateAfflictionDefinition } from "../scripts/affliction/schema/affliction-validator.js";

function installRuntime({ degree = "failure" } = {}) {
  const messages = new Map();
  const modules = new Map();
  const effectExecutions = [];
  modules.set("pf2e-critical-forge", {
    active: true,
    api: {
      effects: {
        execute: async (...args) => { effectExecutions.push(args); return []; },
        validate: () => ({ valid: true, issues: [] })
      }
    }
  });
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: Object.assign([{ id: "gm", isGM: true }], { activeGM: { id: "gm" } }),
    modules,
    messages,
    time: { worldTime: 10 },
    i18n: { localize: (key) => key, format: (key) => key }
  };
  globalThis.ChatMessage = {
    getSpeaker: () => ({}),
    create: async (source) => source
  };
  globalThis.Hooks = { callAll: () => {} };
  globalThis.fromUuid = async () => null;
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    name: "Hero",
    items: [],
    getStatistic: () => ({
      roll: async () => ({
        total: 15,
        id: "roll-1",
        degreeOfSuccess: degree,
        dice: [{ total: 7 }]
      })
    })
  };
  return { actor, messages, effectExecutions };
}

function effectDefinition(id = "reaction-effect") {
  return {
    schemaVersion: 2,
    id,
    name: "Reaction Effect",
    duration: { value: 1, unit: "rounds", expiry: null },
    components: [],
    application: {},
    metadata: {}
  };
}

function definitionWithReaction({ damageTypes = [], applyOn = ["failure", "criticalFailure"] } = {}) {
  return normalizeAfflictionDefinition({
    schemaVersion: 2,
    id: "test.reactive-disease",
    name: "Reactive Disease",
    afflictionType: "disease",
    level: 8,
    rarity: "common",
    traits: ["disease"],
    themes: [],
    saveDefaults: { execution: "automatic", visibility: "public" },
    identification: { initialState: "identified" },
    restrictions: { conditionLocks: [], healing: "none", blockedCapabilities: [] },
    checks: [
      { id: "primary", label: "Fortitude", kind: "save", statistic: "fortitude", dcMode: "fixed", dc: 25, policy: null },
      { id: "trigger-will", label: "Triggered Will", kind: "save", statistic: "will", dcMode: "fixed", dc: 25, policy: null }
    ],
    initialCheck: null,
    onset: null,
    maximumDuration: null,
    defaultStageCheck: null,
    progression: { belowStageOne: "recover", aboveMaximumStage: "clamp", virulent: false },
    stages: [{
      id: "stage-1",
      number: 1,
      name: "Stage 1",
      description: "",
      duration: { value: 1, unit: "days" },
      check: null,
      restrictions: { conditionLocks: [], healing: "none", blockedCapabilities: [] },
      effectPersistence: "stage",
      effect: null,
      reactions: [{
        id: "pain-response",
        label: "Pain response",
        trigger: { event: "damage-taken", damageTypes },
        checkId: "trigger-will",
        applyOn,
        effect: effectDefinition()
      }]
    }],
    metadata: {}
  });
}

function controllerFor(actor, definition) {
  const controller = {
    id: "controller",
    uuid: "Actor.hero.Item.controller",
    parent: actor,
    flags: {
      [MODULE_ID]: {
        managed: true,
        documentKind: DOCUMENT_KINDS.CONTROLLER,
        definitionSnapshot: definition,
        state: {
          schemaVersion: 2,
          instanceId: "instance",
          status: "active",
          currentStage: 1,
          identification: { state: "identified", identifiedAt: 0, identifiedBy: null },
          recoverySuccesses: 0,
          unhealableDamage: 0,
          activeStageEffectUuids: [],
          pendingCheck: null,
          onsetTargetStage: null,
          lastCheck: null,
          events: [],
          mortality: null,
          pause: null,
          revision: 1
        }
      }
    }
  };
  actor.items.push(controller);
  return controller;
}

function damageTakenMessage(actor, { id = "damage-taken-1", messageId = null, options = [] } = {}) {
  return {
    id,
    uuid: `ChatMessage.${id}`,
    actor,
    flags: {
      pf2e: {
        context: { type: "damage-taken", options },
        origin: messageId ? { messageId, uuid: "Actor.source.Item.weapon", type: "weapon" } : null,
        appliedDamage: {
          uuid: actor.uuid,
          isHealing: false,
          updates: [{ path: "system.attributes.hp.value", value: 4 }],
          persistent: [],
          shield: null
        }
      }
    }
  };
}

test("damage-taken reaction event recognizes positive PF2e damage application", () => {
  const { actor } = installRuntime();
  const event = inspectPf2eAfflictionReactionEvent(damageTakenMessage(actor));
  assert.equal(event.matched, true);
  assert.equal(event.event, "damage-taken");
  assert.equal(event.actorUuid, "Actor.hero");
});

test("damage type filters can resolve from the originating PF2e damage-roll message", () => {
  const { actor, messages } = installRuntime();
  messages.set("damage-roll-1", {
    id: "damage-roll-1",
    flags: { pf2e: { damageRoll: { types: { slashing: { normal: 12 } } }, context: { type: "damage-roll", options: [] } } }
  });
  const message = damageTakenMessage(actor, { messageId: "damage-roll-1" });
  assert.ok(resolvePf2eDamageTypes(message).includes("slashing"));
  const event = inspectPf2eAfflictionReactionEvent(message);
  assert.equal(eventReactionMatches(definitionWithReaction({ damageTypes: ["slashing"] }).stages[0].reactions[0], event), true);
  assert.equal(eventReactionMatches(definitionWithReaction({ damageTypes: ["fire"] }).stages[0].reactions[0], event), false);
});

test("reaction schema validates check references, outcome filters, and Critical Forge effect definitions", () => {
  const definition = definitionWithReaction({ damageTypes: ["slashing"] });
  const report = validateAfflictionDefinition(definition, { effectValidator: () => ({ valid: true, issues: [] }) });
  assert.equal(report.valid, true);
  const invalid = structuredClone(definition);
  invalid.stages[0].reactions[0].checkId = "missing";
  assert.equal(validateAfflictionDefinition(invalid).valid, false);
});

test("a matching damage event rolls the configured auxiliary save and executes its effect without progressing the stage", async () => {
  const { actor, effectExecutions } = installRuntime({ degree: "failure" });
  const definition = definitionWithReaction();
  const controller = controllerFor(actor, definition);
  const result = await processAfflictionEventReactionMessage(damageTakenMessage(actor), { force: true });
  assert.equal(result.status, "processed");
  assert.equal(result.results[0].status, "resolved");
  assert.equal(effectExecutions.length, 1);
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 1);
});

test("a successful triggered save records the reaction but does not execute the failure effect", async () => {
  const { actor, effectExecutions } = installRuntime({ degree: "success" });
  controllerFor(actor, definitionWithReaction());
  const result = await processAfflictionEventReactionMessage(damageTakenMessage(actor, { id: "damage-taken-success" }), { force: true });
  assert.equal(result.results[0].status, "resolved");
  assert.equal(result.results[0].effectApplied, false);
  assert.equal(effectExecutions.length, 0);
});

function definitionWithConditionReaction() {
  return normalizeAfflictionDefinition({
    schemaVersion: 2,
    id: "test.condition-disease",
    name: "Condition Disease",
    afflictionType: "disease",
    level: 4,
    rarity: "common",
    traits: ["disease"],
    themes: [],
    saveDefaults: { execution: "automatic", visibility: "public" },
    identification: { initialState: "identified" },
    restrictions: { conditionLocks: [], healing: "none", unhealableDamageTypes: [], blockedCapabilities: [] },
    checks: [{ id: "primary", label: "Fortitude", kind: "save", statistic: "fortitude", dcMode: "fixed", dc: 19, policy: null }],
    initialCheck: null,
    onset: null,
    maximumDuration: null,
    defaultStageCheck: null,
    progression: { belowStageOne: "recover", aboveMaximumStage: "clamp", virulent: true },
    stages: [{
      id: "stage-1", number: 1, name: "Stage 1", description: "",
      duration: { value: 1, unit: "days" }, check: null,
      restrictions: { conditionLocks: [], healing: "none", unhealableDamageTypes: [], blockedCapabilities: [] },
      effectPersistence: "stage", effect: null,
      reactions: [{
        id: "wounded-escalation", label: "Wounded escalation",
        trigger: { event: "condition-increased", conditionSlugs: ["wounded"] },
        checkId: null, applyOn: [], conditionValueDelta: 1, effect: null
      }]
    }],
    metadata: {}
  });
}

test("condition-increased event recognizes gaining a valued PF2e condition", () => {
  const { actor } = installRuntime();
  actor.documentName = "Actor";
  const condition = {
    id: "wounded", uuid: "Actor.hero.Item.wounded", type: "condition", slug: "wounded", name: "Wounded",
    parent: actor, system: { value: { value: 1, max: 4 } }
  };
  const event = inspectPf2eConditionReactionEvent(condition, { previousValue: 0, eventId: "condition-test" });
  assert.equal(event.matched, true);
  assert.equal(event.event, "condition-increased");
  assert.equal(event.conditionSlug, "wounded");
  assert.equal(event.previousValue, 0);
  assert.equal(event.conditionValue, 1);
});

test("direct condition-increased reaction raises the triggering condition once without rolling a save", async () => {
  const { actor, effectExecutions } = installRuntime();
  actor.documentName = "Actor";
  const definition = definitionWithConditionReaction();
  controllerFor(actor, definition);
  const condition = {
    id: "wounded", uuid: "Actor.hero.Item.wounded", type: "condition", slug: "wounded", name: "Wounded",
    parent: actor, system: { value: { value: 1, max: 4 } },
    update: async (changes) => {
      condition.system.value.value = Number(changes["system.value.value"]);
      return condition;
    }
  };
  actor.items.push(condition);
  const event = inspectPf2eConditionReactionEvent(condition, { previousValue: 0, eventId: "condition-direct" });
  const result = await processAfflictionReactionEvent(event, { force: true });
  assert.equal(result.status, "processed");
  assert.equal(result.results[0].status, "resolved");
  assert.equal(condition.system.value.value, 2);
  assert.equal(result.results[0].conditionAdjustment.applied, true);
  assert.equal(effectExecutions.length, 0);
});

test("condition reaction chain suppresses the same reaction from recursively escalating its own update", async () => {
  const { actor } = installRuntime();
  actor.documentName = "Actor";
  const definition = definitionWithConditionReaction();
  const controller = controllerFor(actor, definition);
  const condition = {
    id: "wounded", uuid: "Actor.hero.Item.wounded", type: "condition", slug: "wounded", name: "Wounded",
    parent: actor, system: { value: { value: 2, max: 4 } }, update: async () => condition
  };
  actor.items.push(condition);
  const event = inspectPf2eConditionReactionEvent(condition, {
    previousValue: 1, eventId: "condition-chain",
    options: { [MODULE_ID]: { conditionReactionChain: [`${controller.uuid}|wounded-escalation`] } }
  });
  const result = await processAfflictionReactionEvent(event, { force: true });
  assert.equal(result.status, "processed");
  assert.equal(result.results[0].status, "reaction-chain-suppressed");
});


test("Foundry combat lifecycle inspectors emit initiative-rolled and turn-start events", () => {
  const { actor } = installRuntime();
  const combatant = { id: "c1", uuid: "Combat.test.Combatant.c1", actor, initiative: 23 };
  const initiative = inspectFoundryInitiativeReactionEvent(combatant, { initiative: 23 }, { eventId: "initiative-test" });
  assert.equal(initiative.matched, true);
  assert.equal(initiative.event, "initiative-rolled");
  assert.equal(initiative.actorUuid, actor.uuid);

  const combat = { id: "combat", uuid: "Combat.combat", round: 2, turn: 0, combatant };
  const turn = inspectFoundryTurnStartReactionEvent(combat, { eventId: "turn-test" });
  assert.equal(turn.matched, true);
  assert.equal(turn.event, "turn-start");
  assert.equal(turn.round, 2);
  assert.equal(turn.turn, 0);
});

test("a reaction save can recover the affliction controller without an outcome effect", async () => {
  const { actor } = installRuntime({ degree: "success" });
  let endedReason = null;
  globalThis.game.modules.set(MODULE_ID, {
    active: true,
    api: { instances: { end: async (_controller, { reason }) => { endedReason = reason; return true; } } }
  });
  const definition = normalizeAfflictionDefinition({
    schemaVersion: 2,
    id: "test.reactive-recovery",
    name: "Reactive Recovery",
    afflictionType: "curse",
    level: 11,
    rarity: "common",
    traits: ["curse"],
    themes: [],
    saveDefaults: { execution: "automatic", visibility: "public" },
    identification: { initialState: "identified" },
    restrictions: { conditionLocks: [], healing: "none", unhealableDamageTypes: [], blockedCapabilities: [] },
    checks: [{ id: "wake", label: "Will", kind: "save", statistic: "will", dcMode: "fixed", dc: 28, policy: null }],
    initialCheck: null,
    onset: null,
    maximumDuration: null,
    defaultStageCheck: null,
    progression: { belowStageOne: "recover", aboveMaximumStage: "clamp", virulent: false },
    stages: [{
      id: "stage-1", number: 1, name: "Stage 1", description: "", duration: { unit: "unlimited" }, expiryAction: "check", check: null,
      restrictions: { conditionLocks: [], healing: "none", unhealableDamageTypes: [], blockedCapabilities: [] },
      effectPersistence: "stage", effect: null,
      reactions: [{
        id: "wake-on-damage", label: "Wake on damage",
        trigger: { event: "damage-taken", damageTypes: [], conditionSlugs: [] },
        checkId: "wake", applyOn: [], conditionValueDelta: 0,
        controllerActions: { criticalSuccess: "recover", success: "recover", failure: "none", criticalFailure: "none" },
        effect: null
      }]
    }],
    metadata: {}
  });
  controllerFor(actor, definition);
  const result = await processAfflictionEventReactionMessage(damageTakenMessage(actor, { id: "recovery-damage" }), { force: true });
  assert.equal(result.results[0].controllerOutcome.action, "recover");
  assert.equal(endedReason, "recovered");
});
