import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/constants.js";
import { injuryPoisonReferencesForStrikeAction } from "../scripts/affliction/integration/affliction-host-reference-ui.js";

function reference({ id, label, charges, enabled = true }) {
  return {
    schemaVersion: 1,
    id,
    templateUuid: `Compendium.test.afflictions.Item.${id}`,
    label,
    trigger: "on-damage",
    application: "automatic",
    enabled,
    delivery: { type: "injury-poison", charges },
    metadata: {}
  };
}

test("Strike poison lookup resolves the actual PF2e action Item and exposes enabled coatings with charges", () => {
  const weapon = {
    type: "weapon",
    flags: {
      [MODULE_ID]: {
        afflictionReferences: [
          reference({ id: "green", label: "Green Venom", charges: 1 }),
          reference({ id: "sleep", label: "Sleep Venom", charges: 3, enabled: false })
        ]
      }
    }
  };
  const actor = { system: { actions: [{ item: weapon }] } };

  const coatings = injuryPoisonReferencesForStrikeAction(actor, 0);
  assert.equal(coatings.length, 1);
  assert.equal(coatings[0].label, "Green Venom");
  assert.equal(coatings[0].delivery.charges, 1);
});

test("Strike poison lookup ignores invalid action indices and non-weapon Strikes", () => {
  assert.deepEqual(injuryPoisonReferencesForStrikeAction({ system: { actions: [] } }, 0), []);
  assert.deepEqual(injuryPoisonReferencesForStrikeAction({ system: { actions: [{ item: { type: "action" } }] } }, 0), []);
  assert.deepEqual(injuryPoisonReferencesForStrikeAction({ system: { actions: [] } }, "x"), []);
});
