import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();

const {
  createAfflictionDefinition,
  createDefaultSaveCheck,
  createDefaultStage
} = await import("../scripts/affliction/schema/affliction-defaults.js");
const {
  normalizeAfflictionDefinition,
  resolveStageCheck
} = await import("../scripts/affliction/schema/affliction-normalizer.js");
const { validateAfflictionDefinition } = await import("../scripts/affliction/schema/affliction-validator.js");

function validDefinition() {
  return createAfflictionDefinition({
    name: "Aschenfieber",
    afflictionType: "disease",
    level: 8,
    checks: [createDefaultSaveCheck({ dc: 27 })],
    stages: [
      createDefaultStage({ number: 1 }),
      { ...createDefaultStage({ number: 2 }), duration: { value: 8, unit: "hours" } }
    ]
  });
}

test("default contract creates a stable staged definition", () => {
  const definition = validDefinition();
  const report = validateAfflictionDefinition(definition);
  assert.equal(definition.schemaVersion, 1);
  assert.equal(definition.initialCheck.outcomes.failure.stage, 1);
  assert.equal(definition.defaultStageCheck.outcomes.criticalFailure.delta, 2);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});

test("normalizer canonicalizes singular duration units and stage numbering", () => {
  const normalized = normalizeAfflictionDefinition({
    id: "test.affliction",
    name: "Test",
    onset: { value: "2", unit: "hour" },
    stages: [
      { id: "late", number: 99, duration: { value: "1", unit: "round" } },
      { id: "later", number: 4, duration: { value: 1, unit: "minute" } }
    ]
  });
  assert.deepEqual(normalized.onset, { value: 2, unit: "hours" });
  assert.equal(normalized.stages[0].number, 1);
  assert.equal(normalized.stages[0].duration.unit, "rounds");
  assert.equal(normalized.stages[1].number, 2);
  assert.equal(normalized.stages[1].duration.unit, "minutes");
});


test("normalizer refuses unknown schema versions instead of silently migrating them", () => {
  assert.throws(
    () => normalizeAfflictionDefinition({ schemaVersion: 99, id: "future", name: "Future" }),
    /Unsupported affliction schema version/
  );
});

test("stage check falls back to the root default and can be overridden", () => {
  const definition = validDefinition();
  assert.equal(resolveStageCheck(definition, 1).outcomes.success.delta, -1);
  definition.stages[1].check = {
    checkIds: ["primary"],
    combine: "single",
    outcomes: {
      criticalSuccess: { action: "recover" },
      success: { action: "stay" },
      failure: { action: "stay" },
      criticalFailure: { action: "stage-delta", delta: 1 }
    }
  };
  assert.equal(resolveStageCheck(definition, 2).outcomes.criticalSuccess.action, "recover");
});

test("validator rejects broken references and duplicate stage ids", () => {
  const definition = validDefinition();
  definition.initialCheck.checkIds = ["missing"];
  definition.stages[1].id = definition.stages[0].id;
  const report = validateAfflictionDefinition(definition);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "check-gate.unknown-check"));
  assert.ok(report.errors.some((issue) => issue.code === "stage.id.duplicate"));
});

test("multiple checks are representable through an explicit combine mode", () => {
  const definition = validDefinition();
  definition.checks.push(createDefaultSaveCheck({ id: "mind", statistic: "will", dc: 25 }));
  definition.defaultStageCheck.checkIds = ["primary", "mind"];
  definition.defaultStageCheck.combine = "worst-degree";
  const report = validateAfflictionDefinition(definition);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});

test("validator warns when a stage Effect Definition tries to own stage lifetime", () => {
  const definition = validDefinition();
  definition.stages[0].effect = {
    schemaVersion: 2,
    id: "finite.stage.effect",
    name: "Finite",
    duration: { value: 1, unit: "rounds", expiry: "turn-end" },
    components: [],
    application: {},
    metadata: {}
  };
  const report = validateAfflictionDefinition(definition, {
    effectValidator: () => ({ valid: true, issues: [] })
  });
  assert.equal(report.valid, true);
  assert.ok(report.warnings.some((issue) => issue.code === "stage.effect.duration-managed"));
});


test("nested Critical Forge warning keys are localized when Foundry i18n is available", () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    ...(previousGame ?? {}),
    i18n: {
      format: (key, data) => key === "PF2E_CRITICAL_FORGE.Validation.Rules.FrightenedStatus"
        ? `Localized frightened ${data.frightenedValue}/${data.modifierValue}`
        : key,
      localize: (key) => key
    }
  };
  try {
    const definition = validDefinition();
    definition.stages[0].effect = {
      schemaVersion: 2,
      id: "warning.effect",
      name: "Warning",
      duration: { value: -1, unit: "unlimited", expiry: null },
      components: [{ type: "condition", slug: "frightened", value: 2 }],
      application: {},
      metadata: {}
    };
    const report = validateAfflictionDefinition(definition, {
      effectValidator: () => ({
        valid: true,
        issues: [{
          severity: "warning",
          code: "STACKING_FRIGHTENED_STATUS",
          messageKey: "Validation.Rules.FrightenedStatus",
          data: { frightenedValue: 2, modifierValue: -1 },
          componentIndex: 0
        }]
      })
    });
    assert.equal(report.valid, true);
    assert.equal(report.warnings[0].message, "Localized frightened 2/-1");
    assert.equal(report.warnings[0].data.providerMessageKey, "Validation.Rules.FrightenedStatus");
  } finally {
    globalThis.game = previousGame;
  }
});
