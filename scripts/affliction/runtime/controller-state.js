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
  unhealableDamage = 0,
  unhealableDamageByType = {},
  periodicSchedule = {},
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
    unhealableDamage: Math.max(0, Math.trunc(Number(unhealableDamage) || 0)),
    unhealableDamageByType: Object.fromEntries(Object.entries(unhealableDamageByType ?? {})
      .map(([type, amount]) => [String(type).trim().toLowerCase(), Math.max(0, Math.trunc(Number(amount) || 0))])
      .filter(([type, amount]) => type && amount > 0)),
    periodicSchedule: Object.fromEntries(Object.entries(periodicSchedule ?? {})
      .map(([id, entry]) => [String(id).trim(), deepClone(entry)])
      .filter(([id, entry]) => id && entry && typeof entry === "object" && !Array.isArray(entry))),
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

    // Status/stage combinations are semantic runtime invariants, not merely UI
    // conventions. Stage 0 is reserved for initial exposure/onset workflows;
    // an active Affliction must always own a real stage.
    if (state.status === "active" && state.currentStage < 1) errors.push("active controllers must be in stage 1 or higher.");
    if (["pending", "incubating"].includes(state.status) && state.currentStage !== 0) errors.push(`${state.status} controllers must be in stage 0.`);
    if (["recovered", "ended"].includes(state.status) && state.currentStage !== 0) errors.push(`${state.status} controllers must be in stage 0.`);
    if (definition && state.status === "pending" && !definition.initialCheck) errors.push("pending controllers require an initial check.");
    if (definition && state.status === "incubating" && !definition.onset) errors.push("incubating controllers require an onset duration.");
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
        if (state.status !== "paused") errors.push("pause metadata is only valid while status is paused.");
        if (state.pause.previousStatus === "active" && state.currentStage < 1) errors.push("paused active controllers must retain stage 1 or higher.");
        if (state.pause.previousStatus === "incubating" && state.currentStage !== 0) errors.push("paused incubating controllers must remain in stage 0.");
      }
    } else if (state.status === "paused") {
      errors.push("paused controllers require pause metadata.");
    }
    if (!Number.isInteger(state.recoverySuccesses) || state.recoverySuccesses < 0) errors.push("recoverySuccesses must be a non-negative integer.");
    if (state.unhealableDamage !== undefined && (!Number.isInteger(state.unhealableDamage) || state.unhealableDamage < 0)) errors.push("unhealableDamage must be a non-negative integer when present.");
    if (state.periodicSchedule !== undefined) {
      if (!state.periodicSchedule || typeof state.periodicSchedule !== "object" || Array.isArray(state.periodicSchedule)) errors.push("periodicSchedule must be an object when present.");
      else for (const [id, entry] of Object.entries(state.periodicSchedule)) {
        if (!id.trim() || !entry || typeof entry !== "object" || Array.isArray(entry)) { errors.push("periodicSchedule entries must be objects keyed by periodic effect id."); continue; }
        if (entry.nextAt !== null && entry.nextAt !== undefined && !Number.isFinite(entry.nextAt)) errors.push("periodicSchedule.nextAt must be a finite world-time value or null.");
        if (entry.lastAt !== null && entry.lastAt !== undefined && !Number.isFinite(entry.lastAt)) errors.push("periodicSchedule.lastAt must be a finite world-time value or null.");
        if (entry.lastIntervalSeconds !== null && entry.lastIntervalSeconds !== undefined && (!Number.isFinite(entry.lastIntervalSeconds) || entry.lastIntervalSeconds <= 0)) errors.push("periodicSchedule.lastIntervalSeconds must be a positive finite duration or null.");
        if (!Number.isInteger(entry.sequence ?? 0) || Number(entry.sequence ?? 0) < 0) errors.push("periodicSchedule.sequence must be a non-negative integer.");
      }
    }
    if (state.unhealableDamageByType !== undefined) {
      if (!state.unhealableDamageByType || typeof state.unhealableDamageByType !== "object" || Array.isArray(state.unhealableDamageByType)) errors.push("unhealableDamageByType must be an object when present.");
      else for (const [type, amount] of Object.entries(state.unhealableDamageByType)) {
        if (!type.trim() || !Number.isInteger(amount) || amount < 0) errors.push("unhealableDamageByType values must be non-negative integers keyed by damage type.");
      }
    }
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
