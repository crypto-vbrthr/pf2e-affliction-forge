import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_KINDS, MODULE_ID } from "../scripts/constants.js";
import {
  collectActorPreActionGates,
  evaluateAfflictionPreAction,
  patchPf2eSpellcastingEntry,
  patchPf2eSpellConsumable,
  preActionGateMatches
} from "../scripts/affliction/runtime/affliction-pre-action-runtime.js";
import { normalizeAfflictionDefinition } from "../scripts/affliction/schema/affliction-normalizer.js";

function installGlobals({ rollTotal = 10 } = {}) {
  let rollCount = 0;
  class TestRoll {
    constructor(formula) {
      this.formula = formula;
      this.total = null;
    }
    async evaluate() {
      rollCount += 1;
      this.total = rollTotal;
      return this;
    }
    async toMessage() { return this; }
  }
  globalThis.Roll = TestRoll;
  globalThis.game = {
    i18n: {
      localize: (key) => key,
      format: (key) => key
    }
  };
  globalThis.ChatMessage = {
    getSpeaker: () => ({}),
    create: async (source) => source
  };
  globalThis.Hooks = { callAll: () => {} };
  globalThis.ui = { notifications: { warn: () => {}, error: () => {} } };
  return { get rollCount() { return rollCount; } };
}

function tuberculosisDefinition({ stage = 2 } = {}) {
  return normalizeAfflictionDefinition({
    schemaVersion: 2,
    id: "test.tuberculosis",
    name: "Tuberculosis",
    afflictionType: "disease",
    level: 1,
    rarity: "common",
    traits: ["disease"],
    themes: [],
    saveDefaults: { execution: "automatic", visibility: "public" },
    identification: { initialState: "identified" },
    restrictions: { conditionLocks: [], healing: "none", unhealableDamageTypes: [], blockedCapabilities: [] },
    checks: [{ id: "primary", label: "Fortitude", kind: "save", statistic: "fortitude", dcMode: "fixed", dc: 15, policy: null }],
    initialCheck: null,
    onset: { value: 1, unit: "weeks" },
    maximumDuration: null,
    defaultStageCheck: null,
    progression: { belowStageOne: "recover", aboveMaximumStage: "clamp", virulent: false },
    stages: [1, 2, 3, 4, 5].map((number) => ({
      id: `stage-${number}`,
      number,
      name: `Stage ${number}`,
      description: "",
      duration: { value: 1, unit: "weeks" },
      check: null,
      restrictions: { conditionLocks: [], healing: "none", unhealableDamageTypes: [], blockedCapabilities: [] },
      effectPersistence: "stage",
      effect: null,
      preActionGates: number === 2 || number === 3 ? [{
        id: `cough-${number}`,
        label: "Cough",
        trigger: { actionKinds: ["spell-cast", "item-activation"], requiredTraits: ["concentrate"] },
        check: { kind: "flat", dc: number === 2 ? 5 : 15 },
        blockOnFailure: true
      }] : [],
      reactions: []
    })),
    metadata: { testStage: stage }
  });
}

function controllerFor(actor, { stage = 2 } = {}) {
  const definition = tuberculosisDefinition({ stage });
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
          currentStage: stage,
          identification: { state: "identified", identifiedAt: 0, identifiedBy: null },
          recoverySuccesses: 0,
          unhealableDamage: 0,
          unhealableDamageByType: {},
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

function actorWithTuberculosis({ stage = 2 } = {}) {
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    name: "Hero",
    items: []
  };
  controllerFor(actor, { stage });
  return actor;
}

const concentrateSpell = {
  id: "spell",
  uuid: "Actor.hero.Item.spell",
  name: "Focused Spell",
  system: { traits: { value: ["concentrate", "magical"] } }
};

const nonConcentrateSpell = {
  id: "spell-plain",
  uuid: "Actor.hero.Item.spell-plain",
  name: "Plain Spell",
  system: { traits: { value: ["magical"] } }
};

test("pre-action gate matches supported action kind and all required traits", () => {
  installGlobals();
  const gate = tuberculosisDefinition().stages[1].preActionGates[0];
  assert.equal(preActionGateMatches(gate, { kind: "spell-cast", traits: ["concentrate", "magical"] }), true);
  assert.equal(preActionGateMatches(gate, { kind: "item-activation", traits: ["concentrate"] }), true);
  assert.equal(preActionGateMatches(gate, { kind: "spell-cast", traits: ["magical"] }), false);
  assert.equal(preActionGateMatches(gate, { kind: "strike", traits: ["concentrate"] }), false);
});

test("only active-stage gates matching the action are collected", () => {
  installGlobals();
  const actor = actorWithTuberculosis({ stage: 2 });
  assert.equal(collectActorPreActionGates(actor, { kind: "spell-cast", traits: ["concentrate"] }).length, 1);
  assert.equal(collectActorPreActionGates(actor, { kind: "spell-cast", traits: ["magical"] }).length, 0);
  const inactive = actorWithTuberculosis({ stage: 1 });
  assert.equal(collectActorPreActionGates(inactive, { kind: "spell-cast", traits: ["concentrate"] }).length, 0);
});

test("successful flat gate allows the action and failed flat gate blocks it", async () => {
  installGlobals();
  const actor = actorWithTuberculosis({ stage: 3 });
  const success = await evaluateAfflictionPreAction(actor, { kind: "spell-cast", traits: ["concentrate"] }, {
    createMessage: false,
    roller: async (_actor, gate) => ({ total: gate.check.dc, dc: gate.check.dc, success: true })
  });
  assert.equal(success.allowed, true);
  assert.equal(success.results.length, 1);

  const failure = await evaluateAfflictionPreAction(actor, { kind: "spell-cast", traits: ["concentrate"] }, {
    createMessage: false,
    roller: async (_actor, gate) => ({ total: gate.check.dc - 1, dc: gate.check.dc, success: false })
  });
  assert.equal(failure.allowed, false);
  assert.equal(failure.results.length, 1);
  assert.equal(failure.results[0].blocked, true);
});

test("spellcasting patch blocks a failed concentrate gate before the original cast runs", async () => {
  installGlobals({ rollTotal: 4 });
  const actor = actorWithTuberculosis({ stage: 2 });
  let castCalls = 0;
  class SpellcastingEntry {
    constructor(actor) { this.actor = actor; }
    async cast(spell, options) { castCalls += 1; return { spell, options }; }
  }
  const entry = new SpellcastingEntry(actor);
  assert.equal(patchPf2eSpellcastingEntry(entry), true);
  const result = await entry.cast(concentrateSpell, { consume: true });
  assert.equal(result, undefined);
  assert.equal(castCalls, 0);
});

test("spellcasting patch allows a passing gate and ignores spells without concentrate", async () => {
  const runtime = installGlobals({ rollTotal: 5 });
  const actor = actorWithTuberculosis({ stage: 2 });
  let castCalls = 0;
  class SpellcastingEntry {
    constructor(actor) { this.actor = actor; }
    async cast(spell) { castCalls += 1; return spell.name; }
  }
  const entry = new SpellcastingEntry(actor);
  patchPf2eSpellcastingEntry(entry);
  assert.equal(await entry.cast(concentrateSpell), "Focused Spell");
  assert.equal(castCalls, 1);
  assert.equal(runtime.rollCount, 1);
  assert.equal(await entry.cast(nonConcentrateSpell), "Plain Spell");
  assert.equal(castCalls, 2);
  assert.equal(runtime.rollCount, 1);
});

test("spell consumable patch blocks resource consumption on failure", async () => {
  installGlobals({ rollTotal: 4 });
  const actor = actorWithTuberculosis({ stage: 2 });
  let consumeCalls = 0;
  class SpellConsumable {
    constructor() {
      this.actor = actor;
      this.type = "consumable";
      this.name = "Scroll of Focus";
      this.system = { category: "scroll", spell: { value: true } };
      this.embeddedSpell = concentrateSpell;
    }
    async consume() { consumeCalls += 1; return "consumed"; }
  }
  const item = new SpellConsumable();
  patchPf2eSpellConsumable(item);
  assert.equal(await item.consume(), undefined);
  assert.equal(consumeCalls, 0);
});

test("passing spell consumable gate is not rolled a second time by nested spellcasting", async () => {
  const runtime = installGlobals({ rollTotal: 5 });
  const actor = actorWithTuberculosis({ stage: 2 });
  let castCalls = 0;
  let consumeCalls = 0;
  class SpellcastingEntry {
    constructor(actor) { this.actor = actor; }
    async cast(spell) { castCalls += 1; return spell.name; }
  }
  const entry = new SpellcastingEntry(actor);
  patchPf2eSpellcastingEntry(entry);

  class SpellConsumable {
    constructor() {
      this.actor = actor;
      this.type = "consumable";
      this.name = "Scroll of Focus";
      this.system = { category: "scroll", spell: { value: true } };
      this.embeddedSpell = concentrateSpell;
    }
    async consume() {
      consumeCalls += 1;
      await entry.cast(this.embeddedSpell, { consume: false });
      return "consumed";
    }
  }
  const item = new SpellConsumable();
  patchPf2eSpellConsumable(item);
  assert.equal(await item.consume(), "consumed");
  assert.equal(consumeCalls, 1);
  assert.equal(castCalls, 1);
  assert.equal(runtime.rollCount, 1);
});
