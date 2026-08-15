import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();

const { createAfflictionDefinition } = await import("../scripts/affliction/schema/affliction-defaults.js");
const {
  buildAfflictionTemplateItemSource,
  extractAfflictionDefinitionFromItem,
  inspectAfflictionItem
} = await import("../scripts/affliction/documents/affliction-item-adapter.js");

test("template adapter creates an inert PF2e effect Item with explicit forge flags", () => {
  const definition = createAfflictionDefinition({ name: "Smaragdvipergift", afflictionType: "poison", level: 5 });
  const source = buildAfflictionTemplateItemSource(definition);
  assert.equal(source.type, "effect");
  assert.deepEqual(source.system.rules, []);
  assert.equal(source.system.duration.unit, "unlimited");
  assert.equal(source.flags["pf2e-affliction-forge"].managed, true);
  assert.equal(source.flags["pf2e-affliction-forge"].documentKind, "affliction-template");
  assert.equal(source.flags["pf2e-affliction-forge"].definition.name, "Smaragdvipergift");
});

test("template definition round-trips from stored flags", () => {
  const definition = createAfflictionDefinition({ name: "Grabfäule", afflictionType: "disease", themes: ["undead"] });
  const source = buildAfflictionTemplateItemSource(definition);
  const extracted = extractAfflictionDefinitionFromItem(source);
  assert.equal(extracted.name, "Grabfäule");
  assert.deepEqual(extracted.themes, ["undead"]);
  assert.deepEqual(inspectAfflictionItem(source), {
    managed: true,
    documentKind: "affliction-template",
    definitionId: definition.id,
    instanceId: null,
    controllerUuid: null,
    stageId: null,
    stageNumber: null,
    sourceTemplateUuid: null,
    sourceDefinitionVersion: null
  });
});

test("template adapter localizes provider i18n tokens when reading definitions", () => {
  const previous = globalThis.game?.i18n;
  globalThis.game ??= {};
  globalThis.game.i18n = {
    localize: (key) => ({
      "TEST.Content.Name": "Localized Name",
      "TEST.Content.Description": "Localized Description",
      "TEST.Content.Stage": "Localized Stage"
    })[key] ?? key
  };
  const definition = createAfflictionDefinition({ name: "@i18n:TEST.Content.Name", description: "@i18n:TEST.Content.Description" });
  definition.stages[0].name = "@i18n:TEST.Content.Stage";
  const source = buildAfflictionTemplateItemSource(definition);
  const extracted = extractAfflictionDefinitionFromItem(source);
  assert.equal(extracted.name, "Localized Name");
  assert.equal(extracted.description, "Localized Description");
  assert.equal(extracted.stages[0].name, "Localized Stage");
  globalThis.game.i18n = previous;
});
