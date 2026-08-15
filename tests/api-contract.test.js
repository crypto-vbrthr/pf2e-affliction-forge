import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const { modules } = installFoundryMock();
modules.set("pf2e-critical-forge", {
  active: true,
  version: "1.0.1-rc.3",
  api: {
    version: "0.9.6",
    moduleVersion: "1.0.1-rc.3",
    schemaVersion: 2,
    effects: {
      validate: () => ({ valid: true, issues: [], errors: [] }),
      toItemSources: async () => [],
      execute: async () => []
    },
    components: {
      get: (type) => type === "death" ? { type: "death", execution: "instant" } : null,
      list: () => [{ type: "death", execution: "instant" }]
    },
    ui: { effectEditor: { create: () => ({}) } }
  }
});

const { createPublicApi } = await import("../scripts/api/public-api.js");

test("public API exposes definition, editor, persistence, and active runtime contracts", () => {
  const api = createPublicApi();
  assert.equal(api.version, "0.1.0");
  assert.equal(api.moduleVersion, "0.1.49");
  assert.equal(api.schemaVersion, 2);
  assert.equal(api.controllerSchemaVersion, 2);
  assert.equal(typeof api.definitions.create, "function");
  assert.equal(typeof api.definitions.validate, "function");
  assert.equal(typeof api.definitions.createSavePolicy, "function");
  assert.equal(typeof api.definitions.resolveSavePolicy, "function");
  assert.deepEqual(api.catalogs.saveExecutionModes(), ["automatic", "player", "gm"]);
  assert.deepEqual(api.catalogs.saveVisibilityModes(), ["public", "gmOnly"]);
  assert.deepEqual(api.catalogs.identificationStates(), ["hidden", "suspected", "identified"]);
  assert.deepEqual(api.catalogs.healingRestrictionModes(), ["none", "all", "affliction-damage"]);
  assert.deepEqual(api.catalogs.afflictionCapabilities(), ["speak"]);
  assert.deepEqual(api.catalogs.stageEffectPersistenceModes(), ["stage", "affliction", "permanent"]);
  assert.equal(typeof api.definitions.createRestrictions, "function");
  assert.equal(typeof api.definitions.normalizeRestrictions, "function");
  assert.equal(typeof api.definitions.resolveRestrictions, "function");
  assert.equal(typeof api.restrictions.forActor, "function");
  assert.equal(typeof api.restrictions.forController, "function");
  assert.equal(typeof api.restrictions.isCapabilityBlocked, "function");
  assert.equal(typeof api.documents.buildTemplateSource, "function");
  assert.equal(typeof api.templates.create, "function");
  assert.equal(typeof api.templates.update, "function");
  assert.equal(typeof api.templates.clone, "function");
  assert.equal(typeof api.templates.list, "function");
  assert.equal(typeof api.libraries.register, "function");
  assert.equal(typeof api.libraries.list, "function");
  assert.equal(typeof api.libraries.search, "function");
  assert.equal(typeof api.libraries.setEnabled, "function");
  assert.equal(typeof api.providers.register, "function");
  assert.equal(typeof api.providers.list, "function");
  assert.equal(api.references.schemaVersion, 1);
  assert.equal(typeof api.references.create, "function");
  assert.equal(typeof api.references.createInjuryPoison, "function");
  assert.equal(typeof api.references.consumeInjuryPoisonCharge, "function");
  assert.equal(typeof api.references.list, "function");
  assert.equal(typeof api.references.addToSource, "function");
  assert.equal(typeof api.references.toText, "function");
  assert.deepEqual(api.catalogs.referenceTriggers(), ["manual", "on-use", "on-hit", "on-damage", "failed-save", "critical-failure", "custom"]);
  assert.deepEqual(api.catalogs.referenceApplicationModes(), ["manual", "prompt", "automatic"]);
  assert.deepEqual(api.catalogs.referenceDeliveryTypes(), ["injury-poison"]);
  assert.deepEqual(api.catalogs.referenceHostItemTypes(), ["melee", "weapon", "action", "feat", "spell"]);
  assert.equal(api.references.isHostItem({ type: "melee" }), true);
  assert.equal(api.references.hostDefaults({ type: "melee" }).trigger, "on-hit");
  assert.equal(typeof api.application.apply, "function");
  assert.equal(typeof api.application.applyReference, "function");
  assert.equal(typeof api.application.applyItemReference, "function");
  assert.equal(typeof api.application.createDragData, "function");
  assert.equal(typeof api.application.parseDropData, "function");
  assert.equal(typeof api.controllers.createState, "function");
  assert.equal(api.integration.criticalForge.compatibility().effectEditorAvailable, true);
  assert.equal(api.integration.criticalForge.compatibility().effectExecutionApiAvailable, true);
  assert.equal(api.integration.criticalForge.compatibility().deathComponentAvailable, true);
  assert.equal(typeof api.ui.afflictionEditor.create, "function");
  assert.equal(typeof api.ui.afflictionEditor.createSession, "function");
  assert.equal(typeof api.ui.afflictionEditor.prepareContext, "function");
  assert.deepEqual(api.ui.afflictionEditor.modes, ["create", "edit", "view"]);
  assert.equal(typeof api.ui.forge.open, "function");
  assert.equal(typeof api.ui.controller.open, "function");
  assert.equal(typeof api.instances.apply, "function");
  assert.equal(typeof api.engine.apply, "function");
  assert.equal(typeof api.engine.applyDefinition, "function");
  assert.equal(typeof api.engine.applyTemplate, "function");
  assert.equal(typeof api.engine.process, "function");
  assert.equal(typeof api.engine.processInitial, "function");
  assert.equal(typeof api.engine.combineDegrees, "function");
  assert.equal(typeof api.scheduler.processDue, "function");
  assert.equal(typeof api.scheduler.status, "function");
  assert.equal(typeof api.scheduler.isAuthoritative, "function");
  assert.equal(typeof api.instances.applyDefinition, "function");
  assert.equal(typeof api.instances.applyTemplate, "function");
  assert.equal(typeof api.instances.presentation, "function");
  assert.equal(typeof api.instances.events, "function");
  assert.equal(typeof api.instances.listAll, "function");
  assert.equal(typeof api.instances.setStage, "function");
  assert.equal(typeof api.instances.reapplyStage, "function");
  assert.equal(typeof api.instances.executeStageInstant, "function");
  assert.equal(typeof api.instances.setIdentification, "function");
  assert.equal(typeof api.instances.pause, "function");
  assert.equal(typeof api.instances.resume, "function");
  assert.equal(typeof api.instances.end, "function");
  assert.equal(typeof api.instances.reconcile, "function");
  assert.equal(typeof api.instances.reconcileActor, "function");
  assert.equal(typeof api.instances.reconcileAll, "function");
});

test("stage Effect Definitions are validated through Critical Forge when available", () => {
  const api = createPublicApi();
  const definition = api.definitions.create({
    name: "Effect validation probe",
    stages: [{
      ...api.definitions.createStage({ number: 1 }),
      effect: {
        schemaVersion: 2,
        id: "probe.effect",
        name: "Probe",
        duration: { value: -1, unit: "unlimited", expiry: null },
        components: [],
        application: {},
        metadata: {}
      }
    }]
  });
  assert.equal(api.definitions.validate(definition).valid, true);
});
