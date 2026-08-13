import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();

const { createAfflictionDefinition } = await import("../scripts/affliction/schema/affliction-defaults.js");
const {
  createAfflictionControllerState,
  validateAfflictionControllerState
} = await import("../scripts/affliction/runtime/controller-state.js");

test("controller starts in stage 1 without onset", () => {
  const definition = createAfflictionDefinition({ name: "Gift" });
  const state = createAfflictionControllerState(definition, { appliedAt: 100 });
  assert.equal(state.status, "active");
  assert.equal(state.currentStage, 1);
  assert.equal(state.stageEnteredAt, 100);
  assert.equal(state.identification.state, "identified");
  assert.equal(state.identification.identifiedAt, 100);
  assert.equal(validateAfflictionControllerState(state, definition).valid, true);
});

test("controller starts incubating at stage 0 when onset exists", () => {
  const definition = createAfflictionDefinition({ name: "Fieber", onset: { value: 1, unit: "days" } });
  const state = createAfflictionControllerState(definition, { appliedAt: 100 });
  assert.equal(state.status, "incubating");
  assert.equal(state.currentStage, 0);
  assert.equal(state.stageEnteredAt, null);
});

test("controller copies the template identification start state without changing the definition", () => {
  const definition = createAfflictionDefinition({
    name: "Verborgener Fluch",
    afflictionType: "curse",
    identification: { initialState: "hidden" }
  });
  const state = createAfflictionControllerState(definition, { appliedAt: 250 });
  assert.equal(state.identification.state, "hidden");
  assert.equal(state.identification.identifiedAt, null);
  assert.equal(validateAfflictionControllerState(state, definition).valid, true);
});
