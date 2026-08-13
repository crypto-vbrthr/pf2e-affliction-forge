import { DOCUMENT_KINDS, MODULE_ID } from "../../constants.js";
import { normalizeAfflictionDefinition } from "../schema/affliction-normalizer.js";
import { assertValidAfflictionDefinition } from "../schema/affliction-validator.js";
import { deepClone } from "../schema/utils.js";
import {
  buildTemplateFlags,
  getAfflictionFlags,
  getDocumentKind,
  isManagedAfflictionDocument
} from "./affliction-flags.js";

function sourceOf(item) {
  if (!item || typeof item !== "object") throw new TypeError("An Item document or source object is required.");
  return typeof item.toObject === "function" ? item.toObject() : deepClone(item);
}

export function buildAfflictionTemplateItemSource(definition, { effectValidator = null } = {}) {
  const normalized = normalizeAfflictionDefinition(definition);
  assertValidAfflictionDefinition(normalized, { effectValidator });

  return {
    name: normalized.name,
    type: "effect",
    img: normalized.img,
    system: {
      description: { value: normalized.description ?? "", gm: "" },
      rules: [],
      slug: null,
      traits: { value: [...normalized.traits], otherTags: [...normalized.themes] },
      level: { value: normalized.level },
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
      start: { value: 0, initiative: null },
      badge: null,
      tokenIcon: { show: true },
      unidentified: false
    },
    flags: buildTemplateFlags(normalized)
  };
}

export function extractAfflictionDefinitionFromItem(item, { normalize = true } = {}) {
  const source = sourceOf(item);
  if (source.type !== "effect") throw new TypeError(`Affliction documents must use PF2e Item type effect (received: ${source.type ?? "unknown"}).`);
  const flags = source.flags?.[MODULE_ID];
  if (flags?.managed !== true) throw new TypeError("Item is not managed by PF2E Affliction Forge.");

  let definition = null;
  if (flags.documentKind === DOCUMENT_KINDS.TEMPLATE) definition = flags.definition;
  else if (flags.documentKind === DOCUMENT_KINDS.CONTROLLER) definition = flags.definitionSnapshot;
  else throw new TypeError(`Unsupported Affliction Forge document kind: ${flags.documentKind ?? "unknown"}.`);

  if (!definition) throw new TypeError("Affliction Forge item does not contain a definition payload.");
  return normalize ? normalizeAfflictionDefinition(definition) : deepClone(definition);
}

export function inspectAfflictionItem(item) {
  const source = sourceOf(item);
  const flags = getAfflictionFlags(source);
  return Object.freeze({
    managed: isManagedAfflictionDocument(source),
    documentKind: getDocumentKind(source),
    definitionId: flags?.definitionId ?? null,
    instanceId: flags?.instanceId ?? null,
    sourceTemplateUuid: flags?.sourceTemplateUuid ?? null,
    sourceDefinitionVersion: flags?.sourceDefinitionVersion ?? null
  });
}
