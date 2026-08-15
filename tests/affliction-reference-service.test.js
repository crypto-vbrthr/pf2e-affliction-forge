import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";
import { MODULE_ID } from "../scripts/constants.js";

installFoundryMock();

const {
  addAfflictionReferenceToSource,
  afflictionReferenceText,
  afflictionReferenceHostDefaults,
  createAfflictionReference,
  isAfflictionReferenceHostItem,
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


test("attack and ability host defaults are stable and conservative", () => {
  assert.equal(isAfflictionReferenceHostItem({ type: "melee" }), true);
  assert.equal(isAfflictionReferenceHostItem({ type: "weapon" }), true);
  assert.equal(isAfflictionReferenceHostItem({ type: "action" }), true);
  assert.equal(isAfflictionReferenceHostItem({ type: "feat" }), true);
  assert.equal(isAfflictionReferenceHostItem({ type: "spell" }), true);
  assert.equal(isAfflictionReferenceHostItem({ type: "effect" }), false);

  assert.deepEqual(afflictionReferenceHostDefaults({ type: "melee" }), {
    eligible: true,
    itemType: "melee",
    trigger: "on-hit",
    application: "prompt"
  });
  assert.equal(afflictionReferenceHostDefaults({ type: "spell" }).trigger, "on-use");
  assert.equal(afflictionReferenceHostDefaults({ type: "effect" }).eligible, false);
});

test("injury-poison references carry consumable charges while preserving reference schema 1", async () => {
  const {
    createInjuryPoisonReference,
    injuryPoisonCharges,
    isInjuryPoisonHostItem,
    isInjuryPoisonReference
  } = await import("../scripts/affliction/integration/affliction-reference-service.js");

  const reference = createInjuryPoisonReference({
    templateUuid: "Item.viperVenom",
    label: "Viper Venom",
    charges: 3,
    trigger: "on-hit",
    application: "prompt"
  });
  assert.equal(reference.schemaVersion, 1);
  assert.equal(reference.trigger, "on-damage");
  assert.equal(reference.application, "automatic");
  assert.deepEqual(reference.delivery, { type: "injury-poison", charges: 3 });
  assert.equal(isInjuryPoisonReference(reference), true);
  assert.equal(injuryPoisonCharges(reference), 3);
  assert.equal(isInjuryPoisonHostItem({ type: "weapon" }), true);
  assert.equal(isInjuryPoisonHostItem({ type: "melee" }), true);
  assert.equal(isInjuryPoisonHostItem({ type: "spell" }), false);
});

test("injury-poison charge consumption decrements and removes the exhausted attachment", async () => {
  const {
    consumeInjuryPoisonCharge,
    createInjuryPoisonReference,
    readAfflictionReferences
  } = await import("../scripts/affliction/integration/affliction-reference-service.js");

  const state = {
    flags: {
      [MODULE_ID]: {
        afflictionReferences: [createInjuryPoisonReference({
          id: "coating",
          templateUuid: "Item.poison",
          charges: 2
        })]
      }
    }
  };
  const item = {
    type: "weapon",
    toObject: () => structuredClone(state),
    update: async (changes) => {
      state.flags[MODULE_ID].afflictionReferences = structuredClone(changes[`flags.${MODULE_ID}.afflictionReferences`]);
    }
  };

  const first = await consumeInjuryPoisonCharge(item, "coating");
  assert.deepEqual({ before: first.before, after: first.after, depleted: first.depleted }, { before: 2, after: 1, depleted: false });
  assert.equal(readAfflictionReferences(item)[0].delivery.charges, 1);

  const second = await consumeInjuryPoisonCharge(item, "coating");
  assert.deepEqual({ before: second.before, after: second.after, depleted: second.depleted }, { before: 1, after: 0, depleted: true });
  assert.deepEqual(readAfflictionReferences(item), []);
});

test("adding a second injury poison replaces the previous coating but preserves unrelated references", async () => {
  const {
    addAfflictionReferenceToSource,
    createAfflictionReference,
    createInjuryPoisonReference,
    readAfflictionReferences
  } = await import("../scripts/affliction/integration/affliction-reference-service.js");

  let source = {
    type: "weapon",
    flags: {
      [MODULE_ID]: {
        afflictionReferences: [
          createAfflictionReference({ id: "curse", templateUuid: "Item.curse", trigger: "on-hit", application: "prompt" }),
          createInjuryPoisonReference({ id: "old-poison", templateUuid: "Item.oldPoison", charges: 2 })
        ]
      }
    }
  };
  source = addAfflictionReferenceToSource(source, createInjuryPoisonReference({ id: "new-poison", templateUuid: "Item.newPoison", charges: 1 }));
  const references = readAfflictionReferences(source);
  assert.equal(references.length, 2);
  assert.equal(references.some((entry) => entry.id === "curse"), true);
  assert.equal(references.some((entry) => entry.id === "old-poison"), false);
  assert.equal(references.some((entry) => entry.id === "new-poison"), true);
});
