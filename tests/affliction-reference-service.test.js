import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();

const {
  addAfflictionReferenceToSource,
  afflictionReferenceText,
  createAfflictionReference,
  readAfflictionReferences,
  removeAfflictionReferenceFromSource,
  validateAfflictionReference,
  withAfflictionReferences
} = await import("../scripts/affliction/integration/affliction-reference-service.js");

test("ability references are normalized into a stable public contract", () => {
  const reference = createAfflictionReference({
    templateUuid: "Compendium.afflictions.poisons.Item.arsenic",
    label: "Arsen",
    trigger: "on-hit",
    application: "prompt"
  });
  assert.equal(reference.schemaVersion, 1);
  assert.match(reference.id, /^affliction-ref/);
  assert.equal(reference.templateUuid, "Compendium.afflictions.poisons.Item.arsenic");
  assert.equal(reference.trigger, "on-hit");
  assert.equal(reference.application, "prompt");
  assert.equal(reference.enabled, true);
  assert.equal(validateAfflictionReference(reference).valid, true);
});

test("references can be embedded in arbitrary Item source flags without marking the source as a managed Affliction document", () => {
  const base = { name: "Venomous Bite", type: "action", flags: { existing: { keep: true } } };
  const withReference = addAfflictionReferenceToSource(base, {
    id: "venom",
    templateUuid: "Item.poison",
    trigger: "on-hit",
    application: "automatic"
  });
  assert.equal(withReference.flags.existing.keep, true);
  assert.equal(withReference.flags["pf2e-affliction-forge"].managed, undefined);
  assert.equal(readAfflictionReferences(withReference)[0].id, "venom");

  const removed = removeAfflictionReferenceFromSource(withReference, "venom");
  assert.deepEqual(readAfflictionReferences(removed), []);
});

test("reference collections round-trip and produce draggable description syntax", () => {
  const source = withAfflictionReferences({}, [{
    id: "curse",
    templateUuid: "Compendium.curses.Item.moon",
    label: "Mondfluch"
  }]);
  assert.equal(readAfflictionReferences(source).length, 1);
  assert.equal(
    afflictionReferenceText(readAfflictionReferences(source)[0]),
    "@Affliction[Compendium.curses.Item.moon]{Mondfluch}"
  );
  assert.equal(
    afflictionReferenceText("Compendium.curses.Item.moon", { label: "Mondfluch", syntax: "uuid" }),
    "@UUID[Compendium.curses.Item.moon]{Mondfluch}"
  );
});
