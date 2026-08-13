import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const { modules } = installFoundryMock();
modules.set("pf2e-critical-forge", {
  active: true,
  version: "1.0.1-rc.1",
  api: {
    version: "0.9.4",
    moduleVersion: "1.0.1-rc.1",
    schemaVersion: 2,
    effects: { validate: () => ({ valid: true, issues: [], errors: [] }) },
    ui: { effectEditor: { create: () => ({}) } }
  }
});

const { createPublicApi } = await import("../scripts/api/public-api.js");

test("public API exposes the versioned data contract and embedded editor contract without runtime promises", () => {
  const api = createPublicApi();
  assert.equal(api.version, "0.1.10");
  assert.equal(api.schemaVersion, 1);
  assert.equal(typeof api.definitions.create, "function");
  assert.equal(typeof api.definitions.validate, "function");
  assert.equal(typeof api.documents.buildTemplateSource, "function");
  assert.equal(typeof api.templates.create, "function");
  assert.equal(typeof api.templates.update, "function");
  assert.equal(typeof api.templates.clone, "function");
  assert.equal(typeof api.templates.list, "function");
  assert.equal(typeof api.controllers.createState, "function");
  assert.equal(api.integration.criticalForge.compatibility().effectEditorAvailable, true);
  assert.equal(typeof api.ui.afflictionEditor.create, "function");
  assert.equal(typeof api.ui.afflictionEditor.createSession, "function");
  assert.equal(typeof api.ui.afflictionEditor.prepareContext, "function");
  assert.deepEqual(api.ui.afflictionEditor.modes, ["create", "edit", "view"]);
  assert.equal(typeof api.ui.forge.open, "function");
  assert.equal("instances" in api, false);
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
