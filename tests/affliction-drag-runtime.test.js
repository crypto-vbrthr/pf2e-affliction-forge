import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const { modules } = installFoundryMock();
game.user = { id: "gm", isGM: true };
game.users = { activeGM: { id: "gm" } };
game.items = new Map();
game.i18n = { localize: (key) => key, format: (key, data) => `${key}:${data?.name ?? ""}` };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const { createAfflictionDefinition } = await import("../scripts/affliction/schema/affliction-defaults.js");
const { buildAfflictionTemplateItemSource } = await import("../scripts/affliction/documents/affliction-item-adapter.js");
const {
  handleAfflictionActorSheetDrop,
  handleAfflictionCanvasDrop,
  interceptEmbeddedAfflictionTemplateCreation
} = await import("../scripts/affliction/integration/affliction-external-integration.js");

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("ordinary template Item creation on an Actor is cancelled and rerouted into the Affliction Engine", async () => {
  const calls = [];
  modules.set("pf2e-affliction-forge", {
    api: {
      engine: {
        applyDefinition: async (...args) => {
          calls.push(args);
          return { created: [{ uuid: "Actor.hero.Item.controller" }] };
        }
      }
    }
  });

  const source = buildAfflictionTemplateItemSource(createAfflictionDefinition({ name: "Drop Poison" }));
  const actor = { documentName: "Actor", uuid: "Actor.hero", name: "Hero" };
  const pending = { ...source, parent: actor, id: "template", flags: source.flags };

  const result = interceptEmbeddedAfflictionTemplateCreation(pending, source, {});
  assert.equal(result, false);
  await nextTurn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], actor);
  assert.equal(calls[0][2].origin.application, "drag-drop-actor-sheet");
});

test("custom Affliction drag payload on an Actor sheet routes through application.applyDropData", async () => {
  const calls = [];
  modules.set("pf2e-affliction-forge", {
    api: {
      application: {
        parseDropData: (data) => data.type === "Affliction" ? { templateUuid: data.templateUuid, label: "Venom" } : null,
        applyDropData: async (...args) => calls.push(args)
      }
    }
  });
  const actor = { documentName: "Actor", uuid: "Actor.hero" };
  const data = { type: "Affliction", source: "pf2e-affliction-forge", templateUuid: "Item.venom" };
  assert.equal(handleAfflictionActorSheetDrop(actor, null, data), false);
  await nextTurn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], actor);
  assert.equal(calls[0][2].application, "drag-drop-actor-sheet");
});

test("canvas Item drop resolves an Affliction Template and applies it to the token under the drop point", async () => {
  const applications = [];
  const source = buildAfflictionTemplateItemSource(createAfflictionDefinition({ name: "Canvas Poison" }));
  const template = { ...source, documentName: "Item", uuid: "Item.canvasPoison", flags: source.flags };
  globalThis.fromUuid = async (uuid) => uuid === template.uuid ? template : null;
  modules.set("pf2e-affliction-forge", {
    api: {
      application: {
        parseDropData: () => null,
        apply: async (options) => applications.push(options)
      }
    }
  });
  const token = {
    bounds: { contains: (x, y) => x === 50 && y === 60 },
    actor: { name: "Target", uuid: "Actor.target" },
    document: { uuid: "Scene.test.Token.target" }
  };
  const canvas = {
    tokens: { placeables: [token] },
    scene: { uuid: "Scene.test" }
  };

  handleAfflictionCanvasDrop(canvas, { type: "Item", uuid: template.uuid, x: 50, y: 60 }, null);
  await nextTurn();
  assert.equal(applications.length, 1);
  assert.equal(applications[0].templateUuid, template.uuid);
  assert.equal(applications[0].targets, token);
  assert.equal(applications[0].application, "drag-drop-canvas");
});
