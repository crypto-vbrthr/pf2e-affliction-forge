import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();
globalThis.game.user = { id: "player-1", isGM: false };
globalThis.game.users = [];
globalThis.game.messages = [];
const emitted = [];
globalThis.game.socket = { emit: (...args) => emitted.push(args) };
globalThis.ui = { notifications: { warn: () => {} } };

const { MODULE_ID } = await import("../scripts/constants.js");
const {
  captureManualPlayerSaveMessage,
  captureTaggedPlayerSaveMessageForGm,
  emitPlayerSavePrompt,
  handleIncomingSaveRequestMessage,
  handlePlayerSavePrompt,
  matchingManualPlayerRequests,
  preferredPlayerOwnerId,
  previewVirulentProgress
} = await import("../scripts/affliction/runtime/affliction-save-runtime.js");

function requestMessage({ requestId = "req-1", checkId = "save-1", statistic = "fortitude" } = {}) {
  return {
    flags: {
      [MODULE_ID]: {
        saveRequest: {
          requestId,
          controllerUuid: "Actor.hero.Item.affliction",
          actorUuid: "Actor.hero",
          checkId,
          statistic,
          dc: 20,
          visibility: "public",
          identificationState: "identified",
          userIds: ["player-1"],
          requestedByUserId: "gm-1"
        }
      }
    }
  };
}

function saveMessage({ statistic = "fortitude", afflictionGenerated = false } = {}) {
  return {
    id: "roll-message",
    author: { id: "player-1" },
    speakerActor: { uuid: "Actor.hero" },
    flags: {
      pf2e: {
        context: {
          type: "saving-throw",
          domains: [statistic, "saving-throw", "all"],
          options: afflictionGenerated ? ["affliction-forge", "affliction-forge:check:save-1"] : []
        }
      }
    },
    rolls: [{
      id: "roll-1",
      degreeOfSuccess: "failure",
      total: 18,
      dice: [{ total: 7 }],
      options: { type: "saving-throw" }
    }]
  };
}

test("a manually rolled matching player save is correlated to the pending request and submitted", () => {
  emitted.length = 0;
  globalThis.game.messages = [requestMessage()];
  const message = saveMessage();
  const matches = matchingManualPlayerRequests(message);
  assert.equal(matches.length, 1);
  const result = captureManualPlayerSaveMessage(message);
  assert.equal(result.status, "submitted");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], `module.${MODULE_ID}`);
  assert.deepEqual(emitted[0][1], {
    type: "save-result",
    controllerUuid: "Actor.hero.Item.affliction",
    requestId: "req-1",
    checkId: "save-1",
    userId: "player-1",
    requestedByUserId: "gm-1",
    degree: "failure",
    total: 18,
    d20: 7,
    rollId: "roll-1"
  });
});

test("the request-card generated save is not captured a second time by the manual-roll listener", () => {
  emitted.length = 0;
  globalThis.game.messages = [requestMessage({ requestId: "req-button", checkId: "save-button" })];
  const result = captureManualPlayerSaveMessage(saveMessage({ afflictionGenerated: true }));
  assert.equal(result.status, "ignored");
  assert.equal(emitted.length, 0);
});

test("an ambiguous manual save is not assigned to an arbitrary affliction request", () => {
  emitted.length = 0;
  let warnings = 0;
  globalThis.ui.notifications.warn = () => { warnings += 1; };
  globalThis.game.messages = [
    requestMessage({ requestId: "req-a", checkId: "save-a" }),
    requestMessage({ requestId: "req-b", checkId: "save-b" })
  ];
  const result = captureManualPlayerSaveMessage(saveMessage());
  assert.equal(result.status, "ambiguous");
  assert.equal(emitted.length, 0);
  assert.equal(warnings, 1);
});

test("interactive player saves target one deterministic active owner and prefer the assigned character user", () => {
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    ownership: { "player-1": 3, "player-2": 3 },
    testUserPermission: (user) => ["player-1", "player-2"].includes(user.id)
  };
  globalThis.game.users = [
    { id: "player-1", isGM: false, active: true },
    { id: "player-2", isGM: false, active: true, character: { id: "hero", uuid: "Actor.hero" } }
  ];
  assert.equal(preferredPlayerOwnerId(actor), "player-2");
});

test("player save prompt is sent as a targeted module-socket request", () => {
  emitted.length = 0;
  const sent = emitPlayerSavePrompt({
    requestId: "req-direct",
    controllerUuid: "Actor.hero.Item.affliction",
    actorUuid: "Actor.hero",
    checkId: "save-direct",
    statistic: "fortitude",
    dc: 22,
    visibility: "public",
    identificationState: "identified",
    targetUserId: "player-1",
    userIds: ["player-1"],
    requestedByUserId: "gm-1"
  });
  assert.equal(sent, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], `module.${MODULE_ID}`);
  assert.equal(emitted[0][1].type, "save-request");
  assert.equal(emitted[0][1].request.targetUserId, "player-1");
  assert.deepEqual(emitted[0][1].request.userIds, ["player-1"]);
});

test("targeted save prompt executes PF2e Statistic.roll on the player client and returns the result", async () => {
  emitted.length = 0;
  globalThis.game.user = { id: "player-1", isGM: false };
  globalThis.game.users = [{ id: "player-1", isGM: false, active: true }];
  let receivedParams = null;
  globalThis.fromUuid = async () => ({
    uuid: "Actor.hero",
    getStatistic: () => ({
      roll: async (params) => {
        receivedParams = params;
        return {
          id: "direct-roll",
          degreeOfSuccess: "success",
          total: 25,
          dice: [{ total: 13 }]
        };
      }
    })
  });

  await handlePlayerSavePrompt({
    type: "save-request",
    request: {
      requestId: "req-window",
      controllerUuid: "Actor.hero.Item.affliction",
      actorUuid: "Actor.hero",
      checkId: "save-window",
      statistic: "fortitude",
      dc: 22,
      visibility: "public",
      identificationState: "identified",
      targetUserId: "player-1",
      userIds: ["player-1"],
      requestedByUserId: "gm-1"
    }
  });

  assert.equal(receivedParams.skipDialog, false);
  assert.equal(receivedParams.createMessage, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][1].type, "save-result");
  assert.equal(emitted[0][1].degree, "success");
  assert.equal(emitted[0][1].rollId, "direct-roll");
});


test("incoming whispered request ChatMessage auto-opens PF2e save dialog on the targeted player without requiring the module socket", async () => {
  emitted.length = 0;
  globalThis.game.user = { id: "player-1", isGM: false };
  globalThis.game.users = [{ id: "player-1", isGM: false, active: true }];
  let receivedParams = null;
  globalThis.fromUuid = async () => ({
    uuid: "Actor.hero",
    getStatistic: () => ({
      roll: async (params) => {
        receivedParams = params;
        return {
          id: "chat-transport-roll",
          degreeOfSuccess: "failure",
          total: 19,
          dice: [{ total: 8 }]
        };
      }
    })
  });
  const message = requestMessage({ requestId: "req-chat-transport", checkId: "save-chat-transport" });
  message.flags[MODULE_ID].saveRequest.targetUserId = "player-1";

  const handled = handleIncomingSaveRequestMessage(message);
  assert.equal(handled.status, "prompted");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(receivedParams.skipDialog, false);
  assert.ok(receivedParams.extraRollOptions.includes("affliction-forge:request:req-chat-transport"));
  assert.ok(receivedParams.extraRollOptions.includes("affliction-forge:controller:Actor.hero.Item.affliction"));
  assert.equal(emitted.at(-1)?.[1]?.type, "save-result");
});

test("authoritative GM resolves a uniquely tagged PF2e player-save ChatMessage without relying on a module-socket result", async () => {
  globalThis.game.user = { id: "gm-1", isGM: true };
  const gm = { id: "gm-1", isGM: true, active: true };
  const player = { id: "player-1", isGM: false, active: true };
  const users = [gm, player];
  users.activeGM = gm;
  users.get = (id) => users.find((entry) => entry.id === id);
  globalThis.game.users = users;

  const request = requestMessage({ requestId: "req-gm-chat", checkId: "save-gm-chat" });
  request.flags[MODULE_ID].saveRequest.targetUserId = "player-1";
  globalThis.game.messages = [request];

  let accepted = null;
  globalThis.game.modules.set(MODULE_ID, {
    api: {
      engine: {
        acceptPlayerResult: async (payload) => {
          accepted = payload;
          return { status: "advanced" };
        }
      }
    }
  });
  globalThis.Hooks = { callAll: () => {} };

  const message = {
    id: "pf2e-roll-message",
    author: { id: "player-1" },
    flags: {
      pf2e: {
        context: {
          type: "saving-throw",
          domains: ["fortitude", "saving-throw", "all"],
          options: [
            "affliction-forge",
            "affliction-forge:check:save-gm-chat",
            "affliction-forge:request:req-gm-chat"
          ]
        }
      }
    },
    rolls: [{
      id: "gm-visible-roll",
      degreeOfSuccess: "criticalSuccess",
      total: 31,
      dice: [{ total: 20 }],
      options: { type: "saving-throw" }
    }]
  };

  const result = captureTaggedPlayerSaveMessageForGm(message);
  assert.equal(result.status, "submitted");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(accepted, {
    controllerUuid: "Actor.hero.Item.affliction",
    requestId: "req-gm-chat",
    checkId: "save-gm-chat",
    userId: "player-1",
    requestedByUserId: "gm-1",
    degree: "criticalSuccess",
    total: 31,
    d20: 20,
    rollId: "gm-visible-roll"
  });
});

test("a grouped player-save request resolves two checks through one batch workflow", async () => {
  emitted.length = 0;
  globalThis.game.user = { id: "player-1", isGM: false };
  globalThis.game.users = [{ id: "player-1", isGM: false, active: true }];
  let rollCount = 0;
  globalThis.fromUuid = async () => ({
    uuid: "Actor.hero",
    name: "Hero",
    getStatistic: () => ({
      roll: async (params) => {
        rollCount += 1;
        return {
          id: `batch-roll-${rollCount}`,
          degreeOfSuccess: rollCount === 1 ? "success" : "failure",
          total: rollCount === 1 ? 25 : 18,
          dice: [{ total: rollCount === 1 ? 13 : 7 }],
          options: params
        };
      }
    })
  });

  const { handlePlayerSaveBatchPrompt } = await import("../scripts/affliction/runtime/affliction-save-runtime.js");
  await handlePlayerSaveBatchPrompt({
    type: "save-request-batch",
    batch: {
      requestId: "req-batch-two",
      controllerUuid: "Actor.hero.Item.affliction",
      actorUuid: "Actor.hero",
      identificationState: "identified",
      targetUserId: "player-1",
      userIds: ["player-1"],
      requestedByUserId: "gm-1",
      checks: [
        {
          requestId: "req-batch-two",
          controllerUuid: "Actor.hero.Item.affliction",
          actorUuid: "Actor.hero",
          checkId: "body",
          label: "Body",
          statistic: "fortitude",
          dc: 22,
          visibility: "public",
          identificationState: "identified",
          targetUserId: "player-1",
          userIds: ["player-1"],
          requestedByUserId: "gm-1"
        },
        {
          requestId: "req-batch-two",
          controllerUuid: "Actor.hero.Item.affliction",
          actorUuid: "Actor.hero",
          checkId: "mind",
          label: "Mind",
          statistic: "will",
          dc: 24,
          visibility: "public",
          identificationState: "identified",
          targetUserId: "player-1",
          userIds: ["player-1"],
          requestedByUserId: "gm-1"
        }
      ]
    }
  });

  assert.equal(rollCount, 2);
  const results = emitted.filter((entry) => entry[1]?.type === "save-result");
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((entry) => entry[1].checkId), ["body", "mind"]);
});


test("virulent progress preview updates live after the current stage save", () => {
  const start = { active: true, successes: 0, required: 2 };
  const first = previewVirulentProgress(start, "success");
  assert.equal(first.successes, 1);
  assert.equal(first.lastOutcome, "oneSuccess");

  const second = previewVirulentProgress({ active: true, successes: 1, required: 2 }, "success");
  assert.equal(second.successes, 2);
  assert.equal(second.lastOutcome, "twoSuccesses");

  const broken = previewVirulentProgress({ active: true, successes: 1, required: 2 }, "failure");
  assert.equal(broken.successes, 0);
  assert.equal(broken.lastOutcome, "streakBroken");

  const critical = previewVirulentProgress({ active: true, successes: 1, required: 2 }, "criticalSuccess");
  assert.equal(critical.successes, 0);
  assert.equal(critical.lastOutcome, "criticalSuccess");
});
