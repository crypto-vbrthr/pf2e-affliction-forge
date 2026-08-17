import { MODULE_ID } from "../../constants.js";
import { isAfflictionTemplate } from "../documents/affliction-flags.js";
import { matchesSemanticTags, splitAfflictionThemes } from "../tags/affliction-semantic-tags.js";

export const WORLD_LIBRARY_ID = "world";
export const IMPLICIT_COMPENDIUM_PREFIX = "compendium:";
export const LIBRARY_CHANGED_HOOK = "pf2eAfflictionForgeLibrariesChanged";

function clone(value) {
  if (value == null) return value;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

function requireRuntime() {
  if (!globalThis.game) throw new Error("Foundry runtime is unavailable.");
}

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function bool(value, fallback = false) {
  return value == null ? fallback : Boolean(value);
}

function stringArray(value) {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(source.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}

function itemPacks() {
  if (!globalThis.game?.packs) return [];
  return [...game.packs].filter((pack) => {
    const name = String(pack?.documentName ?? pack?.metadata?.type ?? "").toLowerCase();
    return name === "item" && pack.visible !== false;
  });
}

function packByCollection(collection) {
  return globalThis.game?.packs?.get?.(collection)
    ?? itemPacks().find((pack) => pack.collection === collection)
    ?? null;
}

function localize(key, fallback) {
  try {
    const value = globalThis.game?.i18n?.localize?.(key);
    return value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

function readLibraryStates() {
  try {
    const value = globalThis.game?.settings?.get?.(MODULE_ID, "libraryStates");
    return value && typeof value === "object" && !Array.isArray(value) ? clone(value) : {};
  } catch {
    return {};
  }
}

async function writeLibraryStates(states) {
  if (typeof globalThis.game?.settings?.set !== "function") return false;
  await game.settings.set(MODULE_ID, "libraryStates", clone(states));
  return true;
}

function emitChanged(payload) {
  try {
    globalThis.Hooks?.callAll?.(LIBRARY_CHANGED_HOOK, clone(payload));
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to emit library change hook.`, error);
  }
}

function normalizeLibrary(input, provider) {
  if (!input || typeof input !== "object") throw new TypeError("Library registration requires an object.");
  const id = text(input.id);
  if (!id) throw new TypeError("Library id is required.");
  if (id === WORLD_LIBRARY_ID || id.startsWith(IMPLICIT_COMPENDIUM_PREFIX)) {
    throw new TypeError(`Library id is reserved: ${id}`);
  }
  const packs = stringArray(input.packs ?? provider?.packs);
  if (packs.length === 0) throw new TypeError(`Library ${id} must declare at least one Item compendium pack.`);
  return Object.freeze({
    id,
    label: text(input.label, id),
    providerId: provider.id,
    providerLabel: provider.label,
    moduleId: provider.moduleId,
    version: text(input.version, provider.version),
    packs,
    writable: bool(input.writable, false),
    enabledByDefault: bool(input.enabledByDefault, true),
    description: text(input.description),
    metadata: Object.freeze({ ...(clone(provider.metadata ?? {})), ...(clone(input.metadata ?? {})) }),
    registered: true,
    implicit: false,
    kind: "provider"
  });
}

function normalizeProvider(input) {
  if (!input || typeof input !== "object") throw new TypeError("Provider registration requires an object.");
  const id = text(input.id ?? input.moduleId);
  if (!id) throw new TypeError("Provider id is required.");
  const provider = {
    id,
    label: text(input.label, id),
    moduleId: text(input.moduleId, id),
    version: text(input.version),
    packs: stringArray(input.packs),
    metadata: Object.freeze(clone(input.metadata ?? {}))
  };
  const libraryInputs = Array.isArray(input.libraries) && input.libraries.length > 0
    ? input.libraries
    : [{
        id: text(input.libraryId, id),
        label: text(input.libraryLabel, input.label ?? id),
        packs: provider.packs,
        writable: input.writable,
        enabledByDefault: input.enabledByDefault,
        description: input.description,
        metadata: input.libraryMetadata
      }];
  const libraries = libraryInputs.map((entry) => normalizeLibrary(entry, provider));
  return Object.freeze({ ...provider, libraries: Object.freeze(libraries) });
}

function definitionMetaFromDescriptor(entry) {
  return {
    afflictionType: entry.afflictionType ?? null,
    level: Number.isFinite(Number(entry.level)) ? Number(entry.level) : null,
    rarity: entry.rarity ?? null,
    traits: stringArray(entry.traits),
    themes: stringArray(entry.themes),
    semanticTags: splitAfflictionThemes(entry.themes).tags
  };
}

function matchesSearch(entry, {
  query = "",
  types = null,
  themes = null,
  tags = null,
  tagMode = "all",
  minLevel = null,
  maxLevel = null,
  libraryIds = null
} = {}) {
  const queryText = text(query).toLocaleLowerCase(globalThis.game?.i18n?.lang ?? undefined);
  if (queryText) {
    const haystack = [
      entry.name,
      entry.sourceLabel,
      entry.libraryLabel,
      entry.providerLabel,
      entry.contentSourceLabel,
      entry.contentSourceWorkId,
      entry.contentSourcePage,
      entry.afflictionType,
      entry.rarity,
      ...(entry.traits ?? []),
      ...(entry.themes ?? [])
    ].filter(Boolean).join(" ").toLocaleLowerCase(globalThis.game?.i18n?.lang ?? undefined);
    if (!haystack.includes(queryText)) return false;
  }
  const typeSet = types == null ? null : new Set(stringArray(types));
  if (typeSet?.size && !typeSet.has(entry.afflictionType)) return false;
  const themeSet = themes == null ? null : new Set(stringArray(themes));
  if (themeSet?.size && ![...(entry.themes ?? [])].some((theme) => themeSet.has(theme))) return false;
  if (tags != null && !matchesSemanticTags(entry.themes, tags, { mode: tagMode })) return false;
  const librarySet = libraryIds == null ? null : new Set(stringArray(libraryIds));
  if (librarySet?.size && !librarySet.has(entry.libraryId)) return false;
  const level = Number(entry.level);
  if ((minLevel != null || maxLevel != null) && !Number.isFinite(level)) return false;
  if (minLevel != null && level < Number(minLevel)) return false;
  if (maxLevel != null && level > Number(maxLevel)) return false;
  return true;
}

export class AfflictionLibraryService {
  constructor({ templateService } = {}) {
    if (!templateService) throw new TypeError("AfflictionLibraryService requires a templateService.");
    this.templateService = templateService;
    this.providers = new Map();
    this.libraries = new Map();
    this.packOwners = new Map();
  }

  registerProvider(input) {
    const provider = normalizeProvider(input);
    if (this.providers.has(provider.id)) throw new Error(`Affliction library provider already registered: ${provider.id}`);
    for (const library of provider.libraries) {
      if (this.libraries.has(library.id)) throw new Error(`Affliction library already registered: ${library.id}`);
      for (const pack of library.packs) {
        const owner = this.packOwners.get(pack);
        if (owner) throw new Error(`Item compendium ${pack} is already registered by Affliction library ${owner}.`);
      }
    }
    this.providers.set(provider.id, provider);
    for (const library of provider.libraries) {
      this.libraries.set(library.id, library);
      for (const pack of library.packs) this.packOwners.set(pack, library.id);
    }
    emitChanged({ action: "registered", providerId: provider.id, libraryIds: provider.libraries.map((entry) => entry.id) });
    return clone(provider);
  }

  registerLibrary(input) {
    const moduleId = text(input?.moduleId ?? input?.providerId ?? input?.id);
    const providerId = text(input?.providerId, moduleId);
    let provider = this.providers.get(providerId);
    if (!provider) {
      const registered = this.registerProvider({
        id: providerId,
        label: text(input?.providerLabel, input?.label ?? providerId),
        moduleId,
        version: input?.version,
        metadata: input?.providerMetadata,
        libraries: [input]
      });
      return registered.libraries[0];
    }
    const library = normalizeLibrary(input, provider);
    if (this.libraries.has(library.id)) throw new Error(`Affliction library already registered: ${library.id}`);
    for (const pack of library.packs) {
      const owner = this.packOwners.get(pack);
      if (owner) throw new Error(`Item compendium ${pack} is already registered by Affliction library ${owner}.`);
    }
    const nextProvider = Object.freeze({ ...provider, libraries: Object.freeze([...provider.libraries, library]) });
    this.providers.set(providerId, nextProvider);
    this.libraries.set(library.id, library);
    for (const pack of library.packs) this.packOwners.set(pack, library.id);
    emitChanged({ action: "registered", providerId, libraryIds: [library.id] });
    return clone(library);
  }

  unregisterProvider(providerId) {
    const id = text(providerId);
    const provider = this.providers.get(id);
    if (!provider) return false;
    for (const library of provider.libraries) {
      this.libraries.delete(library.id);
      for (const pack of library.packs) {
        if (this.packOwners.get(pack) === library.id) this.packOwners.delete(pack);
      }
    }
    this.providers.delete(id);
    emitChanged({ action: "unregistered", providerId: id, libraryIds: provider.libraries.map((entry) => entry.id) });
    return true;
  }

  providerList() {
    return [...this.providers.values()].map((entry) => clone(entry));
  }

  #baseLibraries({ includeImplicit = true } = {}) {
    requireRuntime();
    const states = readLibraryStates();
    const result = [{
      id: WORLD_LIBRARY_ID,
      label: localize("PF2E_AFFLICTION_FORGE.Library.World", "World Afflictions"),
      providerId: "world",
      providerLabel: localize("PF2E_AFFLICTION_FORGE.Library.WorldProvider", "World"),
      moduleId: null,
      version: null,
      packs: [],
      writable: Boolean(game.user?.isGM),
      enabledByDefault: true,
      enabled: states[WORLD_LIBRARY_ID] !== false,
      description: localize("PF2E_AFFLICTION_FORGE.Library.WorldHint", "Affliction templates stored as world Items."),
      metadata: {},
      registered: true,
      implicit: false,
      kind: "world",
      missingPacks: [],
      available: true
    }];

    for (const library of this.libraries.values()) {
      const missingPacks = library.packs.filter((collection) => !packByCollection(collection));
      result.push({
        ...clone(library),
        enabled: states[library.id] ?? library.enabledByDefault,
        missingPacks,
        available: missingPacks.length === 0
      });
    }

    if (includeImplicit) {
      for (const pack of itemPacks()) {
        if (this.packOwners.has(pack.collection)) continue;
        const id = `${IMPLICIT_COMPENDIUM_PREFIX}${pack.collection}`;
        result.push({
          id,
          label: pack.title ?? pack.collection,
          providerId: null,
          providerLabel: localize("PF2E_AFFLICTION_FORGE.Library.CompendiumProvider", "Compendium"),
          moduleId: pack.metadata?.packageName ?? null,
          version: null,
          packs: [pack.collection],
          writable: Boolean(game.user?.isGM && !pack.locked),
          enabledByDefault: true,
          enabled: states[id] !== false,
          description: "",
          metadata: {},
          registered: false,
          implicit: true,
          kind: "compendium",
          missingPacks: [],
          available: true
        });
      }
    }
    return result;
  }

  list(options = {}) {
    return this.#baseLibraries(options)
      .sort((a, b) => a.label.localeCompare(b.label, globalThis.game?.i18n?.lang ?? undefined, { sensitivity: "base" }))
      .map((entry) => Object.freeze(entry));
  }

  get(libraryId, options = {}) {
    return this.list(options).find((entry) => entry.id === libraryId) ?? null;
  }

  async setEnabled(libraryId, enabled) {
    const id = text(libraryId);
    const library = this.get(id);
    if (!library) throw new Error(`Unknown Affliction library: ${id}`);
    const states = readLibraryStates();
    states[id] = Boolean(enabled);
    await writeLibraryStates(states);
    emitChanged({ action: "enabled", libraryId: id, enabled: Boolean(enabled) });
    return Boolean(enabled);
  }

  isEnabled(libraryId) {
    return Boolean(this.get(libraryId)?.enabled);
  }

  libraryForPack(collection) {
    const pack = text(collection);
    if (!pack) return null;
    const registeredId = this.packOwners.get(pack);
    if (registeredId) return this.get(registeredId);
    return this.get(`${IMPLICIT_COMPENDIUM_PREFIX}${pack}`);
  }

  libraryForDocument(document) {
    if (!document) return null;
    const pack = typeof document.pack === "string" ? document.pack : null;
    return pack ? this.libraryForPack(pack) : this.get(WORLD_LIBRARY_ID);
  }

  decorateTemplateDescriptor(entry) {
    if (!entry) return null;
    const library = entry.world ? this.get(WORLD_LIBRARY_ID) : this.libraryForPack(entry.pack);
    if (!library) return Object.freeze({ ...entry, libraryId: null, libraryLabel: entry.sourceLabel, providerId: null, providerLabel: null, libraryEnabled: true });
    return Object.freeze({
      ...entry,
      ...definitionMetaFromDescriptor(entry),
      libraryId: library.id,
      libraryLabel: library.label,
      providerId: library.providerId,
      providerLabel: library.providerLabel,
      libraryKind: library.kind,
      libraryEnabled: library.enabled,
      libraryWritable: library.writable,
      writable: Boolean(entry.writable && library.writable),
      readOnly: !(entry.writable && library.writable)
    });
  }

  inspect(document) {
    const base = this.templateService.inspect(document);
    return base ? this.decorateTemplateDescriptor(base) : null;
  }

  canUpdate(document) {
    if (!document || !isAfflictionTemplate(document)) return false;
    if (!this.templateService.canUpdate(document)) return false;
    return Boolean(this.libraryForDocument(document)?.writable);
  }

  async templates({
    includeDisabled = false,
    includeWorld = true,
    includeCompendia = true,
    ...searchOptions
  } = {}) {
    const entries = await this.templateService.list({ includeWorld, includeCompendia });
    return entries
      .map((entry) => this.decorateTemplateDescriptor(entry))
      .filter((entry) => includeDisabled || entry.libraryEnabled)
      .filter((entry) => matchesSearch(entry, searchOptions))
      .sort((a, b) => a.name.localeCompare(b.name, globalThis.game?.i18n?.lang ?? undefined, { sensitivity: "base" })
        || a.libraryLabel.localeCompare(b.libraryLabel, globalThis.game?.i18n?.lang ?? undefined, { sensitivity: "base" }));
  }

  async search(options = {}) {
    return this.templates(options);
  }

  canWriteDestination(pack = null) {
    const requested = text(pack);
    const library = requested ? this.libraryForPack(requested) : this.get(WORLD_LIBRARY_ID);
    if (!library?.writable) return false;
    return this.templateService.writableDestinations().some((destination) => String(destination.value ?? "") === requested);
  }

  writableDestinations() {
    return this.templateService.writableDestinations().filter((destination) => {
      if (!destination.value) return this.get(WORLD_LIBRARY_ID)?.writable !== false;
      return this.libraryForPack(destination.value)?.writable !== false;
    }).map((destination) => ({
      ...destination,
      libraryId: destination.value ? this.libraryForPack(destination.value)?.id ?? null : WORLD_LIBRARY_ID
    }));
  }

  summary() {
    const libraries = this.list();
    return Object.freeze({
      providers: this.providers.size,
      libraries: libraries.length,
      enabled: libraries.filter((entry) => entry.enabled).length,
      registered: libraries.filter((entry) => entry.registered && entry.kind === "provider").length,
      implicit: libraries.filter((entry) => entry.implicit).length
    });
  }
}

export function createAfflictionLibraryService(options = {}) {
  return new AfflictionLibraryService(options);
}
