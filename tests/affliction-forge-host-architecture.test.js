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
const css = readFileSync(join(root, "styles/affliction-forge.css"), "utf8");

test("official Affliction Forge host mounts the public Embedded Affliction Editor", () => {
  assert.match(hostTemplate, /data-affliction-forge-editor-host/);
  assert.match(hostSource, /api\.ui\.afflictionEditor\.create/);
  assert.match(hostSource, /this\.editor\.mount\(host\)/);
  assert.doesNotMatch(hostSource, /createEmbeddedDocuments|applyActor/);
});

test("host owns template persistence while embedded editor remains persistence-neutral", () => {
  for (const action of ["newDraft", "saveTemplate", "saveAsTemplate", "validateDraft", "copyDefinition", "closeWindow"]) {
    assert.match(hostTemplate, new RegExp(`data-action="${action}"`));
  }
  assert.match(hostSource, /this\.#api\(\)\.templates\.create/);
  assert.match(hostSource, /this\.#api\(\)\.templates\.update/);
  assert.match(hostSource, /this\.#api\(\)\.templates\.clone/);
});

test("host exposes a searchable template library beside the embedded editor", () => {
  assert.match(hostTemplate, /affliction-forge-library/);
  assert.match(hostTemplate, /data-affliction-library-filter/);
  assert.match(hostTemplate, /data-action="openTemplate"/);
  assert.match(hostTemplate, /data-action="copyTemplateToWorld"/);
  assert.match(hostSource, /libraries\.search\(\)/);
  assert.match(hostTemplate, /data-affliction-library-source/);
  assert.match(css, /\.affliction-forge-workspace[\s\S]*grid-template-columns/);
});

test("library rows expand for provider metadata instead of inheriting Foundry button height", () => {
  assert.match(css, /\.affliction-forge-template-row[\s\S]*min-height:\s*3\.75rem/);
  assert.match(css, /\.affliction-forge-template-open[\s\S]*min-height:\s*3\.75rem/);
  assert.match(css, /\.affliction-forge-template-open[\s\S]*height:\s*auto/);
  assert.match(css, /\.affliction-forge-template-open[\s\S]*max-height:\s*none/);
});



test("library rows expose content source work and page separately from provider/library labels", () => {
  assert.match(hostTemplate, /template\.sourceDetailLabel/);
  assert.match(hostTemplate, /affliction-forge-template-source-detail/);
  assert.match(hostSource, /entry\.contentSourceLabel/);
  assert.match(hostSource, /entry\.contentSourcePage/);
  assert.match(hostSource, /PF2E_AFFLICTION_FORGE\.Forge\.SourcePageShort/);
  assert.match(hostSource, /providerDetailLabel/);
});

test("Items sidebar integration covers legacy and ApplicationV2 render hooks plus template sheet editing", () => {
  assert.match(integrationSource, /Hooks\.on\("renderItemDirectory"/);
  assert.match(integrationSource, /Hooks\.on\("renderSidebarTab"/);
  assert.match(integrationSource, /Hooks\.on\("getHeaderControlsApplicationV2"/);
  assert.match(integrationSource, /Hooks\.on\("getItemSheetHeaderButtons"/);
  assert.match(integrationSource, /data-\$\{MODULE_ID\}-button/);
  assert.match(integrationSource, /openAfflictionForge/);
  assert.match(integrationSource, /templateUuid: item\.uuid/);
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

test("host constrains the ApplicationV2 height chain and gives library/editor separate scroll contexts", () => {
  assert.match(css, /\.pf2e-affliction-forge\.affliction-forge-app \.window-content[\s\S]*height:\s*100%/);
  assert.match(css, /\.affliction-forge-editor-frame[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.affliction-forge-library-list[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(hostSource, /tag:\s*"form"/);
  assert.match(hostSource, /refreshValidation\?\.\(\{ scrollIntoView: false \}\)/);
});


test("Save As DialogV2 content uses a plain outer div and a styled inner wrapper", () => {
  assert.match(hostSource, /const root = document\.createElement\("div"\);[\s\S]*const wrapper = document\.createElement\("div"\);/);
  assert.match(hostSource, /wrapper\.className = "affliction-forge-save-as-dialog"/);
  assert.match(hostSource, /wrapper\.append\(nameLabel, destinationLabel\);[\s\S]*root\.append\(wrapper\);/);
  assert.doesNotMatch(hostSource, /root\.className = "affliction-forge-save-as-dialog"/);
});


test("template deletion removes stale library state and never resurrects the deleted template as a dirty draft", () => {
  assert.match(integrationSource, /Hooks\.on\("deleteItem", handleAfflictionTemplateDeleted\)/);
  assert.match(integrationSource, /api\?\.documents\?\.isTemplate\?\.\(item\)/);
  assert.match(integrationSource, /app\.handleTemplateDeleted\(item\)/);
  assert.match(hostSource, /async handleTemplateDeleted\(document\)/);
  assert.match(hostSource, /this\.library = this\.library\.filter\(\(entry\) => entry\.uuid !== uuid\)/);
  assert.match(hostSource, /this\.#invalidateLibrary\(\)/);
  assert.match(hostSource, /this\.currentTemplate\?\.uuid === uuid/);
  assert.match(hostSource, /setData\?\.\(createDraftDefinition\(\), \{ mode: "create", rerender: false \}\)/);
  assert.match(hostSource, /this\.editor\?\.markClean\?\.\(\)/);
  assert.doesNotMatch(hostSource, /preservedDefinition/);
  assert.doesNotMatch(hostSource, /session\?\.markDirty/);
  assert.match(hostSource, /this\.element\.isConnected/);
  assert.match(hostSource, /await this\.render\(\{ force: true \}\)/);
});
