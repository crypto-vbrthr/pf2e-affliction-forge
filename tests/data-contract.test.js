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
  resolveSavePolicy,
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
  assert.equal(definition.schemaVersion, 2);
  assert.deepEqual(definition.saveDefaults, { execution: "player", visibility: "public" });
  assert.deepEqual(definition.identification, { initialState: "identified" });
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

test("schema 1 templates migrate to save-policy and identification defaults", () => {
  const migrated = normalizeAfflictionDefinition({
    schemaVersion: 1,
    id: "legacy.affliction",
    name: "Legacy",
    checks: [{ id: "primary", label: "", kind: "save", statistic: "fortitude", dc: 20 }],
    stages: [{ id: "stage-1", number: 1, name: "", description: "", duration: { value: 1, unit: "rounds" }, check: null, effect: null }]
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.saveDefaults, { execution: "player", visibility: "public" });
  assert.equal(migrated.checks[0].policy, null);
  assert.deepEqual(migrated.identification, { initialState: "identified" });
});

test("saving throw policies inherit root defaults and support per-check overrides", () => {
  const definition = validDefinition();
  definition.saveDefaults = { execution: "gm", visibility: "gmOnly" };
  assert.deepEqual(resolveSavePolicy(definition, "primary"), { execution: "gm", visibility: "gmOnly" });

  definition.checks[0].policy = { execution: "automatic", visibility: "public" };
  assert.deepEqual(resolveSavePolicy(definition, definition.checks[0]), { execution: "automatic", visibility: "public" });
  assert.equal(validateAfflictionDefinition(definition).valid, true);
});

test("validator rejects unsupported save policies and identification states", () => {
  const definition = validDefinition();
  definition.saveDefaults.execution = "telepathy";
  definition.identification.initialState = "mysterious";
  definition.checks[0].policy = { execution: "player", visibility: "everyone-but-the-gm" };
  const report = validateAfflictionDefinition(definition);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "save-policy.execution"));
  assert.ok(report.errors.some((issue) => issue.code === "save-policy.visibility"));
  assert.ok(report.errors.some((issue) => issue.code === "identification.initial-state"));
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

test("poison definitions can opt into injury-poison delivery without changing schema version", () => {
  const definition = createAfflictionDefinition({
    id: "test.injury-poison",
    name: "Injury Poison",
    afflictionType: "poison",
    delivery: { injuryPoison: true }
  });
  assert.equal(definition.schemaVersion, 2);
  assert.deepEqual(definition.delivery, { injuryPoison: true });
  assert.equal(validateAfflictionDefinition(definition).valid, true);

  const normalizedLegacy = normalizeAfflictionDefinition({
    schemaVersion: 2,
    id: "legacy.poison",
    name: "Legacy Poison",
    afflictionType: "poison",
    checks: definition.checks,
    stages: definition.stages
  });
  assert.deepEqual(normalizedLegacy.delivery, { injuryPoison: false });
});

test("injury-poison delivery is rejected for non-poison Afflictions", () => {
  const definition = createAfflictionDefinition({
    id: "test.bad-injury-poison",
    name: "Bad Injury Poison",
    afflictionType: "disease",
    delivery: { injuryPoison: true }
  });
  const report = validateAfflictionDefinition(definition);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "delivery.injury-poison-type"));
});

test("save checks support fixed and external source DC modes", () => {
  const external = validDefinition();
  external.checks[0].dcMode = "source";
  external.checks[0].dc = null;
  const normalized = normalizeAfflictionDefinition(external);
  assert.equal(normalized.checks[0].dcMode, "source");
  assert.equal(normalized.checks[0].dc, null);
  assert.equal(validateAfflictionDefinition(normalized).valid, true);

  const fixed = validDefinition();
  fixed.checks[0].dcMode = "fixed";
  fixed.checks[0].dc = null;
  const report = validateAfflictionDefinition(fixed);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "check.dc"));
});

test("virulent progression is an additive schema-v2 capability and defaults off", () => {
  const ordinary = validDefinition();
  assert.equal(ordinary.progression.virulent, false);
  assert.equal(validateAfflictionDefinition(ordinary).valid, true);

  const virulent = normalizeAfflictionDefinition({
    ...ordinary,
    progression: { ...ordinary.progression, virulent: true }
  });
  assert.equal(virulent.schemaVersion, 2);
  assert.equal(virulent.progression.virulent, true);
  assert.equal(validateAfflictionDefinition(virulent).valid, true);
});

test("restrictions and stage-effect persistence are additive schema-v2 capabilities", () => {
  const definition = normalizeAfflictionDefinition({
    ...validDefinition(),
    restrictions: {
      conditionLocks: [{ slug: "sickened", minimum: 1 }],
      healing: "affliction-damage",
      unhealableDamageTypes: ["cold"],
      blockedCapabilities: ["speak"]
    },
    stages: [{
      ...createDefaultStage({ number: 1 }),
      restrictions: {
        conditionLocks: [{ slug: "sickened", minimum: 2 }],
        healing: "all",
        unhealableDamageTypes: ["fire"],
        blockedCapabilities: []
      },
      effectPersistence: "stage",
      effectComponentPersistence: ["permanent"],
      effect: {
        schemaVersion: 2,
        id: "persistent.blind",
        name: "Persistent Blind",
        duration: { value: -1, unit: "unlimited", expiry: null },
        components: [{ type: "condition", slug: "blinded" }],
        application: {},
        metadata: {}
      }
    }]
  });
  assert.equal(definition.schemaVersion, 2);
  assert.equal(definition.restrictions.healing, "affliction-damage");
  assert.deepEqual(definition.restrictions.unhealableDamageTypes, ["cold"]);
  assert.deepEqual(definition.restrictions.blockedCapabilities, ["speak"]);
  assert.equal(definition.stages[0].restrictions.healing, "all");
  assert.deepEqual(definition.stages[0].restrictions.unhealableDamageTypes, ["fire"]);
  assert.equal(definition.stages[0].effectPersistence, "stage");
  assert.deepEqual(definition.stages[0].effectComponentPersistence, ["permanent"]);
  assert.equal(validateAfflictionDefinition(definition, { effectValidator: () => ({ valid: true, issues: [] }) }).valid, true);
});

test("restriction validator rejects unsupported healing, capabilities, and persistence", () => {
  const definition = validDefinition();
  definition.restrictions.healing = "only-on-tuesdays";
  definition.restrictions.blockedCapabilities = ["teleport"];
  definition.restrictions.unhealableDamageTypes = [""];
  definition.stages[0].effectPersistence = "forever-ish";
  definition.stages[0].effectComponentPersistence = ["eternal"];
  const report = validateAfflictionDefinition(definition);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "restrictions.healing"));
  assert.ok(report.errors.some((issue) => issue.code === "restrictions.capability"));
  assert.ok(report.errors.some((issue) => issue.code === "restrictions.damage-type"));
  assert.ok(report.errors.some((issue) => issue.code === "stage.effect-persistence"));
  assert.ok(report.errors.some((issue) => issue.code === "stage.component-persistence-mode"));
});

test("stage event reactions normalize and validate as additive schema-v2 mechanics", () => {
  const definition = normalizeAfflictionDefinition({
    ...validDefinition(),
    checks: [
      createDefaultSaveCheck({ id: "primary", dc: 25 }),
      createDefaultSaveCheck({ id: "mind", statistic: "will", dc: 25 })
    ],
    stages: [{
      ...createDefaultStage({ number: 1 }),
      reactions: [{
        id: "slashing-nightmare",
        label: "Nightmare backlash",
        trigger: { event: "damage-taken", damageTypes: ["slashing"] },
        checkId: "mind",
        applyOn: ["failure", "criticalFailure"],
        effect: null
      }]
    }]
  });
  const reaction = definition.stages[0].reactions[0];
  assert.equal(reaction.trigger.event, "damage-taken");
  assert.deepEqual(reaction.trigger.damageTypes, ["slashing"]);
  assert.equal(reaction.checkId, "mind");
  assert.equal(validateAfflictionDefinition(definition).valid, true);
});

test("condition-increased reactions can resolve directly without an auxiliary save", () => {
  const definition = normalizeAfflictionDefinition({
    ...validDefinition(),
    stages: [{
      ...createDefaultStage({ number: 1 }),
      reactions: [{
        id: "wounded-escalation",
        label: "Escalate wounded",
        trigger: { event: "condition-increased", conditionSlugs: ["WOUNDED"] },
        checkId: null,
        applyOn: [],
        conditionValueDelta: 1,
        effect: null
      }]
    }]
  });
  const reaction = definition.stages[0].reactions[0];
  assert.equal(reaction.trigger.event, "condition-increased");
  assert.deepEqual(reaction.trigger.conditionSlugs, ["wounded"]);
  assert.equal(reaction.checkId, null);
  assert.deepEqual(reaction.applyOn, []);
  assert.equal(reaction.conditionValueDelta, 1);
  assert.equal(validateAfflictionDefinition(definition).valid, true);
});

test("event reaction validator rejects unsupported triggers, unknown checks, and empty outcomes", () => {
  const definition = validDefinition();
  definition.stages[0].reactions = [{
    id: "bad",
    label: "Bad",
    trigger: { event: "moon-phase", damageTypes: [] },
    checkId: "missing",
    applyOn: [],
    effect: null
  }];
  const report = validateAfflictionDefinition(definition);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "reaction.trigger.event"));
  assert.ok(report.errors.some((issue) => issue.code === "reaction.check.unknown"));
  assert.ok(report.errors.some((issue) => issue.code === "reaction.apply-on"));
});

test("numeric modifiers and periodic stage effects normalize and validate as additive schema-v2 mechanics", () => {
  const definition = normalizeAfflictionDefinition({
    ...validDefinition(),
    stages: [{
      ...createDefaultStage({ number: 1 }),
      numericModifiers: [{
        id: "slowed-movement",
        label: "Reduced movement",
        selectors: ["ALL-SPEEDS", "land-speed"],
        type: "status",
        value: -5
      }],
      periodicEffects: [{
        id: "bleeding-burst",
        label: "Recurring bleeding",
        interval: { formula: "1d20", unit: "minutes" },
        effect: {
          schemaVersion: 2,
          id: "bleeding-burst.effect",
          name: "Recurring bleeding",
          duration: { value: -1, unit: "unlimited", expiry: null },
          components: [{ type: "damage", formula: "1d6", damageType: "bleed", persistent: true }],
          application: {},
          metadata: {}
        }
      }]
    }]
  });

  const stage = definition.stages[0];
  assert.deepEqual(stage.numericModifiers[0].selectors, ["all-speeds", "land-speed"]);
  assert.equal(stage.numericModifiers[0].type, "status");
  assert.equal(stage.numericModifiers[0].value, -5);
  assert.deepEqual(stage.periodicEffects[0].interval, { formula: "1d20", unit: "minutes" });
  assert.equal(validateAfflictionDefinition(definition, { effectValidator: () => ({ valid: true, issues: [] }) }).valid, true);
});

test("numeric and periodic validators reject invalid authoring values", () => {
  const definition = validDefinition();
  definition.stages[0].numericModifiers = [{
    id: "bad-modifier",
    label: "Bad",
    selectors: [],
    type: "luck",
    value: 0
  }];
  definition.stages[0].periodicEffects = [{
    id: "bad-periodic",
    label: "Bad periodic",
    interval: { value: 0, unit: "minutes" },
    effect: null
  }];
  const report = validateAfflictionDefinition(definition);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "numeric-modifier.selectors"));
  assert.ok(report.errors.some((issue) => issue.code === "numeric-modifier.type"));
  assert.ok(report.errors.some((issue) => issue.code === "numeric-modifier.value"));
  assert.ok(report.errors.some((issue) => issue.code === "periodic.interval.value"));
});


test("pre-action gates normalize concentrate flat checks without changing schema version", () => {
  const definition = normalizeAfflictionDefinition({
    ...validDefinition(),
    stages: [{
      ...createDefaultStage({ number: 1 }),
      preActionGates: [{
        id: "cough",
        label: "Cough",
        trigger: { actionKinds: ["SPELL-CAST", "item-activation"], requiredTraits: ["CONCENTRATE"] },
        check: { kind: "flat", dc: 5 },
        blockOnFailure: true
      }]
    }]
  });
  const gate = definition.stages[0].preActionGates[0];
  assert.deepEqual(gate.trigger.actionKinds, ["spell-cast", "item-activation"]);
  assert.deepEqual(gate.trigger.requiredTraits, ["concentrate"]);
  assert.deepEqual(gate.check, { kind: "flat", dc: 5 });
  assert.equal(gate.blockOnFailure, true);
  assert.equal(validateAfflictionDefinition(definition).valid, true);
});

test("pre-action validator rejects unsupported action kinds and invalid flat-check DCs", () => {
  const definition = validDefinition();
  definition.stages[0].preActionGates = [{
    id: "bad-gate",
    label: "Bad",
    trigger: { actionKinds: ["teleport-thought"], requiredTraits: [""] },
    check: { kind: "save", dc: 0 },
    blockOnFailure: "yes"
  }];
  const report = validateAfflictionDefinition(definition);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "pre-action.action-kind"));
  assert.ok(report.errors.some((issue) => issue.code === "pre-action.required-trait"));
  assert.ok(report.errors.some((issue) => issue.code === "pre-action.check.kind"));
  assert.ok(report.errors.some((issue) => issue.code === "pre-action.check.dc"));
  assert.ok(report.errors.some((issue) => issue.code === "pre-action.block-on-failure"));
});
