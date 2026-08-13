import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const { modules } = installFoundryMock();
modules.set("pf2e-critical-forge", {
  active: true,
  api: { effects: { validate: () => ({ valid: true, issues: [], errors: [] }) } }
});

globalThis.game.user = { isGM: true };
globalThis.game.i18n = {
  lang: "en",
  localize: (key) => ({
    "PF2E_AFFLICTION_FORGE.Forge.WorldItems": "Item Library",
    "PF2E_AFFLICTION_FORGE.Forge.CopySuffix": "Copy",
    "PF2E_AFFLICTION_FORGE.Editor.Stage": "Stage"
  })[key] ?? key
};
globalThis.game.items = [];

class PackList extends Array {
  get(collection) { return this.find((pack) => pack.collection === collection); }
}
globalThis.game.packs = new PackList();

let nextId = 0;
const documents = new Map();
class FakeItem {
  constructor(source, { pack = null } = {}) {
    this.id = `item${++nextId}`;
    this.documentName = "Item";
    this.pack = pack;
    Object.assign(this, structuredClone(source));
    this.uuid = pack ? `Compendium.${pack}.Item.${this.id}` : `Item.${this.id}`;
    documents.set(this.uuid, this);
  }
  toObject() {
    return structuredClone({
      _id: this.id,
      name: this.name,
      type: this.type,
      img: this.img,
      system: this.system,
      flags: this.flags
    });
  }
  canUserModify() { return true; }
  async update(data) {
    for (const [key, value] of Object.entries(data)) this[key] = structuredClone(value);
    return this;
  }
}

globalThis.Item = {
  implementation: {
    async create(source, operation = {}) {
      const item = new FakeItem(source, { pack: operation.pack ?? null });
      if (!operation.pack) game.items.push(item);
      return item;
    }
  }
};
globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

const { createPublicApi } = await import("../scripts/api/public-api.js");

function effectDefinition(id = "probe.stage-1.effect") {
  return {
    schemaVersion: 2,
    id,
    name: "Stage effect",
    duration: { value: -1, unit: "unlimited", expiry: null },
    components: [],
    application: {},
    metadata: {}
  };
}

test("template service creates and updates a persistent world Item without changing its UUID", async () => {
  const api = createPublicApi();
  const definition = api.definitions.create({
    name: "Ash Fever",
    stages: [{ ...api.definitions.createStage({ number: 1 }), effect: effectDefinition() }]
  });

  const item = await api.templates.create(definition);
  assert.equal(item.type, "effect");
  assert.equal(item.system.rules.length, 0);
  assert.equal(item.flags["pf2e-affliction-forge"].documentKind, "affliction-template");
  assert.equal(item.flags["pf2e-affliction-forge"].definitionVersion, 1);
  const uuid = item.uuid;

  const edited = api.documents.readDefinition(item);
  edited.name = "Ash Fever Revised";
  const updated = await api.templates.update(item, edited);
  assert.equal(updated.uuid, uuid);
  assert.equal(updated.name, "Ash Fever Revised");
  assert.equal(updated.flags["pf2e-affliction-forge"].definitionVersion, 2);
});

test("cloning a template creates a new definition identity and records its source UUID", async () => {
  const api = createPublicApi();
  const original = api.definitions.create({
    name: "Ghoul Rot",
    stages: [{ ...api.definitions.createStage({ number: 1 }), effect: effectDefinition("old.effect") }]
  });
  const item = await api.templates.create(original);
  const clone = await api.templates.clone(item, { name: "Royal Ghoul Rot" });
  const clonedDefinition = api.documents.readDefinition(clone);

  assert.notEqual(clone.uuid, item.uuid);
  assert.notEqual(clonedDefinition.id, original.id);
  assert.equal(clonedDefinition.name, "Royal Ghoul Rot");
  assert.equal(clone.flags["pf2e-affliction-forge"].copiedFromUuid, item.uuid);
  assert.equal(clonedDefinition.stages[0].effect.id, `${clonedDefinition.id}.stage-1.effect`);
});

test("template library discovers world and protected compendium templates", async () => {
  const api = createPublicApi();
  const world = await api.templates.create(api.definitions.create({ name: "World Poison" }));
  const packedDefinition = api.definitions.create({ name: "Pack Curse" });
  const packedSource = api.documents.buildTemplateSource(packedDefinition);
  const pack = {
    documentName: "Item",
    visible: true,
    locked: true,
    collection: "addon.afflictions",
    title: "Addon Afflictions",
    async getIndex() {
      return [{ _id: "curse1", name: packedSource.name, img: packedSource.img, type: packedSource.type, flags: packedSource.flags }];
    },
    getUuid(id) { return `Compendium.${this.collection}.Item.${id}`; }
  };
  game.packs.push(pack);

  const entries = await api.templates.list();
  const worldEntry = entries.find((entry) => entry.uuid === world.uuid);
  const packEntry = entries.find((entry) => entry.uuid === "Compendium.addon.afflictions.Item.curse1");
  assert.equal(worldEntry.world, true);
  assert.equal(worldEntry.writable, true);
  assert.equal(packEntry.world, false);
  assert.equal(packEntry.locked, true);
  assert.equal(packEntry.writable, false);
});
