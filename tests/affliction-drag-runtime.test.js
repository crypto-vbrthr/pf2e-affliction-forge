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

test("custom Affliction drag payload can be dropped directly on an Actor Directory entry", async () => {
  const calls = [];
  const { AFFLICTION_DRAG_MIME } = await import("../scripts/constants.js");
  const { installAfflictionActorDirectoryDropTargets } = await import("../scripts/affliction/integration/affliction-external-integration.js");
  modules.set("pf2e-affliction-forge", {
    api: {
      application: {
        parseDropData: (data) => data?.type === "Affliction" && data?.source === "pf2e-affliction-forge"
          ? { templateUuid: data.templateUuid, label: data.label ?? null, sourceUuid: null, referenceId: null }
          : null,
        applyDropData: async (...args) => calls.push(args)
      }
    }
  });

  const actor = { documentName: "Actor", uuid: "Actor.hero", id: "hero", name: "Hero" };
  game.actors = new Map([["hero", actor]]);
  const listeners = new Map();
  const rowClasses = new Set();
  const row = {
    dataset: { entryId: "hero" },
    classList: {
      add: (value) => rowClasses.add(value),
      remove: (value) => rowClasses.delete(value)
    },
    contains: () => false
  };
  const root = {
    dataset: {},
    querySelectorAll: (selector) => selector === ".pf2e-affliction-actor-drop-target" && rowClasses.has("pf2e-affliction-actor-drop-target") ? [row] : [],
    querySelector: () => null,
    matches: (selector) => selector.includes("#actors"),
    contains: (candidate) => candidate === row,
    addEventListener: (type, callback) => listeners.set(type, callback)
  };
  const target = { closest: () => row };
  const payload = { type: "Affliction", source: "pf2e-affliction-forge", templateUuid: "Item.venom", label: "Venom" };
  const json = JSON.stringify(payload);
  const transfer = {
    types: [AFFLICTION_DRAG_MIME, "text/plain"],
    getData: (type) => type === AFFLICTION_DRAG_MIME || type === "text/plain" ? json : "",
    dropEffect: "none"
  };
  let prevented = 0;
  const baseEvent = {
    target,
    relatedTarget: null,
    dataTransfer: transfer,
    preventDefault: () => prevented++,
    stopPropagation: () => {},
    stopImmediatePropagation: () => {}
  };

  assert.equal(installAfflictionActorDirectoryDropTargets({ documentName: "Actor", tabName: "actors" }, root), true);
  listeners.get("dragover")?.(baseEvent);
  assert.equal(transfer.dropEffect, "copy");
  assert.equal(rowClasses.has("pf2e-affliction-actor-drop-target"), true);

  listeners.get("drop")?.(baseEvent);
  await nextTurn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], actor);
  assert.equal(calls[0][2].application, "drag-drop-actor-directory");
  assert.equal(prevented >= 2, true);
});
