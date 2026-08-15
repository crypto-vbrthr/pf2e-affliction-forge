import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, DOCUMENT_KINDS } from "../scripts/constants.js";
import {
  eventReactionMatches,
  inspectPf2eAfflictionReactionEvent,
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
