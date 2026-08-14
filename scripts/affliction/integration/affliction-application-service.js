import { MODULE_ID } from "../../constants.js";
import {
  createAfflictionReference,
  findAfflictionReference,
  normalizeAfflictionReference,
  readAfflictionReferences
} from "./affliction-reference-service.js";

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

async function resolveUuid(uuid) {
  if (!uuid) return null;
  if (typeof globalThis.fromUuid === "function") return globalThis.fromUuid(uuid);
  return null;
}

async function resolveSource(sourceOrUuid) {
  if (!sourceOrUuid) return null;
  if (typeof sourceOrUuid === "string") return resolveUuid(sourceOrUuid);
  return sourceOrUuid;
}

function originFor({ source = null, reference = null, origin = {}, application = "external-api", context = {} } = {}) {
  return {
    application,
    userId: globalThis.game?.user?.id ?? null,
    sourceActorUuid: source?.actor?.uuid ?? source?.parent?.uuid ?? origin.sourceActorUuid ?? null,
    sourceItemUuid: source?.documentName === "Item" || source?.constructor?.documentName === "Item"
      ? source.uuid ?? origin.sourceItemUuid ?? null
      : origin.sourceItemUuid ?? null,
    referenceId: reference?.id ?? origin.referenceId ?? null,
    trigger: reference?.trigger ?? origin.trigger ?? null,
    applicationMode: reference?.application ?? origin.applicationMode ?? null,
    context: context && typeof context === "object" ? structuredCloneSafe(context) : {},
    ...origin
  };
}

function structuredCloneSafe(value) {
  try {
    if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  } catch {
    // Fall back below.
  }
  try { return JSON.parse(JSON.stringify(value)); } catch { return {}; }
}

export class AfflictionApplicationService {
  constructor({ engine, templateService }) {
    this.engine = engine;
    this.templateService = templateService;
  }

  async resolveReference(referenceOrSource, { referenceId = null } = {}) {
    if (!referenceOrSource) throw new TypeError("An Affliction reference or source document is required.");

    if (typeof referenceOrSource === "string") {
      if (referenceOrSource.includes(".")) return createAfflictionReference({ templateUuid: referenceOrSource });
      throw new TypeError("A bare reference id requires a source document.");
    }

    if (referenceOrSource.templateUuid || referenceOrSource.uuid && referenceOrSource.trigger) {
      return createAfflictionReference(referenceOrSource);
    }

    const source = await resolveSource(referenceOrSource);
    if (!source) throw new TypeError("Affliction reference source could not be resolved.");
    if (referenceId) {
      const reference = findAfflictionReference(source, referenceId);
      if (!reference) throw new Error(`Affliction reference not found: ${referenceId}`);
      return reference;
    }

    const references = readAfflictionReferences(source).filter((entry) => entry.enabled !== false);
    if (references.length === 1) return references[0];
    if (references.length === 0) throw new Error("Source document has no enabled Affliction references.");
    throw new Error("Source document has multiple Affliction references; referenceId is required.");
  }

  async apply({
    templateUuid = null,
    reference = null,
    source = null,
    sourceUuid = null,
    referenceId = null,
    targets = null,
    targetActorUuid = null,
    origin = {},
    context = {},
    application = "external-api",
    ...engineOptions
  } = {}) {
    const sourceDocument = await resolveSource(source ?? sourceUuid);
    let resolvedReference = null;
    let resolvedTemplateUuid = text(templateUuid);

    if (reference) {
      resolvedReference = await this.resolveReference(reference);
      resolvedTemplateUuid ||= resolvedReference.templateUuid;
    } else if (sourceDocument && (referenceId || !resolvedTemplateUuid)) {
      resolvedReference = await this.resolveReference(sourceDocument, { referenceId });
      resolvedTemplateUuid ||= resolvedReference.templateUuid;
    }

    if (!resolvedTemplateUuid) throw new TypeError("External Affliction application requires templateUuid or a resolvable reference.");
    const resolvedTargets = targets ?? targetActorUuid;
    if (!resolvedTargets) throw new TypeError("External Affliction application requires one or more targets.");

    const result = await this.engine.applyTemplate(resolvedTemplateUuid, resolvedTargets, {
      ...engineOptions,
      origin: originFor({ source: sourceDocument, reference: resolvedReference, origin, application, context })
    });

    globalThis.Hooks?.callAll?.("pf2eAfflictionForgeApplied", {
      templateUuid: resolvedTemplateUuid,
      reference: resolvedReference ? structuredCloneSafe(resolvedReference) : null,
      sourceUuid: sourceDocument?.uuid ?? sourceUuid ?? null,
      application,
      result
    });
    return result;
  }

  async applyReference(referenceOrSource, targets, options = {}) {
    const reference = await this.resolveReference(referenceOrSource, { referenceId: options.referenceId ?? null });
    return this.apply({ ...options, reference, source: options.source ?? referenceOrSource, targets });
  }

  async applyItemReference(itemOrUuid, referenceId, targets, options = {}) {
    const source = await resolveSource(itemOrUuid);
    if (!source) throw new Error("Source Item could not be resolved.");
    const reference = await this.resolveReference(source, { referenceId });
    return this.apply({ ...options, source, reference, targets });
  }

  createDragData(templateOrUuid, { label = null, sourceUuid = null, referenceId = null } = {}) {
    const uuid = typeof templateOrUuid === "string" ? templateOrUuid : templateOrUuid?.uuid;
    if (!text(uuid)) throw new TypeError("A template UUID is required to create Affliction drag data.");
    return {
      type: "Affliction",
      source: MODULE_ID,
      version: 1,
      uuid: text(uuid),
      templateUuid: text(uuid),
      label: text(label) || null,
      sourceUuid: text(sourceUuid) || null,
      referenceId: text(referenceId) || null
    };
  }

  parseDropData(data = {}) {
    if (!data || typeof data !== "object") return null;
    if (data.type !== "Affliction" || data.source !== MODULE_ID) return null;
    const templateUuid = text(data.templateUuid ?? data.uuid);
    if (!templateUuid) return null;
    return Object.freeze({
      type: "Affliction",
      templateUuid,
      label: text(data.label) || null,
      sourceUuid: text(data.sourceUuid) || null,
      referenceId: text(data.referenceId) || null
    });
  }

  async applyDropData(data, target, options = {}) {
    const parsed = this.parseDropData(data);
    if (!parsed) throw new TypeError("Drop data is not an Affliction Forge drag payload.");
    return this.apply({
      ...options,
      templateUuid: parsed.templateUuid,
      sourceUuid: parsed.sourceUuid,
      referenceId: parsed.referenceId,
      targets: target,
      application: options.application ?? "drag-drop"
    });
  }
}

export function createAfflictionApplicationService(options) {
  return new AfflictionApplicationService(options);
}
