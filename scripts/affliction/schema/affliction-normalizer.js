import {
  AFFLICTION_SCHEMA_VERSION,
  CHECK_COMBINE_MODES,
  DURATION_UNITS,
  IDENTIFICATION_STATES,
  OUTCOME_KEYS,
  SAVE_DC_MODES,
  SAVE_EXECUTION_MODES,
  SAVE_VISIBILITY_MODES
} from "../../constants.js";
import {
  createAfflictionDefinition,
  createDefaultInitialCheck,
  createDefaultSaveCheck,
  createDefaultSavePolicy,
  createDefaultStage,
  createDefaultStageCheck
} from "./affliction-defaults.js";
import { cleanString, deepClone, finiteNumber, uniqueStrings } from "./utils.js";

const UNIT_ALIASES = Object.freeze({
  round: "rounds",
  rounds: "rounds",
  minute: "minutes",
  minutes: "minutes",
  hour: "hours",
  hours: "hours",
  day: "days",
  days: "days",
  unlimited: "unlimited"
});

function normalizeDuration(duration, { allowUnlimited = true } = {}) {
  if (duration == null) return null;
  const unit = UNIT_ALIASES[cleanString(duration.unit).toLowerCase()] ?? cleanString(duration.unit, "rounds");
  if (allowUnlimited && unit === "unlimited") return { value: -1, unit: "unlimited" };
  return {
    value: finiteNumber(duration.value, 1),
    unit: DURATION_UNITS.includes(unit) && unit !== "unlimited" ? unit : "rounds"
  };
}

function normalizeDirective(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { action: "none" };
  const result = { action: cleanString(value.action, "none") };
  if (result.action === "set-stage") result.stage = finiteNumber(value.stage, 1);
  if (result.action === "stage-delta") result.delta = finiteNumber(value.delta, 0);
  return result;
}

function normalizeCheckGate(value, fallback = null) {
  if (value == null) return fallback == null ? null : deepClone(fallback);
  const outcomes = {};
  for (const key of OUTCOME_KEYS) outcomes[key] = normalizeDirective(value.outcomes?.[key]);
  return {
    checkIds: uniqueStrings(value.checkIds),
    combine: CHECK_COMBINE_MODES.includes(value.combine) ? value.combine : "single",
    outcomes
  };
}

export function normalizeSavePolicy(value, fallback = createDefaultSavePolicy()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : createDefaultSavePolicy();
  const execution = cleanString(source.execution, base.execution ?? "player");
  const visibility = cleanString(source.visibility, base.visibility ?? "public");
  return {
    execution: SAVE_EXECUTION_MODES.includes(execution) ? execution : "player",
    visibility: SAVE_VISIBILITY_MODES.includes(visibility) ? visibility : "public"
  };
}


function normalizeDelivery(value, afflictionType, fallback = { injuryPoison: false }) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    injuryPoison: afflictionType === "poison" && (source.injuryPoison ?? fallback?.injuryPoison) === true
  };
}

function normalizeIdentification(value, fallback = { initialState: "identified" }) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const state = cleanString(source.initialState, fallback.initialState ?? "identified");
  return {
    initialState: IDENTIFICATION_STATES.includes(state) ? state : "identified"
  };
}

function normalizeCheck(check, index) {
  const fallback = createDefaultSaveCheck({ id: index === 0 ? "primary" : `check-${index + 1}` });
  const dcMode = SAVE_DC_MODES.includes(check?.dcMode) ? check.dcMode : fallback.dcMode;
  const hasDc = check?.dc !== null && check?.dc !== undefined && check?.dc !== "";
  return {
    id: cleanString(check?.id, fallback.id),
    label: String(check?.label ?? "").trim(),
    kind: "save",
    statistic: cleanString(check?.statistic, fallback.statistic).toLowerCase(),
    dcMode,
    dc: dcMode === "source" && !hasDc ? null : finiteNumber(check?.dc, fallback.dc),
    policy: check?.policy == null ? null : normalizeSavePolicy(check.policy)
  };
}

function normalizeStage(stage, index) {
  const fallback = createDefaultStage({ number: index + 1 });
  return {
    id: cleanString(stage?.id, fallback.id),
    number: index + 1,
    name: String(stage?.name ?? "").trim(),
    description: String(stage?.description ?? ""),
    duration: normalizeDuration(stage?.duration ?? fallback.duration, { allowUnlimited: true }),
    check: stage?.check == null ? null : normalizeCheckGate(stage.check),
    effect: stage?.effect == null ? null : deepClone(stage.effect)
  };
}

export function normalizeAfflictionDefinition(value = {}, { createDefaults = true } = {}) {
  const base = createDefaults ? createAfflictionDefinition() : {};
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceVersion = source.schemaVersion ?? AFFLICTION_SCHEMA_VERSION;
  if (![1, AFFLICTION_SCHEMA_VERSION].includes(sourceVersion)) {
    throw new RangeError(`Unsupported affliction schema version: ${source.schemaVersion}.`);
  }

  const checksSource = Array.isArray(source.checks) && source.checks.length > 0
    ? source.checks
    : (base.checks ?? []);
  const stagesSource = Array.isArray(source.stages) && source.stages.length > 0
    ? source.stages
    : (base.stages ?? []);

  const afflictionType = cleanString(source.afflictionType, base.afflictionType ?? "disease").toLowerCase();

  return {
    schemaVersion: AFFLICTION_SCHEMA_VERSION,
    id: cleanString(source.id, base.id ?? ""),
    name: String(source.name ?? base.name ?? "").trim(),
    description: String(source.description ?? base.description ?? ""),
    img: cleanString(source.img, base.img ?? "icons/svg/biohazard.svg"),
    afflictionType,
    level: finiteNumber(source.level, base.level ?? 1),
    rarity: cleanString(source.rarity, base.rarity ?? "common").toLowerCase(),
    traits: uniqueStrings(source.traits ?? base.traits),
    themes: uniqueStrings(source.themes ?? base.themes),
    saveDefaults: normalizeSavePolicy(source.saveDefaults, base.saveDefaults ?? createDefaultSavePolicy()),
    identification: normalizeIdentification(source.identification, base.identification ?? { initialState: "identified" }),
    delivery: normalizeDelivery(source.delivery, afflictionType, base.delivery ?? { injuryPoison: false }),
    checks: checksSource.map(normalizeCheck),
    initialCheck: source.initialCheck === null
      ? null
      : normalizeCheckGate(source.initialCheck, base.initialCheck ?? createDefaultInitialCheck()),
    onset: normalizeDuration(source.onset ?? base.onset, { allowUnlimited: false }),
    maximumDuration: normalizeDuration(source.maximumDuration ?? base.maximumDuration, { allowUnlimited: true }),
    defaultStageCheck: source.defaultStageCheck === null
      ? null
      : normalizeCheckGate(source.defaultStageCheck, base.defaultStageCheck ?? createDefaultStageCheck()),
    progression: {
      belowStageOne: cleanString(source.progression?.belowStageOne, base.progression?.belowStageOne ?? "recover"),
      aboveMaximumStage: cleanString(source.progression?.aboveMaximumStage, base.progression?.aboveMaximumStage ?? "clamp"),
      virulent: (source.progression?.virulent ?? base.progression?.virulent) === true
    },
    stages: stagesSource.map(normalizeStage),
    metadata: {
      ...(deepClone(base.metadata ?? {})),
      ...(deepClone(source.metadata ?? {}))
    }
  };
}

export function resolveStageCheck(definition, stageOrNumber) {
  const stage = typeof stageOrNumber === "number"
    ? definition?.stages?.find((entry) => entry.number === stageOrNumber)
    : stageOrNumber;
  if (!stage) return null;
  return deepClone(stage.check ?? definition?.defaultStageCheck ?? null);
}

export function resolveSavePolicy(definition, checkOrId) {
  const check = typeof checkOrId === "string"
    ? definition?.checks?.find((entry) => entry.id === checkOrId)
    : checkOrId;
  if (!check) return null;
  return normalizeSavePolicy(check.policy, definition?.saveDefaults ?? createDefaultSavePolicy());
}
