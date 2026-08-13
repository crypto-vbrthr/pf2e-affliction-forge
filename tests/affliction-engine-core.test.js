import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();

const {
  combineDegrees,
  buildCheckPlan,
  resolveCheckResults,
  resolveDirective
} = await import("../scripts/affliction/runtime/affliction-engine-core.js");
const { createAfflictionDefinition, createDefaultSaveCheck } = await import("../scripts/affliction/schema/affliction-defaults.js");

const definition = createAfflictionDefinition({
  name: "Engine Test",
  checks: [
    createDefaultSaveCheck({ id: "body", statistic: "fortitude", dc: 20 }),
    createDefaultSaveCheck({ id: "mind", statistic: "will", dc: 20 })
  ],
  initialCheck: {
    checkIds: ["body", "mind"],
    combine: "all-success",
    outcomes: {
      criticalSuccess: { action: "reject" },
      success: { action: "reject" },
      failure: { action: "set-stage", stage: 1 },
      criticalFailure: { action: "set-stage", stage: 2 }
    }
  }
});

test("multi-save combination modes produce deterministic degrees", () => {
  assert.equal(combineDegrees(["success", "criticalSuccess"], "all-success"), "success");
  assert.equal(combineDegrees(["success", "failure"], "all-success"), "failure");
  assert.equal(combineDegrees(["failure", "criticalFailure"], "all-success"), "criticalFailure");
  assert.equal(combineDegrees(["failure", "criticalSuccess"], "any-success"), "criticalSuccess");
  assert.equal(combineDegrees(["failure", "criticalFailure"], "any-success"), "failure");
  assert.equal(combineDegrees(["failure", "criticalSuccess"], "best-degree"), "criticalSuccess");
  assert.equal(combineDegrees(["failure", "criticalSuccess"], "worst-degree"), "failure");
});

test("initial check plan resolves all referenced saves and inherited policies", () => {
  const state = { status: "pending", currentStage: 0 };
  const plan = buildCheckPlan(definition, state);
  assert.equal(plan.kind, "initial");
  assert.deepEqual(plan.checks.map((check) => check.id), ["body", "mind"]);
  assert.equal(plan.checks[0].policy.execution, "player");
});

test("completed multi-save results resolve an outcome directive and target stage", () => {
  const state = { status: "pending", currentStage: 0 };
  const plan = buildCheckPlan(definition, state);
  const resolution = resolveCheckResults(definition, state, plan, {
    body: { degree: "success" },
    mind: { degree: "failure" }
  });
  assert.equal(resolution.complete, true);
  assert.equal(resolution.degree, "failure");
  assert.equal(resolution.transition.type, "stage");
  assert.equal(resolution.transition.targetStage, 1);
});

test("progression boundaries recover below stage one and clamp above maximum by default", () => {
  const active = { currentStage: 1 };
  assert.equal(resolveDirective(definition, active, { action: "stage-delta", delta: -1 }).type, "recover");
  const above = resolveDirective(definition, { currentStage: definition.stages.length }, { action: "stage-delta", delta: 10 });
  assert.equal(above.type, "stage");
  assert.equal(above.targetStage, definition.stages.length);
});
