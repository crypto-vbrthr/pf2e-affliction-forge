import { MODULE_ID } from "../../constants.js";
import { buildAfflictionTemplateItemSource, extractAfflictionDefinitionFromItem } from "./affliction-item-adapter.js";
import { getAfflictionFlags, isAfflictionTemplate } from "./affliction-flags.js";
import { normalizeAfflictionDefinition } from "../schema/affliction-normalizer.js";
import { deepClone, randomId } from "../schema/utils.js";

function requireFoundryRuntime() {
  if (!globalThis.game) throw new Error("Foundry runtime is unavailable.");
}

function documentClass() {
  const cls = globalThis.Item?.implementation ?? globalThis.CONFIG?.Item?.documentClass ?? globalThis.Item;
  if (!cls?.create) throw new Error("Foundry Item document class is unavailable.");
  return cls;
}

function normalizeCreated(result) {
  return Array.isArray(result) ? (result[0] ?? null) : (result ?? null);
}

async function resolveDocument(itemOrUuid) {
  if (itemOrUuid && typeof itemOrUuid === "object") return itemOrUuid;
  const uuid = String(itemOrUuid ?? "").trim();
  if (!uuid) throw new TypeError("An Affliction template document or UUID is required.");
  if (typeof globalThis.fromUuid !== "function") throw new Error("Foundry fromUuid() is unavailable.");
  const document = await globalThis.fromUuid(uuid);
  if (!document) throw new Error(`Affliction template not found: ${uuid}`);
  return document;
}

function packForDocument(document) {
  const collection = typeof document?.pack === "string" ? document.pack : null;
  return collection ? game.packs?.get?.(collection) ?? null : null;
}

function canUpdateDocument(document) {
  if (!game.user?.isGM || !document || !isAfflictionTemplate(document)) return false;
  const pack = packForDocument(document);
  if (pack?.locked) return false;
  if (typeof document.canUserModify === "function" && !document.canUserModify(game.user, "update")) return false;
  return true;
}

function sourceLabel(document) {
  const pack = packForDocument(document);
  return pack?.title ?? game.i18n?.localize?.("PF2E_AFFLICTION_FORGE.Forge.WorldItems") ?? "World Items";
}

function definitionMetadata(flags) {
  const definition = flags?.definition ?? {};
  const metadata = definition?.metadata && typeof definition.metadata === "object" ? definition.metadata : {};
  const sourcePage = Number(metadata.sourcePage);
  return {
    afflictionType: definition.afflictionType ?? null,
    level: Number.isFinite(Number(definition.level)) ? Number(definition.level) : null,
    rarity: definition.rarity ?? null,
    traits: Array.isArray(definition.traits) ? [...definition.traits] : [],
    themes: Array.isArray(definition.themes) ? [...definition.themes] : [],
    contentSourceWorkId: String(metadata.sourceWorkId ?? "").trim() || null,
    contentSourceLabel: String(metadata.sourceWorkLabel ?? "").trim() || null,
    contentSourcePage: Number.isFinite(sourcePage) ? sourcePage : null
  };
}

function descriptorFromDocument(document) {
  const flags = getAfflictionFlags(document) ?? {};
  const pack = packForDocument(document);
  return Object.freeze({
    uuid: document.uuid,
    id: document.id,
    name: document.name,
    img: document.img,
    pack: pack?.collection ?? null,
    sourceLabel: sourceLabel(document),
    locked: Boolean(pack?.locked),
    writable: canUpdateDocument(document),
    definitionId: flags.definitionId ?? null,
    definitionVersion: Number(flags.definitionVersion ?? 1),
    copiedFromUuid: flags.copiedFromUuid ?? null,
    world: !pack,
    ...definitionMetadata(flags)
  });
}

function descriptorFromIndexEntry(pack, entry) {
  const flags = entry?.flags?.[MODULE_ID] ?? {};
  return Object.freeze({
    uuid: pack.getUuid(entry._id),
    id: entry._id,
    name: entry.name,
    img: entry.img,
    pack: pack.collection,
    sourceLabel: pack.title,
    locked: Boolean(pack.locked),
    writable: Boolean(game.user?.isGM && !pack.locked),
    definitionId: flags.definitionId ?? null,
    definitionVersion: Number(flags.definitionVersion ?? 1),
    copiedFromUuid: flags.copiedFromUuid ?? null,
    world: false,
    ...definitionMetadata(flags)
  });
}

function itemPackCollections() {
  if (!game.packs) return [];
  return [...game.packs].filter((pack) => {
    const name = String(pack?.documentName ?? pack?.metadata?.type ?? "").toLowerCase();
    return name === "item" && pack.visible !== false;
  });
}

function cloneWithNewIdentity(definition, { name = null } = {}) {
  const copy = normalizeAfflictionDefinition(deepClone(definition));
  const previousId = copy.id;
  copy.id = randomId("pf2e-affliction-forge.custom");
  if (name != null) copy.name = String(name).trim();
  copy.metadata = {
    ...(copy.metadata ?? {}),
    clonedFromDefinitionId: previousId
  };
  for (const stage of copy.stages ?? []) {
    if (!stage.effect) continue;
    stage.effect = deepClone(stage.effect);
    stage.effect.id = `${copy.id}.${stage.id}.effect`;
    stage.effect.name = `${copy.name}${stage.name ? ` · ${stage.name}` : ` · ${game.i18n?.localize?.("PF2E_AFFLICTION_FORGE.Editor.Stage") ?? "Stage"} ${stage.number}`}`;
  }
  return copy;
}

function enrichTemplateSource(source, {
  definitionVersion = 1,
  copiedFromUuid = null,
  folder = null
} = {}) {
  const result = deepClone(source);
  result.flags ??= {};
  result.flags[MODULE_ID] ??= {};
  result.flags[MODULE_ID].definitionVersion = definitionVersion;
  if (copiedFromUuid) result.flags[MODULE_ID].copiedFromUuid = copiedFromUuid;
  else delete result.flags[MODULE_ID].copiedFromUuid;
  if (folder) result.folder = folder;
  return result;
}

function updatePayload(source) {
  const payload = deepClone(source);
  delete payload._id;
  delete payload.type;
  delete payload.folder;
  return payload;
}

export class AfflictionTemplateService {
  constructor({ effectValidator = null } = {}) {
    this.effectValidator = effectValidator;
  }

  async get(itemOrUuid) {
    const document = await resolveDocument(itemOrUuid);
    if (!isAfflictionTemplate(document)) throw new TypeError("Document is not an Affliction Forge template.");
    return document;
  }

  async read(itemOrUuid) {
    return extractAfflictionDefinitionFromItem(await this.get(itemOrUuid));
  }

  inspect(itemOrUuid) {
    if (!itemOrUuid || typeof itemOrUuid !== "object") throw new TypeError("inspect() requires a loaded Item document.");
    if (!isAfflictionTemplate(itemOrUuid)) return null;
    return descriptorFromDocument(itemOrUuid);
  }

  canUpdate(itemOrUuid) {
    if (!itemOrUuid || typeof itemOrUuid !== "object") return false;
    return canUpdateDocument(itemOrUuid);
  }

  async create(definition, {
    pack = null,
    folder = null,
    copiedFromUuid = null,
    definitionVersion = 1
  } = {}) {
    requireFoundryRuntime();
    const source = enrichTemplateSource(buildAfflictionTemplateItemSource(definition, {
      effectValidator: this.effectValidator
    }), { definitionVersion, copiedFromUuid, folder });
    const operation = pack ? { pack } : {};
    const created = normalizeCreated(await documentClass().create(source, operation));
    if (!created) throw new Error("Affliction template could not be created.");
    return created;
  }

  async update(itemOrUuid, definition) {
    const document = await this.get(itemOrUuid);
    if (!canUpdateDocument(document)) throw new Error("Affliction template is read-only and cannot be updated in place.");
    const previous = getAfflictionFlags(document) ?? {};
    const version = Math.max(1, Number(previous.definitionVersion ?? 1)) + 1;
    const source = enrichTemplateSource(buildAfflictionTemplateItemSource(definition, {
      effectValidator: this.effectValidator
    }), {
      definitionVersion: version,
      copiedFromUuid: previous.copiedFromUuid ?? null
    });
    await document.update(updatePayload(source));
    return document;
  }

  async clone(itemOrUuid, {
    definition = null,
    name = null,
    pack = null,
    folder = null
  } = {}) {
    const sourceDocument = await this.get(itemOrUuid);
    const sourceDefinition = definition ?? extractAfflictionDefinitionFromItem(sourceDocument);
    const clone = cloneWithNewIdentity(sourceDefinition, {
      name: name ?? `${sourceDefinition.name} (${game.i18n?.localize?.("PF2E_AFFLICTION_FORGE.Forge.CopySuffix") ?? "Copy"})`
    });
    return this.create(clone, {
      pack,
      folder,
      copiedFromUuid: sourceDocument.uuid,
      definitionVersion: 1
    });
  }

  async copyDefinition(definition, {
    name = null,
    pack = null,
    folder = null,
    copiedFromUuid = null,
    newIdentity = false
  } = {}) {
    const source = newIdentity ? cloneWithNewIdentity(definition, { name }) : normalizeAfflictionDefinition({
      ...deepClone(definition),
      ...(name != null ? { name: String(name).trim() } : {})
    });
    return this.create(source, { pack, folder, copiedFromUuid, definitionVersion: 1 });
  }

  async list({ includeWorld = true, includeCompendia = true } = {}) {
    requireFoundryRuntime();
    const results = [];

    if (includeWorld && game.items) {
      for (const item of game.items) {
        if (isAfflictionTemplate(item)) results.push(descriptorFromDocument(item));
      }
    }

    if (includeCompendia) {
      const packs = itemPackCollections();
      const settled = await Promise.allSettled(packs.map(async (pack) => {
        const index = await pack.getIndex({ fields: ["name", "img", "type", "flags"] });
        const entries = [];
        for (const entry of index) {
          const flags = entry?.flags?.[MODULE_ID];
          if (entry?.type === "effect" && flags?.managed === true && flags.documentKind === "affliction-template") {
            entries.push(descriptorFromIndexEntry(pack, entry));
          }
        }
        return entries;
      }));
      for (const result of settled) {
        if (result.status === "fulfilled") results.push(...result.value);
        else console.warn(`${MODULE_ID} | Failed to index an Item compendium for Affliction templates.`, result.reason);
      }
    }

    results.sort((a, b) => a.name.localeCompare(b.name, game.i18n?.lang ?? undefined, { sensitivity: "base" }) || a.sourceLabel.localeCompare(b.sourceLabel));
    return results;
  }

  writableDestinations() {
    requireFoundryRuntime();
    const destinations = [{ value: "", label: game.i18n?.localize?.("PF2E_AFFLICTION_FORGE.Forge.WorldItems") ?? "World Items" }];
    for (const pack of itemPackCollections()) {
      if (!game.user?.isGM || pack.locked) continue;
      destinations.push({ value: pack.collection, label: pack.title });
    }
    return destinations;
  }
}

export function createAfflictionTemplateService(options = {}) {
  return new AfflictionTemplateService(options);
}
