import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();
globalThis.game.user = { id: "player", isGM: false };

const { MODULE_ID } = await import("../scripts/constants.js");
const { concealedAfflictionItemIds } = await import("../scripts/affliction/runtime/affliction-visibility-runtime.js");

function controller(id, instanceId, identification) {
  return {
    id,
    flags: {
      [MODULE_ID]: {
        managed: true,
        documentKind: "affliction-controller",
        instanceId,
        state: { instanceId, identification: { state: identification } }
      }
    }
  };
}

function stageEffect(id, instanceId) {
  return {
    id,
    flags: {
      [MODULE_ID]: {
        managed: true,
        documentKind: "affliction-stage-effect",
        instanceId
      }
    }
  };
}

function residualEffect(id, instanceId) {
  return {
    id,
    flags: {
      [MODULE_ID]: {
        managed: true,
        documentKind: "affliction-residual-effect",
        instanceId
      }
    }
  };
}

test("player visibility hides hidden controllers and all unidentified stage-effect rows", () => {
  const actor = {
    items: [
      controller("hidden-controller", "a", "hidden"),
      stageEffect("hidden-stage", "a"),
      controller("suspected-controller", "b", "suspected"),
      stageEffect("suspected-stage", "b"),
      controller("identified-controller", "c", "identified"),
      stageEffect("identified-stage", "c")
    ]
  };

  const hidden = concealedAfflictionItemIds(actor);
  assert.deepEqual([...hidden].sort(), ["hidden-controller", "hidden-stage", "suspected-stage"]);
});


test("player visibility treats residual effects like stage effects until identification", () => {
  const actor = {
    items: [
      controller("hidden-controller-r", "r", "hidden"),
      residualEffect("hidden-residual", "r"),
      controller("identified-controller-r", "s", "identified"),
      residualEffect("identified-residual", "s")
    ]
  };
  const hidden = concealedAfflictionItemIds(actor);
  assert.deepEqual([...hidden].sort(), ["hidden-controller-r", "hidden-residual"]);
});
