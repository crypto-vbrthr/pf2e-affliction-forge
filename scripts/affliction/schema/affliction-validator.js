import {
  AFFLICTION_SCHEMA_VERSION,
  AFFLICTION_TYPES,
  CHECK_COMBINE_MODES,
  DURATION_UNITS,
  OUTCOME_KEYS,
  IDENTIFICATION_STATES,
  RARITIES,
  SAVE_DC_MODES,
  SAVE_EXECUTION_MODES,
  SAVE_STATISTICS,
  SAVE_VISIBILITY_MODES,
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
