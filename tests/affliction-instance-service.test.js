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

function setPath(target, path, value) {
  const parts = String(path).split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor[part] ??= {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = structuredClone(value);
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

  getStatistic() {
    return {
      roll: async () => {
        this.rollCount = Number(this.rollCount ?? 0) + 1;
        const degree = Array.isArray(this.saveDegrees) && this.saveDegrees.length > 0
          ? this.saveDegrees.shift()
          : "failure";
        return { degreeOfSuccess: degree, total: 18, dice: [{ total: 10 }] };
      }
    };
  }

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

  async updateEmbeddedDocuments(type, updates) {
    assert.equal(type, "Item");
    const updated = [];
    for (const changes of updates) {
      const item = this.items.find((entry) => entry.id === changes._id);
      if (!item) continue;
      for (const [key, value] of Object.entries(changes)) {
        if (key === "_id") continue;
        if (key.includes(".")) setPath(item, key, value);
        else if (value && typeof value === "object" && !Array.isArray(value)) {
          item[key] ??= {};
          merge(item[key], value);
        } else item[key] = structuredClone(value);
      }
      updated.push(item);
    }
    return updated;
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

const instantExecutions = [];

modules.set("pf2e-critical-forge", {
  active: true,
  version: "1.0.1-rc.3",
  api: {
    version: "0.9.6",
    moduleVersion: "1.0.1-rc.3",
    schemaVersion: 2,
    effects: {
      validate: () => ({ valid: true, issues: [], errors: [] }),
      async toItemSources(definition) {
        const persistent = (definition.components ?? []).filter((component) => !["damage", "death"].includes(component.type));
        if (persistent.length === 0) return [];
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
      },
      async execute(definition, target, options = {}) {
        const actor = target?.documentName === "Actor" ? target : target?.actor;
        if (actor?.failInstant) {
          actor.failInstant = false;
          throw new Error("Synthetic instant execution failure");
        }
        const instant = (definition.components ?? []).filter((component) => ["damage", "death"].includes(component.type));
        if (instant.length === 0) return [];
        const entry = {
          definitionId: definition.id,
          actorUuid: actor?.uuid ?? null,
          components: structuredClone(instant),
          itemUuid: options.item?.uuid ?? null,
          label: options.label ?? null
        };
        instantExecutions.push(entry);
        return instant.map((component) => component.type === "death"
          ? { kind: "death", category: component.category ?? "direct", applied: true }
          : { kind: "damage", formula: component.formula, damageType: component.damageType });
      }
    },
    components: {
      get: (type) => type === "death" ? { type: "death", execution: "instant" } : null,
      list: () => [{ type: "death", execution: "instant" }]
    },
    ui: { effectEditor: { create: () => ({}) } }
  }
});

const { createAfflictionDefinition, createDefaultStage } = await import("../scripts/affliction/schema/affliction-defaults.js");
const { createAfflictionInstanceService, scheduledDueAt } = await import("../scripts/affliction/runtime/affliction-instance-service.js");
const { createAfflictionEngine } = await import("../scripts/affliction/runtime/affliction-engine.js");
const { createAfflictionScheduler } = await import("../scripts/affliction/runtime/affliction-scheduler.js");
const { getAfflictionFlags, isAfflictionController, isAfflictionStageEffect, isAfflictionResidualEffect } = await import("../scripts/affliction/documents/affliction-flags.js");
const { MODULE_ID } = await import("../scripts/constants.js");

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

function mixedEffect(id, name, formula = "2d6") {
  const result = effect(id, name);
  result.components.push({ type: "damage", formula, damageType: "poison" });
  return result;
}

function damageOnlyEffect(id, name, formula = "1d6") {
  return {
    schemaVersion: 2,
    id,
    name,
    duration: { value: -1, unit: "unlimited", expiry: null },
    components: [{ type: "damage", formula, damageType: "poison" }],
    application: {},
    metadata: {}
  };
}

function deathOnlyEffect(id, name, category = "direct") {
  return {
    schemaVersion: 2,
    id,
    name,
    duration: { value: -1, unit: "unlimited", expiry: null },
    components: [{ type: "death", category }],
    application: {},
    metadata: {}
  };
}

function definition() {
  return createAfflictionDefinition({
    name: "Testfäule",
    initialCheck: null,
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
  assert.equal(controllerFlags.state.activeStartedAt, 1000);
  assert.equal(controllerFlags.state.nextCheckAt, 1006);
  assert.equal(controllerFlags.state.activeStageEffectUuids.length, 1);

  const stageEffect = actor.items.find(isAfflictionStageEffect);
  const stageFlags = getAfflictionFlags(stageEffect);
  assert.equal(stageFlags.instanceId, controllerFlags.instanceId);
  assert.equal(stageFlags.stageId, "stage-1");
  assert.match(stageEffect.flags["pf2e-critical-forge"].definitionId, /^rot\.stage1\.affliction-instance\./);
});

test("identified controller descriptions are not duplicated and stage effect Items include the phase description", async () => {
  const actor = new FakeActor("heroDescriptions", "Description Hero");
  const service = createAfflictionInstanceService();
  const stageEffectDefinition = effect("description.stage1", "Descriptive Rot · Phase 1");
  stageEffectDefinition.description = "Additional mechanical note.";
  const source = createAfflictionDefinition({
    name: "Descriptive Rot",
    description: "Affliction overview.",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      description: "Phase 1 description.",
      effect: stageEffectDefinition
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  assert.equal(controller.system.description.value, "Affliction overview.");
  assert.equal(controller.system.description.gm, "", "identified controller must not repeat its public description in GM notes");

  const stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.ok(stageEffect);
  assert.equal(stageEffect.system.description.value, "Phase 1 description.\n\nAdditional mechanical note.");
  assert.equal(stageEffect.system.description.gm, "");
  assert.equal(getAfflictionFlags(stageEffect).identifiedPresentation.description, "Phase 1 description.\n\nAdditional mechanical note.");
});

test("onset time does not start the maximum-active-duration clock before the first stage", async () => {
  const actor = new FakeActor("heroOnsetActiveClock", "Onset Active Clock Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Arsen-ähnliches Gift",
    initialCheck: null,
    onset: { value: 10, unit: "minutes" },
    maximumDuration: { value: 5, unit: "minutes" },
    stages: [{ ...createDefaultStage({ number: 1 }), effect: effect("arsenic.stage1", "Arsen · Phase 1") }]
  });

  const [controller] = await service.applyDefinition(source, actor, { appliedAt: 1000 });
  let state = getAfflictionFlags(controller).state;
  assert.equal(state.status, "incubating");
  assert.equal(state.activeStartedAt, null);
  assert.equal(state.onsetStartedAt, 1000);

  await service.completeOnset(controller, { enteredAt: 1600 });
  state = getAfflictionFlags(controller).state;
  assert.equal(state.status, "active");
  assert.equal(state.currentStage, 1);
  assert.equal(state.stageEnteredAt, 1600);
  assert.equal(state.activeStartedAt, 1600);
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
  assert.equal(flags.state.activeStartedAt, 1000);
  assert.equal(registry.has(firstEffectUuid), false);
  const stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.equal(getAfflictionFlags(stageEffect).stageId, "stage-2");

  const beforeReapply = stageEffect.uuid;
  await service.reapplyStage(controller, { enteredAt: 3000 });
  assert.equal(getAfflictionFlags(controller).state.revision, 3);
  assert.equal(registry.has(beforeReapply), false);
  assert.equal(getAfflictionFlags(controller).state.stageEnteredAt, 3000);
  assert.equal(getAfflictionFlags(controller).state.activeStartedAt, 1000);
});

test("different Affliction definition identities remain isolated on the same Actor", async () => {
  const actor = new FakeActor("hero3", "Hero 3");
  const service = createAfflictionInstanceService();
  const firstDefinition = definition();
  const secondDefinition = definition();
  assert.notEqual(firstDefinition.id, secondDefinition.id);

  const [a] = await service.applyDefinition(firstDefinition, actor);
  const [b] = await service.applyDefinition(secondDefinition, actor);
  const aId = getAfflictionFlags(a).instanceId;
  const bId = getAfflictionFlags(b).instanceId;
  assert.notEqual(aId, bId);

  await service.setStage(a, 2);
  const effectsA = actor.items.filter((item) => isAfflictionStageEffect(item) && getAfflictionFlags(item).instanceId === aId);
  const effectsB = actor.items.filter((item) => isAfflictionStageEffect(item) && getAfflictionFlags(item).instanceId === bId);
  assert.equal(getAfflictionFlags(effectsA[0]).stageId, "stage-2");
  assert.equal(getAfflictionFlags(effectsB[0]).stageId, "stage-1");
});

test("the same Affliction definition cannot be applied twice while its controller exists", async () => {
  const actor = new FakeActor("heroDuplicate", "Duplicate Hero");
  const service = createAfflictionInstanceService();
  const source = definition();

  const [first] = await service.applyDefinition(source, actor);
  const duplicate = await service.applyDefinition(source, actor);

  assert.equal(duplicate.length, 0);
  assert.equal(actor.items.filter(isAfflictionController).length, 1);
  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 1);
  assert.equal(getAfflictionFlags(first).definitionId, source.id);
});

test("a pending initial-exposure controller also blocks duplicate Affliction application", async () => {
  const actor = new FakeActor("heroPendingDuplicate", "Pending Duplicate Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Pending Testfäule",
    stages: [{ ...createDefaultStage({ number: 1 }), effect: effect("pending.rot.stage1", "Pending Testfäule · Phase 1") }]
  });

  const [first] = await service.applyDefinition(source, actor);
  assert.equal(getAfflictionFlags(first).state.status, "pending");
  const duplicate = await service.applyDefinition(source, actor);

  assert.equal(duplicate.length, 0);
  assert.equal(actor.items.filter(isAfflictionController).length, 1);
});

test("the same Affliction may be applied again after the previous controller ends", async () => {
  const actor = new FakeActor("heroReinfect", "Reinfection Hero");
  const service = createAfflictionInstanceService();
  const source = definition();

  const [first] = await service.applyDefinition(source, actor);
  await service.end(first, { reason: "recovered", notifyLifecycle: false });
  const [second] = await service.applyDefinition(source, actor);

  assert.ok(second);
  assert.notEqual(getAfflictionFlags(first).instanceId, getAfflictionFlags(second).instanceId);
  assert.equal(actor.items.filter(isAfflictionController).length, 1);
});

test("multi-target application skips already affected Actors and still applies to eligible targets", async () => {
  const affected = new FakeActor("heroAlreadyAffected", "Already Affected Hero");
  const fresh = new FakeActor("heroFreshTarget", "Fresh Hero");
  const service = createAfflictionInstanceService();
  const source = definition();

  await service.applyDefinition(source, affected);
  const created = await service.applyDefinition(source, [affected, fresh]);

  assert.equal(created.length, 1);
  assert.equal(created[0].parent, fresh);
  assert.equal(affected.items.filter(isAfflictionController).length, 1);
  assert.equal(fresh.items.filter(isAfflictionController).length, 1);
});

test("concurrent applications of the same Affliction serialize to one controller per Actor", async () => {
  const actor = new FakeActor("heroConcurrentDuplicate", "Concurrent Duplicate Hero");
  const service = createAfflictionInstanceService();
  const source = definition();
  const originalCreate = actor.createEmbeddedDocuments.bind(actor);
  let releaseFirst;
  let signalStarted;
  const firstStarted = new Promise((resolve) => { signalStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let firstCreation = true;

  actor.createEmbeddedDocuments = async (...args) => {
    if (firstCreation) {
      firstCreation = false;
      signalStarted();
      await firstGate;
    }
    return originalCreate(...args);
  };

  const firstApplication = service.applyDefinition(source, actor);
  await firstStarted;
  const secondApplication = service.applyDefinition(source, actor);
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseFirst();

  const [first, second] = await Promise.all([firstApplication, secondApplication]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(actor.items.filter(isAfflictionController).length, 1);
  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 1);
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



test("definitions with an initial check create a pending controller before any stage effect", async () => {
  const actor = new FakeActor("heroPending", "Pending Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Expositionsfäule",
    stages: [{ ...createDefaultStage({ number: 1 }), effect: effect("exposure.stage1", "Expositionsfäule · Phase 1") }]
  });
  const [controller] = await service.applyDefinition(source, actor);
  const flags = getAfflictionFlags(controller);
  assert.equal(flags.state.status, "pending");
  assert.equal(flags.state.currentStage, 0);
  assert.equal(flags.state.nextCheckAt, null);
  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 0);
});

test("onset creates an incubating controller without a stage effect", async () => {
  const actor = new FakeActor("hero6", "Hero 6");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Langsames Fieber",
    initialCheck: null,
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

test("stage entry executes instant damage while persistent mechanics remain stage Items", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroInstant", "Instant Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Scharlachgift",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: mixedEffect("scarlet.stage1", "Scharlachgift · Phase 1", "2d6+3")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  const flags = getAfflictionFlags(controller);
  const stageEffects = actor.items.filter(isAfflictionStageEffect);

  assert.equal(stageEffects.length, 1);
  assert.equal(flags.state.activeStageEffectUuids.length, 1);
  assert.equal(instantExecutions.length, 1);
  assert.equal(instantExecutions[0].actorUuid, actor.uuid);
  assert.equal(instantExecutions[0].itemUuid, controller.uuid);
  assert.equal(instantExecutions[0].components[0].formula, "2d6+3");
  assert.match(instantExecutions[0].definitionId, /^scarlet\.stage1\.affliction-instance\./);
});

test("instant-only stages execute without creating empty persistent stage Items", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroInstantOnly", "Instant Only Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Brennendes Gift",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: damageOnlyEffect("burn.stage1", "Brennendes Gift · Phase 1", "8")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  const flags = getAfflictionFlags(controller);

  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 0);
  assert.deepEqual(flags.state.activeStageEffectUuids, []);
  assert.equal(instantExecutions.length, 1);
  assert.equal(instantExecutions[0].components[0].formula, "8");
});

test("lethal final stages execute Critical Forge death components without creating persistent stage Items", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroLethal", "Lethal Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Schwarze Fäule",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: deathOnlyEffect("blackrot.stage1", "Schwarze Fäule · Letzte Phase", "death-effect")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  const flags = getAfflictionFlags(controller);

  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 0);
  assert.deepEqual(flags.state.activeStageEffectUuids, []);
  assert.equal(instantExecutions.length, 1);
  assert.deepEqual(instantExecutions[0].components, [{ type: "death", category: "death-effect" }]);
});

test("same-stage resolution keeps persistent effects and executes instant mechanics again", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroSameStage", "Same Stage Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Kreislaufgift",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: mixedEffect("cycle.stage1", "Kreislaufgift · Phase 1", "1d6")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  const stageEffect = actor.items.find(isAfflictionStageEffect);
  const originalUuid = stageEffect.uuid;
  assert.equal(instantExecutions.length, 1);

  await service.setStage(controller, 1, { enteredAt: 2000 });

  const flags = getAfflictionFlags(controller);
  assert.equal(registry.has(originalUuid), true);
  assert.deepEqual(flags.state.activeStageEffectUuids, [originalUuid]);
  assert.equal(flags.state.stageEnteredAt, 2000);
  assert.equal(flags.state.nextCheckAt, 2006);
  assert.equal(instantExecutions.length, 2);
});

test("manual stage reapplication refreshes persistent output and reruns instant mechanics", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroReapplyInstant", "Reapply Instant Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Wiederkehrendes Gift",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: mixedEffect("repeat.stage1", "Wiederkehrendes Gift · Phase 1", "1d8")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  const firstUuid = actor.items.find(isAfflictionStageEffect).uuid;
  await service.reapplyStage(controller, { enteredAt: 3000 });
  const secondUuid = actor.items.find(isAfflictionStageEffect).uuid;

  assert.notEqual(secondUuid, firstUuid);
  assert.equal(registry.has(firstUuid), false);
  assert.equal(instantExecutions.length, 2);
});

test("an instant execution failure does not roll back an already committed stage transition", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroInstantFailure", "Instant Failure Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Fehlergift",
    initialCheck: null,
    stages: [
      { ...createDefaultStage({ number: 1 }), effect: mixedEffect("failure.stage1", "Fehlergift · Phase 1", "1d4") },
      { ...createDefaultStage({ number: 2 }), effect: mixedEffect("failure.stage2", "Fehlergift · Phase 2", "2d4") }
    ]
  });

  const [controller] = await service.applyDefinition(source, actor);
  actor.failInstant = true;
  await service.setStage(controller, 2, { enteredAt: 4000 });

  const flags = getAfflictionFlags(controller);
  const stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.equal(flags.state.currentStage, 2);
  assert.equal(getAfflictionFlags(stageEffect).stageId, "stage-2");
  assert.equal(flags.state.stageEnteredAt, 4000);
});

test("explicit executeStageInstant retries instant mechanics without changing controller state", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroInstantRetry", "Instant Retry Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Nachwirkendes Gift",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: mixedEffect("retry.stage1", "Nachwirkendes Gift · Phase 1", "2d8")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  const before = structuredClone(getAfflictionFlags(controller).state);
  const results = await service.executeStageInstant(controller);
  const after = getAfflictionFlags(controller).state;

  assert.equal(results.length, 1);
  assert.equal(instantExecutions.length, 2);
  assert.deepEqual(after, before);
});

test("hidden afflictions do not leak their identity through instant-damage labels", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroHiddenInstant", "Hidden Instant Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Geheimer Grabfluch",
    initialCheck: null,
    identification: { initialState: "hidden" },
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: damageOnlyEffect("secret.stage1", "Geheimer Grabfluch · Phase 1", "1d10")
    }]
  });

  await service.applyDefinition(source, actor);
  assert.equal(instantExecutions.length, 1);
  assert.equal(instantExecutions[0].label.includes("Geheimer Grabfluch"), false);
});


test("integrated world-time flow honors one-minute onset and stage durations after an initial save", async () => {
  globalThis.game.time.worldTime = 1000;
  const actor = new FakeActor("timelineIntegration", "Timeline Integration Hero");
  actor.saveDegrees = ["failure", "failure"];
  actor.rollCount = 0;

  const oneMinuteStage = (number) => ({
    ...createDefaultStage({ number }),
    duration: { value: 1, unit: "minutes" }
  });
  const source = createAfflictionDefinition({
    name: "Minutenfieber",
    saveDefaults: { execution: "automatic", visibility: "public" },
    onset: { value: 1, unit: "minutes" },
    stages: [oneMinuteStage(1), oneMinuteStage(2), oneMinuteStage(3)]
  });

  const service = createAfflictionInstanceService();
  const engine = createAfflictionEngine({ instanceService: service });
  const application = await engine.applyDefinition(source, actor);
  const controller = application.controllers[0];
  let flags = getAfflictionFlags(controller);

  assert.equal(actor.rollCount, 1, "initial save is rolled immediately");
  assert.equal(flags.state.status, "incubating");
  assert.equal(flags.state.currentStage, 0);
  assert.equal(flags.state.onsetStartedAt, 1000);
  assert.equal(flags.state.nextCheckAt, 1060);
  assert.equal(scheduledDueAt(flags.definitionSnapshot, flags.state), 1060);

  const scheduler = createAfflictionScheduler({
    engine,
    instanceService: service,
    controllerProvider: () => [controller],
    authorityResolver: () => true,
    settingsProvider: () => ({ enabled: true, catchUpMode: "all", catchUpLimit: 25 })
  });

  globalThis.game.time.worldTime = 1006;
  await scheduler.processDue({ worldTime: 1006, reason: "test-one-round" });
  flags = getAfflictionFlags(controller);
  assert.equal(actor.rollCount, 1, "one six-second round must not request another save");
  assert.equal(flags.state.status, "incubating");
  assert.equal(flags.state.currentStage, 0);

  globalThis.game.time.worldTime = 1060;
  await scheduler.processDue({ worldTime: 1060, reason: "test-onset-complete" });
  flags = getAfflictionFlags(controller);
  assert.equal(actor.rollCount, 1, "onset completion itself does not roll the stage save");
  assert.equal(flags.state.status, "active");
  assert.equal(flags.state.currentStage, 1);
  assert.equal(flags.state.stageEnteredAt, 1060);
  assert.equal(flags.state.nextCheckAt, 1120);
  assert.equal(scheduledDueAt(flags.definitionSnapshot, flags.state), 1120);

  globalThis.game.time.worldTime = 1066;
  await scheduler.processDue({ worldTime: 1066, reason: "test-one-stage-round" });
  flags = getAfflictionFlags(controller);
  assert.equal(actor.rollCount, 1, "one round in stage 1 must not request its one-minute save");
  assert.equal(flags.state.currentStage, 1);

  globalThis.game.time.worldTime = 1120;
  await scheduler.processDue({ worldTime: 1120, reason: "test-stage-due" });
  flags = getAfflictionFlags(controller);
  assert.equal(actor.rollCount, 2, "stage save is rolled only after the full minute");
  assert.equal(flags.state.currentStage, 2, "a failed stage-1 save progresses to stage 2 only after stage 1 existed for a full minute");
  assert.equal(flags.state.stageEnteredAt, 1120);
  assert.equal(flags.state.nextCheckAt, 1180);
});

test("runtime identification presentation conceals hidden afflictions and restores identified stage metadata", async () => {
  const actor = new FakeActor("heroVisibility", "Visibility Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Geheime Fäule",
    description: "Die wahre Beschreibung.",
    initialCheck: null,
    identification: { initialState: "hidden" },
    stages: [{
      ...createDefaultStage({ number: 1 }),
      description: "Geheime Phasenbeschreibung.",
      effect: effect("visibility.stage1", "Geheime Fäule · Phase 1")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  let stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.equal(controller.name, "Unidentified Affliction");
  assert.equal(controller.img, "icons/svg/biohazard.svg");
  assert.equal(controller.system.tokenIcon.show, false);
  assert.equal(controller.system.description.value, "");
  assert.equal(controller.system.description.gm, "Die wahre Beschreibung.");
  assert.equal(stageEffect.name, "Unidentified Effect");
  assert.equal(stageEffect.system.description.value, "");
  assert.equal(stageEffect.system.description.gm, "Geheime Phasenbeschreibung.");
  assert.equal(stageEffect.system.tokenIcon.show, false);

  await service.setIdentification(controller, "suspected", { changedAt: 1100 });
  assert.equal(controller.name, "Suspected Affliction");
  assert.equal(controller.system.tokenIcon.show, true);
  stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.equal(stageEffect.name, "Unidentified Affliction Effect");
  assert.equal(stageEffect.system.tokenIcon.show, false);

  await service.setIdentification(controller, "identified", { changedAt: 1200 });
  assert.equal(controller.name, "Geheime Fäule");
  assert.equal(controller.system.description.value, "Die wahre Beschreibung.");
  assert.equal(controller.system.description.gm, "");
  stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.equal(stageEffect.name, "Geheime Fäule · Phase 1");
  assert.equal(stageEffect.system.description.value, "Geheime Phasenbeschreibung.");
  assert.equal(stageEffect.system.description.gm, "");
  assert.equal(stageEffect.system.tokenIcon.show, true);
  assert.equal(getAfflictionFlags(controller).state.events.at(-1).type, "identification-changed");
});

test("successful lethal stage execution records cause of death and a runtime audit event", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroDeathAudit", "Death Audit Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Endfäule",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      name: "Organversagen",
      effect: deathOnlyEffect("death.audit", "Endfäule · Organversagen", "death-effect")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor, { appliedAt: 1500 });
  const state = getAfflictionFlags(controller).state;
  assert.equal(state.mortality.dead, true);
  assert.equal(state.mortality.stageNumber, 1);
  assert.equal(state.mortality.stageName, "Organversagen");
  assert.equal(state.mortality.category, "death-effect");
  assert.equal(state.mortality.afflictionName, "Endfäule");
  assert.equal(state.events.some((entry) => entry.type === "death"), true);
});

test("reconcile restores missing persistent stage output without replaying instant components", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroReconcileMissing", "Reconcile Missing Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Reconcile Gift",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: mixedEffect("reconcile.stage1", "Reconcile Gift · Phase 1", "2d6")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  assert.equal(instantExecutions.length, 1);
  const first = actor.items.find(isAfflictionStageEffect);
  await actor.deleteEmbeddedDocuments("Item", [first.id]);

  const report = await service.reconcile(controller);
  const repaired = actor.items.filter(isAfflictionStageEffect);
  assert.equal(report.repaired, true);
  assert.equal(report.created, 1);
  assert.equal(repaired.length, 1);
  assert.notEqual(repaired[0].uuid, first.uuid);
  assert.equal(instantExecutions.length, 1, "reconciliation must not replay instant damage");
  assert.deepEqual(getAfflictionFlags(controller).state.activeStageEffectUuids, [repaired[0].uuid]);
});

test("reconcile removes orphaned generated stage effects from an actor", async () => {
  const actor = new FakeActor("heroReconcileOrphan", "Reconcile Orphan Hero");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  const controllerId = controller.id;
  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 1);

  // Simulate an interrupted/manual controller deletion that bypassed the
  // normal cleanup hook, leaving controller-owned generated output behind.
  actor.items = actor.items.filter((item) => item.id !== controllerId);
  registry.delete(controller.uuid);

  const report = await service.reconcileActor(actor, { cleanupOrphans: true });
  assert.equal(report.orphaned, 1);
  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 0);
});

test("same-stage renewal self-heals missing persistent output before executing interval instant mechanics", async () => {
  instantExecutions.length = 0;
  const actor = new FakeActor("heroSameStageRepair", "Same Stage Repair Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Repair Cycle",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effect: mixedEffect("repaircycle.stage1", "Repair Cycle · Phase 1", "1d6")
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  const old = actor.items.find(isAfflictionStageEffect);
  await actor.deleteEmbeddedDocuments("Item", [old.id]);

  await service.setStage(controller, 1, { enteredAt: 2000 });
  const effects = actor.items.filter(isAfflictionStageEffect);
  assert.equal(effects.length, 1);
  assert.equal(instantExecutions.length, 2, "initial entry plus one renewed interval only");
  assert.deepEqual(getAfflictionFlags(controller).state.activeStageEffectUuids, [effects[0].uuid]);
});

test("listAll returns controller descriptors across world actors", async () => {
  const service = createAfflictionInstanceService();
  const actorA = new FakeActor("registry-a", "Registry A");
  const actorB = new FakeActor("registry-b", "Registry B");
  globalThis.game.actors = [actorA, actorB];

  const definition = createAfflictionDefinition({
    name: "Registry Probe",
    stages: [createDefaultStage(1)]
  });

  await service.applyDefinition(definition, [actorA, actorB]);
  const all = await service.listAll();

  assert.equal(all.length, 2);
  assert.deepEqual(all.map((entry) => entry.actorName).sort(), ["Registry A", "Registry B"]);
  assert.ok(all.every((entry) => entry.name === "Registry Probe"));
});

test("listAll includes controllers on unlinked synthetic token actors", async () => {
  const previousActors = globalThis.game.actors;
  const previousScenes = globalThis.game.scenes;
  globalThis.game.actors = [];
  const actor = new FakeActor("synthetic-list", "Synthetic List Actor");
  actor.uuid = "Scene.test.Token.synthetic.Actor.synthetic-list";
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  globalThis.game.scenes = [{
    tokens: [{ actor }]
  }];

  const all = await service.listAll();
  assert.equal(all.some((entry) => entry.uuid === controller.uuid), true);
  assert.equal(all.some((entry) => entry.actorUuid === actor.uuid), true);

  globalThis.game.actors = previousActors;
  globalThis.game.scenes = previousScenes;
});

test("reconcile retries against a newer controller revision instead of rebuilding stale stage output", async () => {
  const actor = new FakeActor("heroReconcileRace", "Reconcile Race Hero");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  const initialStageEffect = actor.items.find(isAfflictionStageEffect);
  await actor.deleteEmbeddedDocuments("Item", [initialStageEffect.id]);

  const criticalApi = modules.get("pf2e-critical-forge").api;
  const originalToItemSources = criticalApi.effects.toItemSources;
  let injectedRevisionChange = false;
  criticalApi.effects.toItemSources = async (effectDefinition, options) => {
    if (!injectedRevisionChange && String(effectDefinition.id).includes("rot.stage1")) {
      injectedRevisionChange = true;
      const state = getAfflictionFlags(controller).state;
      state.currentStage = 2;
      state.stageEnteredAt = 1100;
      state.nextCheckAt = 1106;
      state.revision += 1;
    }
    return originalToItemSources(effectDefinition, options);
  };

  const report = await service.reconcile(controller);
  criticalApi.effects.toItemSources = originalToItemSources;

  assert.equal(report.repaired, true);
  const effects = actor.items.filter(isAfflictionStageEffect);
  assert.equal(effects.length, 1);
  assert.equal(getAfflictionFlags(effects[0]).stageNumber, 2);
  assert.equal(getAfflictionFlags(controller).state.currentStage, 2);
  assert.deepEqual(getAfflictionFlags(controller).state.activeStageEffectUuids, [effects[0].uuid]);
});

test("multi-target structural rollback happens before any irreversible instant stage mechanics execute", async () => {
  const actorA = new FakeActor("multiInstantA", "Multi Instant A");
  const actorB = new FakeActor("multiInstantB", "Multi Instant B");
  const source = createAfflictionDefinition({
    name: "Atomic Instant Test",
    initialCheck: null,
    onset: null,
    stages: [{ ...createDefaultStage({ number: 1 }), effect: mixedEffect("atomic.stage1", "Atomic Stage 1", "4d6") }]
  });
  actorB.failOnStageId = "stage-1";
  const service = createAfflictionInstanceService();
  const before = instantExecutions.length;

  await assert.rejects(() => service.applyDefinition(source, [actorA, actorB]), /Synthetic creation failure/);

  assert.equal(instantExecutions.length, before);
  assert.equal(actorA.items.length, 0);
  assert.equal(actorB.items.length, 0);
});

test("serialized controller mutations continue after a rejected transition", async () => {
  const actor = new FakeActor("heroMutationQueue", "Mutation Queue Hero");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  actor.failOnStageId = "stage-2";

  const failedTransition = service.setStage(controller, 2);
  const queuedIdentification = service.setIdentification(controller, "hidden", {
    changedAt: 5000,
    identifiedBy: "gm"
  });

  const [transitionResult, identificationResult] = await Promise.allSettled([
    failedTransition,
    queuedIdentification
  ]);

  assert.equal(transitionResult.status, "rejected");
  assert.equal(identificationResult.status, "fulfilled");
  const flags = getAfflictionFlags(controller);
  assert.equal(flags.state.currentStage, 1);
  assert.equal(flags.state.identification.state, "hidden");
});

test("reconcileActor isolates a corrupt controller and still repairs healthy instances", async () => {
  const actor = new FakeActor("heroReconcileIsolation", "Reconcile Isolation Hero");
  const service = createAfflictionInstanceService();
  const [corrupt] = await service.applyDefinition(definition(), actor);
  const [healthy] = await service.applyDefinition(definition(), actor);

  // Damage only one controller's persisted definition contract. Its generated
  // output must be preserved, while the healthy sibling can still reconcile.
  corrupt.flags[MODULE_ID].definitionSnapshot = { schemaVersion: 999 };
  const healthyEffect = actor.items.find((item) => {
    const flags = getAfflictionFlags(item);
    return isAfflictionStageEffect(item) && flags?.instanceId === getAfflictionFlags(healthy)?.instanceId;
  });
  await actor.deleteEmbeddedDocuments("Item", [healthyEffect.id]);

  const report = await service.reconcileActor(actor, { cleanupOrphans: true });
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].controllerUuid, corrupt.uuid);
  assert.equal(report.controllers.some((entry) => entry.controllerUuid === healthy.uuid && entry.repaired), true);
  assert.equal(actor.items.some((item) => {
    const flags = getAfflictionFlags(item);
    return isAfflictionStageEffect(item) && flags?.instanceId === getAfflictionFlags(healthy)?.instanceId;
  }), true);
});

test("cleanupDeletedController removes only the deleted controller's generated stage output", async () => {
  const actor = new FakeActor("heroDeletedControllerCleanup", "Deleted Controller Cleanup Hero");
  const service = createAfflictionInstanceService();
  const [first] = await service.applyDefinition(definition(), actor);
  const [second] = await service.applyDefinition(definition(), actor);
  const firstInstanceId = getAfflictionFlags(first).instanceId;
  const secondInstanceId = getAfflictionFlags(second).instanceId;

  // Simulate Foundry's post-delete hook: the deleted document still carries its
  // parent/flags while it is already absent from the Actor collection.
  actor.items = actor.items.filter((item) => item.id !== first.id);
  registry.delete(first.uuid);
  await service.cleanupDeletedController(first);

  assert.equal(actor.items.some((item) => isAfflictionStageEffect(item) && getAfflictionFlags(item)?.instanceId === firstInstanceId), false);
  assert.equal(actor.items.some((item) => isAfflictionStageEffect(item) && getAfflictionFlags(item)?.instanceId === secondInstanceId), true);
  assert.equal(actor.items.includes(second), true);
});

test("stage changes, recovery, and maximum-duration expiry create GM lifecycle chat messages with template links", async () => {
  const created = [];
  const previousChatMessage = globalThis.ChatMessage;
  globalThis.ChatMessage = {
    getWhisperRecipients: () => [{ id: "gm" }],
    getSpeaker: ({ actor }) => ({ actor: actor?.id ?? null }),
    async create(data) { created.push(data); return data; }
  };
  try {
    const service = createAfflictionInstanceService();
    const actor = new FakeActor("lifecycleHero", "Lifecycle Hero");
    const [controller] = await service.applyDefinition(definition(), actor, {
      sourceTemplateUuid: "Compendium.test.afflictions.Item.lifecycle"
    });

    await service.setStage(controller, 2, { enteredAt: 2000 });
    assert.equal(created.length, 1);
    assert.equal(created[0].flags[MODULE_ID].runtimeEvent, "stage-changed");
    assert.equal(created[0].flags[MODULE_ID].fromStage, 1);
    assert.equal(created[0].flags[MODULE_ID].stageNumber, 2);
    assert.deepEqual(created[0].whisper, ["gm"]);
    assert.match(created[0].content, /@Affliction\[Compendium\.test\.afflictions\.Item\.lifecycle\]/);

    await service.end(controller, { reason: "recovered" });
    assert.equal(created.length, 2);
    assert.equal(created[1].flags[MODULE_ID].runtimeEvent, "recovered");
    assert.deepEqual(created[1].whisper, ["gm"]);
    assert.match(created[1].content, /@Affliction\[Compendium\.test\.afflictions\.Item\.lifecycle\]/);

    const actor2 = new FakeActor("durationHero", "Duration Hero");
    const [controller2] = await service.applyDefinition(definition(), actor2, {
      sourceTemplateUuid: "Compendium.test.afflictions.Item.duration"
    });
    await service.end(controller2, { reason: "maximum-duration" });
    assert.equal(created.length, 3);
    assert.equal(created[2].flags[MODULE_ID].runtimeEvent, "maximum-duration");
    assert.deepEqual(created[2].whisper, ["gm"]);
    assert.match(created[2].content, /@Affliction\[Compendium\.test\.afflictions\.Item\.duration\]/);
  } finally {
    globalThis.ChatMessage = previousChatMessage;
  }
});

test("strict reconcile rebuilds manually modified stage-effect content while normal reconcile leaves it alone", async () => {
  const actor = new FakeActor("strictReconcile", "Strict Reconcile Hero");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  let stageEffect = actor.items.find(isAfflictionStageEffect);
  stageEffect.system.rules[0].key = "TamperedRule";

  const normal = await service.reconcile(controller);
  assert.equal(normal.repaired, false);
  assert.equal(actor.items.find(isAfflictionStageEffect).system.rules[0].key, "TamperedRule");

  const strict = await service.reconcile(controller, { strict: true });
  stageEffect = actor.items.find(isAfflictionStageEffect);
  assert.equal(strict.repaired, true);
  assert.equal(strict.strict, true);
  assert.equal(stageEffect.system.rules[0].key, "MockRule");
});

test("pause and resume freeze stage and maximum-duration clocks without removing persistent output", async () => {
  const actor = new FakeActor("pauseResume", "Pause Resume Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Paused Rot",
    initialCheck: null,
    maximumDuration: { value: 5, unit: "minutes" },
    stages: [{
      ...createDefaultStage({ number: 1 }),
      duration: { value: 1, unit: "minutes" },
      effect: effect("paused.stage1", "Paused Rot · Phase 1")
    }]
  });
  const [controller] = await service.applyDefinition(source, actor, { appliedAt: 1000 });
  const originalEffectUuid = actor.items.find(isAfflictionStageEffect).uuid;

  await service.pause(controller, { pausedAt: 1020 });
  let state = getAfflictionFlags(controller).state;
  assert.equal(state.status, "paused");
  assert.equal(state.nextCheckAt, null);
  assert.equal(state.pause.previousStatus, "active");
  assert.equal(state.pause.nextCheckAt, 1060);
  assert.equal(actor.items.find(isAfflictionStageEffect).uuid, originalEffectUuid);

  const reconcile = await service.reconcile(controller, { strict: true });
  assert.equal(reconcile.repaired, false, "paused active-stage output remains present");

  await service.resume(controller, { resumedAt: 1120 });
  state = getAfflictionFlags(controller).state;
  assert.equal(state.status, "active");
  assert.equal(state.stageEnteredAt, 1100);
  assert.equal(state.activeStartedAt, 1100);
  assert.equal(state.nextCheckAt, 1160);
  assert.equal(state.pause, null);
  assert.equal(state.events.at(-2).type, "paused");
  assert.equal(state.events.at(-1).type, "resumed");
});

test("pause refuses controllers with an unresolved save", async () => {
  const actor = new FakeActor("pausePending", "Pause Pending Hero");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  const state = structuredClone(getAfflictionFlags(controller).state);
  state.pendingCheck = { requestId: "pending", checkIds: ["save"], results: {}, requests: {} };
  await service.updateRuntimeState(controller, state);
  await assert.rejects(() => service.pause(controller), /pending save/i);
});

test("identified lethal-stage lifecycle messages remain GM-only and include the template link", async () => {
  const created = [];
  const previousChatMessage = globalThis.ChatMessage;
  globalThis.ChatMessage = {
    getWhisperRecipients: () => [{ id: "gm" }],
    getSpeaker: ({ actor }) => ({ actor: actor?.id ?? null }),
    async create(data) { created.push(data); return data; }
  };
  try {
    const actor = new FakeActor("deathChatHero", "Death Chat Hero");
    const service = createAfflictionInstanceService();
    const source = createAfflictionDefinition({
      name: "Final Rot",
      initialCheck: null,
      identification: { initialState: "identified" },
      stages: [{
        ...createDefaultStage({ number: 1 }),
        name: "Finale",
        effect: deathOnlyEffect("death.chat", "Final Rot · Finale", "direct")
      }]
    });
    await service.applyDefinition(source, actor, {
      sourceTemplateUuid: "Compendium.test.afflictions.Item.deathchat",
      appliedAt: 3000
    });
    const death = created.find((entry) => entry.flags?.[MODULE_ID]?.runtimeEvent === "death");
    assert.ok(death);
    assert.deepEqual(death.whisper, ["gm"]);
    assert.match(death.content, /@Affliction\[Compendium\.test\.afflictions\.Item\.deathchat\]/);
  } finally {
    globalThis.ChatMessage = previousChatMessage;
  }
});


test("active Afflictions cannot be pushed into reserved stage 0", async () => {
  const actor = new FakeActor("stageZeroGuard", "Stage Zero Guard");
  const service = createAfflictionInstanceService();
  const [controller] = await service.applyDefinition(definition(), actor);
  await assert.rejects(
    () => service.setStage(controller, 0),
    /cannot transition to stage 0/i
  );
  const state = getAfflictionFlags(controller).state;
  assert.equal(state.status, "active");
  assert.equal(state.currentStage, 1);
});

test("recorded lethal Afflictions are terminal for stage, pause, and instant retry mutations", async () => {
  const actor = new FakeActor("lethalTerminal", "Lethal Terminal Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Terminal Venom",
    initialCheck: null,
    stages: [
      { ...createDefaultStage({ number: 1 }), effect: deathOnlyEffect("terminal.stage1", "Terminal Venom · Phase 1") },
      { ...createDefaultStage({ number: 2 }), effect: effect("terminal.stage2", "Terminal Venom · Phase 2") }
    ]
  });
  const beforeExecutions = instantExecutions.length;
  const [controller] = await service.applyDefinition(source, actor);
  assert.equal(getAfflictionFlags(controller).state.mortality?.dead, true);
  assert.equal(instantExecutions.length, beforeExecutions + 1);

  await assert.rejects(() => service.setStage(controller, 2), /cannot change stage after death/i);
  await assert.rejects(() => service.pause(controller), /cannot be paused after death/i);
  const retry = await service.executeStageInstant(controller);
  assert.deepEqual(retry, []);
  assert.equal(instantExecutions.length, beforeExecutions + 1);
});

test("source DC checks are materialized from application context before the controller snapshot is created", async () => {
  const actor = new FakeActor("sourceDcHero", "Source DC Hero");
  const service = createAfflictionInstanceService();
  const source = definition();
  source.checks[0].dcMode = "source";
  source.checks[0].dc = null;

  const [controller] = await service.applyDefinition(source, actor, { saveDc: 31 });
  const snapshot = getAfflictionFlags(controller).definitionSnapshot;
  assert.equal(snapshot.checks[0].dcMode, "source");
  assert.equal(snapshot.checks[0].dc, 31);
});

test("source DC checks fail closed when an external DC was not supplied", async () => {
  const actor = new FakeActor("missingSourceDcHero", "Missing Source DC Hero");
  const service = createAfflictionInstanceService();
  const source = definition();
  source.checks[0].dcMode = "source";
  source.checks[0].dc = null;

  await assert.rejects(
    () => service.applyDefinition(source, actor),
    /requires an external source DC/
  );
  assert.equal(actor.items.length, 0);
});

test("source DC can be supplied through origin context for external application facades", async () => {
  const actor = new FakeActor("originSourceDcHero", "Origin Source DC Hero");
  const service = createAfflictionInstanceService();
  const source = definition();
  source.checks[0].dcMode = "source";
  source.checks[0].dc = null;

  const [controller] = await service.applyDefinition(source, actor, {
    origin: { context: { saveDc: 37 } }
  });
  assert.equal(getAfflictionFlags(controller).definitionSnapshot.checks[0].dc, 37);
});

test("virulent recovery streak is persisted by the live engine and resets after a stage reduction", async () => {
  globalThis.game.time.worldTime = 8000;
  const actor = new FakeActor("virulentRuntimeHero", "Virulent Runtime Hero");
  actor.saveDegrees = ["success", "success", "criticalSuccess"];
  const source = createAfflictionDefinition({
    name: "Ausgeprägtes Testgift",
    initialCheck: null,
    saveDefaults: { execution: "automatic", visibility: "public" },
    progression: { belowStageOne: "recover", aboveMaximumStage: "clamp", virulent: true },
    stages: [
      createDefaultStage({ number: 1 }),
      createDefaultStage({ number: 2 }),
      createDefaultStage({ number: 3 })
    ]
  });

  const service = createAfflictionInstanceService();
  const engine = createAfflictionEngine({ instanceService: service });
  const [controller] = await service.applyDefinition(source, actor);
  await service.setStage(controller, 2, { enteredAt: 8000 });

  await engine.process(controller, { force: true, atTime: 8006 });
  let state = getAfflictionFlags(controller).state;
  assert.equal(state.currentStage, 2);
  assert.equal(state.recoverySuccesses, 1);

  await engine.process(controller, { force: true, atTime: 8012 });
  state = getAfflictionFlags(controller).state;
  assert.equal(state.currentStage, 1);
  assert.equal(state.recoverySuccesses, 0);

  await service.setStage(controller, 3, { enteredAt: 8012 });
  await engine.process(controller, { force: true, atTime: 8018 });
  state = getAfflictionFlags(controller).state;
  assert.equal(state.currentStage, 2, "critical success reduces a virulent affliction by only one stage");
  assert.equal(state.recoverySuccesses, 0);
});


test("affliction-persistent stage output survives stage transitions and is removed when the affliction ends", async () => {
  const actor = new FakeActor("heroAfflictionPersistent", "Persistent Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Persistent Disease",
    initialCheck: null,
    stages: [
      { ...createDefaultStage({ number: 1 }), effectPersistence: "affliction", effect: effect("persist.stage1", "Persistent stage 1") },
      { ...createDefaultStage({ number: 2 }), effect: effect("persist.stage2", "Persistent stage 2") }
    ]
  });
  const [controller] = await service.applyDefinition(source, actor);
  await service.setStage(controller, 2, { notifyLifecycle: false });

  const residual = actor.items.find(isAfflictionResidualEffect);
  assert.ok(residual);
  assert.equal(getAfflictionFlags(residual).residualPersistence, "affliction");
  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 1);

  await service.end(controller, { reason: "recovered", notifyLifecycle: false });
  assert.equal(actor.items.some(isAfflictionResidualEffect), false);
});

test("component-specific persistence preserves only the selected stage component", async () => {
  const actor = new FakeActor("heroComponentResidual", "Component Hero");
  const service = createAfflictionInstanceService();
  const mixedPersistent = effect("mixed.stage1", "Mixed persistence");
  mixedPersistent.components = [
    { type: "condition", slug: "enfeebled", value: 2 },
    { type: "condition", slug: "blinded" }
  ];
  const source = createAfflictionDefinition({
    name: "Selective Blinding Disease",
    initialCheck: null,
    stages: [
      {
        ...createDefaultStage({ number: 1 }),
        effectPersistence: "stage",
        effectComponentPersistence: [null, "permanent"],
        effect: mixedPersistent
      },
      { ...createDefaultStage({ number: 2 }), effect: null }
    ]
  });
  const [controller] = await service.applyDefinition(source, actor);
  assert.equal(actor.items.filter(isAfflictionStageEffect).length, 2, "different persistence groups compile into separate managed Items");
  const stageItems = actor.items.filter(isAfflictionStageEffect);
  assert.deepEqual(stageItems.map((item) => getAfflictionFlags(item).effectPersistence).sort(), ["permanent", "stage"]);

  await service.setStage(controller, 2, { notifyLifecycle: false });
  const residuals = actor.items.filter(isAfflictionResidualEffect);
  assert.equal(residuals.length, 1);
  assert.equal(getAfflictionFlags(residuals[0]).residualPersistence, "permanent");
  assert.deepEqual(getAfflictionFlags(residuals[0]).componentIndices, [1]);

  await service.end(controller, { reason: "recovered", notifyLifecycle: false });
  const detached = actor.items.find(isAfflictionResidualEffect);
  assert.ok(detached);
  assert.equal(getAfflictionFlags(detached).controllerUuid, null);
});

test("permanent stage output detaches and survives controller end", async () => {
  const actor = new FakeActor("heroPermanentResidual", "Permanent Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Blinding Disease",
    initialCheck: null,
    stages: [
      { ...createDefaultStage({ number: 1 }), effectPersistence: "permanent", effect: effect("blind.stage1", "Permanent consequence") },
      { ...createDefaultStage({ number: 2 }), effect: null }
    ]
  });
  const [controller] = await service.applyDefinition(source, actor);
  await service.setStage(controller, 2, { notifyLifecycle: false });
  let residual = actor.items.find(isAfflictionResidualEffect);
  assert.ok(residual);
  assert.equal(getAfflictionFlags(residual).controllerUuid, controller.uuid);

  await service.end(controller, { reason: "recovered", notifyLifecycle: false });
  residual = actor.items.find(isAfflictionResidualEffect);
  assert.ok(residual);
  assert.equal(getAfflictionFlags(residual).residualPersistence, "permanent");
  assert.equal(getAfflictionFlags(residual).controllerUuid, null);
  assert.equal(actor.items.some(isAfflictionController), false);
});

test("stage numeric modifiers compile to managed PF2e FlatModifier effect Items", async () => {
  const actor = new FakeActor("heroNumericModifier", "Numeric Modifier Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Slowing Sickness",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      numericModifiers: [{
        id: "slow-all-speeds",
        label: "Slowed by disease",
        selectors: ["all-speeds"],
        type: "status",
        value: -5
      }]
    }]
  });

  const [controller] = await service.applyDefinition(source, actor);
  const stageEffects = actor.items.filter(isAfflictionStageEffect);
  assert.equal(stageEffects.length, 1);
  assert.deepEqual(stageEffects[0].system.rules, [{
    key: "FlatModifier",
    selector: "all-speeds",
    type: "status",
    value: -5,
    slug: `affliction-${getAfflictionFlags(controller).state.instanceId}-stage-1-slow-all-speeds`.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
    label: "Slowed by disease"
  }]);
  assert.equal(getAfflictionFlags(stageEffects[0]).nativeKind, "numeric-modifiers");
});

test("periodic stage effects roll their interval, execute through Critical Forge, and reschedule", async () => {
  globalThis.game.time.worldTime = 1000;
  const previousRoll = globalThis.Roll;
  globalThis.Roll = class MockRoll {
    constructor(formula) { this.formula = formula; this.total = null; }
    static create(formula) { return new MockRoll(formula); }
    async evaluate() { this.total = this.formula === "1d20" ? 7 : Number(this.formula); return this; }
  };
  instantExecutions.length = 0;
  try {
    const actor = new FakeActor("heroPeriodic", "Periodic Hero");
    const service = createAfflictionInstanceService();
    const source = createAfflictionDefinition({
      name: "Recurring Plague",
      initialCheck: null,
      stages: [{
        ...createDefaultStage({ number: 1 }),
        duration: { value: 1, unit: "hours" },
        periodicEffects: [{
          id: "bleed-pulse",
          label: "Bleeding pulse",
          interval: { formula: "1d20", unit: "minutes" },
          effect: damageOnlyEffect("recurring.bleed", "Recurring bleed", "1d6")
        }]
      }]
    });

    const [controller] = await service.applyDefinition(source, actor);
    let state = getAfflictionFlags(controller).state;
    assert.deepEqual(state.periodicSchedule["bleed-pulse"], {
      nextAt: 1420,
      lastAt: null,
      sequence: 0,
      lastIntervalSeconds: 420
    });

    const result = await service.executePeriodic(controller, "bleed-pulse", { at: 1420 });
    assert.equal(result.status, "executed");
    assert.equal(instantExecutions.length, 1);
    assert.equal(instantExecutions[0].components[0].formula, "1d6");
    state = getAfflictionFlags(controller).state;
    assert.equal(state.periodicSchedule["bleed-pulse"].lastAt, 1420);
    assert.equal(state.periodicSchedule["bleed-pulse"].sequence, 1);
    assert.equal(state.periodicSchedule["bleed-pulse"].nextAt, 1840);
    assert.ok(state.events.some((event) => event.type === "periodic-effect" && event.data.periodicId === "bleed-pulse"));
  } finally {
    globalThis.Roll = previousRoll;
  }
});

test("same-stage renewal preserves an already rolled periodic interval", async () => {
  globalThis.game.time.worldTime = 1000;
  const previousRoll = globalThis.Roll;
  let total = 7;
  globalThis.Roll = class MockRoll {
    constructor(formula) { this.formula = formula; this.total = null; }
    static create(formula) { return new MockRoll(formula); }
    async evaluate() { this.total = total; return this; }
  };
  try {
    const actor = new FakeActor("heroPeriodicRenewal", "Periodic Renewal Hero");
    const service = createAfflictionInstanceService();
    const source = createAfflictionDefinition({
      name: "Recurring Plague Renewal",
      initialCheck: null,
      stages: [{
        ...createDefaultStage({ number: 1 }),
        periodicEffects: [{
          id: "pulse",
          label: "Pulse",
          interval: { formula: "1d20", unit: "minutes" },
          effect: damageOnlyEffect("renewal.pulse", "Pulse", "1")
        }]
      }]
    });
    const [controller] = await service.applyDefinition(source, actor);
    assert.equal(getAfflictionFlags(controller).state.periodicSchedule.pulse.nextAt, 1420);
    total = 19;
    await service.setStage(controller, 1, { enteredAt: 1100 });
    assert.equal(getAfflictionFlags(controller).state.periodicSchedule.pulse.nextAt, 1420);
  } finally {
    globalThis.Roll = previousRoll;
  }
});

test("pause and resume preserve remaining time for periodic effects", async () => {
  globalThis.game.time.worldTime = 1000;
  const actor = new FakeActor("heroPeriodicPause", "Periodic Pause Hero");
  const service = createAfflictionInstanceService();
  const source = createAfflictionDefinition({
    name: "Periodic Pause Disease",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      duration: { value: 10, unit: "minutes" },
      periodicEffects: [{
        id: "pulse",
        label: "Pulse",
        interval: { value: 2, unit: "minutes" },
        effect: damageOnlyEffect("pause.pulse", "Pulse", "1")
      }]
    }]
  });
  const [controller] = await service.applyDefinition(source, actor);
  assert.equal(getAfflictionFlags(controller).state.periodicSchedule.pulse.nextAt, 1120);
  await service.pause(controller, { pausedAt: 1060 });
  await service.resume(controller, { resumedAt: 1180 });
  const state = getAfflictionFlags(controller).state;
  assert.equal(state.periodicSchedule.pulse.nextAt, 1240);
  assert.equal(state.nextCheckAt, 1720);
});

test("formula onset is rolled once when incubation begins and the persisted deadline is reused", async () => {
  const previousRoll = globalThis.Roll;
  let rolls = 0;
  globalThis.Roll = class MockRoll {
    constructor(formula) { this.formula = formula; this.total = null; }
    static create(formula) { return new MockRoll(formula); }
    async evaluate() { rolls += 1; this.total = 3; return this; }
  };
  try {
    const actor = new FakeActor("formulaOnset", "Formula Onset Hero");
    const service = createAfflictionInstanceService();
    const source = createAfflictionDefinition({
      name: "Formula Onset",
      initialCheck: null,
      onset: { formula: "1d4", unit: "days" },
      stages: [createDefaultStage({ number: 1 })]
    });
    const [controller] = await service.applyDefinition(source, actor, { appliedAt: 1000 });
    const state = getAfflictionFlags(controller).state;
    assert.equal(rolls, 1);
    assert.equal(state.nextCheckAt, 1000 + (3 * 86400));
    assert.equal(scheduledDueAt(source, state), state.nextCheckAt);
    assert.equal(rolls, 1, "reading the schedule must not reroll a formula onset");
  } finally {
    globalThis.Roll = previousRoll;
  }
});

test("formula stage duration is rolled for each new stage interval and its deadline is persisted", async () => {
  const previousRoll = globalThis.Roll;
  const totals = [4, 2];
  globalThis.Roll = class MockRoll {
    constructor(formula) { this.formula = formula; this.total = null; }
    static create(formula) { return new MockRoll(formula); }
    async evaluate() { this.total = totals.shift(); return this; }
  };
  try {
    const actor = new FakeActor("formulaStage", "Formula Stage Hero");
    const service = createAfflictionInstanceService();
    const source = createAfflictionDefinition({
      name: "Formula Stage",
      initialCheck: null,
      stages: [{ ...createDefaultStage({ number: 1 }), duration: { formula: "1d6", unit: "minutes" } }]
    });
    const [controller] = await service.applyDefinition(source, actor, { appliedAt: 1000 });
    let state = getAfflictionFlags(controller).state;
    assert.equal(state.nextCheckAt, 1240);
    assert.equal(scheduledDueAt(source, state), 1240);

    await service.setStage(controller, 1, { enteredAt: 1240 });
    state = getAfflictionFlags(controller).state;
    assert.equal(state.nextCheckAt, 1360, "a same-stage renewal starts a new formula-based stage interval");
    assert.equal(scheduledDueAt(source, state), 1360);
    assert.equal(totals.length, 0);
  } finally {
    globalThis.Roll = previousRoll;
  }
});

test("formula maximum duration is rolled once when active timing begins and survives stage changes", async () => {
  const previousRoll = globalThis.Roll;
  let maxRolls = 0;
  globalThis.Roll = class MockRoll {
    constructor(formula) { this.formula = formula; this.total = null; }
    static create(formula) { return new MockRoll(formula); }
    async evaluate() { if (this.formula === "1d4") maxRolls += 1; this.total = this.formula === "1d4" ? 3 : 1; return this; }
  };
  try {
    const actor = new FakeActor("formulaMax", "Formula Maximum Hero");
    const service = createAfflictionInstanceService();
    const source = createAfflictionDefinition({
      name: "Formula Maximum",
      initialCheck: null,
      maximumDuration: { formula: "1d4", unit: "hours" },
      stages: [
        { ...createDefaultStage({ number: 1 }), duration: { value: 1, unit: "minutes" } },
        { ...createDefaultStage({ number: 2 }), duration: { value: 1, unit: "minutes" } }
      ]
    });
    const [controller] = await service.applyDefinition(source, actor, { appliedAt: 1000 });
    let state = getAfflictionFlags(controller).state;
    assert.equal(state.maximumDurationAt, 11800);
    assert.equal(maxRolls, 1);

    await service.setStage(controller, 2, { enteredAt: 1060 });
    state = getAfflictionFlags(controller).state;
    assert.equal(state.maximumDurationAt, 11800);
    assert.equal(maxRolls, 1, "stage changes must not reroll the active maximum duration");

    await service.pause(controller, { pausedAt: 1100 });
    await service.resume(controller, { resumedAt: 1200 });
    state = getAfflictionFlags(controller).state;
    assert.equal(state.maximumDurationAt, 11900, "pause time shifts a persisted formula maximum deadline");
  } finally {
    globalThis.Roll = previousRoll;
  }
});

test("timed component persistence becomes a detached residual with its own expiry after controller end", async () => {
  const actor = new FakeActor("timedResidual", "Timed Residual Hero");
  const service = createAfflictionInstanceService();
  const mixed = effect("timed.stage", "Timed residual stage");
  mixed.components = [
    { type: "condition", slug: "enfeebled", value: 1 },
    { type: "condition", slug: "blinded" }
  ];
  const source = createAfflictionDefinition({
    name: "Timed Residual Disease",
    initialCheck: null,
    stages: [{
      ...createDefaultStage({ number: 1 }),
      effectPersistence: "stage",
      effectComponentPersistence: [null, "timed"],
      effectComponentPersistenceDurations: [null, { value: 24, unit: "hours" }],
      effect: mixed
    }]
  });
  const [controller] = await service.applyDefinition(source, actor, { appliedAt: 1000 });
  globalThis.game.time.worldTime = 1100;
  await service.end(controller, { reason: "recovered", notifyLifecycle: false });
  const residual = actor.items.find(isAfflictionResidualEffect);
  assert.ok(residual);
  const flags = getAfflictionFlags(residual);
  assert.equal(flags.residualPersistence, "timed");
  assert.equal(flags.residualCreatedAt, 1100);
  assert.equal(flags.residualDurationSeconds, 86400);
  assert.equal(flags.residualExpiresAt, 87500);
  assert.equal(flags.controllerUuid, null);
  assert.deepEqual(flags.componentIndices, [1]);
});

test("formula timed residual duration is rolled when the stage output becomes residual", async () => {
  const previousRoll = globalThis.Roll;
  let rolls = 0;
  globalThis.Roll = class MockRoll {
    constructor(formula) { this.formula = formula; this.total = null; }
    static create(formula) { return new MockRoll(formula); }
    async evaluate() { rolls += 1; this.total = 2; return this; }
  };
  try {
    const actor = new FakeActor("formulaResidual", "Formula Residual Hero");
    const service = createAfflictionInstanceService();
    const source = createAfflictionDefinition({
      name: "Formula Residual Disease",
      initialCheck: null,
      stages: [
        {
          ...createDefaultStage({ number: 1 }),
          effectPersistence: "timed",
          effectPersistenceDuration: { formula: "1d4", unit: "hours" },
          effect: effect("formula.residual", "Formula residual")
        },
        { ...createDefaultStage({ number: 2 }), effect: null }
      ]
    });
    const [controller] = await service.applyDefinition(source, actor, { appliedAt: 1000 });
    assert.equal(rolls, 0, "residual timing does not start while the stage is still active");
    await service.setStage(controller, 2, { enteredAt: 1060, notifyLifecycle: false });
    const residual = actor.items.find(isAfflictionResidualEffect);
    assert.ok(residual);
    assert.equal(rolls, 1);
    assert.equal(getAfflictionFlags(residual).residualExpiresAt, 8260);
  } finally {
    globalThis.Roll = previousRoll;
  }
});
