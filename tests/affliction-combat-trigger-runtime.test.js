import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";
import { MODULE_ID } from "../scripts/constants.js";

const { modules } = installFoundryMock();
globalThis.game.user = { id: "gm", isGM: true };
globalThis.game.users = { activeGM: { id: "gm" } };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };

const {
  afflictionReferenceMatchesTrigger,
  inspectPf2eAfflictionTriggerMessage,
  processPf2eAfflictionTriggerMessage
} = await import("../scripts/affliction/integration/affliction-combat-trigger-runtime.js");

function sourceItem({
  trigger = "on-hit",
  application = "automatic",
  referenceId = "venom"
} = {}) {
  const source = {
    name: "Fieberangriff",
    type: "melee",
    flags: {
      [MODULE_ID]: {
        afflictionReferences: [{
          schemaVersion: 1,
          id: referenceId,
          templateUuid: "Compendium.test.afflictions.Item.fever",
          label: "Furchtfieber",
          trigger,
          application,
          enabled: true,
          metadata: {}
        }]
      }
    }
  };
  return {
    documentName: "Item",
    uuid: "Actor.source.Item.feverAttack",
    name: source.name,
    type: source.type,
    actor: { uuid: "Actor.source" },
    toObject: () => structuredClone(source)
  };
}

function targetActor() {
  return { documentName: "Actor", uuid: "Actor.target", name: "Ziel" };
}

test("PF2e attack-roll success emits on-use and on-hit against the serialized target", async () => {
  const target = targetActor();
  const item = sourceItem();
  const message = {
    id: "attack-success",
    uuid: "ChatMessage.attack-success",
    item,
    target: { actor: target },
    flags: {
      pf2e: {
        context: {
          type: "attack-roll",
          outcome: "success",
          target: { actor: target.uuid, token: "Scene.test.Token.target" }
        }
      }
    }
  };

  const event = await inspectPf2eAfflictionTriggerMessage(message);
  assert.equal(event.matched, true);
  assert.deepEqual(event.triggers, ["on-use", "on-hit"]);
  assert.equal(event.sourceItem, item);
  assert.equal(event.targetActor, target);
  assert.equal(event.outcome, "success");
  assert.equal(afflictionReferenceMatchesTrigger(item.toObject().flags[MODULE_ID].afflictionReferences[0], event), true);
});

test("PF2e missed attacks do not satisfy on-hit", async () => {
  const target = targetActor();
  const item = sourceItem();
  const event = await inspectPf2eAfflictionTriggerMessage({
    id: "attack-failure",
    item,
    target: { actor: target },
    flags: { pf2e: { context: { type: "attack-roll", outcome: "failure" } } }
  });
  assert.deepEqual(event.triggers, ["on-use"]);
  assert.equal(afflictionReferenceMatchesTrigger(item.toObject().flags[MODULE_ID].afflictionReferences[0], event), false);
});

test("on-damage is driven by PF2e damage-taken messages after positive damage application", async () => {
  const target = targetActor();
  const item = sourceItem({ trigger: "on-damage" });
  const event = await inspectPf2eAfflictionTriggerMessage({
    id: "damage-taken",
    item,
    actor: target,
    flags: {
      pf2e: {
        context: { type: "damage-taken", domains: ["damage-received"], options: [] },
        appliedDamage: {
          uuid: target.uuid,
          isHealing: false,
          shield: null,
          persistent: [],
          updates: [{ path: "system.attributes.hp.value", value: 7 }]
        }
      }
    }
  });
  assert.deepEqual(event.triggers, ["on-damage"]);
  assert.equal(event.targetActor, target);
});

test("healing and zero/reverted damage do not satisfy on-damage", async () => {
  const target = targetActor();
  const item = sourceItem({ trigger: "on-damage" });
  const healing = await inspectPf2eAfflictionTriggerMessage({
    id: "healing",
    item,
    actor: target,
    flags: { pf2e: { context: { type: "damage-taken" }, appliedDamage: { isHealing: true, updates: [] } } }
  });
  assert.deepEqual(healing.triggers, []);

  const reverted = await inspectPf2eAfflictionTriggerMessage({
    id: "reverted",
    item,
    actor: target,
    flags: { pf2e: { context: { type: "damage-taken" }, appliedDamage: { isHealing: false, isReverted: true, updates: [{ path: "system.attributes.hp.value", value: 5 }] } } }
  });
  assert.deepEqual(reverted.triggers, []);
});

test("failed saving throws and critical failures map to their reference triggers", async () => {
  const target = targetActor();
  const failedItem = sourceItem({ trigger: "failed-save", referenceId: "failed" });
  const failed = await inspectPf2eAfflictionTriggerMessage({
    id: "save-failure",
    item: failedItem,
    actor: target,
    flags: { pf2e: { context: { type: "saving-throw", outcome: "failure" } } }
  });
  assert.deepEqual(failed.triggers, ["failed-save"]);

  const criticalItem = sourceItem({ trigger: "critical-failure", referenceId: "critical" });
  const critical = await inspectPf2eAfflictionTriggerMessage({
    id: "save-critical-failure",
    item: criticalItem,
    actor: target,
    flags: { pf2e: { context: { type: "saving-throw", outcome: "criticalFailure" } } }
  });
  assert.deepEqual(critical.triggers, ["failed-save", "critical-failure"]);
  assert.equal(afflictionReferenceMatchesTrigger(criticalItem.toObject().flags[MODULE_ID].afflictionReferences[0], critical), true);
});

test("automatic combat triggers route through the public application facade once", async () => {
  const target = targetActor();
  const item = sourceItem({ application: "automatic" });
  const calls = [];
  modules.set(MODULE_ID, {
    api: {
      application: {
        applyItemReference: async (...args) => {
          calls.push(args);
          return { controllers: [{ id: "controller" }] };
        }
      }
    }
  });
  const message = {
    id: "auto-hit",
    uuid: "ChatMessage.auto-hit",
    item,
    target: { actor: target },
    flags: { pf2e: { context: { type: "attack-roll", outcome: "criticalSuccess" } } }
  };

  const first = await processPf2eAfflictionTriggerMessage(message, { force: true });
  const second = await processPf2eAfflictionTriggerMessage(message, { force: true });
  assert.equal(first.results[0].status, "applied");
  assert.equal(second.results[0].status, "duplicate");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], item);
  assert.equal(calls[0][1], "venom");
  assert.equal(calls[0][2], target);
  assert.equal(calls[0][3].application, "combat-trigger");
  assert.equal(calls[0][3].context.outcome, "criticalSuccess");
});

test("manual application policies are recognized but never auto-applied", async () => {
  const target = targetActor();
  const item = sourceItem({ application: "manual" });
  let calls = 0;
  modules.set(MODULE_ID, { api: { application: { applyItemReference: async () => { calls += 1; } } } });
  const result = await processPf2eAfflictionTriggerMessage({
    id: "manual-hit",
    item,
    target: { actor: target },
    flags: { pf2e: { context: { type: "attack-roll", outcome: "success" } } }
  }, { force: true });
  assert.equal(result.results[0].status, "manual");
  assert.equal(calls, 0);
});

test("saving-throw triggers can resolve their source Item from PF2e origin metadata", async () => {
  const target = targetActor();
  const item = sourceItem({ trigger: "failed-save", referenceId: "origin-save" });
  const previousFromUuid = globalThis.fromUuid;
  const previousFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = undefined;
  globalThis.fromUuid = async (uuid) => uuid === item.uuid ? item : null;
  try {
    const event = await inspectPf2eAfflictionTriggerMessage({
      id: "save-origin-failure",
      actor: target,
      flags: {
        pf2e: {
          context: { type: "saving-throw", outcome: "failure" },
          origin: { uuid: item.uuid }
        }
      }
    });
    assert.equal(event.sourceItem, item);
    assert.equal(event.targetActor, target);
    assert.deepEqual(event.triggers, ["failed-save"]);
  } finally {
    globalThis.fromUuid = previousFromUuid;
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});
