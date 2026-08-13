import { AFFLICTION_SCHEMA_VERSION } from "../../constants.js";
import { deepFreeze, randomId } from "./utils.js";

export function createDefaultSavePolicy({
  execution = "player",
  visibility = "public"
} = {}) {
  return { execution, visibility };
}

export function createDefaultSaveCheck({
  id = "primary",
  label = "",
  statistic = "fortitude",
  dc = 15,
  policy = null
} = {}) {
  return {
    id,
    label,
    kind: "save",
    statistic,
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

export function createDefaultStage({ number = 1 } = {}) {
  return {
    id: `stage-${number}`,
    number,
    name: "",
    description: "",
    duration: { value: 1, unit: "rounds" },
    check: null,
    effect: null
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
    checks,
    initialCheck,
    onset,
    maximumDuration,
    defaultStageCheck,
    progression: progression ?? {
      belowStageOne: "recover",
      aboveMaximumStage: "clamp"
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
    "traits", "themes", "saveDefaults", "identification", "checks", "stages"
  ],
  savePolicy: {
    defaultsAtRoot: true,
    perCheckOverride: true,
    executionModes: ["automatic", "player", "gm"],
    visibilityModes: ["public", "gmOnly"]
  },
  identificationStates: ["hidden", "suspected", "identified"],
  stageEffectOwnership: "affliction-engine",
  templateItemType: "effect",
  templateRuleElements: "none",
  activeDefinitionPolicy: "snapshot-on-application"
});

// Kept as an import compatibility alias during the 0.1.x line.
export const AFFLICTION_DATA_CONTRACT_V1 = AFFLICTION_DATA_CONTRACT_V2;
