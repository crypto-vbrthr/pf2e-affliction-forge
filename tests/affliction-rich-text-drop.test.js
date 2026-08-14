import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

const { modules } = installFoundryMock();
const { AFFLICTION_DRAG_MIME } = await import("../scripts/constants.js");
const {
  afflictionTextFromDragData,
  handleAfflictionProseMirrorDrop,
  installAfflictionProseMirrorDropPlugin,
  handleProseMirrorPluginsEvent
} = await import("../scripts/affliction/integration/affliction-rich-text-drop.js");
const { writeDragData } = await import("../scripts/affliction/integration/affliction-external-integration.js");

const payload = {
  type: "Affliction",
  source: "pf2e-affliction-forge",
  templateUuid: "Compendium.test.afflictions.Item.venom",
  label: "Smaragdvipergift"
};

function installApi() {
  modules.set("pf2e-affliction-forge", {
    api: {
      references: {
        toText: (uuid, { label } = {}) => `@Affliction[${uuid}]${label ? `{${label}}` : ""}`
      },
      application: {
        parseDropData: (data) => data?.type === "Affliction" && data?.source === "pf2e-affliction-forge"
          ? { templateUuid: data.templateUuid, label: data.label ?? null }
          : null
      }
    }
  });
}

function dragEvent() {
  const json = JSON.stringify(payload);
  let prevented = false;
  let stopped = false;
  return {
    clientX: 12,
    clientY: 34,
    dataTransfer: {
      types: [AFFLICTION_DRAG_MIME],
      getData: (type) => type === AFFLICTION_DRAG_MIME ? json : ""
    },
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
    get prevented() { return prevented; },
    get stopped() { return stopped; }
  };
}

test("drag data becomes canonical @Affliction syntax", () => {
  installApi();
  assert.equal(
    afflictionTextFromDragData({ templateUuid: payload.templateUuid, label: payload.label }),
    `@Affliction[${payload.templateUuid}]{${payload.label}}`
  );
});

test("ProseMirror drop inserts the reference at drop coordinates through a transaction", () => {
  installApi();
  const event = dragEvent();
  const calls = [];
  const transaction = {
    insertText: (text, from, to) => {
      calls.push({ text, from, to });
      return transaction;
    }
  };
  let dispatched = null;
  let focused = false;
  const view = {
    state: { tr: transaction, selection: { from: 3 } },
    posAtCoords: ({ left, top }) => left === 12 && top === 34 ? { pos: 9 } : null,
    dispatch: (value) => { dispatched = value; },
    focus: () => { focused = true; }
  };

  assert.equal(handleAfflictionProseMirrorDrop(view, event), true);
  assert.deepEqual(calls, [{
    text: `@Affliction[${payload.templateUuid}]{${payload.label}}`,
    from: 9,
    to: 9
  }]);
  assert.equal(dispatched, transaction);
  assert.equal(focused, true);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
});

test("createProseMirrorEditor integration installs a plugin that delegates Affliction drops", () => {
  installApi();
  class Plugin {
    constructor(spec) { this.spec = spec; this.key = {}; }
    getState() { return null; }
  }
  const plugins = { base: new Plugin({}) };
  assert.equal(installAfflictionProseMirrorDropPlugin("editor.test", plugins), true);
  assert.equal(plugins.afflictionForgeDrop instanceof Plugin, true);
  assert.equal(typeof plugins.afflictionForgeDrop.spec.props.handleDrop, "function");
});

test("native world Item drag is recognized as rich-text Affliction drop when the Item is a template", async () => {
  installApi();
  const { readRichTextAfflictionDragData } = await import("../scripts/affliction/integration/affliction-rich-text-drop.js");
  const template = { name: "World Poison" };
  modules.get("pf2e-affliction-forge").api.documents = {
    isTemplate: (document) => document === template
  };
  globalThis.foundry = {
    applications: { ux: { TextEditor: { implementation: { getDragEventData: () => ({ type: "Item", uuid: "Item.worldPoison" }) } } } },
    utils: { fromUuidSync: (uuid) => uuid === "Item.worldPoison" ? template : null }
  };

  const parsed = readRichTextAfflictionDragData({ dataTransfer: { getData: () => "", types: [] } });
  assert.equal(parsed.templateUuid, "Item.worldPoison");
  assert.equal(parsed.label, "World Poison");
  delete globalThis.foundry;
});


test("Affliction drags advertise native Foundry Item data as text/plain while preserving custom MIME data", () => {
  installApi();
  const stored = new Map();
  const event = {
    dataTransfer: {
      effectAllowed: "",
      setData: (type, value) => stored.set(type, value)
    }
  };
  assert.equal(writeDragData(event, payload), true);
  assert.deepEqual(JSON.parse(stored.get("text/plain")), {
    type: "Item",
    uuid: payload.templateUuid
  });
  assert.equal(JSON.parse(stored.get(AFFLICTION_DRAG_MIME)).type, "Affliction");
  assert.equal(JSON.parse(stored.get(AFFLICTION_DRAG_MIME)).templateUuid, payload.templateUuid);
  assert.equal(event.dataTransfer.effectAllowed, "copy");
});

test("prose-mirror custom-element plugins event can install the Affliction drop plugin", () => {
  installApi();
  class Plugin {
    constructor(spec) { this.spec = spec; this.props = spec?.props ?? {}; this.key = {}; }
    getState() { return null; }
  }
  const plugins = { base: new Plugin({}) };
  const event = {
    target: { tagName: "PROSE-MIRROR", id: "pm.test" },
    detail: { plugins }
  };
  assert.equal(handleProseMirrorPluginsEvent(event), true);
  assert.equal(plugins.afflictionForgeDrop instanceof Plugin, true);
});

test("delegated Affliction link click opens the template in the Forge even when element-local listeners are absent", async () => {
  installApi();
  let opened = null;
  modules.get("pf2e-affliction-forge").api.ui = {
    forge: {
      async open(options) { opened = options; }
    }
  };
  globalThis.game.user = { id: "gm", isGM: true };
  const { handleAfflictionReferenceLinkClick } = await import("../scripts/affliction/integration/affliction-external-integration.js");
  const anchor = {
    dataset: { afflictionTemplateUuid: payload.templateUuid },
    closest: (selector) => selector === ".pf2e-affliction-reference-link" ? anchor : null
  };
  let prevented = false;
  let stopped = false;
  const event = {
    target: anchor,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; }
  };

  assert.equal(await handleAfflictionReferenceLinkClick(event), true);
  assert.deepEqual(opened, { templateUuid: payload.templateUuid });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});
