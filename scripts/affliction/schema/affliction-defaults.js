import { AFFLICTION_SCHEMA_VERSION } from "../../constants.js";
import { deepFreeze, randomId } from "./utils.js";

export function createDefaultSaveCheck({
  id = "primary",
  label = "",
  statistic = "fortitude",
  dc = 15
} = {}) {
  return {
    id,
    label,
    kind: "save",
    statistic,
    dc
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
  checks = [createDefaultSaveCheck()],
  initialCheck = createDefaultInitialCheck(),
  onset = null,
  maximumDuration = null,
  defaultStageCheck = createDefaultStageCheck(),
  stages = [createDefaultStage()],
  progression = null,
  metadata = {}
} = {}) {
  const definition = {
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

  return definition;
}

export const AFFLICTION_DATA_CONTRACT_V1 = deepFreeze({
  schemaVersion: AFFLICTION_SCHEMA_VERSION,
  requiredRootFields: [
    "schemaVersion", "id", "name", "afflictionType", "level", "rarity",
    "traits", "themes", "checks", "stages"
  ],
  stageEffectOwnership: "affliction-engine",
  templateItemType: "effect",
  templateRuleElements: "none",
  activeDefinitionPolicy: "snapshot-on-application"
});
