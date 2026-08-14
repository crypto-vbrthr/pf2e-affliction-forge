import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const integration = readFileSync(join(root, "scripts/affliction/integration/affliction-external-integration.js"), "utf8");
const main = readFileSync(join(root, "scripts/main.js"), "utf8");
const host = readFileSync(join(root, "scripts/affliction/forge/affliction-forge-app.js"), "utf8");
const template = readFileSync(join(root, "templates/affliction-forge/affliction-forge-app.hbs"), "utf8");

test("custom Affliction text references are enriched into draggable links", () => {
  assert.match(integration, /CONFIG\?\.TextEditor\?\.enrichers/);
  assert.match(integration, /@Affliction\\\[/);
  assert.match(integration, /pf2e-affliction-reference-link/);
  assert.match(integration, /draggable = true/);
  assert.match(integration, /createDragData/);
  assert.match(main, /initializeAfflictionTextIntegration\(\)/);
});

test("actor-sheet Item drops transform templates into engine-managed controller applications", () => {
  assert.match(integration, /preCreateItem/);
  assert.match(integration, /isAfflictionTemplate\(document\)/);
  assert.match(integration, /return false/);
  assert.match(integration, /engine\?\.applyDefinition/);
  assert.match(integration, /drag-drop-actor-sheet/);
});

test("custom Affliction drops and ordinary Item drops are supported on Actor sheets and canvas tokens", () => {
  assert.match(integration, /dropActorSheetData/);
  assert.match(integration, /dropCanvasData/);
  assert.match(integration, /data\?\.type !== "Affliction"/);
  assert.match(integration, /data\?\.type !== "Item"/);
  assert.match(integration, /tokenAtCanvasPoint/);
  assert.match(main, /initializeAfflictionExternalRuntimeIntegration\(\)/);
});

test("Affliction Forge library templates themselves are draggable", () => {
  assert.match(template, /data-affliction-template-uuid/);
  assert.match(template, /draggable="true"/);
  assert.match(host, /#bindTemplateDrag/);
  assert.match(host, /application\.createDragData/);
});
