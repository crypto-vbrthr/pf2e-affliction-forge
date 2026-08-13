import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const { modules } = installFoundryMock();

globalThis.CONFIG = { time: { roundTime: 6 } };
globalThis.game.user = { id: "gm", isGM: true };
globalThis.game.time = { worldTime: 1000 };
globalThis.game.i18n = {
  localize: (key) => key,
  format: (key, data) => `${key}:${JSON.stringify(data)}`
};

const registry = new Map();
let documentId = 0;

function merge(target, changes) {
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ??= {};
      merge(target[key], value);
    } else {
      target[key] = structuredClone(value);
    }
  }
  return target;
}

class FakeItem {
  constructor(source, parent) {
    this.documentName = "Item";
    this.parent = parent;
    this.id = `item${++documentId}`;
    this.uuid = `${parent.uuid}.Item.${this.id}`;
    Object.assign(this, structuredClone(source));
    registry.set(this.uuid, this);
  }

  toObject() {
    const { parent, ...source } = this;
    return structuredClone(source);
  }

  async update(changes) {
    merge(this, changes);
    return this;
  }
}

class FakeActor {
  constructor(id, name = id) {
    this.documentName = "Actor";
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = name;
    this.items = [];
    registry.set(this.uuid, this);
  }

  canUserModify() { return true; }

  async createEmbeddedDocuments(type, sources) {
    assert.equal(type, "Item");
    if (this.failOnStageId && sources.some((source) => source.flags?.["pf2e-affliction-forge"]?.stageId === this.failOnStageId)) {
      const failed = this.failOnStageId;
      this.failOnStageId = null;
      throw new Error(`Synthetic creation failure for ${failed}`);
    }
    const created = sources.map((source) => new FakeItem(source, this));
    this.items.push(...created);
    return created;
  }

  async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "Item");
    const removed = this.items.filter((item) => ids.includes(item.id));
    this.items = this.items.filter((item) => !ids.includes(item.id));
    for (const item of removed) registry.delete(item.uuid);
    return removed;
  }
}

globalThis.fromUuid = async (uuid) => registry.get(uuid) ?? null;

modules.set("pf2e-critical-forge", {
  active: true,
  version: "1.0.1-rc.1",
  api: {
    version: "1.0.0",
    moduleVersion: "1.0.1-rc.1",
    schemaVersion: 2,
    effects: {
      validate: () => ({ valid: true, issues: [], errors: [] }),
      async toItemSources(definition) {
        return [{
          name: definition.name,
          type: "effect",
          img: definition.img ?? "icons/svg/aura.svg",
          system: {
            description: { value: "", gm: "" },
            rules: [{ key: "MockRule" }],
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            tokenIcon: { show: true },
            unidentified: false
          },
          flags: {
            "pf2e-critical-forge": {
              definitionId: definition.id,
              schemaVersion: 2
            }
          }
        }];
      }
    },
    ui: { effectEditor: { create: () => ({}) } }
  }
});

const { createAfflictionDefinition, createDefaultStage } = await import("../scripts/affliction/schema/affliction-defaults.js");
const { createAfflictionInstanceService } = await import("../scripts/affliction/runtime/affliction-instance-service.js");
const { getAfflictionFlags, isAfflictionController, isAfflictionStageEffect } = await import("../scripts/affliction/documents/affliction-flags.js");

function effect(id, name) {
  return {
    schemaVersion: 2,
    id,
    name,
    duration: { value: -1, unit: "unlimited", expiry: null },
    components: [{ type: "condition", slug: "frightened", value: 1 }],
    application: {},
    metadata: {}
  };
}

function definition() {
  return createAfflictionDefinition({
    name: "Testfäule",
    stages: [
      { ...createDefaultStage({ number: 1 }), effect: effect("rot.stage1", "Testfäule · Phase 1") },
      { ...createDefaultStage({ number: 2 }), effect: effect("rot.stage2", "Testfäule · Phase 2") }
    ]
  });
}

test("applying a definition creates one controller plus a tagged stage effect", async () => {
  const actor = new FakeActor("hero", "Hero");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor, {
    sourceTemplateUuid: "Item.template",
    sourceDefinitionVersion: 4
  });

  assert.equal(isAfflictionController(controller), true);
  assert.equal(actor.items.length, 2);
  const controllerFlags = getAfflictionFlags(controller);
  assert.equal(controllerFlags.sourceTemplateUuid, "Item.template");
  assert.equal(controllerFlags.sourceDefinitionVersion, 4);
  assert.equal(controllerFlags.state.currentStage, 1);
  assert.equal(controllerFlags.state.stageEnteredAt, 1000);
  assert.equal(controllerFlags.state.nextCheckAt, 1006);
  assert.equal(controllerFlags.state.activeStageEffectUuids.length, 1);

  const stageEffect = actor.items.find(isAfflictionStageEffect);
  const stageFlags = getAfflictionFlags(stageEffect);
  assert.equal(stageFlags.instanceId, controllerFlags.instanceId);
  assert.equal(stageFlags.stageId, "stage-1");
  assert.match(stageEffect.flags["pf2e-critical-forge"].definitionId, /^rot\.stage1\.affliction-instance\./);
});

test("manual stage transitions replace only this instance stage effects and update revision", async () => {
  const actor = new FakeActor("hero2", "Hero 2");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  const firstEffectUuid = getAfflictionFlags(controller).state.activeStageEffectUuids[0];

  await service.setStage(controller, 2, { enteredAt: 2000 });
  const flags = getAfflictionFlags(controller);
  assert.equal(flags.state.currentStage, 2);
  assert.equal(flags.state.revision, 2);
  assert.equal(flags.state.stageEnteredAt, 2000);
  assert.equal(registry.has(firstEffectUuid), false);
  const stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.equal(getAfflictionFlags(stageEffect).stageId, "stage-2");

  const beforeReapply = stageEffect.uuid;
  await service.reapplyStage(controller, { enteredAt: 3000 });
  assert.equal(getAfflictionFlags(controller).state.revision, 3);
  assert.equal(registry.has(beforeReapply), false);
  assert.equal(getAfflictionFlags(controller).state.stageEnteredAt, 3000);
});

test("multiple instances of the same definition remain isolated", async () => {
  const actor = new FakeActor("hero3", "Hero 3");
  const service = createAfflictionInstanceService();
  const [a] = await service.applyDefinition(definition(), actor);
  const [b] = await service.applyDefinition(definition(), actor);
  const aId = getAfflictionFlags(a).instanceId;
  const bId = getAfflictionFlags(b).instanceId;
  assert.notEqual(aId, bId);

  await service.setStage(a, 2);
  const effectsA = actor.items.filter((item) => isAfflictionStageEffect(item) && getAfflictionFlags(item).instanceId === aId);
  const effectsB = actor.items.filter((item) => isAfflictionStageEffect(item) && getAfflictionFlags(item).instanceId === bId);
  assert.equal(getAfflictionFlags(effectsA[0]).stageId, "stage-2");
  assert.equal(getAfflictionFlags(effectsB[0]).stageId, "stage-1");
});

test("identification changes are persisted on controller and active stage effects", async () => {
  const actor = new FakeActor("hero4", "Hero 4");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);

  await service.setIdentification(controller, "hidden", { changedAt: 4000, identifiedBy: "gm" });
  const flags = getAfflictionFlags(controller);
  assert.equal(flags.state.identification.state, "hidden");
  assert.equal(controller.system.unidentified, true);
  const stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.equal(stageEffect.system.unidentified, true);
  assert.equal(stageEffect.system.tokenIcon.show, false);
});

test("ending an affliction removes controller and all stage effects", async () => {
  const actor = new FakeActor("hero5", "Hero 5");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  await service.end(controller);
  assert.equal(actor.items.length, 0);
});



test("multi-target application rolls back earlier targets if a later target fails", async () => {
  const first = new FakeActor("batch1", "Batch 1");
  const second = new FakeActor("batch2", "Batch 2");
  second.failOnStageId = "stage-1";
  const service = createAfflictionInstanceService();

  await assert.rejects(() => service.applyDefinition(definition(), [first, second]), /Synthetic creation failure/);
  assert.equal(first.items.length, 0);
  assert.equal(second.items.length, 0);
});

test("failed stage creation rolls back to the previous stage output", async () => {
  const actor = new FakeActor("heroRollback", "Rollback Hero");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  actor.failOnStageId = "stage-2";

  await assert.rejects(() => service.setStage(controller, 2), /Synthetic creation failure/);
  const flags = getAfflictionFlags(controller);
  assert.equal(flags.state.currentStage, 1);
  const effects = actor.items.filter(isAfflictionStageEffect);
  assert.equal(effects.length, 1);
  assert.equal(getAfflictionFlags(effects[0]).stageId, "stage-1");
  assert.deepEqual(flags.state.activeStageEffectUuids, [effects[0].uuid]);
});

test("onset creates an incubating controller without a stage effect", async () => {
  const actor = new FakeActor("hero6", "Hero 6");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Langsames Fieber",
    onset: { value: 2, unit: "hours" },
    stages: [{ ...createDefaultStage({ number: 1 }), effect: effect("slow.stage1", "Langsames Fieber · Phase 1") }]
  });
  const [controller] = await service.applyDefinition(source, actor);
  const flags = getAfflictionFlags(controller);
  assert.equal(flags.state.status, "incubating");
  assert.equal(flags.state.currentStage, 0);
  assert.equal(flags.state.nextCheckAt, 8200);
  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 0);
});
