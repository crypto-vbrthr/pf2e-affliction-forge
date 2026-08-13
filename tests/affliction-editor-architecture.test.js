import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(root, "templates/affliction-forge/affliction-editor.hbs"), "utf8");
const source = readFileSync(join(root, "scripts/affliction/editor/affliction-editor.js"), "utf8");

const { modules } = installFoundryMock();
globalThis.game.i18n = { localize: (key) => key };
modules.set("pf2e-critical-forge", {
  active: true,
  api: {
    version: "0.9.4",
    moduleVersion: "1.0.1-rc.3",
    schemaVersion: 2,
    effects: { validate: () => ({ valid: true, issues: [], errors: [] }) },
    ui: { effectEditor: { create: () => ({}) } }
  }
});

const { createAfflictionDefinition } = await import("../scripts/affliction/schema/affliction-defaults.js");
const { createAfflictionEditorSession } = await import("../scripts/affliction/editor/affliction-editor-session.js");
const { prepareAfflictionEditorContext, renderAfflictionEditor } = await import("../scripts/affliction/editor/affliction-editor.js");

test("shared Affliction Editor owns editing controls but no persistence or application actions", () => {
  assert.match(template, /data-affliction-action="addStage"/);
  assert.match(template, /data-affliction-action="addCheck"/);
  assert.match(template, /data-stage-effect-host/);

  for (const action of ["save", "saveAs", "applySelected", "deleteTemplate", "createItem", "updateItem"]) {
    assert.doesNotMatch(template, new RegExp(`data-affliction-action="${action}"`));
  }
});

test("embedded Affliction Editor consumes Critical Forge's public embedded Effect Editor API", () => {
  assert.match(source, /criticalApi\.ui\.effectEditor\.create/);
  assert.doesNotMatch(source, /from\s+["'].*critical-forge\/scripts\/effect-forge/);
});

test("context preparation exposes create/edit/view state and validation without mutating definition", async () => {
  const definition = createAfflictionDefinition({ name: "Context Probe" });
  const session = createAfflictionEditorSession(definition, { mode: "edit" });
  const api = {
    definitions: {
      validate: () => ({ valid: true, issues: [], errors: [], warnings: [] })
    }
  };
  const context = await prepareAfflictionEditorContext(session, { api });
  assert.equal(context.mode, "edit");
  assert.equal(context.readOnly, false);
  assert.equal(context.stages.length, 1);
  assert.equal(context.validation.valid, true);
  assert.equal(definition.name, "Context Probe");
});

test("renderer is reusable by external host containers", async () => {
  let capturedPath = null;
  const html = await renderAfflictionEditor(
    { definition: { name: "Probe" } },
    {
      renderTemplateFn: async (path) => {
        capturedPath = path;
        return "<section>affliction editor</section>";
      }
    }
  );
  assert.match(capturedPath, /templates\/affliction-forge\/affliction-editor\.hbs$/);
  assert.equal(html, "<section>affliction editor</section>");
});

test("editable modes are not serialized as a disabled fieldset", () => {
  assert.match(template, /data-affliction-editor-fieldset/);
  assert.doesNotMatch(template, /<fieldset[^>]*\{\{#if readOnly\}\}disabled/);
  assert.match(source, /#ensureEditableState\(\)/);
  assert.match(source, /fieldset\.removeAttribute\("disabled"\)/);
  assert.match(source, /refreshValidation\(\{ scrollIntoView = false \} = \{\}\)/);
});


test("save-check references are wired for immediate label and id synchronization", () => {
  assert.match(template, /data-gate-check-option/);
  assert.match(template, /data-gate-check-label/);
  assert.match(source, /#refreshRenderedCheckReferences\(\)/);
  assert.match(source, /label\.textContent = check\.label \|\| check\.id/);
});

test("stage effect editing is compact and Affliction-owned outside component mechanics", () => {
  const css = readFileSync(join(root, "styles/affliction-forge.css"), "utf8");
  assert.match(template, /data-stage-effect-summary/);
  assert.match(template, /data-effect-component-count/);
  assert.match(source, /synchronizeManagedStageEffectMetadata/);
  assert.match(source, /host\.dataset\.afflictionEffectEditor = "components-only"/);
  assert.match(css, /effect-forge-section:not\(\.effect-forge-components-section\)/);
  assert.match(css, /display:\s*none\s*!important/);
});

test("validation presentation de-duplicates field paths", () => {
  assert.match(source, /function displayIssue\(issue\)/);
  assert.match(template, /issue\.displayMessage/);
});

test("Critical Forge Effect Definitions cross a clone boundary before Affliction metadata synchronization", () => {
  assert.match(source, /const effect = deepClone\(source\)/);
  assert.match(source, /this\.session\.setStageEffect\(index, built\)/);
  assert.doesNotMatch(source, /stage\.effect\s*=\s*built/);
});


test("embedded stage effects inherit the Critical Forge visual theme without a nested component scrollbar", () => {
  const css = readFileSync(join(root, "styles/affliction-forge.css"), "utf8");
  assert.match(css, /affliction-editor-effect-host\[data-affliction-effect-editor="components-only"\][\s\S]*--ef-field:\s*#242431/);
  assert.match(css, /--ef-panel-alt:\s*#191923/);
  assert.match(css, /--ef-purple-bright:\s*#915bd0/);
  assert.match(css, /\.effect-forge-component-list\s*\{[\s\S]*max-height:\s*none/);
  assert.match(css, /\.effect-forge-component-list\s*\{[\s\S]*overflow:\s*visible/);
});

test("embedded editor exposes saving throw execution, visibility, and identification controls", async () => {
  const definition = createAfflictionDefinition({ name: "Policy Probe" });
  const session = createAfflictionEditorSession(definition);
  const api = {
    definitions: {
      validate: () => ({ valid: true, issues: [], errors: [], warnings: [] })
    }
  };
  const context = await prepareAfflictionEditorContext(session, { api });
  assert.equal(context.saveDefaults.executionOptions.length, 3);
  assert.equal(context.saveDefaults.visibilityOptions.length, 2);
  assert.equal(context.identificationOptions.length, 3);
  assert.equal(context.checks[0].policyView.inherited, true);

  assert.match(template, /data-affliction-field="saveDefaultExecution"/);
  assert.match(template, /data-affliction-field="saveDefaultVisibility"/);
  assert.match(template, /data-check-policy-override/);
  assert.match(template, /data-affliction-field="identificationInitialState"/);
  assert.match(source, /#refreshRenderedInheritedSavePolicies/);
});
