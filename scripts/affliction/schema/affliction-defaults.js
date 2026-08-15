import { AFFLICTION_SCHEMA_VERSION } from "../../constants.js";
import { deepFreeze, randomId } from "./utils.js";

export function createDefaultSavePolicy({
  execution = "player",
  visibility = "public"
} = {}) {
  return { execution, visibility };
}

export function createDefaultRestrictions() {
  return {
    conditionLocks: [],
    healing: "none",
    unhealableDamageTypes: [],
    blockedCapabilities: []
  };
}

export function createDefaultSaveCheck({
  id = "primary",
  label = "",
  statistic = "fortitude",
  dc = 15,
  dcMode = "fixed",
  policy = null
} = {}) {
  return {
    id,
    label,
    kind: "save",
    statistic,
    dcMode,
    dc,
    policy
  };
}

export function createDefaultInitialCheck() {
  return {
    checkIds: ["primary"],
    combine: "single",
    outcomes: {
      criticalSuccess: { action: "reject" },
      success: { action: "reject" },
      failure: { action: "set-stage", stage: 1 },
      criticalFailure: { action: "set-stage", stage: 2 }
    }
  };
}

export function createDefaultStageCheck() {
  return {
    checkIds: ["primary"],
    combine: "single",
    outcomes: {
      criticalSuccess: { action: "stage-delta", delta: -2 },
      success: { action: "stage-delta", delta: -1 },
      failure: { action: "stage-delta", delta: 1 },
      criticalFailure: { action: "stage-delta", delta: 2 }
    }
  };
}


export function createDefaultNumericModifier({
  id = "modifier-1",
  label = "",
  selectors = ["all-speeds"],
  type = "untyped",
  value = -5
} = {}) {
  return {
    id,
    label,
    selectors: Array.isArray(selectors) ? [...selectors] : [selectors],
    type,
    value
  };
}

export function createDefaultPeriodicEffect({
  id = "periodic-1",
  label = "",
  interval = { value: 1, unit: "minutes" },
  effect = null
} = {}) {
  return {
    id,
    label,
    interval,
    effect
  };
}

export function createDefaultEventReaction({
  id = "reaction-1",
  label = "",
  event = "damage-taken",
  damageTypes = [],
  conditionSlugs = [],
  checkId = "primary",
  applyOn = ["failure", "criticalFailure"],
  conditionValueDelta = 0,
  effect = null
} = {}) {
  return {
    id,
    label,
    trigger: { event, damageTypes, conditionSlugs },
    checkId,
    applyOn,
    conditionValueDelta,
    effect
  };
}

export function createDefaultStage({ number = 1 } = {}) {
  return {
    id: `stage-${number}`,
    number,
    name: "",
    description: "",
    duration: { value: 1, unit: "rounds" },
    check: null,
    restrictions: createDefaultRestrictions(),
    effectPersistence: "stage",
    effectComponentPersistence: [],
    effect: null,
    numericModifiers: [],
    periodicEffects: [],
    reactions: []
  };
}

export function createAfflictionDefinition({
  id = randomId("pf2e-affliction-forge.custom"),
  name = "",
  description = "",
  img = "icons/svg/biohazard.svg",
  afflictionType = "disease",
  level = 1,
  rarity = "common",
  traits = [],
  themes = [],
  saveDefaults = createDefaultSavePolicy(),
  identification = { initialState: "identified" },
  delivery = { injuryPoison: false },
  restrictions = createDefaultRestrictions(),
  checks = [createDefaultSaveCheck()],
  initialCheck = createDefaultInitialCheck(),
  onset = null,
  maximumDuration = null,
  defaultStageCheck = createDefaultStageCheck(),
  stages = [createDefaultStage()],
  progression = null,
  metadata = {}
} = {}) {
  return {
    schemaVersion: AFFLICTION_SCHEMA_VERSION,
    id,
    name,
    description,
    img,
    afflictionType,
    level,
    rarity,
    traits,
    themes,
    saveDefaults,
    identification,
    delivery,
    restrictions,
    checks,
    initialCheck,
    onset,
    maximumDuration,
    defaultStageCheck,
    progression: progression ?? {
      belowStageOne: "recover",
      aboveMaximumStage: "clamp",
      virulent: false
    },
    stages,
    metadata: {
      originModule: "pf2e-affliction-forge",
      originFeature: "affliction-definition",
      ...metadata
    }
  };
}

export const AFFLICTION_DATA_CONTRACT_V2 = deepFreeze({
  schemaVersion: AFFLICTION_SCHEMA_VERSION,
  requiredRootFields: [
    "schemaVersion", "id", "name", "afflictionType", "level", "rarity",
    "traits", "themes", "saveDefaults", "identification", "restrictions", "checks", "stages"
  ],
  savePolicy: {
    defaultsAtRoot: true,
    perCheckOverride: true,
    executionModes: ["automatic", "player", "gm"],
    visibilityModes: ["public", "gmOnly"],
    dcModes: ["fixed", "source"],
    sourceDcApplicationOptions: ["saveDc", "saveDcs"]
  },
  identificationStates: ["hidden", "suspected", "identified"],
  stageEffectOwnership: "affliction-engine",
  templateItemType: "effect",
  templateRuleElements: "none",
  activeDefinitionPolicy: "snapshot-on-application",
  restrictions: {
    scopes: ["affliction", "stage"],
    healingModes: ["none", "all", "affliction-damage"],
    typedHealingLocks: "damage-type-slug-array",
    blockedCapabilities: ["speak"],
    conditionLocks: "slug-plus-optional-minimum"
  },
  stageEffectPersistence: ["stage", "affliction", "permanent"],
  componentEffectPersistence: "per-component override; null inherits stage persistence",
  numericModifiers: {
    scope: "stage",
    implementation: "pf2e-flat-modifier-rule-element",
    selectors: "one-or-more-pf2e-selector-slugs",
    types: ["untyped", "status", "circumstance", "item"]
  },
  periodicStageEffects: {
    scope: "stage",
    interval: "fixed-duration-or-dice-formula",
    effect: "critical-forge-effect-definition",
    schedule: "persisted-per-controller-stage"
  },
  eventReactions: {
    events: ["damage-taken", "condition-increased"],
    optionalDamageTypeFilter: true,
    optionalConditionSlugFilter: true,
    optionalSaveCheck: true,
    triggeringConditionValueDelta: true,
    outcomeEffect: "critical-forge-effect-definition",
    stageProgression: "unchanged"
  },
  deliveryCapabilities: {
    injuryPoison: "weapon-or-melee-reference-with-consumable-charges"
  }
});

// Kept as an import compatibility alias during the 0.1.x line.
export const AFFLICTION_DATA_CONTRACT_V1 = AFFLICTION_DATA_CONTRACT_V2;
