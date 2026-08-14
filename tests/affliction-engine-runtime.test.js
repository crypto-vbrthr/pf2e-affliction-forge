import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const { modules } = installFoundryMock();
globalThis.CONFIG = { time: { roundTime: 6 } };
globalThis.game.user = { id: "gm", isGM: true };
globalThis.game.time = { worldTime: 1000 };
globalThis.game.users = [];

const { createAfflictionDefinition, createDefaultStage } = await import("../scripts/affliction/schema/affliction-defaults.js");
const { createAfflictionEngine } = await import("../scripts/affliction/runtime/affliction-engine.js");
const { MODULE_ID } = await import("../scripts/constants.js");

function makeController(definition, { state = null, degrees = ["failure"] } = {}) {
  const queue = [...degrees];
  const actor = {
    documentName: "Actor",
    uuid: "Actor.test",
    name: "Test Actor",
    getStatistic() {
      return {
        async roll(options) {
          actor.lastRollOptions = options;
          const degree = queue.shift() ?? "failure";
          return { degreeOfSuccess: degree, total: 20, dice: [{ total: 10 }] };
        }
      };
    }
  };
  const baseState = state ?? {
    schemaVersion: 2,
    instanceId: "instance.test",
    status: "pending",
    currentStage: 0,
    appliedAt: 1000,
    stageEnteredAt: null,
    nextCheckAt: 1000,
    identification: { state: "identified", identifiedAt: 1000, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: null,
    lastCheck: null,
    revision: 1
  };
  const controller = {
    documentName: "Item",
    id: "controller",
    uuid: "Actor.test.Item.controller",
    parent: actor,
    flags: {
      [MODULE_ID]: {
        managed: true,
        documentKind: "affliction-controller",
        definitionSnapshot: structuredClone(definition),
        instanceId: baseState.instanceId,
        state: structuredClone(baseState)
      }
    }
  };
  return { actor, controller };
}

function serviceFor(controller) {
  return {
    ended: null,
    async get() { return controller; },
    async setPendingCheck(_controller, pending) {
      controller.flags[MODULE_ID].state.pendingCheck = structuredClone(pending);
      controller.flags[MODULE_ID].state.revision += 1;
      return controller;
    },
    async setStage(_controller, stage, options = {}) {
      const state = controller.flags[MODULE_ID].state;
      state.status = "active";
      state.currentStage = stage;
      state.stageEnteredAt = 1000;
      state.pendingCheck = null;
      state.onsetTargetStage = null;
      if (options.lastCheck !== undefined) state.lastCheck = structuredClone(options.lastCheck);
      state.revision += 1;
      return controller;
    },
    async beginOnset(_controller, targetStage, { lastCheck } = {}) {
      const state = controller.flags[MODULE_ID].state;
      state.status = "incubating";
      state.currentStage = 0;
      state.onsetTargetStage = targetStage;
      state.pendingCheck = null;
      state.lastCheck = structuredClone(lastCheck ?? null);
      state.revision += 1;
      return controller;
    },
    async completeOnset() {
      const state = controller.flags[MODULE_ID].state;
      state.status = "active";
      state.currentStage = state.onsetTargetStage ?? 1;
      state.onsetTargetStage = null;
      state.revision += 1;
      return controller;
    },
    async updateRuntimeState(_controller, nextState) {
      controller.flags[MODULE_ID].state = structuredClone(nextState);
      return controller;
    },
    async end(_controller, { reason }) {
      this.ended = reason;
      return true;
    }
  };
}

function automaticDefinition(extra = {}) {
  return createAfflictionDefinition({
    name: "Engine Runtime Test",
    saveDefaults: { execution: "automatic", visibility: "public" },
    stages: [
      createDefaultStage({ number: 1 }),
      createDefaultStage({ number: 2 })
    ],
    ...extra
  });
}

test("automatic initial failure resolves into stage 1 without a manual transition", async () => {
  const definition = automaticDefinition();
  const { actor, controller } = makeController(definition, { degrees: ["failure"] });
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.processInitial(controller);
  assert.equal(result.status, "stage-changed");
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 1);
  assert.equal(actor.lastRollOptions.skipDialog, true);
  assert.equal(controller.flags[MODULE_ID].state.lastCheck.degree, "failure");
});

test("automatic initial success rejects the affliction", async () => {
  const definition = automaticDefinition();
  const { controller } = makeController(definition, { degrees: ["success"] });
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.processInitial(controller);
  assert.equal(result.status, "rejected");
  assert.equal(service.ended, "rejected");
});

test("failed initial save starts onset before applying the target stage", async () => {
  const definition = automaticDefinition({ onset: { value: 1, unit: "hours" } });
  const { controller } = makeController(definition, { degrees: ["criticalFailure"] });
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.processInitial(controller);
  assert.equal(result.status, "incubating");
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 0);
  assert.equal(controller.flags[MODULE_ID].state.onsetTargetStage, 2);
});

test("manual GM policy keeps the PF2e modifier dialog enabled", async () => {
  const definition = createAfflictionDefinition({
    name: "GM Save",
    saveDefaults: { execution: "gm", visibility: "gmOnly" },
    stages: [createDefaultStage({ number: 1 })]
  });
  const { actor, controller } = makeController(definition, { degrees: ["failure"] });
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });
  await engine.processInitial(controller);
  assert.equal(actor.lastRollOptions.skipDialog, false);
  assert.equal(actor.lastRollOptions.rollMode, "gmroll");
});


test("engine applyDefinition is the canonical application path and immediately resolves initial saves", async () => {
  const definition = automaticDefinition();
  const { controller } = makeController(definition, { degrees: ["failure"] });
  const service = serviceFor(controller);
  service.applyDefinition = async () => [controller];
  const engine = createAfflictionEngine({ instanceService: service });
  const application = await engine.applyDefinition(definition, [controller.parent]);
  assert.equal(application.created.length, 1);
  assert.equal(application.controllers.length, 1);
  assert.equal(application.results.length, 1);
  assert.equal(application.results[0].status, "stage-changed");
  assert.equal(application.errors.length, 0);
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 1);
});

test("stage transition stores lastCheck in the same controller transition", async () => {
  const definition = automaticDefinition();
  const state = {
    schemaVersion: 2,
    instanceId: "instance.stage",
    status: "active",
    currentStage: 1,
    appliedAt: 1000,
    stageEnteredAt: 900,
    nextCheckAt: 1000,
    identification: { state: "identified", identifiedAt: 900, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: null,
    lastCheck: null,
    revision: 1
  };
  const { controller } = makeController(definition, { state, degrees: ["failure"] });
  const service = serviceFor(controller);
  let stageOptions = null;
  const originalSetStage = service.setStage.bind(service);
  service.setStage = async (target, stage, options = {}) => {
    stageOptions = structuredClone(options);
    return originalSetStage(target, stage, options);
  };
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.process(controller, { force: true });
  assert.equal(result.status, "stage-changed");
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 2);
  assert.equal(stageOptions.lastCheck.degree, "failure");
  assert.equal(controller.flags[MODULE_ID].state.lastCheck.degree, "failure");
});

test("scheduler processing can anchor stage transitions to the historical due time", async () => {
  const definition = automaticDefinition();
  const state = {
    schemaVersion: 2,
    instanceId: "instance.historical",
    status: "active",
    currentStage: 1,
    appliedAt: 500,
    stageEnteredAt: 700,
    nextCheckAt: 800,
    identification: { state: "identified", identifiedAt: 500, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: null,
    lastCheck: null,
    revision: 1
  };
  globalThis.game.time.worldTime = 1000;
  const { controller } = makeController(definition, { state, degrees: ["failure"] });
  const service = serviceFor(controller);
  let enteredAt = null;
  const original = service.setStage.bind(service);
  service.setStage = async (target, stage, options = {}) => {
    enteredAt = options.enteredAt;
    return original(target, stage, options);
  };
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.process(controller, { atTime: 800 });
  assert.equal(result.status, "stage-changed");
  assert.equal(enteredAt, 800);
  assert.equal(controller.flags[MODULE_ID].state.lastCheck.effectiveAt, 800);
});

test("engine does not complete a one-minute onset after only one combat round when stored due time is stale", async () => {
  const definition = automaticDefinition({ onset: { value: 1, unit: "minutes" } });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.onset-floor",
    status: "incubating",
    currentStage: 0,
    appliedAt: 1000,
    stageEnteredAt: null,
    nextCheckAt: 1006,
    identification: { state: "identified", identifiedAt: 1000, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: 1,
    lastCheck: { effectiveAt: 1000, results: { primary: { execution: "gm", degree: "failure" } } },
    revision: 2
  };
  const { controller } = makeController(definition, { state });
  const engine = createAfflictionEngine({ instanceService: serviceFor(controller) });
  const result = await engine.process(controller, { atTime: 1006 });
  assert.equal(result.status, "not-due");
  assert.equal(result.dueAt, 1060);
  assert.equal(controller.flags[MODULE_ID].state.status, "incubating");
});

test("engine does not request a one-minute stage save after only one combat round when stored due time is stale", async () => {
  const definition = automaticDefinition({
    stages: [
      { ...createDefaultStage({ number: 1 }), duration: { value: 1, unit: "minutes" } },
      createDefaultStage({ number: 2 })
    ]
  });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.stage-floor",
    status: "active",
    currentStage: 1,
    appliedAt: 1000,
    stageEnteredAt: 1000,
    nextCheckAt: 1006,
    identification: { state: "identified", identifiedAt: 1000, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: null,
    lastCheck: null,
    revision: 2
  };
  const { controller } = makeController(definition, { state, degrees: ["failure"] });
  const engine = createAfflictionEngine({ instanceService: serviceFor(controller) });
  const result = await engine.process(controller, { atTime: 1006 });
  assert.equal(result.status, "not-due");
  assert.equal(result.dueAt, 1060);
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 1);
});

test("duplicate player-save deliveries are serialized and transition only once", async () => {
  globalThis.game.users = [{ id: "player", isGM: false, active: true }];
  const definition = automaticDefinition({
    saveDefaults: { execution: "player", visibility: "public" }
  });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.concurrent-player",
    status: "active",
    currentStage: 1,
    appliedAt: 900,
    stageEnteredAt: 900,
    activeStartedAt: 900,
    onsetStartedAt: null,
    nextCheckAt: 1000,
    identification: { state: "identified", identifiedAt: 900, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: {
      schemaVersion: 1,
      requestId: "request.concurrent",
      kind: "stage",
      stageNumber: 1,
      combine: "single",
      checkIds: ["primary"],
      requestedAt: 1000,
      effectiveAt: 1000,
      requests: {
        primary: {
          requestId: "request.concurrent",
          checkId: "primary",
          status: "awaiting-player",
          execution: "player",
          visibility: "public",
          userIds: ["player"]
        }
      },
      results: {}
    },
    onsetTargetStage: null,
    lastCheck: null,
    revision: 3
  };
  const { actor, controller } = makeController(definition, { state });
  actor.testUserPermission = (user) => user?.id === "player";
  const service = serviceFor(controller);
  let stageTransitions = 0;
  const originalSetStage = service.setStage.bind(service);
  service.setStage = async (...args) => {
    stageTransitions += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return originalSetStage(...args);
  };
  const engine = createAfflictionEngine({ instanceService: service });
  const payload = {
    controllerUuid: controller.uuid,
    requestId: "request.concurrent",
    checkId: "primary",
    userId: "player",
    degree: "failure",
    total: 17,
    d20: 9,
    rollId: "roll.concurrent"
  };

  const [first, second] = await Promise.all([
    engine.acceptPlayerResult(payload),
    engine.acceptPlayerResult(payload)
  ]);

  assert.equal(stageTransitions, 1);
  assert.deepEqual([first.status, second.status].sort(), ["stage-changed", "stale"]);
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 2);
});

test("resumePending preserves completed results and re-runs only unresolved checks", async () => {
  globalThis.game.users = [];
  const definition = automaticDefinition({
    saveDefaults: { execution: "gm", visibility: "public" }
  });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.resume",
    status: "active",
    currentStage: 1,
    appliedAt: 900,
    stageEnteredAt: 900,
    activeStartedAt: 900,
    onsetStartedAt: null,
    nextCheckAt: 1000,
    identification: { state: "identified", identifiedAt: 900, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: {
      schemaVersion: 1,
      requestId: "request.resume",
      kind: "stage",
      stageNumber: 1,
      combine: "single",
      checkIds: ["primary"],
      requestedAt: 1000,
      effectiveAt: 1000,
      requests: { primary: { status: "awaiting-gm", execution: "gm", visibility: "public" } },
      results: {}
    },
    onsetTargetStage: null,
    lastCheck: null,
    revision: 4
  };
  const { actor, controller } = makeController(definition, { state, degrees: ["failure"] });
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });

  const result = await engine.resumePending(controller, { reason: "ready" });

  assert.equal(result.status, "stage-changed");
  assert.equal(result.resumed, true);
  assert.equal(result.resetRequests, 1);
  assert.equal(actor.lastRollOptions.skipDialog, false);
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 2);
  assert.equal(controller.flags[MODULE_ID].state.lastCheck.effectiveAt, 1000);
});

test("a manual controller transition invalidates an in-flight save before it can apply a stale result", async () => {
  globalThis.game.users = [{ id: "player", isGM: false, active: true }];
  const definition = automaticDefinition({ saveDefaults: { execution: "player", visibility: "public" } });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.manual-wins",
    status: "active",
    currentStage: 1,
    appliedAt: 900,
    stageEnteredAt: 900,
    activeStartedAt: 900,
    onsetStartedAt: null,
    nextCheckAt: 1000,
    identification: { state: "identified", identifiedAt: 900, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: {
      schemaVersion: 1,
      requestId: "request.manual-wins",
      kind: "stage",
      stageNumber: 1,
      combine: "single",
      checkIds: ["primary"],
      requestedAt: 1000,
      effectiveAt: 1000,
      requests: {
        primary: {
          requestId: "request.manual-wins",
          checkId: "primary",
          status: "awaiting-player",
          execution: "player",
          visibility: "public",
          userIds: ["player"]
        }
      },
      results: {}
    },
    onsetTargetStage: null,
    lastCheck: null,
    revision: 5
  };
  const { actor, controller } = makeController(definition, { state });
  actor.testUserPermission = () => true;
  const service = serviceFor(controller);
  const originalSetPending = service.setPendingCheck.bind(service);
  let manualIntervention = false;
  service.setPendingCheck = async (target, pending) => {
    const result = await originalSetPending(target, pending);
    if (!manualIntervention && pending?.results?.primary?.degree) {
      manualIntervention = true;
      const runtimeState = controller.flags[MODULE_ID].state;
      runtimeState.currentStage = 2;
      runtimeState.pendingCheck = null;
      runtimeState.revision += 1;
    }
    return result;
  };
  let setStageCalls = 0;
  const originalSetStage = service.setStage.bind(service);
  service.setStage = async (...args) => {
    setStageCalls += 1;
    return originalSetStage(...args);
  };
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.acceptPlayerResult({
    controllerUuid: controller.uuid,
    requestId: "request.manual-wins",
    checkId: "primary",
    userId: "player",
    degree: "failure",
    rollId: "roll.manual-wins"
  });

  assert.equal(result.status, "stale");
  assert.equal(setStageCalls, 0);
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 2);
});
