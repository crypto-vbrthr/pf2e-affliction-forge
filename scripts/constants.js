export const MODULE_ID = "pf2e-affliction-forge";
export const MODULE_VERSION = "0.1.19";
export const API_VERSION = "0.1.19";
export const AFFLICTION_SCHEMA_VERSION = 2;
export const CONTROLLER_SCHEMA_VERSION = 2;
export const CRITICAL_FORGE_MODULE_ID = "pf2e-critical-forge";

export const DOCUMENT_KINDS = Object.freeze({
  TEMPLATE: "affliction-template",
  CONTROLLER: "affliction-controller",
  STAGE_EFFECT: "affliction-stage-effect",
  RESIDUAL_EFFECT: "affliction-residual-effect"
});

export const AFFLICTION_TYPES = Object.freeze([
  "poison",
  "disease",
  "curse",
  "other"
]);

export const RARITIES = Object.freeze([
  "common",
  "uncommon",
  "rare",
  "unique"
]);

export const SAVE_STATISTICS = Object.freeze([
  "fortitude",
  "reflex",
  "will"
]);

export const SAVE_EXECUTION_MODES = Object.freeze([
  "automatic",
  "player",
  "gm"
]);

export const SAVE_VISIBILITY_MODES = Object.freeze([
  "public",
  "gmOnly"
]);

export const IDENTIFICATION_STATES = Object.freeze([
  "hidden",
  "suspected",
  "identified"
]);

export const DURATION_UNITS = Object.freeze([
  "rounds",
  "minutes",
  "hours",
  "days",
  "unlimited"
]);

export const CHECK_COMBINE_MODES = Object.freeze([
  "single",
  "best-degree",
  "worst-degree",
  "all-success",
  "any-success"
]);

export const OUTCOME_KEYS = Object.freeze([
  "criticalSuccess",
  "success",
  "failure",
  "criticalFailure"
]);

export const TRANSITION_ACTIONS = Object.freeze([
  "none",
  "reject",
  "recover",
  "stay",
  "set-stage",
  "stage-delta"
]);
