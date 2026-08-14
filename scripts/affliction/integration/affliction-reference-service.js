import { MODULE_ID } from "../../constants.js";
import { deepClone, randomId } from "../schema/utils.js";

export const AFFLICTION_REFERENCE_SCHEMA_VERSION = 1;

export const AFFLICTION_REFERENCE_TRIGGERS = Object.freeze([
  "manual",
  "on-use",
  "on-hit",
  "on-damage",
  "failed-save",
  "critical-failure",
  "custom"
]);

export const AFFLICTION_REFERENCE_APPLICATION_MODES = Object.freeze([
  "manual",
  "prompt",
  "automatic"
]);

export const AFFLICTION_REFERENCE_HOST_ITEM_TYPES = Object.freeze([
  "melee",
  "weapon",
  "action",
  "feat",
  "spell"
]);

function sourceOf(documentOrSource) {
  if (!documentOrSource || typeof documentOrSource !== "object") return {};
  return typeof documentOrSource.toObject === "function"
    ? documentOrSource.toObject()
    : deepClone(documentOrSource);
}

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function boolean(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function itemTypeOf(documentOrSource) {
  return text(documentOrSource?.type);
}

export function isAfflictionReferenceHostItem(documentOrSource) {
  return AFFLICTION_REFERENCE_HOST_ITEM_TYPES.includes(itemTypeOf(documentOrSource));
}

export function defaultAfflictionReferenceTriggerForHost(documentOrSource) {
  const type = itemTypeOf(documentOrSource);
  if (type === "melee" || type === "weapon") return "on-hit";
  return "on-use";
}

export function defaultAfflictionReferenceApplicationForHost(_documentOrSource) {
  return "prompt";
}

export function afflictionReferenceHostDefaults(documentOrSource) {
  const type = itemTypeOf(documentOrSource);
  const eligible = AFFLICTION_REFERENCE_HOST_ITEM_TYPES.includes(type);
  return Object.freeze({
    eligible,
    itemType: type || null,
    trigger: eligible ? defaultAfflictionReferenceTriggerForHost(documentOrSource) : "manual",
    application: eligible ? defaultAfflictionReferenceApplicationForHost(documentOrSource) : "manual"
  });
}

export function normalizeAfflictionReference(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const trigger = AFFLICTION_REFERENCE_TRIGGERS.includes(source.trigger) ? source.trigger : "manual";
  const application = AFFLICTION_REFERENCE_APPLICATION_MODES.includes(source.application) ? source.application : "manual";
  return {
    schemaVersion: AFFLICTION_REFERENCE_SCHEMA_VERSION,
    id: text(source.id) || randomId("affliction-ref"),
    templateUuid: text(source.templateUuid ?? source.uuid),
    label: text(source.label) || null,
    trigger,
    application,
    enabled: boolean(source.enabled, true),
    metadata: deepClone(source.metadata && typeof source.metadata === "object" ? source.metadata : {})
  };
}

export function validateAfflictionReference(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const reference = normalizeAfflictionReference(source);
  const errors = [];
  if (!reference.templateUuid) errors.push("templateUuid must be a non-empty string.");
  if (source.trigger != null && !AFFLICTION_REFERENCE_TRIGGERS.includes(source.trigger)) {
    errors.push(`Unsupported trigger: ${source.trigger}`);
  }
  if (source.application != null && !AFFLICTION_REFERENCE_APPLICATION_MODES.includes(source.application)) {
    errors.push(`Unsupported application mode: ${source.application}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), reference: Object.freeze(reference) });
}

export function createAfflictionReference(options = {}) {
  const report = validateAfflictionReference(options);
  if (!report.valid) throw new TypeError(`Invalid Affliction reference: ${report.errors.join(" ")}`);
  return deepClone(report.reference);
}

export function readAfflictionReferences(documentOrSource) {
  const source = sourceOf(documentOrSource);
  const raw = source.flags?.[MODULE_ID]?.afflictionReferences;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => normalizeAfflictionReference(entry)).filter((entry) => entry.templateUuid);
}

export function withAfflictionReferences(sourceInput, references = []) {
  const source = sourceOf(sourceInput);
  source.flags ??= {};
  source.flags[MODULE_ID] ??= {};
  source.flags[MODULE_ID].afflictionReferences = references.map((entry) => createAfflictionReference(entry));
  return source;
}

export function addAfflictionReferenceToSource(sourceInput, referenceInput) {
  const source = sourceOf(sourceInput);
  const references = readAfflictionReferences(source);
  const reference = createAfflictionReference(referenceInput);
  const duplicateIndex = references.findIndex((entry) => entry.id === reference.id);
  if (duplicateIndex >= 0) references[duplicateIndex] = reference;
  else references.push(reference);
  return withAfflictionReferences(source, references);
}

export function removeAfflictionReferenceFromSource(sourceInput, referenceId) {
  const id = text(referenceId);
  const source = sourceOf(sourceInput);
  return withAfflictionReferences(source, readAfflictionReferences(source).filter((entry) => entry.id !== id));
}

export function findAfflictionReference(documentOrSource, referenceId) {
  const id = text(referenceId);
  return readAfflictionReferences(documentOrSource).find((entry) => entry.id === id) ?? null;
}

export async function setDocumentAfflictionReferences(document, references = []) {
  if (!document?.update) throw new TypeError("A writable Foundry document is required.");
  const normalized = references.map((entry) => createAfflictionReference(entry));
  await document.update({ [`flags.${MODULE_ID}.afflictionReferences`]: normalized });
  return normalized;
}

export async function addDocumentAfflictionReference(document, referenceInput) {
  const reference = createAfflictionReference(referenceInput);
  const references = readAfflictionReferences(document);
  const index = references.findIndex((entry) => entry.id === reference.id);
  if (index >= 0) references[index] = reference;
  else references.push(reference);
  await setDocumentAfflictionReferences(document, references);
  return reference;
}

export async function removeDocumentAfflictionReference(document, referenceId) {
  const source = removeAfflictionReferenceFromSource(document, referenceId);
  const references = source.flags?.[MODULE_ID]?.afflictionReferences ?? [];
  await setDocumentAfflictionReferences(document, references);
  return references;
}

export function afflictionReferenceText(referenceOrUuid, { label = null, syntax = "affliction" } = {}) {
  const reference = typeof referenceOrUuid === "string"
    ? normalizeAfflictionReference({ templateUuid: referenceOrUuid, label })
    : normalizeAfflictionReference(referenceOrUuid);
  if (!reference.templateUuid) throw new TypeError("An Affliction template UUID is required.");
  const resolvedLabel = text(label) || reference.label;
  if (syntax === "uuid") {
    return `@UUID[${reference.templateUuid}]${resolvedLabel ? `{${resolvedLabel}}` : ""}`;
  }
  return `@Affliction[${reference.templateUuid}]${resolvedLabel ? `{${resolvedLabel}}` : ""}`;
}

export function afflictionReferenceSummary(referenceInput) {
  const reference = normalizeAfflictionReference(referenceInput);
  return Object.freeze({
    id: reference.id,
    templateUuid: reference.templateUuid,
    label: reference.label,
    trigger: reference.trigger,
    application: reference.application,
    enabled: reference.enabled
  });
}
