import {
  AFFLICTION_SCHEMA_VERSION,
  CONTROLLER_SCHEMA_VERSION,
  DOCUMENT_KINDS,
  MODULE_ID
} from "../../constants.js";
import { deepClone } from "../schema/utils.js";

export function getAfflictionFlags(documentOrSource) {
  return documentOrSource?.flags?.[MODULE_ID] ?? null;
}

export function getDocumentKind(documentOrSource) {
  return getAfflictionFlags(documentOrSource)?.documentKind ?? null;
}

export function isManagedAfflictionDocument(documentOrSource) {
  return getAfflictionFlags(documentOrSource)?.managed === true;
}

export function isAfflictionTemplate(documentOrSource) {
  const flags = getAfflictionFlags(documentOrSource);
  return flags?.managed === true && flags.documentKind === DOCUMENT_KINDS.TEMPLATE;
}

export function isAfflictionController(documentOrSource) {
  const flags = getAfflictionFlags(documentOrSource);
  return flags?.managed === true && flags.documentKind === DOCUMENT_KINDS.CONTROLLER;
}

export function buildTemplateFlags(definition) {
  return {
    [MODULE_ID]: {
      managed: true,
      documentKind: DOCUMENT_KINDS.TEMPLATE,
      schemaVersion: AFFLICTION_SCHEMA_VERSION,
      definitionId: definition.id,
      definitionVersion: 1,
      definition: deepClone(definition),
      originModule: definition.metadata?.originModule ?? MODULE_ID,
      originFeature: definition.metadata?.originFeature ?? "affliction-template"
    }
  };
}

export function buildControllerFlags({
  definitionSnapshot,
  instanceId,
  sourceTemplateUuid = null,
  origin = {},
  state
}) {
  return {
    [MODULE_ID]: {
      managed: true,
      documentKind: DOCUMENT_KINDS.CONTROLLER,
      schemaVersion: AFFLICTION_SCHEMA_VERSION,
      controllerSchemaVersion: CONTROLLER_SCHEMA_VERSION,
      definitionId: definitionSnapshot.id,
      definitionSnapshot: deepClone(definitionSnapshot),
      instanceId,
      sourceTemplateUuid,
      origin: deepClone(origin),
      state: deepClone(state)
    }
  };
}
