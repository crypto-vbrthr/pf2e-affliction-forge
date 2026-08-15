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

export function createDefaultPreActionGate({
  id = "gate-1",
  label = "",
  actionKinds = ["spell-cast", "item-activation"],
  requiredTraits = ["concentrate"],
  dc = 5,
  blockOnFailure = true
} = {}) {
  return {
    id,
    label,
    trigger: {
      actionKinds: Array.isArray(actionKinds) ? [...actionKinds] : [actionKinds],
      requiredTraits: Array.isArray(requiredTraits) ? [...requiredTraits] : [requiredTraits]
    },
    check: { kind: "flat", dc },
    blockOnFailure
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
  controllerActions = null,
  effect = null
} = {}) {
  return {
    id,
    label,
    trigger: { event, damageTypes, conditionSlugs },
    checkId,
    applyOn,
    conditionValueDelta,
    controllerActions: controllerActions ?? {
      criticalSuccess: "none",
      success: "none",
      failure: "none",
      criticalFailure: "none"
    },
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
    expiryAction: "check",
    check: null,
    restrictions: createDefaultRestrictions(),
    effectPersistence: "stage",
    effectPersistenceDuration: null,
    effectComponentPersistence: [],
    effectComponentPersistenceDurations: [],
    effect: null,
    numericModifiers: [],
    periodicEffects: [],
    preActionGates: [],
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
  multipleExposure = "default",
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
    multipleExposure,
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
  stageEffectPersistence: ["stage", "affliction", "permanent", "timed"],
  timedResidualPersistence: "timed persistence requires a fixed or formula duration and starts when the stage output becomes residual",
  componentEffectPersistence: "per-component override; null inherits stage persistence; timed overrides may supply their own duration",
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
  preActionGates: {
    scope: "stage",
    actionKinds: ["spell-cast", "item-activation"],
    requiredTraits: "all-required-traits-must-match",
    checks: ["flat"],
    failure: "may-block-action-before-resource-consumption",
    itemActivationIntegration: "public-api-for-external-activation-workflows"
  },
  eventReactions: {
    events: ["damage-taken", "condition-increased", "initiative-rolled", "turn-start"],
    optionalDamageTypeFilter: true,
    optionalConditionSlugFilter: true,
    optionalSaveCheck: true,
    triggeringConditionValueDelta: true,
    outcomeEffect: "critical-forge-effect-definition",
    controllerOutcomeActions: ["none", "recover", "end"],
    stageProgression: "unchanged"
  },
  stageExpiry: {
    actions: ["check", "recover", "end", "stay"],
    default: "check"
  },
  deliveryCapabilities: {
    injuryPoison: "weapon-or-melee-reference-with-consumable-charges",
    repeatedPoisonExposure: "new-initial-save-without-restarting-onset-or-maximum-duration",
    repeatedExposureOverride: ["default", "ignore"],
    injuryPoisonDamageTypes: ["slashing", "piercing"],
    oneInjuryPoisonPerHost: true
  },
  incapacitation: {
    sourceLevel: "affliction-level",
    targetHigherLevel: "improve-save-degree-by-one"
  }
});

// Kept as an import compatibility alias during the 0.1.x line.
export const AFFLICTION_DATA_CONTRACT_V1 = AFFLICTION_DATA_CONTRACT_V2;
