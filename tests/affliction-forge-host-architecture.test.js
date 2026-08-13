import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostTemplate = readFileSync(join(root, "templates/affliction-forge/affliction-forge-app.hbs"), "utf8");
const hostSource = readFileSync(join(root, "scripts/affliction/forge/affliction-forge-app.js"), "utf8");
const integrationSource = readFileSync(join(root, "scripts/affliction/forge/affliction-forge.js"), "utf8");
const mainSource = readFileSync(join(root, "scripts/main.js"), "utf8");

test("official Affliction Forge host mounts the public Embedded Affliction Editor", () => {
  assert.match(hostTemplate, /data-affliction-forge-editor-host/);
  assert.match(hostSource, /api\.ui\.afflictionEditor\.create/);
  assert.match(hostSource, /this\.editor\.mount\(host\)/);
  assert.doesNotMatch(hostSource, /buildAfflictionTemplateItemSource|createEmbeddedDocuments|game\.items\.create/);
});

test("host owns window actions while embedded editor remains persistence-neutral", () => {
  for (const action of ["newDraft", "validateDraft", "copyDefinition", "closeWindow"]) {
    assert.match(hostTemplate, new RegExp(`data-action="${action}"`));
  }
  for (const action of ["saveTemplate", "updateTemplate", "applyActor"]) {
    assert.doesNotMatch(hostTemplate, new RegExp(`data-action="${action}"`));
  }
});

test("Items sidebar integration covers legacy and ApplicationV2 render hooks", () => {
  assert.match(integrationSource, /Hooks\.on\("renderItemDirectory"/);
  assert.match(integrationSource, /Hooks\.on\("renderSidebarTab"/);
  assert.match(integrationSource, /data-\$\{MODULE_ID\}-button/);
  assert.match(integrationSource, /openAfflictionForge/);
  assert.match(mainSource, /initializeAfflictionForgeUi\(\)/);
});

test("host force-loads a cache-busted module stylesheet and applies a runtime scroll fallback", () => {
  assert.match(integrationSource, /ensureAfflictionForgeStyles/);
  assert.match(integrationSource, /affliction-forge\.css/);
  assert.match(integrationSource, /\?v=\$\{encodeURIComponent\(MODULE_VERSION\)\}/);
  assert.match(hostSource, /ResizeObserver/);
  assert.match(hostSource, /overflowY:\s*"scroll"/);
  assert.match(hostSource, /host\.scrollTop = 0/);
});

test("host constrains the ApplicationV2 height chain and owns a scrollable editor frame", () => {
  const css = readFileSync(join(root, "styles/affliction-forge.css"), "utf8");
  assert.match(css, /\.pf2e-affliction-forge\.affliction-forge-app \.window-content[\s\S]*height:\s*100%/);
  assert.match(css, /\.affliction-forge-editor-frame[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(hostSource, /tag:\s*"form"/);
  assert.match(hostSource, /refreshValidation\?\.\(\{ scrollIntoView: false \}\)/);
  assert.match(hostSource, /focusFirstField\?\.\(\)/);
});
