import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();
game.user = { id: "gm", isGM: true };
const hookEvents = [];
globalThis.Hooks = { callAll: (...args) => hookEvents.push(args) };

const { createAfflictionApplicationService } = await import("../scripts/affliction/integration/affliction-application-service.js");
const { addAfflictionReferenceToSource } = await import("../scripts/affliction/integration/affliction-reference-service.js");

function serviceWithSpy() {
  const calls = [];
  const engine = {
    applyTemplate: async (...args) => {
      calls.push(args);
      return { created: [{ uuid: "Actor.target.Item.controller" }], controllers: [], results: [], errors: [] };
    }
  };
  return { calls, service: createAfflictionApplicationService({ engine, templateService: {} }) };
}

test("external application API resolves a source ability reference and preserves machine-readable origin", async () => {
  const { service, calls } = serviceWithSpy();
  const source = addAfflictionReferenceToSource({
    uuid: "Actor.monster.Item.bite",
    documentName: "Item",
    parent: { uuid: "Actor.monster" }
  }, {
    id: "venom",
    templateUuid: "Compendium.afflictions.Item.venom",
    trigger: "on-hit",
    application: "automatic"
  });
  source.documentName = "Item";
  source.uuid = "Actor.monster.Item.bite";
  source.parent = { uuid: "Actor.monster" };

  const result = await service.applyItemReference(source, "venom", "Actor.target", {
    context: { attackDegree: "success" }
  });

  assert.equal(result.created.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "Compendium.afflictions.Item.venom");
  assert.equal(calls[0][1], "Actor.target");
  assert.equal(calls[0][2].origin.sourceItemUuid, "Actor.monster.Item.bite");
  assert.equal(calls[0][2].origin.referenceId, "venom");
  assert.equal(calls[0][2].origin.trigger, "on-hit");
  assert.equal(calls[0][2].origin.applicationMode, "automatic");
  assert.deepEqual(calls[0][2].origin.context, { attackDegree: "success" });
});

test("drag payload is explicit, parseable, and routes through the same engine application path", async () => {
  const { service, calls } = serviceWithSpy();
  const payload = service.createDragData("Compendium.afflictions.Item.venom", { label: "Venom" });
  assert.deepEqual(service.parseDropData(payload), {
    type: "Affliction",
    templateUuid: "Compendium.afflictions.Item.venom",
    label: "Venom",
    sourceUuid: null,
    referenceId: null
  });

  await service.applyDropData(payload, "Actor.target", { application: "drag-drop-actor-sheet" });
  assert.equal(calls[0][0], "Compendium.afflictions.Item.venom");
  assert.equal(calls[0][1], "Actor.target");
  assert.equal(calls[0][2].origin.application, "drag-drop-actor-sheet");
});
