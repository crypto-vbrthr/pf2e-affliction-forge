import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();
globalThis.ui = { notifications: { warn: () => {} } };
globalThis.game.i18n = { format: (key) => key, localize: (key) => key };

const { MODULE_ID, DOCUMENT_KINDS } = await import("../scripts/constants.js");
const { createAfflictionDefinition, createDefaultStage } = await import("../scripts/affliction/schema/affliction-defaults.js");
const {
  collectActorRestrictions,
  guardConditionUpdate,
  guardConditionDelete,
  guardHealingUpdate,
  isAfflictionCapabilityBlocked,
  recordTypedHealingLockDamage
} = await import("../scripts/affliction/runtime/affliction-restriction-runtime.js");

function actorWithController({ rootRestrictions = {}, stageRestrictions = {}, unhealableDamage = 0, unhealableDamageByType = {}, hp = { value: 50, max: 100 } } = {}) {
  const definition = createAfflictionDefinition({
    id: "test.restrictions",
    name: "Restriction Test",
    initialCheck: null,
    restrictions: rootRestrictions,
    stages: [{ ...createDefaultStage({ number: 1 }), restrictions: stageRestrictions }]
  });
  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    documentName: "Actor",
    system: { attributes: { hp: { ...hp } } },
    items: []
  };
  const controller = {
    id: "controller-1",
    uuid: "Actor.actor-1.Item.controller-1",
    parent: actor,
    flags: {
      [MODULE_ID]: {
        managed: true,
        documentKind: DOCUMENT_KINDS.CONTROLLER,
        instanceId: "instance-1",
        definitionSnapshot: definition,
        state: {
          instanceId: "instance-1",
          status: "active",
          currentStage: 1,
          unhealableDamage,
          unhealableDamageByType,
          revision: 1
        }
      }
    }
  };
  controller.update = async (changes) => {
    const state = changes[`flags.${MODULE_ID}.state`];
    if (state) controller.flags[MODULE_ID].state = structuredClone(state);
    return controller;
  };
  actor.items.push(controller);
  return { actor, controller, definition };
}

function condition(actor, { slug = "sickened", value = 2, name = "Sickened" } = {}) {
  return {
    type: "condition",
    name,
    parent: actor,
    system: { slug, value: { value } }
  };
}

test("active root and stage restrictions merge for an Actor", () => {
  const { actor } = actorWithController({
    rootRestrictions: { conditionLocks: [{ slug: "sickened", minimum: 1 }], healing: "affliction-damage", blockedCapabilities: [] },
    stageRestrictions: { conditionLocks: [{ slug: "sickened", minimum: 2 }], healing: "none", blockedCapabilities: ["speak"] },
    unhealableDamage: 7
  });
  const restrictions = collectActorRestrictions(actor);
  assert.equal(restrictions.conditionLocks[0].slug, "sickened");
  assert.equal(restrictions.conditionLocks[0].minimum, 2);
  assert.equal(restrictions.healing, "affliction-damage");
  assert.equal(restrictions.unhealableDamage, 7);
  assert.equal(isAfflictionCapabilityBlocked(actor, "speak"), true);
});

test("condition locks block reduction and deletion but allow increases", () => {
  const { actor } = actorWithController({
    stageRestrictions: { conditionLocks: [{ slug: "sickened", minimum: 2 }], healing: "none", blockedCapabilities: [] }
  });
  const item = condition(actor, { value: 2 });
  assert.equal(guardConditionUpdate(item, { system: { value: { value: 1 } } }), false);
  assert.equal(guardConditionUpdate(item, { system: { value: { value: 3 } } }), true);
  assert.equal(guardConditionDelete(item), false);
});

test("a condition lock without a minimum freezes the current value against reduction", () => {
  const { actor } = actorWithController({
    rootRestrictions: { conditionLocks: [{ slug: "fatigued", minimum: null }], healing: "none", blockedCapabilities: [] }
  });
  const item = condition(actor, { slug: "fatigued", value: 1, name: "Fatigued" });
  assert.equal(guardConditionUpdate(item, { system: { value: { value: 0 } } }), false);
  assert.equal(guardConditionDelete(item), false);
});

test("all-healing restriction clamps attempted HP healing to the current value", () => {
  const { actor } = actorWithController({
    stageRestrictions: { conditionLocks: [], healing: "all", blockedCapabilities: [] },
    hp: { value: 50, max: 100 }
  });
  const changes = { system: { attributes: { hp: { value: 80 } } } };
  assert.equal(guardHealingUpdate(actor, changes), true);
  assert.equal(changes.system.attributes.hp.value, 50);
});

test("affliction-damage healing restriction permits other healing but preserves tracked affliction damage", () => {
  const { actor } = actorWithController({
    rootRestrictions: { conditionLocks: [], healing: "affliction-damage", blockedCapabilities: [] },
    unhealableDamage: 10,
    hp: { value: 60, max: 100 }
  });
  const partial = { system: { attributes: { hp: { value: 85 } } } };
  guardHealingUpdate(actor, partial);
  assert.equal(partial.system.attributes.hp.value, 85);

  const excessive = { system: { attributes: { hp: { value: 100 } } } };
  guardHealingUpdate(actor, excessive);
  assert.equal(excessive.system.attributes.hp.value, 90);
});


test("typed healing locks protect recorded single-type PF2e damage", async () => {
  globalThis.game.user = { id: "gm", isGM: true };
  globalThis.game.users = { activeGM: { id: "gm" } };
  globalThis.game.messages = new Map();
  const { actor, controller } = actorWithController({
    stageRestrictions: { conditionLocks: [], healing: "none", unhealableDamageTypes: ["cold"], blockedCapabilities: [] },
    hp: { value: 70, max: 100 }
  });
  const message = {
    id: "cold-damage",
    uuid: "ChatMessage.cold-damage",
    actor,
    flags: {
      pf2e: {
        context: { type: "damage-taken", options: [] },
        damageRoll: { types: { cold: { energy: 12 } } },
        appliedDamage: {
          isHealing: false,
          isReverted: false,
          persistent: [],
          shield: null,
          updates: [{ path: "system.attributes.hp.value", value: 12 }]
        }
      }
    }
  };
  const result = await recordTypedHealingLockDamage(message);
  assert.equal(result.status, "recorded");
  assert.equal(controller.flags[MODULE_ID].state.unhealableDamageByType.cold, 12);

  const healing = { system: { attributes: { hp: { value: 100 } } } };
  guardHealingUpdate(actor, healing);
  assert.equal(healing.system.attributes.hp.value, 88);
});

test("typed healing locks refuse to guess mixed damage allocation", async () => {
  globalThis.game.user = { id: "gm", isGM: true };
  globalThis.game.users = { activeGM: { id: "gm" } };
  globalThis.game.messages = new Map();
  const { actor, controller } = actorWithController({
    stageRestrictions: { conditionLocks: [], healing: "none", unhealableDamageTypes: ["cold"], blockedCapabilities: [] }
  });
  const message = {
    id: "mixed-damage",
    uuid: "ChatMessage.mixed-damage",
    actor,
    flags: {
      pf2e: {
        context: { type: "damage-taken", options: [] },
        damageRoll: { types: { cold: { energy: 6 }, slashing: { physical: 6 } } },
        appliedDamage: {
          isHealing: false,
          isReverted: false,
          persistent: [],
          shield: null,
          updates: [{ path: "system.attributes.hp.value", value: 10 }]
        }
      }
    }
  };
  const result = await recordTypedHealingLockDamage(message);
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(controller.flags[MODULE_ID].state.unhealableDamageByType, {});
});
