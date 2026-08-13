import { CONTROLLER_SCHEMA_VERSION } from "../../constants.js";
import { deepClone, randomId } from "../schema/utils.js";

export const CONTROLLER_STATUSES = Object.freeze([
  "pending",
  "incubating",
  "active",
  "paused",
  "recovered",
  "ended"
]);

export function createAfflictionControllerState(definition, {
  instanceId = randomId("affliction-instance"),
  appliedAt = null,
  currentStage = definition?.onset ? 0 : 1,
  stageEnteredAt = definition?.onset ? null : appliedAt,
  nextCheckAt = null,
  status = definition?.onset ? "incubating" : "active",
  activeStageEffectUuids = [],
  pendingCheck = null,
  recoverySuccesses = 0,
  revision = 1
} = {}) {
  return {
    schemaVersion: CONTROLLER_SCHEMA_VERSION,
    instanceId,
    status,
    currentStage,
    appliedAt,
    stageEnteredAt,
    nextCheckAt,
    recoverySuccesses,
    activeStageEffectUuids: [...activeStageEffectUuids],
    pendingCheck: pendingCheck == null ? null : deepClone(pendingCheck),
    revision
  };
}

export function validateAfflictionControllerState(state, definition = null) {
  const errors = [];
  if (!state || typeof state !== "object" || Array.isArray(state)) errors.push("Controller state must be an object.");
  else {
    if (state.schemaVersion !== CONTROLLER_SCHEMA_VERSION) errors.push(`Expected controller schema ${CONTROLLER_SCHEMA_VERSION}.`);
    if (typeof state.instanceId !== "string" || !state.instanceId.trim()) errors.push("instanceId is required.");
    if (!CONTROLLER_STATUSES.includes(state.status)) errors.push(`Unsupported controller status: ${state.status}.`);
    if (!Number.isInteger(state.currentStage) || state.currentStage < 0) errors.push("currentStage must be a non-negative integer.");
    if (definition && state.currentStage > definition.stages.length) errors.push("currentStage exceeds the definition stage count.");
    if (!Array.isArray(state.activeStageEffectUuids)) errors.push("activeStageEffectUuids must be an array.");
    if (!Number.isInteger(state.recoverySuccesses) || state.recoverySuccesses < 0) errors.push("recoverySuccesses must be a non-negative integer.");
    if (!Number.isInteger(state.revision) || state.revision < 1) errors.push("revision must be a positive integer.");
    for (const field of ["appliedAt", "stageEnteredAt", "nextCheckAt"]) {
      if (state[field] !== null && !Number.isFinite(state[field])) errors.push(`${field} must be a finite world-time value or null.`);
    }
  }
  return { valid: errors.length === 0, errors };
}
