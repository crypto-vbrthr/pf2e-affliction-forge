import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();
globalThis.CONFIG = { time: { roundTime: 6 } };
globalThis.game.user = { id: "gm-a", isGM: true };
globalThis.game.users = { activeGM: globalThis.game.user, contents: [globalThis.game.user] };
globalThis.game.time = { worldTime: 300 };

const { createAfflictionDefinition, createDefaultStage } = await import("../scripts/affliction/schema/affliction-defaults.js");
const { MODULE_ID } = await import("../scripts/constants.js");
const {
  createAfflictionScheduler,
  authoritativeGmId,
  isAuthoritativeGmClient,
  controllerMaximumDurationAt,
  controllerCanonicalDueAt
} = await import("../scripts/affliction/runtime/affliction-scheduler.js");

function definition(extra = {}) {
  return createAfflictionDefinition({
    name: "Scheduler Test",
    initialCheck: null,
    stages: [createDefaultStage({ number: 1 })],
    ...extra
  });
}

function makeController(def, state = {}) {
  const actor = { documentName: "Actor", uuid: "Actor.scheduler", name: "Scheduler Actor" };
  const fullState = {
    schemaVersion: 2,
    instanceId: "instance.scheduler",
    status: "active",
    currentStage: 1,
    appliedAt: 0,
    stageEnteredAt: 40,
    nextCheckAt: 100,
    identification: { state: "identified", identifiedAt: 0, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: null,
    lastCheck: null,
    revision: 1,
    ...state
  };
  const controller = {
    documentName: "Item",
    id: "controller",
    uuid: "Actor.scheduler.Item.controller",
    name: def.name,
    parent: actor,
    flags: {
      [MODULE_ID]: {
        managed: true,
        documentKind: "affliction-controller",
        definitionSnapshot: structuredClone(def),
        instanceId: fullState.instanceId,
        state: fullState
      }
    }
  };
  return controller;
}

function runtime(controller, { step = 60, execution = null } = {}) {
  const calls = [];
  let removed = false;
  const service = {
    ended: null,
    async get() {
      if (removed) throw new Error("removed");
      return controller;
    },
    async end(_controller, { reason }) {
      this.ended = reason;
      removed = true;
      return true;
    }
  };
  const engine = {
    async process(_controller, { atTime }) {
      calls.push(atTime);
      const state = controller.flags[MODULE_ID].state;
      state.stageEnteredAt = atTime;
      state.nextCheckAt = atTime + step;
      state.revision += 1;
      if (execution) {
        state.lastCheck = {
          requestId: `check-${calls.length}`,
          effectiveAt: atTime,
          results: { primary: { execution, degree: "failure" } }
        };
      }
      return { status: "stage-changed", degree: execution ? "failure" : undefined, controller };
    }
  };
  return { service, engine, calls };
}

function schedulerFor(controller, runtimeParts, settings = {}) {
  return createAfflictionScheduler({
    engine: runtimeParts.engine,
    instanceService: runtimeParts.service,
    controllerProvider: () => [controller],
    authorityResolver: () => true,
    settingsProvider: () => ({ enabled: true, catchUpMode: "all", catchUpLimit: 25, ...settings })
  });
}

test("Foundry activeGM is the scheduler authority", () => {
  assert.equal(authoritativeGmId(), "gm-a");
  assert.equal(isAuthoritativeGmClient(), true);
  globalThis.game.user = { id: "gm-b", isGM: true };
  assert.equal(isAuthoritativeGmClient(), false);
  globalThis.game.user = globalThis.game.users.activeGM;
});

test("catch-up mode processes every historical due interval at its scheduled timestamp", async () => {
  const controller = makeController(definition());
  const parts = runtime(controller);
  const scheduler = schedulerFor(controller, parts);
  const result = await scheduler.processDue({ worldTime: 300 });
  assert.deepEqual(parts.calls, [100, 160, 220, 280]);
  assert.equal(controller.flags[MODULE_ID].state.nextCheckAt, 340);
  assert.equal(result.processed[0].status, "caught-up");
});

test("next catch-up mode consumes only one overdue interval", async () => {
  const controller = makeController(definition());
  const parts = runtime(controller);
  const scheduler = schedulerFor(controller, parts, { catchUpMode: "next" });
  const result = await scheduler.processDue({ worldTime: 300 });
  assert.deepEqual(parts.calls, [100]);
  assert.equal(result.processed[0].status, "processed-next");
});

test("outstanding player or GM requests block automatic re-issuance", async () => {
  const controller = makeController(definition(), {
    pendingCheck: {
      requestId: "pending",
      requests: { primary: { status: "awaiting-player" } },
      results: {}
    }
  });
  const parts = runtime(controller);
  const scheduler = schedulerFor(controller, parts);
  const result = await scheduler.processDue({ worldTime: 300 });
  assert.deepEqual(parts.calls, []);
  assert.equal(result.processed[0].status, "pending-manual");
});

test("maximum duration ends an affliction before a later stage check", async () => {
  const def = definition({ maximumDuration: { value: 2, unit: "minutes" } });
  const controller = makeController(def, { nextCheckAt: 180 });
  const parts = runtime(controller);
  const scheduler = schedulerFor(controller, parts);
  const result = await scheduler.processDue({ worldTime: 200 });
  assert.equal(controllerMaximumDurationAt(controller), 120);
  assert.equal(parts.service.ended, "maximum-duration");
  assert.deepEqual(parts.calls, []);
  assert.equal(result.processed[0].status, "maximum-duration");
});

test("maximum duration starts when the first active stage begins, not during onset", () => {
  const def = definition({
    onset: { value: 10, unit: "minutes" },
    maximumDuration: { value: 5, unit: "minutes" }
  });
  const controller = makeController(def, {
    status: "incubating",
    currentStage: 0,
    appliedAt: 100,
    onsetStartedAt: 100,
    activeStartedAt: null,
    stageEnteredAt: null,
    nextCheckAt: 700
  });
  assert.equal(controllerMaximumDurationAt(controller), null);

  Object.assign(controller.flags[MODULE_ID].state, {
    status: "active",
    currentStage: 1,
    onsetStartedAt: null,
    activeStartedAt: 700,
    stageEnteredAt: 700,
    nextCheckAt: 706
  });
  assert.equal(controllerMaximumDurationAt(controller), 1000);
});

test("legacy controllers infer the active-duration anchor from the earliest stage-entered event", () => {
  const def = definition({
    onset: { value: 10, unit: "minutes" },
    maximumDuration: { value: 5, unit: "minutes" }
  });
  const controller = makeController(def, {
    status: "active",
    currentStage: 2,
    appliedAt: 100,
    stageEnteredAt: 850,
    nextCheckAt: 856,
    activeStartedAt: undefined,
    events: [
      { type: "onset-started", at: 100 },
      { type: "stage-entered", at: 700, stageNumber: 1 },
      { type: "stage-entered", at: 850, stageNumber: 2 }
    ]
  });
  assert.equal(controllerMaximumDurationAt(controller), 1000);
});

test("catch-up safety limit stops runaway historical processing", async () => {
  const controller = makeController(definition());
  const parts = runtime(controller, { step: 1 });
  const scheduler = schedulerFor(controller, parts, { catchUpLimit: 3 });
  const result = await scheduler.processDue({ worldTime: 300 });
  assert.deepEqual(parts.calls, [100, 106, 112]);
  assert.equal(result.processed[0].status, "catch-up-limit");
});


test("scheduler never shortens a one-minute onset because of a stale early nextCheckAt", async () => {
  const def = definition({ onset: { value: 1, unit: "minutes" } });
  const controller = makeController(def, {
    status: "incubating",
    currentStage: 0,
    appliedAt: 100,
    stageEnteredAt: null,
    nextCheckAt: 106,
    onsetTargetStage: 1,
    lastCheck: { effectiveAt: 100, results: { primary: { execution: "gm", degree: "failure" } } }
  });
  const parts = runtime(controller);
  const scheduler = schedulerFor(controller, parts);
  assert.equal(controllerCanonicalDueAt(controller), 160);
  await scheduler.processDue({ worldTime: 106 });
  assert.deepEqual(parts.calls, []);
});

test("scheduler never shortens a one-minute stage because of a stale early nextCheckAt", async () => {
  const def = definition({
    stages: [{ ...createDefaultStage({ number: 1 }), duration: { value: 1, unit: "minutes" } }]
  });
  const controller = makeController(def, {
    status: "active",
    currentStage: 1,
    appliedAt: 100,
    stageEnteredAt: 100,
    nextCheckAt: 106
  });
  const parts = runtime(controller);
  const scheduler = schedulerFor(controller, parts);
  assert.equal(controllerCanonicalDueAt(controller), 160);
  await scheduler.processDue({ worldTime: 106 });
  assert.deepEqual(parts.calls, []);
});

test("pending initial exposure saves are never driven by world-time scheduling", async () => {
  const controller = makeController(definition(), {
    status: "pending",
    currentStage: 0,
    stageEnteredAt: null,
    nextCheckAt: 100
  });
  const parts = runtime(controller);
  const scheduler = schedulerFor(controller, parts);
  const result = await scheduler.processDue({ worldTime: 300 });
  assert.deepEqual(parts.calls, []);
  assert.equal(result.processed[0].status, "pending-initial");
});

test("an in-progress check blocks scheduler re-entry before a GM request marker exists", async () => {
  const controller = makeController(definition(), {
    pendingCheck: {
      requestId: "in-progress",
      checkIds: ["primary"],
      requests: {},
      results: {}
    }
  });
  const parts = runtime(controller);
  const scheduler = schedulerFor(controller, parts);
  const result = await scheduler.processDue({ worldTime: 300 });
  assert.deepEqual(parts.calls, []);
  assert.equal(result.processed[0].status, "pending-manual");
});

test("manual GM saves process at most one overdue interval per scheduler pass", async () => {
  const controller = makeController(definition());
  const parts = runtime(controller, { execution: "gm" });
  const scheduler = schedulerFor(controller, parts, { catchUpMode: "all" });
  const result = await scheduler.processDue({ worldTime: 300 });
  assert.deepEqual(parts.calls, [100]);
  assert.equal(result.processed[0].status, "processed-interactive");
});
