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
    "PF2E_AFFLICTION_FORGE.Editor.Stage": "Stage",
    "PF2E_AFFLICTION_FORGE.Library.World": "World Afflictions",
    "PF2E_AFFLICTION_FORGE.Library.WorldProvider": "World",
    "PF2E_AFFLICTION_FORGE.Library.WorldHint": "World templates",
    "PF2E_AFFLICTION_FORGE.Library.CompendiumProvider": "Compendium"
  })[key] ?? key
};
const settingStore = new Map();
globalThis.game.settings = {
  get: (_module, key) => settingStore.get(key),
  set: async (_module, key, value) => { settingStore.set(key, structuredClone(value)); return value; }
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
    this.id = `libitem${++nextId}`;
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
globalThis.Hooks = { callAll: () => {} };

const providerPack = {
  documentName: "Item",
  visible: true,
  locked: false,
  collection: "undead-horrors.afflictions",
  title: "Undead Horrors",
  metadata: { packageName: "undead-horrors" },
  async getIndex() {
    return [...documents.values()]
      .filter((doc) => doc.pack === this.collection)
      .map((doc) => ({ _id: doc.id, name: doc.name, img: doc.img, type: doc.type, flags: structuredClone(doc.flags) }));
  },
  getUuid(id) { return `Compendium.${this.collection}.Item.${id}`; }
};
game.packs.push(providerPack);

const { createPublicApi } = await import("../scripts/api/public-api.js");

test("provider API turns compendium packs into named read-only libraries", async () => {
  const api = createPublicApi();
  const definition = api.definitions.create({
    name: "Ghoul Rot",
    afflictionType: "disease",
    level: 7,
    themes: ["undead", "decay"]
  });

  // Before a content provider claims the pack it behaves like a normal writable
  // compendium destination, preserving the pre-library behavior.
  const packed = await api.templates.create(definition, { pack: providerPack.collection });

  const provider = api.providers.register({
    id: "undead-horrors",
    label: "Undead Horrors",
    moduleId: "undead-horrors",
    version: "1.0.0",
    libraries: [{
      id: "undead-horrors.core",
      label: "Undead Horrors",
      packs: [providerPack.collection],
      writable: false,
      metadata: { themes: ["undead"] }
    }]
  });

  assert.equal(provider.id, "undead-horrors");
  const library = api.libraries.get("undead-horrors.core");
  assert.equal(library.writable, false);
  assert.equal(library.registered, true);
  assert.deepEqual(library.packs, [providerPack.collection]);

  const templates = await api.libraries.search({ themes: ["undead"], minLevel: 5, maxLevel: 8 });
  const entry = templates.find((candidate) => candidate.uuid === packed.uuid);
  assert.equal(entry.libraryId, "undead-horrors.core");
  assert.equal(entry.libraryLabel, "Undead Horrors");
  assert.equal(entry.providerId, "undead-horrors");
  assert.equal(entry.writable, false);
  assert.equal(entry.afflictionType, "disease");
  assert.equal(entry.level, 7);

  const edited = api.documents.readDefinition(packed);
  edited.name = "Changed Ghoul Rot";
  await assert.rejects(() => api.templates.update(packed, edited), /read-only library/i);
  assert.equal(api.templates.writableDestinations().some((destination) => destination.value === providerPack.collection), false);
});

test("library enabled state is persisted independently of provider registration", async () => {
  const api = createPublicApi();
  api.providers.register({
    id: "venoms",
    label: "Venoms & Toxins",
    moduleId: "venoms",
    libraries: [{ id: "venoms.core", label: "Venoms & Toxins", packs: [providerPack.collection], writable: false }]
  });
  assert.equal(api.libraries.isEnabled("venoms.core"), true);
  await api.libraries.setEnabled("venoms.core", false);
  assert.equal(api.libraries.isEnabled("venoms.core"), false);
});
