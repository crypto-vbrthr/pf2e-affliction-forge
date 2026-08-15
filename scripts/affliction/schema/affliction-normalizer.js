import {
  AFFLICTION_SCHEMA_VERSION,
  AFFLICTION_CAPABILITIES,
  AFFLICTION_PRE_ACTION_KINDS,
  AFFLICTION_REACTION_EVENTS,
  CHECK_COMBINE_MODES,
  DURATION_UNITS,
  HEALING_RESTRICTION_MODES,
  IDENTIFICATION_STATES,
  NUMERIC_MODIFIER_TYPES,
  OUTCOME_KEYS,
  SAVE_DC_MODES,
  SAVE_EXECUTION_MODES,
  SAVE_VISIBILITY_MODES,
  STAGE_EFFECT_PERSISTENCE_MODES
} from "../../constants.js";
import {
  createAfflictionDefinition,
  createDefaultEventReaction,
  createDefaultInitialCheck,
  createDefaultNumericModifier,
  createDefaultPeriodicEffect,
  createDefaultPreActionGate,
  createDefaultRestrictions,
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


function normalizeConditionLock(value) {
  if (typeof value === "string") {
    const slug = cleanString(value).toLowerCase();
    return slug ? { slug, minimum: null } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const slug = cleanString(value.slug).toLowerCase();
  if (!slug) return null;
  const rawMinimum = value.minimum;
  const minimum = rawMinimum == null || rawMinimum === ""
    ? null
    : Math.max(1, Math.trunc(finiteNumber(rawMinimum, 1)));
  return { slug, minimum };
}

export function normalizeRestrictions(value, fallback = createDefaultRestrictions()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : createDefaultRestrictions();
  const conditionLocks = Array.isArray(source.conditionLocks ?? base.conditionLocks)
    ? (source.conditionLocks ?? base.conditionLocks).map(normalizeConditionLock).filter(Boolean)
    : [];
  const healing = cleanString(source.healing, base.healing ?? "none");
  const unhealableDamageTypes = uniqueStrings(source.unhealableDamageTypes ?? base.unhealableDamageTypes)
    .map((entry) => entry.toLowerCase());
  const blockedCapabilities = uniqueStrings(source.blockedCapabilities ?? base.blockedCapabilities)
    .map((entry) => entry.toLowerCase())
    .filter((entry) => AFFLICTION_CAPABILITIES.includes(entry));
  return {
    conditionLocks,
    healing: HEALING_RESTRICTION_MODES.includes(healing) ? healing : "none",
    unhealableDamageTypes,
    blockedCapabilities
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

function normalizeNumericModifier(value, index) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = createDefaultNumericModifier({ id: `modifier-${index + 1}` });
  const selectorSource = source.selectors ?? source.selector ?? fallback.selectors;
  const selectors = uniqueStrings(Array.isArray(selectorSource) ? selectorSource : [selectorSource])
    .map((entry) => entry.toLowerCase());
  const type = cleanString(source.type, fallback.type).toLowerCase();
  return {
    id: cleanString(source.id, fallback.id),
    label: String(source.label ?? "").trim(),
    selectors: selectors.length > 0 ? selectors : [...fallback.selectors],
    type: NUMERIC_MODIFIER_TYPES.includes(type) ? type : fallback.type,
    value: finiteNumber(source.value, fallback.value)
  };
}

function normalizePeriodicInterval(value, fallback = { value: 1, unit: "minutes" }) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const unit = UNIT_ALIASES[cleanString(source.unit, fallback.unit ?? "minutes").toLowerCase()] ?? "minutes";
  const normalizedUnit = DURATION_UNITS.includes(unit) && unit !== "unlimited" ? unit : "minutes";
  const formula = String(source.formula ?? "").trim();
  if (formula) return { formula, unit: normalizedUnit };
  return { value: Math.max(1, finiteNumber(source.value, fallback.value ?? 1)), unit: normalizedUnit };
}

function normalizePeriodicEffect(value, index) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = createDefaultPeriodicEffect({ id: `periodic-${index + 1}` });
  return {
    id: cleanString(source.id, fallback.id),
    label: String(source.label ?? "").trim(),
    interval: normalizePeriodicInterval(source.interval, fallback.interval),
    effect: source.effect == null ? null : deepClone(source.effect)
  };
}

function normalizePreActionGate(value, index) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = createDefaultPreActionGate({ id: `gate-${index + 1}` });
  const triggerSource = source.trigger && typeof source.trigger === "object" && !Array.isArray(source.trigger)
    ? source.trigger
    : {};
  const actionKinds = uniqueStrings(triggerSource.actionKinds ?? fallback.trigger.actionKinds)
    .map((entry) => entry.toLowerCase())
    .filter((entry) => AFFLICTION_PRE_ACTION_KINDS.includes(entry));
  const checkSource = source.check && typeof source.check === "object" && !Array.isArray(source.check)
    ? source.check
    : fallback.check;
  return {
    id: cleanString(source.id, fallback.id),
    label: String(source.label ?? "").trim(),
    trigger: {
      actionKinds: actionKinds.length > 0 ? actionKinds : [...fallback.trigger.actionKinds],
      requiredTraits: uniqueStrings(triggerSource.requiredTraits ?? fallback.trigger.requiredTraits)
        .map((entry) => entry.toLowerCase())
    },
    check: {
      kind: "flat",
      dc: Math.trunc(finiteNumber(checkSource.dc, fallback.check.dc))
    },
    blockOnFailure: source.blockOnFailure !== false
  };
}

function normalizeEventReaction(value, index) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = createDefaultEventReaction({ id: `reaction-${index + 1}` });
  const triggerSource = source.trigger && typeof source.trigger === "object" && !Array.isArray(source.trigger)
    ? source.trigger
    : {};
  const event = cleanString(triggerSource.event, fallback.trigger.event).toLowerCase();
  const checkIdSource = source.checkId;
  const checkId = checkIdSource == null || String(checkIdSource).trim() === ""
    ? null
    : cleanString(checkIdSource, fallback.checkId);
  return {
    id: cleanString(source.id, fallback.id),
    label: String(source.label ?? "").trim(),
    trigger: {
      event: AFFLICTION_REACTION_EVENTS.includes(event) ? event : fallback.trigger.event,
      damageTypes: uniqueStrings(triggerSource.damageTypes).map((entry) => entry.toLowerCase()),
      conditionSlugs: uniqueStrings(triggerSource.conditionSlugs).map((entry) => entry.toLowerCase())
    },
    checkId,
    applyOn: checkId
      ? uniqueStrings(source.applyOn ?? fallback.applyOn).filter((entry) => OUTCOME_KEYS.includes(entry))
      : [],
    conditionValueDelta: Math.trunc(finiteNumber(source.conditionValueDelta, 0)),
    effect: source.effect == null ? null : deepClone(source.effect)
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

function normalizeEffectComponentPersistence(value, componentCount = 0) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: Math.max(0, componentCount) }, (_, index) => {
    const mode = source[index];
    return mode == null || mode === "" ? null : (STAGE_EFFECT_PERSISTENCE_MODES.includes(mode) ? mode : null);
  });
}

export function resolveStageComponentPersistence(stage, componentIndex) {
  const override = stage?.effectComponentPersistence?.[componentIndex];
  return STAGE_EFFECT_PERSISTENCE_MODES.includes(override) ? override : (stage?.effectPersistence ?? "stage");
}

function normalizeStage(stage, index) {
  const fallback = createDefaultStage({ number: index + 1 });
  const componentCount = Array.isArray(stage?.effect?.components) ? stage.effect.components.length : 0;
  return {
    id: cleanString(stage?.id, fallback.id),
    number: index + 1,
    name: String(stage?.name ?? "").trim(),
    description: String(stage?.description ?? ""),
    duration: normalizeDuration(stage?.duration ?? fallback.duration, { allowUnlimited: true }),
    check: stage?.check == null ? null : normalizeCheckGate(stage.check),
    restrictions: normalizeRestrictions(stage?.restrictions, fallback.restrictions),
    effectPersistence: STAGE_EFFECT_PERSISTENCE_MODES.includes(stage?.effectPersistence)
      ? stage.effectPersistence
      : fallback.effectPersistence,
    effectComponentPersistence: normalizeEffectComponentPersistence(stage?.effectComponentPersistence, componentCount),
    effect: stage?.effect == null ? null : deepClone(stage.effect),
    numericModifiers: Array.isArray(stage?.numericModifiers) ? stage.numericModifiers.map(normalizeNumericModifier) : [],
    periodicEffects: Array.isArray(stage?.periodicEffects) ? stage.periodicEffects.map(normalizePeriodicEffect) : [],
    preActionGates: Array.isArray(stage?.preActionGates) ? stage.preActionGates.map(normalizePreActionGate) : [],
    reactions: Array.isArray(stage?.reactions) ? stage.reactions.map(normalizeEventReaction) : []
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
    restrictions: normalizeRestrictions(source.restrictions, base.restrictions ?? createDefaultRestrictions()),
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

export function mergeRestrictions(...values) {
  const normalized = values.filter(Boolean).map((value) => normalizeRestrictions(value));
  const conditionBySlug = new Map();
  const blockedCapabilities = new Set();
  const unhealableDamageTypes = new Set();
  let healing = "none";
  const healingRank = { none: 0, "affliction-damage": 1, all: 2 };

  for (const restrictions of normalized) {
    for (const lock of restrictions.conditionLocks) {
      const previous = conditionBySlug.get(lock.slug);
      const minimums = [previous?.minimum, lock.minimum].filter((entry) => Number.isInteger(entry));
      conditionBySlug.set(lock.slug, {
        slug: lock.slug,
        minimum: minimums.length > 0 ? Math.max(...minimums) : null
      });
    }
    if ((healingRank[restrictions.healing] ?? 0) > (healingRank[healing] ?? 0)) healing = restrictions.healing;
    for (const damageType of restrictions.unhealableDamageTypes ?? []) unhealableDamageTypes.add(damageType);
    for (const capability of restrictions.blockedCapabilities) blockedCapabilities.add(capability);
  }

  return {
    conditionLocks: [...conditionBySlug.values()],
    healing,
    unhealableDamageTypes: [...unhealableDamageTypes],
    blockedCapabilities: [...blockedCapabilities]
  };
}

export function resolveAfflictionRestrictions(definition, stageOrNumber = null) {
  const stage = typeof stageOrNumber === "number"
    ? definition?.stages?.find((entry) => entry.number === stageOrNumber)
    : stageOrNumber;
  return mergeRestrictions(definition?.restrictions, stage?.restrictions);
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
