import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const { modules } = installFoundryMock();
globalThis.CONFIG = { time: { roundTime: 6 } };
globalThis.game.user = { id: "gm", isGM: true };
globalThis.game.time = { worldTime: 1000 };
globalThis.game.users = [];

const { createAfflictionDefinition, createDefaultSaveCheck, createDefaultStage } = await import("../scripts/affliction/schema/affliction-defaults.js");
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

test("successful initial Affliction application whispers the GM with a persisted template link", async () => {
  const definition = automaticDefinition();
  const { controller } = makeController(definition, { degrees: ["failure"] });
  controller.flags[MODULE_ID].sourceTemplateUuid = "Compendium.afflictions.Item.engine-runtime-test";
  const service = serviceFor(controller);
  service.applyDefinition = async () => [controller];
  const created = [];
  const previousChatMessage = globalThis.ChatMessage;
  globalThis.ChatMessage = {
    getWhisperRecipients: () => [{ id: "gm" }],
    getSpeaker: () => ({ actor: "test" }),
    async create(data) { created.push(data); return data; }
  };
  try {
    const engine = createAfflictionEngine({ instanceService: service });
    const result = await engine.applyDefinition(definition, [controller.parent]);
    assert.equal(result.controllers.length, 1);
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].whisper, ["gm"]);
    assert.match(created[0].content, /Test Actor/);
    assert.match(created[0].content, /@Affliction\[Compendium\.afflictions\.Item\.engine-runtime-test\]/);
    assert.equal(created[0].flags[MODULE_ID].runtimeEvent, "affliction-applied");
  } finally {
    globalThis.ChatMessage = previousChatMessage;
  }
});

test("rejected initial exposure does not create a GM infection notice", async () => {
  const definition = automaticDefinition();
  const { controller } = makeController(definition, { degrees: ["success"] });
  controller.flags[MODULE_ID].sourceTemplateUuid = "Compendium.afflictions.Item.rejected";
  const service = serviceFor(controller);
  service.applyDefinition = async () => [controller];
  const created = [];
  const previousChatMessage = globalThis.ChatMessage;
  globalThis.ChatMessage = {
    getWhisperRecipients: () => [{ id: "gm" }],
    getSpeaker: () => ({}),
    async create(data) { created.push(data); return data; }
  };
  try {
    const engine = createAfflictionEngine({ instanceService: service });
    const result = await engine.applyDefinition(definition, [controller.parent]);
    assert.equal(result.controllers.length, 0);
    assert.equal(created.length, 0);
  } finally {
    globalThis.ChatMessage = previousChatMessage;
  }
});

test("Affliction without an initial save announces immediately and falls back to its definition name without a template UUID", async () => {
  const definition = automaticDefinition({ initialCheck: null });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.no-initial",
    status: "active",
    currentStage: 1,
    appliedAt: 1000,
    activeStartedAt: 1000,
    stageEnteredAt: 1000,
    nextCheckAt: 1060,
    identification: { state: "identified", identifiedAt: 1000, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: null,
    lastCheck: null,
    revision: 1
  };
  const { controller } = makeController(definition, { state });
  const service = serviceFor(controller);
  service.applyDefinition = async () => [controller];
  const created = [];
  const previousChatMessage = globalThis.ChatMessage;
  globalThis.ChatMessage = {
    getWhisperRecipients: () => [{ id: "gm" }],
    getSpeaker: () => ({}),
    async create(data) { created.push(data); return data; }
  };
  try {
    const engine = createAfflictionEngine({ instanceService: service });
    const result = await engine.applyDefinition(definition, [controller.parent]);
    assert.equal(result.controllers.length, 1);
    assert.equal(created.length, 1);
    assert.match(created[0].content, /Engine Runtime Test/);
    assert.doesNotMatch(created[0].content, /@Affliction\[/);
  } finally {
    globalThis.ChatMessage = previousChatMessage;
  }
});


test("engine processing treats a recorded lethal Affliction as terminal", async () => {
  const definition = automaticDefinition();
  const state = {
    schemaVersion: 2,
    instanceId: "instance.dead",
    status: "active",
    currentStage: 1,
    appliedAt: 900,
    stageEnteredAt: 900,
    activeStartedAt: 900,
    nextCheckAt: 1000,
    identification: { state: "identified", identifiedAt: 900, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: null,
    lastCheck: null,
    mortality: { dead: true, at: 950, stageNumber: 1, category: "direct" },
    pause: null,
    events: [],
    revision: 2
  };
  const { actor, controller } = makeController(definition, { state, degrees: ["failure"] });
  const engine = createAfflictionEngine({ instanceService: serviceFor(controller) });
  const result = await engine.process(controller, { force: true });
  assert.equal(result.status, "dead");
  assert.equal(actor.lastRollOptions, undefined);
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 1);
});


test("two GM-manual saves in one gate are resolved as one batch and summarized together in GM chat", async () => {
  const definition = createAfflictionDefinition({
    name: "Twin Save Affliction",
    saveDefaults: { execution: "gm", visibility: "gmOnly" },
    checks: [
      createDefaultSaveCheck({ id: "body", label: "Body", statistic: "fortitude", dc: 20 }),
      createDefaultSaveCheck({ id: "mind", label: "Mind", statistic: "will", dc: 22 })
    ],
    initialCheck: {
      checkIds: ["body", "mind"],
      combine: "all-success",
      outcomes: {
        criticalSuccess: { action: "reject" },
        success: { action: "reject" },
        failure: { action: "set-stage", stage: 1 },
        criticalFailure: { action: "set-stage", stage: 1 }
      }
    },
    stages: [createDefaultStage({ number: 1 })]
  });
  const { actor, controller } = makeController(definition, { degrees: ["success", "failure"] });
  let rollCount = 0;
  const originalGetStatistic = actor.getStatistic.bind(actor);
  actor.getStatistic = (statistic) => {
    const wrapped = originalGetStatistic(statistic);
    return {
      roll: async (options) => {
        rollCount += 1;
        return wrapped.roll(options);
      }
    };
  };
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });

  const previousChatMessage = globalThis.ChatMessage;
  const chat = [];
  globalThis.ChatMessage = {
    create: async (data) => { chat.push(data); return data; },
    getSpeaker: () => ({}),
    getWhisperRecipients: () => [{ id: "gm" }]
  };
  try {
    const result = await engine.processInitial(controller);
    assert.equal(result.status, "stage-changed");
    assert.equal(rollCount, 2);
    const lastCheck = controller.flags[MODULE_ID].state.lastCheck;
    assert.equal(lastCheck.results.body.degree, "success");
    assert.equal(lastCheck.results.mind.degree, "failure");
    assert.equal(lastCheck.degree, "failure");
    const summary = chat.find((entry) => entry.flags?.[MODULE_ID]?.runtimeEvent === "affliction-save-resolved");
    assert.ok(summary);
    assert.match(summary.content, /Body/);
    assert.match(summary.content, /Mind/);
  } finally {
    globalThis.ChatMessage = previousChatMessage;
  }
});

test("a single virulent player stage save uses the Affliction batch window transport with recovery progress", async () => {
  const previousUsers = globalThis.game.users;
  const previousChatMessage = globalThis.ChatMessage;
  const player = { id: "player-virulent", isGM: false, active: true };
  const gm = { id: "gm", isGM: true, active: true };
  const users = [gm, player];
  users.get = (id) => users.find((entry) => entry.id === id);
  globalThis.game.users = users;

  const definition = automaticDefinition({
    saveDefaults: { execution: "player", visibility: "public" },
    progression: { belowStageOne: "recover", aboveMaximumStage: "clamp", virulent: true }
  });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.virulent-player-window",
    status: "active",
    currentStage: 1,
    appliedAt: 900,
    stageEnteredAt: 900,
    activeStartedAt: 900,
    onsetStartedAt: null,
    nextCheckAt: 1000,
    identification: { state: "identified", identifiedAt: 900, identifiedBy: null },
    recoverySuccesses: 1,
    activeStageEffectUuids: [],
    pendingCheck: null,
    onsetTargetStage: null,
    lastCheck: null,
    revision: 2
  };
  const { actor, controller } = makeController(definition, { state });
  actor.testUserPermission = (user) => user?.id === player.id;
  const created = [];
  globalThis.ChatMessage = {
    create: async (data) => { created.push(data); return data; },
    getSpeaker: () => ({}),
    getWhisperRecipients: () => [gm]
  };

  try {
    const engine = createAfflictionEngine({ instanceService: serviceFor(controller) });
    const result = await engine.process(controller, { force: true });
    assert.equal(result.status, "pending");
    assert.equal(actor.lastRollOptions, undefined, "the GM must not open PF2e's native single-save dialog for a player-owned virulent save");
    const batch = created.find((entry) => entry.flags?.[MODULE_ID]?.saveRequestBatch);
    assert.ok(batch, "virulent stage saves should use the Affliction batch/window request even with one check");
    assert.equal(batch.flags[MODULE_ID].saveRequestBatch.checks.length, 1);
    assert.deepEqual(batch.flags[MODULE_ID].saveRequestBatch.virulentProgress, {
      active: true,
      successes: 1,
      required: 2
    });
    assert.equal(created.some((entry) => entry.flags?.[MODULE_ID]?.saveRequest), false);
  } finally {
    globalThis.game.users = previousUsers;
    globalThis.ChatMessage = previousChatMessage;
  }
});


test("finite stage can recover automatically at expiry without a stage save", async () => {
  const stage = createDefaultStage({ number: 1 });
  stage.duration = { value: 1, unit: "rounds" };
  stage.expiryAction = "recover";
  const definition = automaticDefinition({ defaultStageCheck: null, stages: [stage] });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.expiry",
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
    revision: 1
  };
  const { controller } = makeController(definition, { state });
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.process(controller, { atTime: 1006 });
  assert.equal(result.status, "recovered");
  assert.equal(service.ended, "recovered");
});

test("repeated poison exposure failure advances the existing active controller without restarting maximum-duration anchor", async () => {
  const definition = automaticDefinition({
    afflictionType: "poison",
    stages: [createDefaultStage({ number: 1 }), createDefaultStage({ number: 2 }), createDefaultStage({ number: 3 })]
  });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.reexposure",
    status: "active",
    currentStage: 1,
    appliedAt: 500,
    stageEnteredAt: 900,
    activeStartedAt: 700,
    onsetStartedAt: null,
    nextCheckAt: 1200,
    identification: { state: "identified", identifiedAt: 500, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [], periodicSchedule: {}, pendingCheck: null,
    onsetTargetStage: null, lastCheck: null, revision: 1
  };
  const { controller } = makeController(definition, { state, degrees: ["failure"] });
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.repeatExposure(controller, { atTime: 1050 });
  assert.equal(result.status, "reexposure-stage-changed");
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 2);
  assert.equal(controller.flags[MODULE_ID].state.activeStartedAt, 700);
  assert.equal(controller.flags[MODULE_ID].state.lastCheck.kind, "reexposure");
});

test("repeated poison exposure during onset escalates the target stage without restarting onset", async () => {
  const definition = automaticDefinition({
    afflictionType: "poison",
    onset: { value: 10, unit: "minutes" },
    stages: [createDefaultStage({ number: 1 }), createDefaultStage({ number: 2 }), createDefaultStage({ number: 3 })]
  });
  const state = {
    schemaVersion: 2,
    instanceId: "instance.reexposure-onset",
    status: "incubating",
    currentStage: 0,
    appliedAt: 500,
    stageEnteredAt: null,
    activeStartedAt: null,
    onsetStartedAt: 700,
    nextCheckAt: 1300,
    identification: { state: "identified", identifiedAt: 500, identifiedBy: null },
    recoverySuccesses: 0,
    activeStageEffectUuids: [], periodicSchedule: {}, pendingCheck: null,
    onsetTargetStage: 1, lastCheck: null, revision: 1
  };
  const { controller } = makeController(definition, { state, degrees: ["criticalFailure"] });
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.repeatExposure(controller, { atTime: 900 });
  assert.equal(result.status, "reexposure-onset-escalated");
  assert.equal(controller.flags[MODULE_ID].state.onsetTargetStage, 3);
  assert.equal(controller.flags[MODULE_ID].state.onsetStartedAt, 700);
  assert.equal(controller.flags[MODULE_ID].state.nextCheckAt, 1300);
});

test("poison repeated-exposure override can suppress the extra initial save", async () => {
  const definition = automaticDefinition({ afflictionType: "poison", multipleExposure: "ignore" });
  const state = {
    schemaVersion: 2, instanceId: "instance.ignore-repeat", status: "active", currentStage: 1,
    appliedAt: 500, stageEnteredAt: 900, activeStartedAt: 900, onsetStartedAt: null, nextCheckAt: 1000,
    identification: { state: "identified", identifiedAt: 500, identifiedBy: null }, recoverySuccesses: 0,
    activeStageEffectUuids: [], periodicSchedule: {}, pendingCheck: null, onsetTargetStage: null, lastCheck: null, revision: 1
  };
  const { controller, actor } = makeController(definition, { state, degrees: ["criticalFailure"] });
  const engine = createAfflictionEngine({ instanceService: serviceFor(controller) });
  const result = await engine.repeatExposure(controller);
  assert.equal(result.status, "ignored");
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 1);
  assert.equal(actor.lastRollOptions, undefined);
});

test("incapacitation adjusts the authoritative initial save before resolving the Affliction", async () => {
  const definition = automaticDefinition({ afflictionType: "poison", level: 2, traits: ["poison", "incapacitation"] });
  const { actor, controller } = makeController(definition, { degrees: ["failure"] });
  actor.system = { details: { level: { value: 3 } } };
  const service = serviceFor(controller);
  const engine = createAfflictionEngine({ instanceService: service });
  const result = await engine.processInitial(controller);
  assert.equal(result.status, "rejected");
  assert.equal(result.degree, "success");
  assert.equal(service.ended, "rejected");
});

test("canonical applyDefinition routes a second exposure to the existing poison controller", async () => {
  const definition = automaticDefinition({ afflictionType: "poison" });
  const state = {
    schemaVersion: 2, instanceId: "instance.canonical-repeat", status: "active", currentStage: 1,
    appliedAt: 500, stageEnteredAt: 900, activeStartedAt: 900, onsetStartedAt: null, nextCheckAt: 1200,
    identification: { state: "identified", identifiedAt: 500, identifiedBy: null }, recoverySuccesses: 0,
    activeStageEffectUuids: [], periodicSchedule: {}, pendingCheck: null, onsetTargetStage: null, lastCheck: null, revision: 1
  };
  const { controller, actor } = makeController(definition, { state, degrees: ["failure"] });
  const service = serviceFor(controller);
  service.findActiveDefinition = async () => controller;
  service.applyDefinition = async () => { throw new Error("must not create a second poison controller"); };
  const engine = createAfflictionEngine({ instanceService: service });
  const application = await engine.applyDefinition(definition, actor, { appliedAt: 1050 });
  assert.equal(application.created.length, 0);
  assert.equal(application.reexposures.length, 1);
  assert.equal(application.reexposures[0].status, "reexposure-stage-changed");
  assert.equal(controller.flags[MODULE_ID].state.currentStage, 2);
});
