import { CONTROLLER_SCHEMA_VERSION, IDENTIFICATION_STATES } from "../../constants.js";
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
  currentStage = definition?.initialCheck || definition?.onset ? 0 : 1,
  stageEnteredAt = currentStage > 0 ? appliedAt : null,
  activeStartedAt = currentStage > 0 ? appliedAt : null,
  onsetStartedAt = definition?.onset && !definition?.initialCheck && currentStage === 0 ? appliedAt : null,
  nextCheckAt = null,
  status = definition?.initialCheck ? "pending" : definition?.onset ? "incubating" : "active",
  identificationState = definition?.identification?.initialState ?? "identified",
  identifiedAt = identificationState === "identified" ? appliedAt : null,
  identifiedBy = null,
  activeStageEffectUuids = [],
  pendingCheck = null,
  onsetTargetStage = definition?.onset && !definition?.initialCheck ? 1 : null,
  lastCheck = null,
  events = [],
  mortality = null,
  pause = null,
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
    activeStartedAt,
    onsetStartedAt,
    nextCheckAt,
    identification: {
      state: IDENTIFICATION_STATES.includes(identificationState) ? identificationState : "identified",
      identifiedAt,
      identifiedBy
    },
    recoverySuccesses,
    activeStageEffectUuids: [...activeStageEffectUuids],
    pendingCheck: pendingCheck == null ? null : deepClone(pendingCheck),
    onsetTargetStage: onsetTargetStage == null ? null : Math.max(1, Math.trunc(Number(onsetTargetStage) || 1)),
    lastCheck: lastCheck == null ? null : deepClone(lastCheck),
    events: Array.isArray(events) ? deepClone(events) : [],
    mortality: mortality == null ? null : deepClone(mortality),
    pause: pause == null ? null : deepClone(pause),
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
    if (state.pendingCheck !== null && state.pendingCheck !== undefined && (typeof state.pendingCheck !== "object" || Array.isArray(state.pendingCheck))) errors.push("pendingCheck must be an object or null.");
    if (state.lastCheck !== null && state.lastCheck !== undefined && (typeof state.lastCheck !== "object" || Array.isArray(state.lastCheck))) errors.push("lastCheck must be an object or null.");
    if (state.events !== undefined && !Array.isArray(state.events)) errors.push("events must be an array when present.");
    if (state.mortality !== null && state.mortality !== undefined && (typeof state.mortality !== "object" || Array.isArray(state.mortality))) errors.push("mortality must be an object or null.");
    if (state.pause !== null && state.pause !== undefined) {
      if (typeof state.pause !== "object" || Array.isArray(state.pause)) errors.push("pause must be an object or null.");
      else {
        if (!Number.isFinite(state.pause.pausedAt)) errors.push("pause.pausedAt must be a finite world-time value.");
        if (!["incubating", "active"].includes(state.pause.previousStatus)) errors.push("pause.previousStatus must be incubating or active.");
        if (state.pause.nextCheckAt !== null && state.pause.nextCheckAt !== undefined && !Number.isFinite(state.pause.nextCheckAt)) errors.push("pause.nextCheckAt must be a finite world-time value or null.");
      }
    }
    if (!Number.isInteger(state.recoverySuccesses) || state.recoverySuccesses < 0) errors.push("recoverySuccesses must be a non-negative integer.");
    if (!Number.isInteger(state.revision) || state.revision < 1) errors.push("revision must be a positive integer.");
    if (state.onsetTargetStage !== null && state.onsetTargetStage !== undefined && (!Number.isInteger(state.onsetTargetStage) || state.onsetTargetStage < 1)) errors.push("onsetTargetStage must be a positive integer or null.");
    if (definition && Number.isInteger(state.onsetTargetStage) && state.onsetTargetStage > definition.stages.length) errors.push("onsetTargetStage exceeds the definition stage count.");
    for (const field of ["appliedAt", "stageEnteredAt", "activeStartedAt", "onsetStartedAt", "nextCheckAt"]) {
      if (state[field] != null && !Number.isFinite(state[field])) errors.push(`${field} must be a finite world-time value or null.`);
    }

    const identification = state.identification;
    if (!identification || typeof identification !== "object" || Array.isArray(identification)) {
      errors.push("identification must be an object.");
    } else {
      if (!IDENTIFICATION_STATES.includes(identification.state)) errors.push(`Unsupported identification state: ${identification.state}.`);
      if (identification.identifiedAt !== null && !Number.isFinite(identification.identifiedAt)) errors.push("identification.identifiedAt must be a finite world-time value or null.");
      if (identification.identifiedBy !== null && typeof identification.identifiedBy !== "string") errors.push("identification.identifiedBy must be a string or null.");
    }
  }
  return { valid: errors.length === 0, errors };
}
