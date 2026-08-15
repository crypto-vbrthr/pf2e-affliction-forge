import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();

const { createAfflictionDefinition } = await import("../scripts/affliction/schema/affliction-defaults.js");
const { createAfflictionEditorSession } = await import("../scripts/affliction/editor/affliction-editor-session.js");

function sourceDefinition() {
  return createAfflictionDefinition({
    id: "test.editor",
    name: "Editor Test",
    level: 5
  });
}

test("editor session round-trips a normalized AfflictionDefinition", () => {
  const source = sourceDefinition();
  const session = createAfflictionEditorSession(source, { mode: "edit" });
  assert.equal(session.readOnly, false);
  assert.equal(session.dirty, false);
  assert.deepEqual(session.value, source);

  session.definition.name = "Changed";
  session.refreshDirty();
  assert.equal(session.dirty, true);
  assert.equal(session.value.name, "Changed");
});

test("check rename preserves gate references", () => {
  const session = createAfflictionEditorSession(sourceDefinition());
  assert.equal(session.definition.initialCheck.checkIds[0], "primary");
  assert.equal(session.definition.defaultStageCheck.checkIds[0], "primary");

  session.renameCheck(0, "body");
  assert.equal(session.definition.checks[0].id, "body");
  assert.deepEqual(session.definition.initialCheck.checkIds, ["body"]);
  assert.deepEqual(session.definition.defaultStageCheck.checkIds, ["body"]);
});

test("editor never allows the last save check or last stage to be removed", () => {
  const session = createAfflictionEditorSession(sourceDefinition());
  assert.equal(session.removeCheck(0), false);
  assert.equal(session.removeStage(0), false);
  assert.equal(session.definition.checks.length, 1);
  assert.equal(session.definition.stages.length, 1);
});

test("stage operations reindex stage numbers and preserve embedded effect data", () => {
  const source = sourceDefinition();
  source.stages[0].effect = {
    schemaVersion: 2,
    id: "stage.effect",
    name: "Stage Effect",
    description: "",
    img: "icons/svg/aura.svg",
    duration: { value: -1, unit: "unlimited", expiry: null },
    components: [],
    application: {},
    metadata: { custom: "keep" }
  };
  const session = createAfflictionEditorSession(source);
  const copyIndex = session.duplicateStage(0);
  assert.equal(copyIndex, 1);
  assert.equal(session.definition.stages.length, 2);
  assert.equal(session.definition.stages[0].number, 1);
  assert.equal(session.definition.stages[1].number, 2);
  assert.equal(session.definition.stages[1].effect.metadata.custom, "keep");

  session.moveStage(1, "up");
  assert.equal(session.definition.stages[0].number, 1);
  assert.equal(session.definition.stages[1].number, 2);
});

test("stage check override can be enabled and returned to inherited mode", () => {
  const session = createAfflictionEditorSession(sourceDefinition());
  assert.equal(session.definition.stages[0].check, null);
  session.setStageCheckOverride(0, true);
  assert.ok(session.definition.stages[0].check);
  assert.notEqual(session.definition.stages[0].check, session.definition.defaultStageCheck);
  session.setStageCheckOverride(0, false);
  assert.equal(session.definition.stages[0].check, null);
});

test("view mode is explicitly read-only at the editor contract level", () => {
  const session = createAfflictionEditorSession(sourceDefinition(), { mode: "view" });
  assert.equal(session.readOnly, true);
  assert.equal(session.mode, "view");
});

test("stage effect assignment thaws deeply frozen Critical Forge definitions", () => {
  const session = createAfflictionEditorSession(sourceDefinition());
  const frozen = Object.freeze({
    schemaVersion: 2,
    id: "critical.frozen",
    name: "Frozen Effect",
    description: "",
    img: "icons/svg/aura.svg",
    duration: Object.freeze({ value: -1, unit: "unlimited", expiry: null }),
    components: Object.freeze([]),
    application: Object.freeze({}),
    metadata: Object.freeze({ source: "critical-forge" })
  });

  session.setStageEffect(0, frozen);

  assert.notEqual(session.definition.stages[0].effect, frozen);
  assert.equal(Object.isFrozen(session.definition.stages[0].effect), false);
  assert.doesNotThrow(() => {
    session.definition.stages[0].effect.id = "affliction.mutable";
    session.definition.stages[0].effect.metadata.originModule = "pf2e-affliction-forge";
  });
  assert.equal(session.definition.stages[0].effect.id, "affliction.mutable");
});

test("editor session preserves save-policy overrides and identification state", () => {
  const source = sourceDefinition();
  source.saveDefaults = { execution: "automatic", visibility: "gmOnly" };
  source.identification = { initialState: "hidden" };
  source.checks[0].policy = { execution: "gm", visibility: "public" };
  const session = createAfflictionEditorSession(source);
  assert.deepEqual(session.definition.saveDefaults, { execution: "automatic", visibility: "gmOnly" });
  assert.deepEqual(session.definition.checks[0].policy, { execution: "gm", visibility: "public" });
  assert.deepEqual(session.definition.identification, { initialState: "hidden" });
});

test("check rename preserves stage event-reaction references", () => {
  const session = createAfflictionEditorSession(sourceDefinition());
  session.addStageReaction(0, { id: "hurt", checkId: "primary" });
  assert.equal(session.definition.stages[0].reactions[0].checkId, "primary");

  session.renameCheck(0, "mind");
  assert.equal(session.definition.stages[0].reactions[0].checkId, "mind");
});

test("duplicating a stage gives event reactions and their effects independent identities", () => {
  const session = createAfflictionEditorSession(sourceDefinition());
  session.addStageReaction(0, { id: "hurt", checkId: "primary" });
  session.setStageReactionEffect(0, 0, {
    schemaVersion: 2,
    id: "reaction.effect",
    name: "Reaction Effect",
    description: "",
    img: "icons/svg/aura.svg",
    duration: { value: 1, unit: "rounds", expiry: null },
    components: [],
    application: {},
    metadata: {}
  });

  session.duplicateStage(0);
  const original = session.definition.stages[0].reactions[0];
  const copy = session.definition.stages[1].reactions[0];
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.effect.id, original.effect.id);
  assert.match(copy.effect.id, new RegExp(session.definition.stages[1].id));
});
