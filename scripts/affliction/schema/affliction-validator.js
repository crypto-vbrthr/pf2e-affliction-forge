import {
  AFFLICTION_CAPABILITIES,
  AFFLICTION_PRE_ACTION_KINDS,
  AFFLICTION_REACTION_EVENTS,
  AFFLICTION_SCHEMA_VERSION,
  AFFLICTION_TYPES,
  CHECK_COMBINE_MODES,
  DURATION_UNITS,
  HEALING_RESTRICTION_MODES,
  OUTCOME_KEYS,
  IDENTIFICATION_STATES,
  NUMERIC_MODIFIER_TYPES,
  RARITIES,
  SAVE_DC_MODES,
  SAVE_EXECUTION_MODES,
  SAVE_STATISTICS,
  SAVE_VISIBILITY_MODES,
  STAGE_EFFECT_PERSISTENCE_MODES,
  TRANSITION_ACTIONS
} from "../../constants.js";
import { AfflictionValidationError, AfflictionValidationReport } from "./validation-report.js";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(report, value, path, code) {
  if (typeof value !== "string" || !value.trim()) {
    report.add({ severity: "error", code, path, message: `${path} must be a non-empty string.` });
    return false;
  }
  return true;
}

function validateDuration(report, duration, path, { nullable = false, allowUnlimited = true } = {}) {
  if (duration == null) {
    if (!nullable) report.add({ severity: "error", code: "duration.required", path, message: `${path} is required.` });
    return;
  }
  if (!isObject(duration)) {
    report.add({ severity: "error", code: "duration.object", path, message: `${path} must be an object.` });
    return;
  }
  if (!DURATION_UNITS.includes(duration.unit)) {
    report.add({ severity: "error", code: "duration.unit", path: `${path}.unit`, message: `Unsupported duration unit: ${duration.unit}.` });
    return;
  }
  if (duration.unit === "unlimited") {
    if (!allowUnlimited) report.add({ severity: "error", code: "duration.unlimited-not-allowed", path, message: `${path} cannot be unlimited.` });
    if (duration.value !== -1) report.add({ severity: "warning", code: "duration.unlimited-value", path: `${path}.value`, message: "Unlimited durations should use value -1." });
    return;
  }
  if (!Number.isFinite(duration.value) || duration.value <= 0) {
    report.add({ severity: "error", code: "duration.value", path: `${path}.value`, message: "Duration value must be greater than 0." });
  }
}

function validateDirective(report, directive, path, stageCount) {
  if (!isObject(directive)) {
    report.add({ severity: "error", code: "transition.object", path, message: `${path} must be an object.` });
    return;
  }
  if (!TRANSITION_ACTIONS.includes(directive.action)) {
    report.add({ severity: "error", code: "transition.action", path: `${path}.action`, message: `Unsupported transition action: ${directive.action}.` });
    return;
  }
  if (directive.action === "set-stage") {
    if (!Number.isInteger(directive.stage) || directive.stage < 1) {
      report.add({ severity: "error", code: "transition.stage", path: `${path}.stage`, message: "set-stage requires a positive integer stage." });
    }
  }
  if (directive.action === "stage-delta" && (!Number.isInteger(directive.delta) || directive.delta === 0)) {
    report.add({ severity: "error", code: "transition.delta", path: `${path}.delta`, message: "stage-delta requires a non-zero integer delta." });
  }
}

function validateCheckGate(report, gate, path, checkIds, stageCount) {
  if (gate == null) return;
  if (!isObject(gate)) {
    report.add({ severity: "error", code: "check-gate.object", path, message: `${path} must be an object.` });
    return;
  }
  if (!Array.isArray(gate.checkIds) || gate.checkIds.length === 0) {
    report.add({ severity: "error", code: "check-gate.checks", path: `${path}.checkIds`, message: "At least one check is required." });
  } else {
    for (const [index, checkId] of gate.checkIds.entries()) {
      if (!checkIds.has(checkId)) {
        report.add({ severity: "error", code: "check-gate.unknown-check", path: `${path}.checkIds.${index}`, message: `Unknown check id: ${checkId}.` });
      }
    }
  }
  if (!CHECK_COMBINE_MODES.includes(gate.combine)) {
    report.add({ severity: "error", code: "check-gate.combine", path: `${path}.combine`, message: `Unsupported check combination: ${gate.combine}.` });
  }
  if (gate.combine === "single" && gate.checkIds?.length !== 1) {
    report.add({ severity: "error", code: "check-gate.single-count", path: `${path}.checkIds`, message: "The single combination requires exactly one check." });
  }
  if (!isObject(gate.outcomes)) {
    report.add({ severity: "error", code: "check-gate.outcomes", path: `${path}.outcomes`, message: "Outcome transitions are required." });
    return;
  }
  for (const outcome of OUTCOME_KEYS) {
    validateDirective(report, gate.outcomes[outcome], `${path}.outcomes.${outcome}`, stageCount);
  }
}


function validateSavePolicy(report, policy, path, { nullable = false } = {}) {
  if (policy == null) {
    if (!nullable) report.add({ severity: "error", code: "save-policy.required", path, message: `${path} is required.` });
    return;
  }
  if (!isObject(policy)) {
    report.add({ severity: "error", code: "save-policy.object", path, message: `${path} must be an object.` });
    return;
  }
  if (!SAVE_EXECUTION_MODES.includes(policy.execution)) {
    report.add({ severity: "error", code: "save-policy.execution", path: `${path}.execution`, message: `Unsupported save execution mode: ${policy.execution}.` });
  }
  if (!SAVE_VISIBILITY_MODES.includes(policy.visibility)) {
    report.add({ severity: "error", code: "save-policy.visibility", path: `${path}.visibility`, message: `Unsupported save visibility mode: ${policy.visibility}.` });
  }
}


function validateRestrictions(report, restrictions, path) {
  if (!isObject(restrictions)) {
    report.add({ severity: "error", code: "restrictions.object", path, message: `${path} must be an object.` });
    return;
  }
  if (!Array.isArray(restrictions.conditionLocks)) {
    report.add({ severity: "error", code: "restrictions.condition-locks", path: `${path}.conditionLocks`, message: "conditionLocks must be an array." });
  } else {
    const slugs = new Set();
    for (const [index, lock] of restrictions.conditionLocks.entries()) {
      const lockPath = `${path}.conditionLocks.${index}`;
      if (!isObject(lock)) {
        report.add({ severity: "error", code: "restriction.condition-lock.object", path: lockPath, message: "Condition lock must be an object." });
        continue;
      }
      if (requiredString(report, lock.slug, `${lockPath}.slug`, "restriction.condition-lock.slug")) {
        if (slugs.has(lock.slug)) report.add({ severity: "warning", code: "restriction.condition-lock.duplicate", path: `${lockPath}.slug`, message: `Duplicate condition lock: ${lock.slug}.` });
        slugs.add(lock.slug);
      }
      if (lock.minimum != null && (!Number.isInteger(lock.minimum) || lock.minimum < 1)) {
        report.add({ severity: "error", code: "restriction.condition-lock.minimum", path: `${lockPath}.minimum`, message: "Condition lock minimum must be a positive integer or null." });
      }
    }
  }
  if (!HEALING_RESTRICTION_MODES.includes(restrictions.healing)) {
    report.add({ severity: "error", code: "restrictions.healing", path: `${path}.healing`, message: `Unsupported healing restriction: ${restrictions.healing}.` });
  }
  if (!Array.isArray(restrictions.unhealableDamageTypes)) {
    report.add({ severity: "error", code: "restrictions.damage-types", path: `${path}.unhealableDamageTypes`, message: "unhealableDamageTypes must be an array." });
  } else {
    for (const [index, damageType] of restrictions.unhealableDamageTypes.entries()) {
      if (typeof damageType !== "string" || !damageType.trim()) {
        report.add({ severity: "error", code: "restrictions.damage-type", path: `${path}.unhealableDamageTypes.${index}`, message: "Healing-locked damage types must be non-empty strings." });
      }
    }
  }
  if (!Array.isArray(restrictions.blockedCapabilities)) {
    report.add({ severity: "error", code: "restrictions.capabilities", path: `${path}.blockedCapabilities`, message: "blockedCapabilities must be an array." });
  } else {
    for (const [index, capability] of restrictions.blockedCapabilities.entries()) {
      if (!AFFLICTION_CAPABILITIES.includes(capability)) {
        report.add({ severity: "error", code: "restrictions.capability", path: `${path}.blockedCapabilities.${index}`, message: `Unsupported blocked capability: ${capability}.` });
      }
    }
  }
}

function validateDelivery(report, definition) {
  const delivery = definition.delivery;
  if (delivery == null) return; // Additive 0.1.x capability; legacy schema-v2 values normalize to false.
  if (!isObject(delivery)) {
    report.add({ severity: "error", code: "delivery.object", path: "delivery", message: "Delivery settings must be an object." });
    return;
  }
  if (typeof delivery.injuryPoison !== "boolean") {
    report.add({ severity: "error", code: "delivery.injury-poison", path: "delivery.injuryPoison", message: "injuryPoison must be a boolean." });
  } else if (delivery.injuryPoison && definition.afflictionType !== "poison") {
    report.add({ severity: "error", code: "delivery.injury-poison-type", path: "delivery.injuryPoison", message: "Only poison Afflictions can be marked as injury poison." });
  }
}

function validateIdentification(report, identification) {
  if (!isObject(identification)) {
    report.add({ severity: "error", code: "identification.object", path: "identification", message: "Identification settings are required." });
    return;
  }
  if (!IDENTIFICATION_STATES.includes(identification.initialState)) {
    report.add({
      severity: "error",
      code: "identification.initial-state",
      path: "identification.initialState",
      message: `Unsupported initial identification state: ${identification.initialState}.`
    });
  }
}

function validateChecks(report, checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    report.add({ severity: "error", code: "checks.required", path: "checks", message: "At least one check definition is required." });
    return new Set();
  }
  const ids = new Set();
  for (const [index, check] of checks.entries()) {
    const path = `checks.${index}`;
    if (!isObject(check)) {
      report.add({ severity: "error", code: "check.object", path, message: `${path} must be an object.` });
      continue;
    }
    if (requiredString(report, check.id, `${path}.id`, "check.id")) {
      if (ids.has(check.id)) report.add({ severity: "error", code: "check.id.duplicate", path: `${path}.id`, message: `Duplicate check id: ${check.id}.` });
      ids.add(check.id);
    }
    if (check.kind !== "save") report.add({ severity: "error", code: "check.kind", path: `${path}.kind`, message: "Affliction Forge supports save checks only." });
    if (!SAVE_STATISTICS.includes(check.statistic)) report.add({ severity: "error", code: "check.statistic", path: `${path}.statistic`, message: `Unsupported save statistic: ${check.statistic}.` });
    if (!SAVE_DC_MODES.includes(check.dcMode)) report.add({ severity: "error", code: "check.dc-mode", path: `${path}.dcMode`, message: `Unsupported save DC mode: ${check.dcMode}.` });
    if (check.dcMode === "fixed" && (!Number.isInteger(check.dc) || check.dc < 1 || check.dc > 100)) {
      report.add({ severity: "error", code: "check.dc", path: `${path}.dc`, message: "Fixed save DC must be an integer from 1 to 100." });
    }
    if (check.dcMode === "source" && check.dc != null && (!Number.isInteger(check.dc) || check.dc < 1 || check.dc > 100)) {
      report.add({ severity: "error", code: "check.dc", path: `${path}.dc`, message: "Resolved source save DC must be an integer from 1 to 100 when present." });
    }
    validateSavePolicy(report, check.policy, `${path}.policy`, { nullable: true });
  }
  return ids;
}

function adaptEffectReport(effectReport) {
  if (!effectReport) return [];
  if (Array.isArray(effectReport.issues)) return effectReport.issues;
  return [];
}

function resolveEffectIssueMessage(issue) {
  const explicit = String(issue?.message ?? "").trim();
  if (explicit) return explicit;

  const messageKey = String(issue?.messageKey ?? "").trim();
  if (!messageKey) return String(issue?.code ?? "Invalid Effect Definition.");

  const i18n = globalThis.game?.i18n;
  const candidates = messageKey.startsWith("PF2E_CRITICAL_FORGE.")
    ? [messageKey]
    : [`PF2E_CRITICAL_FORGE.${messageKey}`, messageKey];

  for (const key of candidates) {
    try {
      const formatted = i18n?.format?.(key, issue?.data ?? {});
      if (formatted && formatted !== key) return formatted;
      const localized = i18n?.localize?.(key);
      if (localized && localized !== key) return localized;
    } catch {
      // Validation remains usable in headless tests or if the provider has no locale entry.
    }
  }

  return messageKey;
}


function validateReactionEffect(report, effect, path, effectValidator) {
  if (effect == null) return;
  if (!isObject(effect)) {
    report.add({ severity: "error", code: "reaction.effect.object", path, message: "Reaction effect must be an Effect Definition object or null." });
    return;
  }
  if (typeof effectValidator !== "function") return;
  try {
    const effectReport = effectValidator(effect);
    for (const issue of adaptEffectReport(effectReport)) {
      report.add({
        severity: issue.severity === "info" ? "info" : issue.severity,
        code: `reaction.effect.${issue.code ?? "invalid"}`,
        path: `${path}${Number.isInteger(issue.componentIndex) ? `.components.${issue.componentIndex}` : ""}`,
        message: resolveEffectIssueMessage(issue),
        data: { ...(issue.data ?? {}), providerMessageKey: issue.messageKey ?? null }
      });
    }
    if (effectReport?.valid === false && adaptEffectReport(effectReport).length === 0) {
      for (const message of effectReport.errors ?? []) report.add({ severity: "error", code: "reaction.effect.invalid", path, message: String(message) });
    }
  } catch (error) {
    report.add({ severity: "error", code: "reaction.effect.validator-failed", path, message: `Effect validation failed: ${error.message}` });
  }
}

function validateNumericModifiers(report, modifiers, path) {
  if (!Array.isArray(modifiers)) {
    report.add({ severity: "error", code: "numeric-modifier.array", path, message: "Stage numeric modifiers must be an array." });
    return;
  }
  const ids = new Set();
  for (const [index, modifier] of modifiers.entries()) {
    const modifierPath = `${path}.${index}`;
    if (!isObject(modifier)) {
      report.add({ severity: "error", code: "numeric-modifier.object", path: modifierPath, message: "Numeric modifier must be an object." });
      continue;
    }
    if (requiredString(report, modifier.id, `${modifierPath}.id`, "numeric-modifier.id")) {
      if (ids.has(modifier.id)) report.add({ severity: "error", code: "numeric-modifier.id.duplicate", path: `${modifierPath}.id`, message: `Duplicate numeric modifier id: ${modifier.id}.` });
      ids.add(modifier.id);
    }
    if (!Array.isArray(modifier.selectors) || modifier.selectors.length === 0) {
      report.add({ severity: "error", code: "numeric-modifier.selectors", path: `${modifierPath}.selectors`, message: "At least one PF2e selector is required." });
    } else {
      for (const [selectorIndex, selector] of modifier.selectors.entries()) {
        if (typeof selector !== "string" || !selector.trim()) {
          report.add({ severity: "error", code: "numeric-modifier.selector", path: `${modifierPath}.selectors.${selectorIndex}`, message: "Numeric modifier selectors must be non-empty strings." });
        }
      }
    }
    if (!NUMERIC_MODIFIER_TYPES.includes(modifier.type)) {
      report.add({ severity: "error", code: "numeric-modifier.type", path: `${modifierPath}.type`, message: `Unsupported numeric modifier type: ${modifier.type}.` });
    }
    if (!Number.isFinite(modifier.value) || modifier.value === 0) {
      report.add({ severity: "error", code: "numeric-modifier.value", path: `${modifierPath}.value`, message: "Numeric modifier value must be a non-zero finite number." });
    }
  }
}

function validatePeriodicEffects(report, periodicEffects, path, effectValidator) {
  if (!Array.isArray(periodicEffects)) {
    report.add({ severity: "error", code: "periodic.array", path, message: "Periodic stage effects must be an array." });
    return;
  }
  const ids = new Set();
  for (const [index, periodic] of periodicEffects.entries()) {
    const periodicPath = `${path}.${index}`;
    if (!isObject(periodic)) {
      report.add({ severity: "error", code: "periodic.object", path: periodicPath, message: "Periodic stage effect must be an object." });
      continue;
    }
    if (requiredString(report, periodic.id, `${periodicPath}.id`, "periodic.id")) {
      if (ids.has(periodic.id)) report.add({ severity: "error", code: "periodic.id.duplicate", path: `${periodicPath}.id`, message: `Duplicate periodic effect id: ${periodic.id}.` });
      ids.add(periodic.id);
    }
    const interval = periodic.interval;
    if (!isObject(interval)) {
      report.add({ severity: "error", code: "periodic.interval.object", path: `${periodicPath}.interval`, message: "Periodic interval must be an object." });
    } else {
      if (!DURATION_UNITS.includes(interval.unit) || interval.unit === "unlimited") {
        report.add({ severity: "error", code: "periodic.interval.unit", path: `${periodicPath}.interval.unit`, message: `Unsupported periodic interval unit: ${interval.unit}.` });
      }
      const hasFormula = typeof interval.formula === "string" && interval.formula.trim().length > 0;
      const hasValue = Number.isFinite(interval.value) && interval.value > 0;
      if (!hasFormula && !hasValue) {
        report.add({ severity: "error", code: "periodic.interval.value", path: `${periodicPath}.interval`, message: "Periodic interval requires a positive value or a dice formula." });
      }
      if (hasFormula && interval.value != null) {
        report.add({ severity: "warning", code: "periodic.interval.both", path: `${periodicPath}.interval`, message: "Periodic interval contains both formula and value; formula takes precedence." });
      }
    }
    if (periodic.effect == null) {
      report.add({ severity: "warning", code: "periodic.effect.missing", path: `${periodicPath}.effect`, message: "Periodic stage entry has no effect to execute." });
    } else {
      validateReactionEffect(report, periodic.effect, `${periodicPath}.effect`, effectValidator);
    }
  }
}

function validatePreActionGates(report, gates, path) {
  if (!Array.isArray(gates)) {
    report.add({ severity: "error", code: "pre-action.array", path, message: "Stage pre-action gates must be an array." });
    return;
  }
  const ids = new Set();
  for (const [index, gate] of gates.entries()) {
    const gatePath = `${path}.${index}`;
    if (!isObject(gate)) {
      report.add({ severity: "error", code: "pre-action.object", path: gatePath, message: "Pre-action gate must be an object." });
      continue;
    }
    if (requiredString(report, gate.id, `${gatePath}.id`, "pre-action.id")) {
      if (ids.has(gate.id)) report.add({ severity: "error", code: "pre-action.id.duplicate", path: `${gatePath}.id`, message: `Duplicate pre-action gate id: ${gate.id}.` });
      ids.add(gate.id);
    }
    if (!isObject(gate.trigger)) {
      report.add({ severity: "error", code: "pre-action.trigger.object", path: `${gatePath}.trigger`, message: "Pre-action trigger is required." });
    } else {
      if (!Array.isArray(gate.trigger.actionKinds) || gate.trigger.actionKinds.length === 0) {
        report.add({ severity: "error", code: "pre-action.action-kinds", path: `${gatePath}.trigger.actionKinds`, message: "At least one pre-action kind is required." });
      } else {
        for (const [kindIndex, kind] of gate.trigger.actionKinds.entries()) {
          if (!AFFLICTION_PRE_ACTION_KINDS.includes(kind)) report.add({ severity: "error", code: "pre-action.action-kind", path: `${gatePath}.trigger.actionKinds.${kindIndex}`, message: `Unsupported pre-action kind: ${kind}.` });
        }
      }
      if (!Array.isArray(gate.trigger.requiredTraits)) {
        report.add({ severity: "error", code: "pre-action.required-traits", path: `${gatePath}.trigger.requiredTraits`, message: "requiredTraits must be an array." });
      } else {
        for (const [traitIndex, trait] of gate.trigger.requiredTraits.entries()) {
          if (typeof trait !== "string" || !trait.trim()) report.add({ severity: "error", code: "pre-action.required-trait", path: `${gatePath}.trigger.requiredTraits.${traitIndex}`, message: "Required traits must be non-empty strings." });
        }
      }
    }
    if (!isObject(gate.check)) {
      report.add({ severity: "error", code: "pre-action.check.object", path: `${gatePath}.check`, message: "Pre-action check is required." });
    } else {
      if (gate.check.kind !== "flat") report.add({ severity: "error", code: "pre-action.check.kind", path: `${gatePath}.check.kind`, message: `Unsupported pre-action check kind: ${gate.check.kind}.` });
      if (!Number.isInteger(gate.check.dc) || gate.check.dc < 1 || gate.check.dc > 20) {
        report.add({ severity: "error", code: "pre-action.check.dc", path: `${gatePath}.check.dc`, message: "Flat-check DC must be an integer from 1 to 20." });
      }
    }
    if (typeof gate.blockOnFailure !== "boolean") {
      report.add({ severity: "error", code: "pre-action.block-on-failure", path: `${gatePath}.blockOnFailure`, message: "blockOnFailure must be a boolean." });
    }
  }
}

function validateStageReactions(report, reactions, path, checkIds, effectValidator) {
  if (!Array.isArray(reactions)) {
    report.add({ severity: "error", code: "reaction.array", path, message: "Stage reactions must be an array." });
    return;
  }
  const ids = new Set();
  for (const [index, reaction] of reactions.entries()) {
    const reactionPath = `${path}.${index}`;
    if (!isObject(reaction)) {
      report.add({ severity: "error", code: "reaction.object", path: reactionPath, message: "Stage reaction must be an object." });
      continue;
    }
    if (requiredString(report, reaction.id, `${reactionPath}.id`, "reaction.id")) {
      if (ids.has(reaction.id)) report.add({ severity: "error", code: "reaction.id.duplicate", path: `${reactionPath}.id`, message: `Duplicate reaction id: ${reaction.id}.` });
      ids.add(reaction.id);
    }
    if (!isObject(reaction.trigger)) {
      report.add({ severity: "error", code: "reaction.trigger.object", path: `${reactionPath}.trigger`, message: "Reaction trigger is required." });
    } else {
      if (!AFFLICTION_REACTION_EVENTS.includes(reaction.trigger.event)) {
        report.add({ severity: "error", code: "reaction.trigger.event", path: `${reactionPath}.trigger.event`, message: `Unsupported reaction event: ${reaction.trigger.event}.` });
      }
      if (!Array.isArray(reaction.trigger.damageTypes)) {
        report.add({ severity: "error", code: "reaction.trigger.damage-types", path: `${reactionPath}.trigger.damageTypes`, message: "damageTypes must be an array." });
      } else if (reaction.trigger.event !== "damage-taken" && reaction.trigger.damageTypes.length > 0) {
        report.add({ severity: "warning", code: "reaction.trigger.damage-types-unused", path: `${reactionPath}.trigger.damageTypes`, message: "Damage type filters are only used by damage-taken reactions." });
      }
      if (!Array.isArray(reaction.trigger.conditionSlugs)) {
        report.add({ severity: "error", code: "reaction.trigger.condition-slugs", path: `${reactionPath}.trigger.conditionSlugs`, message: "conditionSlugs must be an array." });
      } else if (reaction.trigger.event !== "condition-increased" && reaction.trigger.conditionSlugs.length > 0) {
        report.add({ severity: "warning", code: "reaction.trigger.condition-slugs-unused", path: `${reactionPath}.trigger.conditionSlugs`, message: "Condition filters are only used by condition-increased reactions." });
      }
    }
    const hasCheck = reaction.checkId != null && String(reaction.checkId).trim() !== "";
    if (hasCheck && !checkIds.has(reaction.checkId)) {
      report.add({ severity: "error", code: "reaction.check.unknown", path: `${reactionPath}.checkId`, message: `Unknown reaction check id: ${reaction.checkId}.` });
    }
    if (hasCheck) {
      if (!Array.isArray(reaction.applyOn) || reaction.applyOn.length === 0) {
        report.add({ severity: "error", code: "reaction.apply-on", path: `${reactionPath}.applyOn`, message: "A checked reaction must apply on at least one degree of success." });
      } else {
        for (const [outcomeIndex, outcome] of reaction.applyOn.entries()) {
          if (!OUTCOME_KEYS.includes(outcome)) report.add({ severity: "error", code: "reaction.apply-on.outcome", path: `${reactionPath}.applyOn.${outcomeIndex}`, message: `Unsupported reaction outcome: ${outcome}.` });
        }
      }
    } else if (!Array.isArray(reaction.applyOn)) {
      report.add({ severity: "error", code: "reaction.apply-on.array", path: `${reactionPath}.applyOn`, message: "applyOn must be an array." });
    }
    if (!Number.isInteger(reaction.conditionValueDelta)) {
      report.add({ severity: "error", code: "reaction.condition-delta", path: `${reactionPath}.conditionValueDelta`, message: "conditionValueDelta must be an integer." });
    } else if (reaction.conditionValueDelta !== 0 && reaction.trigger?.event !== "condition-increased") {
      report.add({ severity: "warning", code: "reaction.condition-delta-unused", path: `${reactionPath}.conditionValueDelta`, message: "conditionValueDelta is only used by condition-increased reactions." });
    }
    if (reaction.effect == null && reaction.conditionValueDelta === 0) {
      report.add({ severity: "warning", code: "reaction.effect.missing", path: `${reactionPath}.effect`, message: "Reaction has no mechanical output." });
    } else if (reaction.effect != null) {
      validateReactionEffect(report, reaction.effect, `${reactionPath}.effect`, effectValidator);
    }
  }
}

export function validateAfflictionDefinition(definition, { effectValidator = null } = {}) {
  const report = new AfflictionValidationReport();
  if (!isObject(definition)) {
    report.add({ severity: "error", code: "definition.object", path: "", message: "Affliction definition must be an object." });
    return report.toJSON();
  }

  if (definition.schemaVersion !== AFFLICTION_SCHEMA_VERSION) report.add({ severity: "error", code: "schema.version", path: "schemaVersion", message: `Expected affliction schema ${AFFLICTION_SCHEMA_VERSION}.` });
  requiredString(report, definition.id, "id", "id.required");
  requiredString(report, definition.name, "name", "name.required");
  requiredString(report, definition.img, "img", "img.required");

  if (!AFFLICTION_TYPES.includes(definition.afflictionType)) report.add({ severity: "error", code: "affliction.type", path: "afflictionType", message: `Unsupported affliction type: ${definition.afflictionType}.` });
  if (!Number.isInteger(definition.level) || definition.level < 0 || definition.level > 25) report.add({ severity: "error", code: "affliction.level", path: "level", message: "Level must be an integer from 0 to 25." });
  if (!RARITIES.includes(definition.rarity)) report.add({ severity: "error", code: "affliction.rarity", path: "rarity", message: `Unsupported rarity: ${definition.rarity}.` });
  if (!Array.isArray(definition.traits)) report.add({ severity: "error", code: "affliction.traits", path: "traits", message: "Traits must be an array." });
  if (!Array.isArray(definition.themes)) report.add({ severity: "error", code: "affliction.themes", path: "themes", message: "Themes must be an array." });

  validateSavePolicy(report, definition.saveDefaults, "saveDefaults");
  validateIdentification(report, definition.identification);
  validateDelivery(report, definition);
  validateRestrictions(report, definition.restrictions, "restrictions");

  const checkIds = validateChecks(report, definition.checks);
  const stageCount = Array.isArray(definition.stages) ? definition.stages.length : 0;
  validateCheckGate(report, definition.initialCheck, "initialCheck", checkIds, stageCount);
  validateCheckGate(report, definition.defaultStageCheck, "defaultStageCheck", checkIds, stageCount);
  validateDuration(report, definition.onset, "onset", { nullable: true, allowUnlimited: false });
  validateDuration(report, definition.maximumDuration, "maximumDuration", { nullable: true, allowUnlimited: true });

  if (!isObject(definition.progression)) {
    report.add({ severity: "error", code: "progression.object", path: "progression", message: "Progression settings are required." });
  } else {
    if (!["recover", "clamp"].includes(definition.progression.belowStageOne)) report.add({ severity: "error", code: "progression.below", path: "progression.belowStageOne", message: "belowStageOne must be recover or clamp." });
    if (!["clamp", "end"].includes(definition.progression.aboveMaximumStage)) report.add({ severity: "error", code: "progression.above", path: "progression.aboveMaximumStage", message: "aboveMaximumStage must be clamp or end." });
    if (typeof definition.progression.virulent !== "boolean") report.add({ severity: "error", code: "progression.virulent", path: "progression.virulent", message: "virulent must be a boolean." });
  }

  if (!Array.isArray(definition.stages) || definition.stages.length === 0) {
    report.add({ severity: "error", code: "stages.required", path: "stages", message: "At least one affliction stage is required." });
  } else {
    const stageIds = new Set();
    for (const [index, stage] of definition.stages.entries()) {
      const path = `stages.${index}`;
      if (!isObject(stage)) {
        report.add({ severity: "error", code: "stage.object", path, message: `${path} must be an object.` });
        continue;
      }
      if (requiredString(report, stage.id, `${path}.id`, "stage.id")) {
        if (stageIds.has(stage.id)) report.add({ severity: "error", code: "stage.id.duplicate", path: `${path}.id`, message: `Duplicate stage id: ${stage.id}.` });
        stageIds.add(stage.id);
      }
      if (stage.number !== index + 1) report.add({ severity: "error", code: "stage.number", path: `${path}.number`, message: `Stage number must be ${index + 1}.` });
      validateDuration(report, stage.duration, `${path}.duration`, { nullable: false, allowUnlimited: true });
      validateCheckGate(report, stage.check, `${path}.check`, checkIds, definition.stages.length);
      validateRestrictions(report, stage.restrictions, `${path}.restrictions`);
      validateNumericModifiers(report, stage.numericModifiers ?? [], `${path}.numericModifiers`);
      validatePeriodicEffects(report, stage.periodicEffects ?? [], `${path}.periodicEffects`, effectValidator);
      validatePreActionGates(report, stage.preActionGates ?? [], `${path}.preActionGates`);
      validateStageReactions(report, stage.reactions ?? [], `${path}.reactions`, checkIds, effectValidator);
      if (!STAGE_EFFECT_PERSISTENCE_MODES.includes(stage.effectPersistence)) {
        report.add({ severity: "error", code: "stage.effect-persistence", path: `${path}.effectPersistence`, message: `Unsupported stage effect persistence: ${stage.effectPersistence}.` });
      }
      if (!Array.isArray(stage.effectComponentPersistence)) {
        report.add({ severity: "error", code: "stage.component-persistence", path: `${path}.effectComponentPersistence`, message: "effectComponentPersistence must be an array." });
      } else {
        const componentCount = Array.isArray(stage.effect?.components) ? stage.effect.components.length : 0;
        if (stage.effectComponentPersistence.length > componentCount) {
          report.add({ severity: "warning", code: "stage.component-persistence-extra", path: `${path}.effectComponentPersistence`, message: "Component persistence contains entries for components that do not exist." });
        }
        for (const [componentIndex, mode] of stage.effectComponentPersistence.entries()) {
          if (mode != null && !STAGE_EFFECT_PERSISTENCE_MODES.includes(mode)) {
            report.add({ severity: "error", code: "stage.component-persistence-mode", path: `${path}.effectComponentPersistence.${componentIndex}`, message: `Unsupported component persistence: ${mode}.` });
          }
        }
      }
      if (stage.effectPersistence !== "stage" && stage.effect == null) {
        report.add({ severity: "warning", code: "stage.effect-persistence-without-effect", path: `${path}.effectPersistence`, message: "Persistent stage output has no effect definition to preserve." });
      }
      if (stage.duration?.unit === "unlimited" && (stage.check ?? definition.defaultStageCheck)) {
        report.add({ severity: "warning", code: "stage.unlimited-with-check", path: `${path}.duration`, message: "An unlimited stage with a progression check has no automatic due time." });
      }

      if (stage.effect != null) {
        if (isObject(stage.effect) && stage.effect.duration?.unit !== "unlimited") {
          report.add({
            severity: "warning",
            code: "stage.effect.duration-managed",
            path: `${path}.effect.duration`,
            message: "Stage Effect duration should normally be unlimited because the Affliction Engine owns stage lifecycle."
          });
        }
        if (!isObject(stage.effect)) {
          report.add({ severity: "error", code: "stage.effect.object", path: `${path}.effect`, message: "Stage effect must be an Effect Definition object or null." });
        } else if (typeof effectValidator === "function") {
          try {
            const effectReport = effectValidator(stage.effect);
            for (const issue of adaptEffectReport(effectReport)) {
              report.add({
                severity: issue.severity === "info" ? "info" : issue.severity,
                code: `effect.${issue.code ?? "invalid"}`,
                path: `${path}.effect${Number.isInteger(issue.componentIndex) ? `.components.${issue.componentIndex}` : ""}`,
                message: resolveEffectIssueMessage(issue),
                data: {
                  ...(issue.data ?? {}),
                  providerMessageKey: issue.messageKey ?? null
                }
              });
            }
            if (effectReport?.valid === false && adaptEffectReport(effectReport).length === 0) {
              for (const message of effectReport.errors ?? []) report.add({ severity: "error", code: "effect.invalid", path: `${path}.effect`, message: String(message) });
            }
          } catch (error) {
            report.add({ severity: "error", code: "effect.validator-failed", path: `${path}.effect`, message: `Effect validation failed: ${error.message}` });
          }
        }
      }
    }
  }

  return report.toJSON();
}

export function assertValidAfflictionDefinition(definition, options = {}) {
  const report = validateAfflictionDefinition(definition, options);
  if (!report.valid) throw new AfflictionValidationError(report);
  return definition;
}
