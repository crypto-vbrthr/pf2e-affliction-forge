export const MODULE_ID = "pf2e-affliction-forge";
export const MODULE_VERSION = "0.1.61";
// Public API compatibility is versioned independently from module releases.
// Patch/minor module releases may harden runtime behavior without forcing
// downstream consumers such as Creature Forge to chase a new API number.
export const API_VERSION = "0.1.0";
export const AFFLICTION_SCHEMA_VERSION = 2;
export const CONTROLLER_SCHEMA_VERSION = 2;
export const CRITICAL_FORGE_MODULE_ID = "pf2e-critical-forge";
export const AFFLICTION_DRAG_MIME = "application/x-pf2e-affliction-forge";

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

export const SAVE_DC_MODES = Object.freeze([
  "fixed",
  "source"
]);

export const MULTIPLE_EXPOSURE_MODES = Object.freeze([
  "default",
  "ignore"
]);

export const IDENTIFICATION_STATES = Object.freeze([
  "hidden",
  "suspected",
  "identified"
]);

export const HEALING_RESTRICTION_MODES = Object.freeze([
  "none",
  "all",
  "affliction-damage"
]);

export const AFFLICTION_CAPABILITIES = Object.freeze([
  "speak"
]);

export const AFFLICTION_REACTION_EVENTS = Object.freeze([
  "damage-taken",
  "condition-increased",
  "initiative-rolled",
  "turn-start"
]);

export const REACTION_CONTROLLER_ACTIONS = Object.freeze([
  "none",
  "recover",
  "end"
]);

export const STAGE_EXPIRY_ACTIONS = Object.freeze([
  "check",
  "recover",
  "end",
  "stay"
]);


export const AFFLICTION_PRE_ACTION_KINDS = Object.freeze([
  "spell-cast",
  "item-activation"
]);

export const NUMERIC_MODIFIER_TYPES = Object.freeze([
  "untyped",
  "status",
  "circumstance",
  "item"
]);

export const STAGE_EFFECT_PERSISTENCE_MODES = Object.freeze([
  "stage",
  "affliction",
  "permanent",
  "timed"
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
