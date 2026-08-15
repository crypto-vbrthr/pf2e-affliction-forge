import {
  AFFLICTION_PRE_ACTION_KINDS,
  AFFLICTION_REACTION_EVENTS,
  AFFLICTION_TYPES,
  CHECK_COMBINE_MODES,
  DURATION_UNITS,
  HEALING_RESTRICTION_MODES,
  IDENTIFICATION_STATES,
  MODULE_ID,
  NUMERIC_MODIFIER_TYPES,
  OUTCOME_KEYS,
  RARITIES,
  REACTION_CONTROLLER_ACTIONS,
  STAGE_EXPIRY_ACTIONS,
  SAVE_DC_MODES,
  SAVE_EXECUTION_MODES,
  SAVE_STATISTICS,
  SAVE_VISIBILITY_MODES,
  STAGE_EFFECT_PERSISTENCE_MODES,
  TRANSITION_ACTIONS
} from "../../constants.js";
import { getCriticalForgeApi } from "../integration/critical-forge-adapter.js";
import { createAfflictionEditorSession } from "./affliction-editor-session.js";
import { deepClone } from "../schema/utils.js";

export const AFFLICTION_EDITOR_TEMPLATE = `modules/${MODULE_ID}/templates/affliction-forge/affliction-editor.hbs`;

const LABELS = Object.freeze({
  preActionKind: {
    "spell-cast": "PF2E_AFFLICTION_FORGE.PreAction.Kind.SpellCast",
    "item-activation": "PF2E_AFFLICTION_FORGE.PreAction.Kind.ItemActivation"
  },
  reactionEvent: {
    "damage-taken": "PF2E_AFFLICTION_FORGE.Reaction.Event.DamageTaken",
    "condition-increased": "PF2E_AFFLICTION_FORGE.Reaction.Event.ConditionIncreased",
    "initiative-rolled": "PF2E_AFFLICTION_FORGE.Reaction.Event.InitiativeRolled",
    "turn-start": "PF2E_AFFLICTION_FORGE.Reaction.Event.TurnStart"
  },
  reactionControllerAction: {
    none: "PF2E_AFFLICTION_FORGE.Reaction.ControllerAction.None",
    recover: "PF2E_AFFLICTION_FORGE.Reaction.ControllerAction.Recover",
    end: "PF2E_AFFLICTION_FORGE.Reaction.ControllerAction.End"
  },
  stageExpiryAction: {
    check: "PF2E_AFFLICTION_FORGE.StageExpiry.Check",
    recover: "PF2E_AFFLICTION_FORGE.StageExpiry.Recover",
    end: "PF2E_AFFLICTION_FORGE.StageExpiry.End",
    stay: "PF2E_AFFLICTION_FORGE.StageExpiry.Stay"
  },
  numericModifierType: {
    untyped: "PF2E_AFFLICTION_FORGE.NumericModifier.Type.Untyped",
    status: "PF2E_AFFLICTION_FORGE.NumericModifier.Type.Status",
    circumstance: "PF2E_AFFLICTION_FORGE.NumericModifier.Type.Circumstance",
    item: "PF2E_AFFLICTION_FORGE.NumericModifier.Type.Item"
  },
  type: {
    poison: "PF2E_AFFLICTION_FORGE.Types.Poison",
    disease: "PF2E_AFFLICTION_FORGE.Types.Disease",
    curse: "PF2E_AFFLICTION_FORGE.Types.Curse",
    other: "PF2E_AFFLICTION_FORGE.Types.Other"
  },
  rarity: {
    common: "PF2E_AFFLICTION_FORGE.Rarity.Common",
    uncommon: "PF2E_AFFLICTION_FORGE.Rarity.Uncommon",
    rare: "PF2E_AFFLICTION_FORGE.Rarity.Rare",
    unique: "PF2E_AFFLICTION_FORGE.Rarity.Unique"
  },
  statistic: {
    fortitude: "PF2E_AFFLICTION_FORGE.Save.Fortitude",
    reflex: "PF2E_AFFLICTION_FORGE.Save.Reflex",
    will: "PF2E_AFFLICTION_FORGE.Save.Will"
  },
  duration: {
    rounds: "PF2E_AFFLICTION_FORGE.Duration.Rounds",
    minutes: "PF2E_AFFLICTION_FORGE.Duration.Minutes",
    hours: "PF2E_AFFLICTION_FORGE.Duration.Hours",
    days: "PF2E_AFFLICTION_FORGE.Duration.Days",
    unlimited: "PF2E_AFFLICTION_FORGE.Duration.Unlimited"
  },
  combine: {
    single: "PF2E_AFFLICTION_FORGE.Combine.Single",
    "best-degree": "PF2E_AFFLICTION_FORGE.Combine.BestDegree",
    "worst-degree": "PF2E_AFFLICTION_FORGE.Combine.WorstDegree",
    "all-success": "PF2E_AFFLICTION_FORGE.Combine.AllSuccess",
    "any-success": "PF2E_AFFLICTION_FORGE.Combine.AnySuccess"
  },
  execution: {
    automatic: "PF2E_AFFLICTION_FORGE.SaveExecution.Automatic",
    player: "PF2E_AFFLICTION_FORGE.SaveExecution.Player",
    gm: "PF2E_AFFLICTION_FORGE.SaveExecution.GM"
  },
  dcMode: {
    fixed: "PF2E_AFFLICTION_FORGE.Editor.DCModeFixed",
    source: "PF2E_AFFLICTION_FORGE.Editor.DCModeSource"
  },
  visibility: {
    public: "PF2E_AFFLICTION_FORGE.SaveVisibility.Public",
    gmOnly: "PF2E_AFFLICTION_FORGE.SaveVisibility.GMOnly"
  },
  identification: {
    hidden: "PF2E_AFFLICTION_FORGE.Identification.Hidden",
    suspected: "PF2E_AFFLICTION_FORGE.Identification.Suspected",
    identified: "PF2E_AFFLICTION_FORGE.Identification.Identified"
  },
  healingRestriction: {
    none: "PF2E_AFFLICTION_FORGE.Restrictions.HealingNone",
    all: "PF2E_AFFLICTION_FORGE.Restrictions.HealingAll",
    "affliction-damage": "PF2E_AFFLICTION_FORGE.Restrictions.HealingAfflictionDamage"
  },
  effectPersistence: {
    inherit: "PF2E_AFFLICTION_FORGE.Restrictions.PersistenceInherit",
    stage: "PF2E_AFFLICTION_FORGE.Restrictions.PersistenceStage",
    affliction: "PF2E_AFFLICTION_FORGE.Restrictions.PersistenceAffliction",
    permanent: "PF2E_AFFLICTION_FORGE.Restrictions.PersistencePermanent"
  },
  action: {
    none: "PF2E_AFFLICTION_FORGE.Transition.None",
    reject: "PF2E_AFFLICTION_FORGE.Transition.Reject",
    recover: "PF2E_AFFLICTION_FORGE.Transition.Recover",
    stay: "PF2E_AFFLICTION_FORGE.Transition.Stay",
    "set-stage": "PF2E_AFFLICTION_FORGE.Transition.SetStage",
    "stage-delta": "PF2E_AFFLICTION_FORGE.Transition.StageDelta"
  },
  outcome: {
    criticalSuccess: "PF2E_AFFLICTION_FORGE.Outcome.CriticalSuccess",
    success: "PF2E_AFFLICTION_FORGE.Outcome.Success",
    failure: "PF2E_AFFLICTION_FORGE.Outcome.Failure",
    criticalFailure: "PF2E_AFFLICTION_FORGE.Outcome.CriticalFailure"
  }
});

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function optionList(values, selected, labels) {
  return values.map((value) => ({
    value,
    label: localize(labels[value] ?? value),
    selected: value === selected
  }));
}

function parseStringList(value) {
  return [...new Set(String(value ?? "")
    .split(/[\n,;]/g)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function conditionLocksToText(locks = []) {
  return (locks ?? []).map((lock) => Number.isInteger(lock?.minimum)
    ? `${lock.slug}:${lock.minimum}`
    : String(lock?.slug ?? "")).filter(Boolean).join(", ");
}

function parseConditionLocks(value) {
  const locks = [];
  for (const entry of parseStringList(value)) {
    const [slugPart, minimumPart] = entry.split(":", 2);
    const slug = String(slugPart ?? "").trim().toLowerCase();
    if (!slug) continue;
    const parsed = Number.parseInt(String(minimumPart ?? ""), 10);
    locks.push({ slug, minimum: Number.isInteger(parsed) && parsed > 0 ? parsed : null });
  }
  return locks;
}

function prepareRestrictions(restrictions = {}) {
  return {
    conditionLocksText: conditionLocksToText(restrictions.conditionLocks),
    healingOptions: optionList(HEALING_RESTRICTION_MODES, restrictions.healing ?? "none", LABELS.healingRestriction),
    unhealableDamageTypesText: (restrictions.unhealableDamageTypes ?? []).join(", "),
    speakBlocked: restrictions.blockedCapabilities?.includes("speak") ?? false
  };
}

function restrictionsFromRegion(region, fallback = {}) {
  if (!(region instanceof HTMLElement)) return fallback;
  return {
    conditionLocks: parseConditionLocks(region.querySelector('[data-restriction-field="conditionLocks"]')?.value ?? ""),
    healing: String(region.querySelector('[data-restriction-field="healing"]')?.value ?? "none"),
    unhealableDamageTypes: parseStringList(region.querySelector('[data-restriction-field="unhealableDamageTypes"]')?.value ?? "").map((entry) => entry.toLowerCase()),
    blockedCapabilities: region.querySelector('[data-restriction-field="speak"]')?.checked ? ["speak"] : []
  };
}

function componentDisplayLabel(component, index) {
  const type = String(component?.type ?? "component");
  const detail = component?.slug ?? component?.label ?? component?.damageType ?? component?.selector ?? "";
  return detail ? `${index + 1}. ${type} · ${detail}` : `${index + 1}. ${type}`;
}

function prepareComponentPersistence(stage) {
  const components = Array.isArray(stage?.effect?.components) ? stage.effect.components : [];
  const overrides = Array.isArray(stage?.effectComponentPersistence) ? stage.effectComponentPersistence : [];
  return components.map((component, index) => {
    const override = overrides[index] ?? null;
    const values = ["inherit", ...STAGE_EFFECT_PERSISTENCE_MODES];
    return {
      index,
      label: componentDisplayLabel(component, index),
      options: values.map((value) => ({
        value: value === "inherit" ? "" : value,
        label: localize(LABELS.effectPersistence[value] ?? value),
        selected: value === "inherit" ? override == null : override === value
      }))
    };
  });
}

function integerValue(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function durationFromRegion(region, { nullable = true, allowUnlimited = true } = {}) {
  if (!(region instanceof HTMLElement)) return nullable ? null : { value: 1, unit: "rounds" };
  const enabled = region.querySelector('[data-duration-enabled]');
  if (nullable && enabled && !enabled.checked) return null;
  const unlimited = allowUnlimited && Boolean(region.querySelector('[data-duration-unlimited]')?.checked);
  if (unlimited) return { value: -1, unit: "unlimited" };
  const value = integerValue(region.querySelector('[data-duration-value]')?.value, 1);
  const unit = String(region.querySelector('[data-duration-unit]')?.value ?? "rounds");
  return { value, unit };
}

function directiveFromRegion(region) {
  const action = String(region.querySelector('[data-directive-action]')?.value ?? "none");
  const result = { action };
  if (action === "set-stage") result.stage = integerValue(region.querySelector('[data-directive-value]')?.value, 1);
  if (action === "stage-delta") result.delta = integerValue(region.querySelector('[data-directive-value]')?.value, 1);
  return result;
}

function gateFromRegion(region) {
  if (!(region instanceof HTMLElement)) return null;
  const checkIds = [...region.querySelectorAll('[data-gate-check-id]:checked')]
    .map((input) => String(input.value ?? "").trim())
    .filter(Boolean);
  const outcomes = {};
  for (const outcome of OUTCOME_KEYS) {
    const outcomeRegion = region.querySelector(`[data-outcome="${outcome}"]`);
    outcomes[outcome] = directiveFromRegion(outcomeRegion);
  }
  return {
    checkIds,
    combine: String(region.querySelector('[data-gate-combine]')?.value ?? "single"),
    outcomes
  };
}

function preparedDirective(directive = { action: "none" }) {
  const action = directive?.action ?? "none";
  return {
    ...directive,
    action,
    value: action === "set-stage" ? (directive.stage ?? 1) : action === "stage-delta" ? (directive.delta ?? 1) : "",
    usesValue: action === "set-stage" || action === "stage-delta",
    valueLabel: localize(action === "set-stage"
      ? "PF2E_AFFLICTION_FORGE.Editor.TargetStage"
      : "PF2E_AFFLICTION_FORGE.Editor.StageDelta"),
    actionOptions: optionList(TRANSITION_ACTIONS, action, LABELS.action)
  };
}

function prepareGate(gate, checks) {
  if (!gate) return null;
  return {
    checkOptions: checks.map((check, index) => ({
      index,
      value: check.id,
      label: check.label || check.id,
      checked: gate.checkIds?.includes(check.id) ?? false
    })),
    combineOptions: optionList(CHECK_COMBINE_MODES, gate.combine, LABELS.combine),
    outcomes: OUTCOME_KEYS.map((outcome) => ({
      key: outcome,
      label: localize(LABELS.outcome[outcome]),
      directive: preparedDirective(gate.outcomes?.[outcome])
    }))
  };
}

function prepareDuration(duration, { nullable = true, allowUnlimited = true } = {}) {
  const enabled = duration != null;
  const unlimited = enabled && duration?.unit === "unlimited";
  return {
    enabled: nullable ? enabled : true,
    value: unlimited ? 1 : (duration?.value ?? 1),
    unit: unlimited ? "rounds" : (duration?.unit ?? "rounds"),
    unlimited: allowUnlimited && unlimited,
    unitOptions: optionList(DURATION_UNITS.filter((unit) => unit !== "unlimited"), unlimited ? "rounds" : (duration?.unit ?? "rounds"), LABELS.duration)
  };
}


function prepareSavePolicy(policy, defaults) {
  const inherited = policy == null;
  const effective = inherited ? defaults : policy;
  return {
    inherited,
    execution: effective?.execution ?? "player",
    visibility: effective?.visibility ?? "public",
    executionOptions: optionList(SAVE_EXECUTION_MODES, effective?.execution ?? "player", LABELS.execution),
    visibilityOptions: optionList(SAVE_VISIBILITY_MODES, effective?.visibility ?? "public", LABELS.visibility)
  };
}

function displayIssue(issue) {
  const path = String(issue?.path ?? "");
  const raw = String(issue?.message ?? issue?.code ?? "");
  const message = path && raw.toLowerCase().startsWith(`${path.toLowerCase()} `)
    ? raw.slice(path.length).trimStart()
    : raw;
  return { ...issue, displayMessage: message };
}

function displayIssuePath(path) {
  const value = String(path ?? "");
  const periodicEffectComponent = /^stages\.(\d+)\.periodicEffects\.(\d+)\.effect\.components\.(\d+)(?:\.|$)/.exec(value);
  if (periodicEffectComponent) {
    const stageNumber = Number(periodicEffectComponent[1]) + 1;
    const periodicNumber = Number(periodicEffectComponent[2]) + 1;
    const componentNumber = Number(periodicEffectComponent[3]) + 1;
    return `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage")} ${stageNumber} · ${localize("PF2E_AFFLICTION_FORGE.Periodic.PeriodicEffect")} ${periodicNumber} · ${localize("PF2E_AFFLICTION_FORGE.Editor.Component")} ${componentNumber}`;
  }
  const reactionEffectComponent = /^stages\.(\d+)\.reactions\.(\d+)\.effect\.components\.(\d+)(?:\.|$)/.exec(value);
  if (reactionEffectComponent) {
    const stageNumber = Number(reactionEffectComponent[1]) + 1;
    const reactionNumber = Number(reactionEffectComponent[2]) + 1;
    const componentNumber = Number(reactionEffectComponent[3]) + 1;
    return `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage")} ${stageNumber} · ${localize("PF2E_AFFLICTION_FORGE.Reaction.EventReaction")} ${reactionNumber} · ${localize("PF2E_AFFLICTION_FORGE.Editor.Component")} ${componentNumber}`;
  }
  const effectComponent = /^stages\.(\d+)\.effect\.components\.(\d+)(?:\.|$)/.exec(value);
  if (effectComponent) {
    const stageNumber = Number(effectComponent[1]) + 1;
    const componentNumber = Number(effectComponent[2]) + 1;
    return `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage")} ${stageNumber} · ${localize("PF2E_AFFLICTION_FORGE.Editor.Component")} ${componentNumber}`;
  }
  const stageOnly = /^stages\.(\d+)(?:\.|$)/.exec(value);
  if (stageOnly) return `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage")} ${Number(stageOnly[1]) + 1}`;
  return value;
}

function issueSummary(report) {
  const issues = (report?.issues ?? []).map(displayIssue);
  return {
    valid: report?.valid !== false,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    issues
  };
}

function createDefaultStageEffect(definition, stage, criticalApi) {
  const effectId = `${definition.id}.${stage.id}.effect`;
  const stageLabel = stage.name || `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage")} ${stage.number}`;
  return criticalApi.builders.effect()
    .setId(effectId)
    .setName(`${definition.name || localize("PF2E_AFFLICTION_FORGE.Editor.Untitled")} · ${stageLabel}`)
    .setImage(definition.img)
    .setDuration(-1, "unlimited", null)
    .setMetadata({
      originModule: MODULE_ID,
      originFeature: "affliction-stage-effect-definition"
    })
    .build();
}

function synchronizeManagedStageEffectMetadata(definition, stage) {
  const source = stage?.effect;
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;

  // Critical Forge builders intentionally return deeply frozen Effect Definitions.
  // The Affliction editor keeps a mutable working model, so never mutate an
  // Effect Definition received from the public Critical Forge API in place.
  // Always clone first and replace the stage-owned value with the mutable copy.
  const effect = deepClone(source);
  const stageLabel = stage.name || `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage")} ${stage.number}`;
  effect.id = `${definition.id}.${stage.id}.effect`;
  effect.name = `${definition.name || localize("PF2E_AFFLICTION_FORGE.Editor.Untitled")} · ${stageLabel}`;
  effect.img = definition.img;
  effect.duration = { value: -1, unit: "unlimited", expiry: null };
  effect.metadata = {
    ...(effect.metadata ?? {}),
    originModule: MODULE_ID,
    originFeature: "affliction-stage-effect-definition"
  };
  stage.effect = effect;
  return effect;
}


function createDefaultReactionEffect(definition, stage, reaction, criticalApi) {
  const effectId = `${definition.id}.${stage.id}.${reaction.id}.reaction-effect`;
  const reactionLabel = reaction.label || localize("PF2E_AFFLICTION_FORGE.Reaction.EventReaction");
  return criticalApi.builders.effect()
    .setId(effectId)
    .setName(`${definition.name || localize("PF2E_AFFLICTION_FORGE.Editor.Untitled")} · ${reactionLabel}`)
    .setImage(definition.img)
    .setDuration(1, "rounds", null)
    .setMetadata({
      originModule: MODULE_ID,
      originFeature: "affliction-event-reaction-effect-definition"
    })
    .build();
}

function synchronizeManagedReactionEffectMetadata(definition, stage, reaction) {
  const source = reaction?.effect;
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;
  const effect = deepClone(source);
  const reactionLabel = reaction.label || localize("PF2E_AFFLICTION_FORGE.Reaction.EventReaction");
  effect.id = `${definition.id}.${stage.id}.${reaction.id}.reaction-effect`;
  effect.name = `${definition.name || localize("PF2E_AFFLICTION_FORGE.Editor.Untitled")} · ${reactionLabel}`;
  effect.img = definition.img;
  effect.metadata = {
    ...(effect.metadata ?? {}),
    originModule: MODULE_ID,
    originFeature: "affliction-event-reaction-effect-definition"
  };
  reaction.effect = effect;
  return effect;
}

function createDefaultPeriodicEffectDefinition(definition, stage, periodic, criticalApi) {
  const effectId = `${definition.id}.${stage.id}.${periodic.id}.periodic-effect`;
  const periodicLabel = periodic.label || localize("PF2E_AFFLICTION_FORGE.Periodic.PeriodicEffect");
  return criticalApi.builders.effect()
    .setId(effectId)
    .setName(`${definition.name || localize("PF2E_AFFLICTION_FORGE.Editor.Untitled")} · ${periodicLabel}`)
    .setImage(definition.img)
    .setDuration(1, "rounds", null)
    .setMetadata({
      originModule: MODULE_ID,
      originFeature: "affliction-periodic-stage-effect-definition"
    })
    .build();
}

function synchronizeManagedPeriodicEffectMetadata(definition, stage, periodic) {
  const source = periodic?.effect;
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;
  const effect = deepClone(source);
  const periodicLabel = periodic.label || localize("PF2E_AFFLICTION_FORGE.Periodic.PeriodicEffect");
  effect.id = `${definition.id}.${stage.id}.${periodic.id}.periodic-effect`;
  effect.name = `${definition.name || localize("PF2E_AFFLICTION_FORGE.Editor.Untitled")} · ${periodicLabel}`;
  effect.img = definition.img;
  effect.metadata = {
    ...(effect.metadata ?? {}),
    originModule: MODULE_ID,
    originFeature: "affliction-periodic-stage-effect-definition"
  };
  periodic.effect = effect;
  return effect;
}

function prepareNumericModifier(modifier, modifierIndex) {
  return {
    ...modifier,
    index: modifierIndex,
    number: modifierIndex + 1,
    selectorsText: (modifier.selectors ?? []).join(", "),
    typeOptions: optionList(NUMERIC_MODIFIER_TYPES, modifier.type ?? "untyped", LABELS.numericModifierType)
  };
}

function preparePeriodicEffect(periodic, periodicIndex) {
  const interval = periodic.interval ?? { value: 1, unit: "minutes" };
  return {
    ...periodic,
    index: periodicIndex,
    number: periodicIndex + 1,
    intervalValue: interval.value ?? 1,
    intervalFormula: interval.formula ?? "",
    intervalUnitOptions: optionList(DURATION_UNITS.filter((unit) => unit !== "unlimited"), interval.unit ?? "minutes", LABELS.duration),
    hasEffect: Boolean(periodic.effect),
    effectComponentCount: Array.isArray(periodic.effect?.components) ? periodic.effect.components.length : 0
  };
}

function preparePreActionGate(gate, gateIndex) {
  return {
    ...gate,
    index: gateIndex,
    number: gateIndex + 1,
    requiredTraitsText: (gate.trigger?.requiredTraits ?? []).join(", "),
    actionKinds: AFFLICTION_PRE_ACTION_KINDS.map((kind) => ({
      kind,
      label: localize(LABELS.preActionKind[kind]),
      checked: gate.trigger?.actionKinds?.includes?.(kind) ?? false
    })),
    flatDc: gate.check?.dc ?? 5
  };
}

function prepareReaction(reaction, reactionIndex, checks) {
  return {
    ...reaction,
    index: reactionIndex,
    number: reactionIndex + 1,
    eventOptions: optionList(AFFLICTION_REACTION_EVENTS, reaction.trigger?.event ?? "damage-taken", LABELS.reactionEvent),
    damageTypesText: (reaction.trigger?.damageTypes ?? []).join(", "),
    conditionSlugsText: (reaction.trigger?.conditionSlugs ?? []).join(", "),
    checkOptions: [
      {
        value: "",
        label: localize("PF2E_AFFLICTION_FORGE.Reaction.NoCheck"),
        selected: reaction.checkId == null || reaction.checkId === ""
      },
      ...checks.map((check) => ({
        value: check.id,
        label: check.label || check.id,
        selected: check.id === reaction.checkId
      }))
    ],
    outcomes: OUTCOME_KEYS.map((outcome) => ({
      key: outcome,
      label: localize(LABELS.outcome[outcome]),
      checked: reaction.applyOn?.includes?.(outcome) ?? false,
      controllerActionOptions: optionList(
        REACTION_CONTROLLER_ACTIONS,
        reaction.controllerActions?.[outcome] ?? "none",
        LABELS.reactionControllerAction
      )
    })),
    hasEffect: Boolean(reaction.effect),
    effectComponentCount: Array.isArray(reaction.effect?.components) ? reaction.effect.components.length : 0
  };
}

export async function prepareAfflictionEditorContext(session, {
  api = game.modules.get(MODULE_ID)?.api,
  validationReport = null
} = {}) {
  if (!api) throw new Error("Affliction Forge API is unavailable.");
  const definition = session.definition;
  const report = validationReport ?? api.definitions.validate(definition);
  return {
    definition,
    mode: session.mode,
    readOnly: session.readOnly,
    dirty: session.dirty,
    typeOptions: optionList(AFFLICTION_TYPES, definition.afflictionType, LABELS.type),
    rarityOptions: optionList(RARITIES, definition.rarity, LABELS.rarity),
    statisticCatalog: SAVE_STATISTICS,
    saveDefaults: {
      executionOptions: optionList(SAVE_EXECUTION_MODES, definition.saveDefaults.execution, LABELS.execution),
      visibilityOptions: optionList(SAVE_VISIBILITY_MODES, definition.saveDefaults.visibility, LABELS.visibility)
    },
    identificationOptions: optionList(IDENTIFICATION_STATES, definition.identification.initialState, LABELS.identification),
    isPoison: definition.afflictionType === "poison",
    injuryPoison: definition.delivery?.injuryPoison === true,
    ignoreRepeatedExposure: definition.afflictionType === "poison" && definition.multipleExposure === "ignore",
    restrictionView: prepareRestrictions(definition.restrictions),
    checks: definition.checks.map((check, index) => ({
      ...check,
      index,
      number: index + 1,
      canRemove: definition.checks.length > 1,
      statisticOptions: optionList(SAVE_STATISTICS, check.statistic, LABELS.statistic),
      dcModeOptions: optionList(SAVE_DC_MODES, check.dcMode, LABELS.dcMode),
      sourceDc: check.dcMode === "source",
      policyView: prepareSavePolicy(check.policy, definition.saveDefaults)
    })),
    initialCheck: prepareGate(definition.initialCheck, definition.checks),
    hasInitialCheck: Boolean(definition.initialCheck),
    defaultStageCheck: prepareGate(definition.defaultStageCheck, definition.checks),
    hasDefaultStageCheck: Boolean(definition.defaultStageCheck),
    onset: prepareDuration(definition.onset, { nullable: true, allowUnlimited: false }),
    maximumDuration: prepareDuration(definition.maximumDuration, { nullable: true, allowUnlimited: true }),
    stages: definition.stages.map((stage, index) => ({
      ...stage,
      index,
      canMoveUp: index > 0,
      canMoveDown: index < definition.stages.length - 1,
      canRemove: definition.stages.length > 1,
      collapsed: session.isStageCollapsed(index),
      durationView: prepareDuration(stage.duration, { nullable: false, allowUnlimited: true }),
      expiryActionOptions: optionList(STAGE_EXPIRY_ACTIONS, stage.expiryAction ?? "check", LABELS.stageExpiryAction),
      usesCustomCheck: Boolean(stage.check),
      customCheck: prepareGate(stage.check, definition.checks),
      restrictionView: prepareRestrictions(stage.restrictions),
      effectPersistenceOptions: optionList(STAGE_EFFECT_PERSISTENCE_MODES, stage.effectPersistence ?? "stage", LABELS.effectPersistence),
      effectComponentPersistenceRows: prepareComponentPersistence(stage),
      hasEffect: Boolean(stage.effect),
      effectComponentCount: Array.isArray(stage.effect?.components) ? stage.effect.components.length : 0,
      numericModifiers: (stage.numericModifiers ?? []).map((modifier, modifierIndex) => ({
        ...prepareNumericModifier(modifier, modifierIndex),
        stageIndex: index
      })),
      periodicEffects: (stage.periodicEffects ?? []).map((periodic, periodicIndex) => ({
        ...preparePeriodicEffect(periodic, periodicIndex),
        stageIndex: index
      })),
      preActionGates: (stage.preActionGates ?? []).map((gate, gateIndex) => ({
        ...preparePreActionGate(gate, gateIndex),
        stageIndex: index
      })),
      reactions: (stage.reactions ?? []).map((reaction, reactionIndex) => ({
        ...prepareReaction(reaction, reactionIndex, definition.checks),
        stageIndex: index
      }))
    })),
    validation: issueSummary(report)
  };
}

export async function renderAfflictionEditor(context, {
  renderTemplateFn = globalThis.foundry?.applications?.handlebars?.renderTemplate
} = {}) {
  if (typeof renderTemplateFn !== "function") throw new Error("Foundry renderTemplate is unavailable.");
  return renderTemplateFn(AFFLICTION_EDITOR_TEMPLATE, context);
}

export class EmbeddedAfflictionEditor {
  constructor({
    definition = null,
    session = null,
    mode = "edit",
    apiProvider = () => game.modules.get(MODULE_ID)?.api,
    criticalApiProvider = () => getCriticalForgeApi({ required: true }),
    onChange = null
  } = {}) {
    this.session = session ?? createAfflictionEditorSession(definition, { mode });
    this.apiProvider = apiProvider;
    this.criticalApiProvider = criticalApiProvider;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.container = null;
    this.root = null;
    this.boundClick = null;
    this.boundInput = null;
    this.boundChange = null;
    this.effectEditors = new Map();
  }

  get value() {
    this.#sync();
    return this.session.value;
  }

  get dirty() {
    return this.session.dirty;
  }

  get mode() {
    return this.session.mode;
  }

  #api() {
    const api = this.apiProvider?.();
    if (!api) throw new Error("Affliction Forge API is unavailable.");
    return api;
  }

  #criticalApi() {
    const api = this.criticalApiProvider?.();
    if (!api?.ui?.effectEditor?.create) throw new Error("Critical Forge Embedded Effect Editor API is unavailable.");
    return api;
  }

  async renderHtml(options = {}) {
    const context = await prepareAfflictionEditorContext(this.session, {
      api: this.#api(),
      validationReport: options.validationReport ?? null
    });
    return renderAfflictionEditor(context, options);
  }

  async mount(container, options = {}) {
    if (!(container instanceof HTMLElement)) throw new TypeError("Affliction Editor mount target must be an HTMLElement.");
    this.unmount();
    this.container = container;
    const html = await this.renderHtml(options);
    container.innerHTML = `<div class="affliction-editor-embedded" data-affliction-editor-root>${html}</div>`;
    this.root = container.querySelector("[data-affliction-editor-root]");
    this.#ensureEditableState();
    this.#bind();
    this.#activateDynamicControls();
    await this.#mountStageEffectEditors();
    await this.#mountPeriodicEffectEditors();
    await this.#mountReactionEffectEditors();
    if (this.session.readOnly) this.#applyReadOnly();
    return this;
  }

  unmount() {
    for (const editor of this.effectEditors.values()) editor.unmount?.();
    this.effectEditors.clear();
    if (this.root && this.boundClick) this.root.removeEventListener("click", this.boundClick);
    if (this.root && this.boundInput) this.root.removeEventListener("input", this.boundInput);
    if (this.root && this.boundChange) this.root.removeEventListener("change", this.boundChange);
    this.root = null;
    this.boundClick = null;
    this.boundInput = null;
    this.boundChange = null;
  }

  destroy() {
    this.unmount();
    if (this.container) this.container.innerHTML = "";
    this.container = null;
  }

  setData(definition, { mode = this.session.mode, rerender = true } = {}) {
    this.session.loadDefinition(definition, { mode });
    if (rerender && this.container) return this.mount(this.container);
    return this;
  }

  markClean() {
    this.#sync();
    this.session.markClean();
    return this;
  }

  validate() {
    this.#sync();
    return this.#api().definitions.validate(this.session.definition);
  }

  refreshValidation({ scrollIntoView = false } = {}) {
    this.#sync();
    const report = this.#refreshValidation();
    if (scrollIntoView) {
      this.root?.querySelector?.("[data-validation-root]")?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest"
      });
    }
    return report;
  }

  focusFirstField() {
    const field = this.root?.querySelector?.('[data-affliction-field="name"]');
    if (field instanceof HTMLElement && !field.matches(":disabled")) {
      field.focus();
      field.select?.();
      return true;
    }
    return false;
  }

  #ensureEditableState() {
    if (!(this.root instanceof HTMLElement)) return;
    const fieldset = this.root.querySelector("[data-affliction-editor-fieldset]");
    if (!(fieldset instanceof HTMLElement)) return;

    if (this.session.readOnly) {
      fieldset.disabled = true;
      return;
    }

    // Embedded hosts must never accidentally inherit a disabled fieldset state.
    // Read-only is applied explicitly by the session instead.
    fieldset.disabled = false;
    fieldset.removeAttribute("disabled");
  }

  #bind() {
    if (!(this.root instanceof HTMLElement)) return;
    this.boundClick = async (event) => {
      const target = event.target?.closest?.("[data-affliction-action]");
      if (!target || !this.root.contains(target)) return;
      const action = target.dataset.afflictionAction;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.session.readOnly && !["toggleStage"].includes(action)) return;
      await this.#handleAction(action, target);
    };
    const sync = (event) => {
      if (event?.target?.closest?.("[data-effect-editor-root]")) return;
      this.#sync();
      this.#refreshValidation();
      this.#emitChange();
    };
    this.boundInput = sync;
    this.boundChange = sync;
    this.root.addEventListener("click", this.boundClick);
    this.root.addEventListener("input", this.boundInput);
    this.root.addEventListener("change", this.boundChange);
  }

  #sync() {
    const root = this.root;
    if (!(root instanceof HTMLElement)) return;
    const definition = this.session.definition;

    const value = (selector, fallback = "") => root.querySelector(selector)?.value ?? fallback;
    definition.id = String(value('[data-affliction-field="id"]', definition.id)).trim();
    definition.name = String(value('[data-affliction-field="name"]', definition.name)).trim();
    definition.description = String(value('[data-affliction-field="description"]', definition.description));
    definition.img = String(value('[data-affliction-field="img"]', definition.img)).trim();
    definition.afflictionType = String(value('[data-affliction-field="afflictionType"]', definition.afflictionType));
    definition.level = integerValue(value('[data-affliction-field="level"]', definition.level), definition.level);
    definition.rarity = String(value('[data-affliction-field="rarity"]', definition.rarity));
    definition.traits = parseStringList(value('[data-affliction-field="traits"]', definition.traits.join(", ")));
    definition.themes = parseStringList(value('[data-affliction-field="themes"]', definition.themes.join(", ")));
    definition.progression.belowStageOne = String(value('[data-affliction-field="belowStageOne"]', definition.progression.belowStageOne));
    definition.progression.aboveMaximumStage = String(value('[data-affliction-field="aboveMaximumStage"]', definition.progression.aboveMaximumStage));
    definition.progression.virulent = Boolean(root.querySelector('[data-affliction-field="virulent"]')?.checked);
    definition.saveDefaults.execution = String(value('[data-affliction-field="saveDefaultExecution"]', definition.saveDefaults.execution));
    definition.saveDefaults.visibility = String(value('[data-affliction-field="saveDefaultVisibility"]', definition.saveDefaults.visibility));
    definition.identification.initialState = String(value('[data-affliction-field="identificationInitialState"]', definition.identification.initialState));
    definition.delivery ??= { injuryPoison: false };
    const injuryPoisonControl = root.querySelector('[data-affliction-field="injuryPoison"]');
    definition.delivery.injuryPoison = definition.afflictionType === "poison" && Boolean(injuryPoisonControl?.checked);
    const repeatedExposureControl = root.querySelector('[data-affliction-field="ignoreRepeatedExposure"]');
    definition.multipleExposure = definition.afflictionType === "poison" && Boolean(repeatedExposureControl?.checked) ? "ignore" : "default";
    const poisonOptions = root.querySelector("[data-poison-delivery-options]");
    if (poisonOptions) poisonOptions.hidden = definition.afflictionType !== "poison";
    if (definition.afflictionType !== "poison" && injuryPoisonControl) injuryPoisonControl.checked = false;
    if (definition.afflictionType !== "poison" && repeatedExposureControl) repeatedExposureControl.checked = false;

    definition.restrictions = restrictionsFromRegion(root.querySelector('[data-affliction-restrictions="root"]'), definition.restrictions);

    this.#refreshRenderedInheritedSavePolicies();

    const onsetRegion = root.querySelector('[data-affliction-duration="onset"]');
    definition.onset = durationFromRegion(onsetRegion, { nullable: true, allowUnlimited: false });
    const maximumRegion = root.querySelector('[data-affliction-duration="maximumDuration"]');
    definition.maximumDuration = durationFromRegion(maximumRegion, { nullable: true, allowUnlimited: true });

    for (const checkRegion of root.querySelectorAll("[data-affliction-check-index]")) {
      const index = Number(checkRegion.dataset.afflictionCheckIndex);
      const check = definition.checks[index];
      if (!check) continue;
      const oldId = check.id;
      const nextId = String(checkRegion.querySelector('[data-check-field="id"]')?.value ?? oldId).trim();
      if (nextId && nextId !== oldId) this.session.renameCheck(index, nextId);
      check.label = String(checkRegion.querySelector('[data-check-field="label"]')?.value ?? check.label);
      check.statistic = String(checkRegion.querySelector('[data-check-field="statistic"]')?.value ?? check.statistic);
      check.dcMode = String(checkRegion.querySelector('[data-check-field="dcMode"]')?.value ?? check.dcMode);
      const dcControl = checkRegion.querySelector('[data-check-field="dc"]');
      if (check.dcMode === "source") check.dc = null;
      else check.dc = integerValue(dcControl?.value, Number.isInteger(check.dc) ? check.dc : 15);
      if (dcControl) {
        dcControl.disabled = check.dcMode === "source";
        if (check.dcMode === "source") dcControl.value = "";
        else if (!dcControl.value) dcControl.value = String(check.dc);
      }
      const policyOverride = Boolean(checkRegion.querySelector('[data-check-policy-override]')?.checked);
      check.policy = policyOverride ? {
        execution: String(checkRegion.querySelector('[data-check-policy-execution]')?.value ?? definition.saveDefaults.execution),
        visibility: String(checkRegion.querySelector('[data-check-policy-visibility]')?.value ?? definition.saveDefaults.visibility)
      } : null;
    }

    this.#refreshRenderedCheckReferences();

    const initialRegion = root.querySelector('[data-check-gate="initialCheck"]');
    if (definition.initialCheck && initialRegion) definition.initialCheck = gateFromRegion(initialRegion);
    const defaultRegion = root.querySelector('[data-check-gate="defaultStageCheck"]');
    if (definition.defaultStageCheck && defaultRegion) definition.defaultStageCheck = gateFromRegion(defaultRegion);

    for (const stageRegion of root.querySelectorAll("[data-affliction-stage-index]")) {
      const index = Number(stageRegion.dataset.afflictionStageIndex);
      const stage = definition.stages[index];
      if (!stage) continue;
      stage.id = String(stageRegion.querySelector('[data-stage-field="id"]')?.value ?? stage.id).trim();
      stage.name = String(stageRegion.querySelector('[data-stage-field="name"]')?.value ?? stage.name);
      stage.description = String(stageRegion.querySelector('[data-stage-field="description"]')?.value ?? stage.description);
      stage.duration = durationFromRegion(stageRegion.querySelector('[data-stage-duration]'), { nullable: false, allowUnlimited: true });
      stage.expiryAction = String(stageRegion.querySelector('[data-stage-field="expiryAction"]')?.value ?? stage.expiryAction ?? "check");
      const customGate = stageRegion.querySelector('[data-check-gate="stage"]');
      if (stage.check && customGate) stage.check = gateFromRegion(customGate);
      stage.restrictions = restrictionsFromRegion(stageRegion.querySelector('[data-stage-restrictions]'), stage.restrictions);
      stage.effectPersistence = String(stageRegion.querySelector('[data-stage-field="effectPersistence"]')?.value ?? stage.effectPersistence ?? "stage");
      const components = Array.isArray(stage.effect?.components) ? stage.effect.components : [];
      stage.effectComponentPersistence = components.map((_, componentIndex) => {
        const select = stageRegion.querySelector(`[data-stage-component-persistence-index="${componentIndex}"]`);
        if (!select) return stage.effectComponentPersistence?.[componentIndex] ?? null;
        const mode = String(select.value ?? "");
        return mode || null;
      });
      for (const modifierRegion of stageRegion.querySelectorAll("[data-stage-modifier-index]")) {
        const modifierIndex = Number(modifierRegion.dataset.stageModifierIndex);
        const modifier = stage.numericModifiers?.[modifierIndex];
        if (!modifier) continue;
        modifier.id = String(modifierRegion.querySelector('[data-modifier-field="id"]')?.value ?? modifier.id).trim();
        modifier.label = String(modifierRegion.querySelector('[data-modifier-field="label"]')?.value ?? modifier.label);
        modifier.selectors = parseStringList(modifierRegion.querySelector('[data-modifier-field="selectors"]')?.value ?? "").map((entry) => entry.toLowerCase());
        modifier.type = String(modifierRegion.querySelector('[data-modifier-field="type"]')?.value ?? modifier.type ?? "untyped");
        modifier.value = Number(modifierRegion.querySelector('[data-modifier-field="value"]')?.value ?? modifier.value ?? 0);
      }
      for (const periodicRegion of stageRegion.querySelectorAll("[data-stage-periodic-index]")) {
        const periodicIndex = Number(periodicRegion.dataset.stagePeriodicIndex);
        const periodic = stage.periodicEffects?.[periodicIndex];
        if (!periodic) continue;
        periodic.id = String(periodicRegion.querySelector('[data-periodic-field="id"]')?.value ?? periodic.id).trim();
        periodic.label = String(periodicRegion.querySelector('[data-periodic-field="label"]')?.value ?? periodic.label);
        const formula = String(periodicRegion.querySelector('[data-periodic-field="formula"]')?.value ?? "").trim();
        const unit = String(periodicRegion.querySelector('[data-periodic-field="unit"]')?.value ?? periodic.interval?.unit ?? "minutes");
        periodic.interval = formula
          ? { formula, unit }
          : { value: Number(periodicRegion.querySelector('[data-periodic-field="value"]')?.value ?? periodic.interval?.value ?? 1), unit };
        synchronizeManagedPeriodicEffectMetadata(definition, stage, periodic);
      }
      for (const gateRegion of stageRegion.querySelectorAll("[data-stage-pre-action-index]")) {
        const gateIndex = Number(gateRegion.dataset.stagePreActionIndex);
        const gate = stage.preActionGates?.[gateIndex];
        if (!gate) continue;
        gate.id = String(gateRegion.querySelector('[data-pre-action-field="id"]')?.value ?? gate.id).trim();
        gate.label = String(gateRegion.querySelector('[data-pre-action-field="label"]')?.value ?? gate.label);
        gate.trigger ??= { actionKinds: [], requiredTraits: [] };
        gate.trigger.actionKinds = [...gateRegion.querySelectorAll('[data-pre-action-kind]:checked')].map((input) => String(input.value));
        gate.trigger.requiredTraits = parseStringList(gateRegion.querySelector('[data-pre-action-field="requiredTraits"]')?.value ?? "").map((entry) => entry.toLowerCase());
        gate.check = { kind: "flat", dc: Math.trunc(Number(gateRegion.querySelector('[data-pre-action-field="dc"]')?.value ?? gate.check?.dc ?? 5) || 5) };
        gate.blockOnFailure = gateRegion.querySelector('[data-pre-action-field="blockOnFailure"]')?.checked !== false;
      }
      for (const reactionRegion of stageRegion.querySelectorAll("[data-stage-reaction-index]")) {
        const reactionIndex = Number(reactionRegion.dataset.stageReactionIndex);
        const reaction = stage.reactions?.[reactionIndex];
        if (!reaction) continue;
        reaction.id = String(reactionRegion.querySelector('[data-reaction-field="id"]')?.value ?? reaction.id).trim();
        reaction.label = String(reactionRegion.querySelector('[data-reaction-field="label"]')?.value ?? reaction.label);
        reaction.trigger ??= { event: "damage-taken", damageTypes: [], conditionSlugs: [] };
        reaction.trigger.event = String(reactionRegion.querySelector('[data-reaction-field="event"]')?.value ?? reaction.trigger.event ?? "damage-taken");
        reaction.trigger.damageTypes = parseStringList(reactionRegion.querySelector('[data-reaction-field="damageTypes"]')?.value ?? "").map((entry) => entry.toLowerCase());
        reaction.trigger.conditionSlugs = parseStringList(reactionRegion.querySelector('[data-reaction-field="conditionSlugs"]')?.value ?? "").map((entry) => entry.toLowerCase());
        const checkId = String(reactionRegion.querySelector('[data-reaction-field="checkId"]')?.value ?? "").trim();
        reaction.checkId = checkId || null;
        reaction.applyOn = reaction.checkId
          ? [...reactionRegion.querySelectorAll('[data-reaction-outcome]:checked')].map((input) => String(input.value))
          : [];
        reaction.controllerActions = Object.fromEntries(OUTCOME_KEYS.map((outcome) => [
          outcome,
          String(reactionRegion.querySelector(`[data-reaction-controller-action="${outcome}"]`)?.value ?? reaction.controllerActions?.[outcome] ?? "none")
        ]));
        reaction.conditionValueDelta = Math.trunc(Number(reactionRegion.querySelector('[data-reaction-field="conditionValueDelta"]')?.value ?? 0) || 0);
        synchronizeManagedReactionEffectMetadata(definition, stage, reaction);
      }
      synchronizeManagedStageEffectMetadata(definition, stage);
    }

    this.session.refreshDirty();
  }

  #refreshRenderedInheritedSavePolicies() {
    const root = this.root;
    if (!(root instanceof HTMLElement)) return;
    const defaults = this.session.definition.saveDefaults;
    for (const region of root.querySelectorAll("[data-check-policy]")) {
      const override = region.querySelector("[data-check-policy-override]");
      if (override?.checked) continue;
      const execution = region.querySelector("[data-check-policy-execution]");
      const visibility = region.querySelector("[data-check-policy-visibility]");
      if (execution) execution.value = defaults.execution;
      if (visibility) visibility.value = defaults.visibility;
    }
  }

  #refreshRenderedCheckReferences() {
    const root = this.root;
    if (!(root instanceof HTMLElement)) return;
    const checks = this.session.definition.checks;
    for (const option of root.querySelectorAll("[data-gate-check-option]")) {
      const index = Number(option.dataset.checkIndex);
      const check = checks[index];
      if (!check) continue;
      const input = option.querySelector("[data-gate-check-id]");
      const label = option.querySelector("[data-gate-check-label]");
      if (input) input.value = check.id;
      if (label) label.textContent = check.label || check.id;
    }
    for (const select of root.querySelectorAll("[data-reaction-field=\"checkId\"]")) {
      const stageIndex = Number(select.closest("[data-affliction-stage-index]")?.dataset?.afflictionStageIndex);
      const reactionIndex = Number(select.closest("[data-stage-reaction-index]")?.dataset?.stageReactionIndex);
      const selectedId = this.session.definition.stages?.[stageIndex]?.reactions?.[reactionIndex]?.checkId;
      const existing = [...select.options].filter((option) => option.value !== "");
      for (const [index, option] of existing.entries()) {
        const check = checks[index];
        if (!check) continue;
        option.value = check.id;
        option.textContent = check.label || check.id;
      }
      select.value = selectedId ?? "";
    }
  }

  #updateStageEffectSummary(index, effectDefinition) {
    const count = Array.isArray(effectDefinition?.components) ? effectDefinition.components.length : 0;
    const output = this.root?.querySelector?.(`[data-stage-effect-summary="${index}"] [data-effect-component-count]`);
    if (output) output.textContent = String(count);
  }

  #refreshStageComponentPersistence(index) {
    const container = this.root?.querySelector?.(`[data-stage-component-persistence-list="${index}"]`);
    const stage = this.session.definition.stages[index];
    if (!(container instanceof HTMLElement) || !stage) return;
    const rows = prepareComponentPersistence(stage);
    container.replaceChildren();
    if (rows.length === 0) return;
    const heading = document.createElement("small");
    heading.className = "affliction-editor-component-persistence-hint";
    heading.textContent = localize("PF2E_AFFLICTION_FORGE.Restrictions.ComponentPersistenceHint");
    container.append(heading);
    for (const row of rows) {
      const label = document.createElement("label");
      label.className = "affliction-editor-field affliction-editor-component-persistence-row";
      const span = document.createElement("span");
      span.textContent = row.label;
      const select = document.createElement("select");
      select.dataset.stageComponentPersistenceIndex = String(row.index);
      for (const option of row.options) {
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label;
        el.selected = option.selected;
        select.append(el);
      }
      if (this.session.readOnly) select.disabled = true;
      label.append(span, select);
      container.append(label);
    }
  }

  #updateReactionEffectSummary(stageIndex, reactionIndex, effectDefinition) {
    const count = Array.isArray(effectDefinition?.components) ? effectDefinition.components.length : 0;
    const output = this.root?.querySelector?.(`[data-reaction-effect-summary="${stageIndex}:${reactionIndex}"] [data-effect-component-count]`);
    if (output) output.textContent = String(count);
  }

  #updatePeriodicEffectSummary(stageIndex, periodicIndex, effectDefinition) {
    const count = Array.isArray(effectDefinition?.components) ? effectDefinition.components.length : 0;
    const output = this.root?.querySelector?.(`[data-periodic-effect-summary="${stageIndex}:${periodicIndex}"] [data-effect-component-count]`);
    if (output) output.textContent = String(count);
  }

  #emitChange() {
    this.onChange?.(this.session.value, this.session);
  }

  async #changed({ rerender = true } = {}) {
    this.session.markDirty();
    this.#emitChange();
    if (rerender && this.container) await this.mount(this.container);
  }

  async #handleAction(action, target) {
    this.#sync();
    const index = Number(target.dataset.index);
    const reactionIndex = Number(target.dataset.reactionIndex);
    const modifierIndex = Number(target.dataset.modifierIndex);
    const periodicIndex = Number(target.dataset.periodicIndex);
    const preActionIndex = Number(target.dataset.preActionIndex);

    if (action === "addCheck") this.session.addCheck();
    else if (action === "removeCheck") this.session.removeCheck(index);
    else if (action === "toggleInitialCheck") this.session.setInitialCheckEnabled(!this.session.definition.initialCheck);
    else if (action === "toggleDefaultStageCheck") this.session.setDefaultStageCheckEnabled(!this.session.definition.defaultStageCheck);
    else if (action === "addStage") this.session.addStage();
    else if (action === "removeStage") this.session.removeStage(index);
    else if (action === "duplicateStage") this.session.duplicateStage(index);
    else if (action === "moveStageUp") this.session.moveStage(index, "up");
    else if (action === "moveStageDown") this.session.moveStage(index, "down");
    else if (action === "toggleStage") {
      this.session.toggleStageCollapsed(index);
      if (this.container) await this.mount(this.container);
      return;
    }
    else if (action === "toggleStageCheck") this.session.setStageCheckOverride(index, !this.session.definition.stages[index]?.check);
    else if (action === "addStageNumericModifier") this.session.addStageNumericModifier(index);
    else if (action === "removeStageNumericModifier") this.session.removeStageNumericModifier(index, modifierIndex);
    else if (action === "addStagePeriodicEffect") this.session.addStagePeriodicEffect(index);
    else if (action === "removeStagePeriodicEffect") this.session.removeStagePeriodicEffect(index, periodicIndex);
    else if (action === "addPeriodicEffectDefinition") {
      const stage = this.session.definition.stages[index];
      const periodic = stage?.periodicEffects?.[periodicIndex];
      if (stage && periodic && !periodic.effect) {
        this.session.setStagePeriodicEffect(index, periodicIndex, createDefaultPeriodicEffectDefinition(this.session.definition, stage, periodic, this.#criticalApi()));
      }
    }
    else if (action === "removePeriodicEffectDefinition") this.session.setStagePeriodicEffect(index, periodicIndex, null);
    else if (action === "addStagePreActionGate") this.session.addStagePreActionGate(index);
    else if (action === "removeStagePreActionGate") this.session.removeStagePreActionGate(index, preActionIndex);
    else if (action === "addStageReaction") this.session.addStageReaction(index);
    else if (action === "removeStageReaction") this.session.removeStageReaction(index, reactionIndex);
    else if (action === "addReactionEffect") {
      const stage = this.session.definition.stages[index];
      const reaction = stage?.reactions?.[reactionIndex];
      if (stage && reaction && !reaction.effect) {
        this.session.setStageReactionEffect(index, reactionIndex, createDefaultReactionEffect(this.session.definition, stage, reaction, this.#criticalApi()));
      }
    }
    else if (action === "removeReactionEffect") this.session.setStageReactionEffect(index, reactionIndex, null);
    else if (action === "addStageEffect") {
      const stage = this.session.definition.stages[index];
      if (stage && !stage.effect) this.session.setStageEffect(index, createDefaultStageEffect(this.session.definition, stage, this.#criticalApi()));
    }
    else if (action === "removeStageEffect") this.session.clearStageEffect(index);
    else if (action === "browseImage") {
      const Picker = globalThis.FilePicker ?? foundry.applications?.apps?.FilePicker?.implementation;
      if (!Picker) {
        globalThis.ui?.notifications?.warn?.(localize("PF2E_AFFLICTION_FORGE.Editor.ImagePickerUnavailable"));
        return;
      }
      const picker = new Picker({
        type: "image",
        current: this.session.definition.img,
        callback: async (path) => {
          this.session.definition.img = path;
          await this.#changed();
        }
      });
      await picker.browse();
      return;
    } else return;

    await this.#changed();
  }

  async #mountStageEffectEditors() {
    if (!(this.root instanceof HTMLElement)) return;
    const criticalApi = this.#criticalApi();
    for (const host of this.root.querySelectorAll("[data-stage-effect-host]")) {
      const index = Number(host.dataset.stageEffectHost);
      const stage = this.session.definition.stages[index];
      if (!stage?.effect) continue;
      synchronizeManagedStageEffectMetadata(this.session.definition, stage);
      const editor = criticalApi.ui.effectEditor.create({
        definition: stage.effect,
        layout: "embedded",
        onChange: (effectSession) => {
          const built = effectSession.buildDefinition({ api: criticalApi });
          // `built` is deeply frozen by Critical Forge. Route it through the
          // session clone boundary before applying Affliction-owned metadata.
          const previousPersistence = Array.isArray(stage.effectComponentPersistence) ? [...stage.effectComponentPersistence] : [];
          this.session.setStageEffect(index, built);
          const currentStage = this.session.definition.stages[index];
          const componentCount = Array.isArray(currentStage?.effect?.components) ? currentStage.effect.components.length : 0;
          currentStage.effectComponentPersistence = Array.from({ length: componentCount }, (_, componentIndex) => previousPersistence[componentIndex] ?? null);
          const managed = synchronizeManagedStageEffectMetadata(this.session.definition, currentStage);
          this.session.markDirty();
          this.#updateStageEffectSummary(index, managed);
          this.#refreshStageComponentPersistence(index);
          this.#refreshValidation();
          this.#emitChange();
        }
      });
      this.effectEditors.set(index, editor);
      await editor.mount(host);
      host.dataset.afflictionEffectEditor = "components-only";
      editor.root?.setAttribute?.("data-affliction-stage-effect-editor", "");
      if (this.session.readOnly) {
        for (const control of host.querySelectorAll("input, select, textarea, button")) control.disabled = true;
      }
    }
  }


  async #mountPeriodicEffectEditors() {
    if (!(this.root instanceof HTMLElement)) return;
    const criticalApi = this.#criticalApi();
    for (const host of this.root.querySelectorAll("[data-periodic-effect-host]")) {
      const [stageText, periodicText] = String(host.dataset.periodicEffectHost ?? "").split(":");
      const stageIndex = Number(stageText);
      const periodicIndex = Number(periodicText);
      const stage = this.session.definition.stages[stageIndex];
      const periodic = stage?.periodicEffects?.[periodicIndex];
      if (!stage || !periodic?.effect) continue;
      synchronizeManagedPeriodicEffectMetadata(this.session.definition, stage, periodic);
      const editor = criticalApi.ui.effectEditor.create({
        definition: periodic.effect,
        layout: "embedded",
        onChange: (effectSession) => {
          const built = effectSession.buildDefinition({ api: criticalApi });
          this.session.setStagePeriodicEffect(stageIndex, periodicIndex, built);
          const currentStage = this.session.definition.stages[stageIndex];
          const currentPeriodic = currentStage?.periodicEffects?.[periodicIndex];
          const managed = synchronizeManagedPeriodicEffectMetadata(this.session.definition, currentStage, currentPeriodic);
          this.session.markDirty();
          this.#updatePeriodicEffectSummary(stageIndex, periodicIndex, managed);
          this.#refreshValidation();
          this.#emitChange();
        }
      });
      this.effectEditors.set(`periodic:${stageIndex}:${periodicIndex}`, editor);
      await editor.mount(host);
      host.dataset.afflictionEffectEditor = "components-only";
      editor.root?.setAttribute?.("data-affliction-periodic-effect-editor", "");
      if (this.session.readOnly) {
        for (const control of host.querySelectorAll("input, select, textarea, button")) control.disabled = true;
      }
    }
  }

  async #mountReactionEffectEditors() {
    if (!(this.root instanceof HTMLElement)) return;
    const criticalApi = this.#criticalApi();
    for (const host of this.root.querySelectorAll("[data-reaction-effect-host]")) {
      const [stageText, reactionText] = String(host.dataset.reactionEffectHost ?? "").split(":");
      const stageIndex = Number(stageText);
      const reactionIndex = Number(reactionText);
      const stage = this.session.definition.stages[stageIndex];
      const reaction = stage?.reactions?.[reactionIndex];
      if (!stage || !reaction?.effect) continue;
      synchronizeManagedReactionEffectMetadata(this.session.definition, stage, reaction);
      const editor = criticalApi.ui.effectEditor.create({
        definition: reaction.effect,
        layout: "embedded",
        onChange: (effectSession) => {
          const built = effectSession.buildDefinition({ api: criticalApi });
          this.session.setStageReactionEffect(stageIndex, reactionIndex, built);
          const currentStage = this.session.definition.stages[stageIndex];
          const currentReaction = currentStage?.reactions?.[reactionIndex];
          const managed = synchronizeManagedReactionEffectMetadata(this.session.definition, currentStage, currentReaction);
          this.session.markDirty();
          this.#updateReactionEffectSummary(stageIndex, reactionIndex, managed);
          this.#refreshValidation();
          this.#emitChange();
        }
      });
      this.effectEditors.set(`reaction:${stageIndex}:${reactionIndex}`, editor);
      await editor.mount(host);
      host.dataset.afflictionEffectEditor = "components-only";
      editor.root?.setAttribute?.("data-affliction-reaction-effect-editor", "");
      if (this.session.readOnly) {
        for (const control of host.querySelectorAll("input, select, textarea, button")) control.disabled = true;
      }
    }
  }

  #refreshValidation() {
    const root = this.root;
    if (!(root instanceof HTMLElement)) return this.#api().definitions.validate(this.session.definition);
    const section = root.querySelector("[data-validation-root]");
    const report = this.#api().definitions.validate(this.session.definition);
    if (!(section instanceof HTMLElement)) return report;
    const errors = report.issues?.filter((issue) => issue.severity === "error") ?? [];
    const badge = section.querySelector("[data-validation-badge]");
    if (badge) {
      badge.classList.toggle("valid", report.valid !== false);
      badge.classList.toggle("invalid", report.valid === false);
      badge.innerHTML = report.valid !== false
        ? `<i class="fa-solid fa-circle-check"></i> ${localize("PF2E_AFFLICTION_FORGE.Editor.Valid")}`
        : `<i class="fa-solid fa-circle-xmark"></i> ${errors.length} ${localize("PF2E_AFFLICTION_FORGE.Editor.Errors")}`;
    }

    let issues = section.querySelector("[data-validation-issues]");
    if (!issues) {
      issues = document.createElement("div");
      issues.dataset.validationIssues = "";
      section.append(issues);
    }
    issues.replaceChildren();
    if (!report.issues?.length) {
      issues.className = "affliction-editor-empty";
      issues.textContent = localize("PF2E_AFFLICTION_FORGE.Editor.NoValidationIssues");
      return report;
    }
    issues.className = "affliction-editor-issues";
    for (const issue of report.issues) {
      const row = document.createElement("div");
      row.className = `affliction-editor-issue severity-${issue.severity}`;
      const icon = document.createElement("i");
      icon.className = `fa-solid ${issue.severity === "error" ? "fa-circle-xmark" : "fa-triangle-exclamation"}`;
      const text = document.createElement("span");
      const path = document.createElement("strong");
      path.textContent = displayIssuePath(issue.path);
      const display = displayIssue(issue);
      text.append(path, document.createTextNode(`${issue.path ? " " : ""}${display.displayMessage}`));
      row.append(icon, text);
      issues.append(row);
    }
    return report;
  }

  #activateDynamicControls() {
    const root = this.root;
    if (!(root instanceof HTMLElement)) return;

    for (const region of root.querySelectorAll("[data-affliction-duration]")) {
      const enabled = region.querySelector("[data-duration-enabled]");
      const unlimited = region.querySelector("[data-duration-unlimited]");
      const controls = region.querySelectorAll("[data-duration-control]");
      const update = () => {
        const active = enabled ? enabled.checked : true;
        const infinite = Boolean(unlimited?.checked);
        if (unlimited) unlimited.disabled = !active || this.session.readOnly;
        for (const control of controls) control.disabled = !active || infinite || this.session.readOnly;
      };
      enabled?.addEventListener("change", update);
      unlimited?.addEventListener("change", update);
      update();
    }

    for (const region of root.querySelectorAll("[data-stage-duration]")) {
      const unlimited = region.querySelector("[data-duration-unlimited]");
      const controls = region.querySelectorAll("[data-duration-control]");
      const update = () => {
        const infinite = Boolean(unlimited?.checked);
        for (const control of controls) control.disabled = infinite || this.session.readOnly;
      };
      unlimited?.addEventListener("change", update);
      update();
    }

    for (const directive of root.querySelectorAll("[data-outcome]")) {
      const action = directive.querySelector("[data-directive-action]");
      const valueWrap = directive.querySelector("[data-directive-value-wrap]");
      const value = directive.querySelector("[data-directive-value]");
      const label = directive.querySelector("[data-directive-value-label]");
      const update = () => {
        const current = action?.value ?? "none";
        const visible = current === "set-stage" || current === "stage-delta";
        if (valueWrap) valueWrap.hidden = !visible;
        if (value) value.disabled = !visible || this.session.readOnly;
        if (label) label.textContent = localize(current === "set-stage"
          ? "PF2E_AFFLICTION_FORGE.Editor.TargetStage"
          : "PF2E_AFFLICTION_FORGE.Editor.StageDelta");
      };
      action?.addEventListener("change", update);
      update();
    }


    for (const region of root.querySelectorAll("[data-check-policy]")) {
      const override = region.querySelector("[data-check-policy-override]");
      const controls = region.querySelectorAll("[data-check-policy-control]");
      const update = () => {
        const enabled = Boolean(override?.checked);
        for (const control of controls) control.disabled = !enabled || this.session.readOnly;
      };
      override?.addEventListener("change", update);
      update();
    }

    for (const gate of root.querySelectorAll("[data-check-gate]")) {
      const combine = gate.querySelector("[data-gate-combine]");
      const checks = [...gate.querySelectorAll("[data-gate-check-id]")];
      const update = () => {
        const single = combine?.value === "single";
        if (!single) return;
        const selected = checks.filter((check) => check.checked);
        if (selected.length <= 1) return;
        for (const check of selected.slice(1)) check.checked = false;
      };
      combine?.addEventListener("change", update);
      for (const check of checks) check.addEventListener("change", () => {
        if (combine?.value === "single" && check.checked) {
          for (const other of checks) if (other !== check) other.checked = false;
        }
      });
      update();
    }

    for (const card of root.querySelectorAll("[data-stage-reaction-index]")) {
      const event = card.querySelector('[data-reaction-field="event"]');
      const damageTypes = card.querySelector('[data-reaction-field="damageTypes"]');
      const conditionSlugs = card.querySelector('[data-reaction-field="conditionSlugs"]');
      const conditionDelta = card.querySelector('[data-reaction-field="conditionValueDelta"]');
      const check = card.querySelector('[data-reaction-field="checkId"]');
      const outcomes = [...card.querySelectorAll('[data-reaction-outcome]')];
      const controllerActions = [...card.querySelectorAll('[data-reaction-controller-action]')];
      const update = () => {
        const eventValue = String(event?.value ?? "damage-taken");
        if (damageTypes) damageTypes.disabled = eventValue !== "damage-taken" || this.session.readOnly;
        if (conditionSlugs) conditionSlugs.disabled = eventValue !== "condition-increased" || this.session.readOnly;
        if (conditionDelta) conditionDelta.disabled = eventValue !== "condition-increased" || this.session.readOnly;
        const hasCheck = Boolean(String(check?.value ?? "").trim());
        for (const outcome of outcomes) outcome.disabled = !hasCheck || this.session.readOnly;
        for (const action of controllerActions) action.disabled = !hasCheck || this.session.readOnly;
      };
      event?.addEventListener("change", update);
      check?.addEventListener("change", update);
      update();
    }
  }

  #applyReadOnly() {
    if (!(this.root instanceof HTMLElement)) return;
    for (const control of this.root.querySelectorAll("input, select, textarea")) control.disabled = true;
    for (const button of this.root.querySelectorAll("button[data-affliction-action]")) {
      if (button.dataset.afflictionAction !== "toggleStage") button.disabled = true;
    }
  }
}

export function createEmbeddedAfflictionEditor(options = {}) {
  return new EmbeddedAfflictionEditor(options);
}

export function createAfflictionEditorUiApi() {
  return Object.freeze({
    template: AFFLICTION_EDITOR_TEMPLATE,
    modes: Object.freeze(["create", "edit", "view"]),
    createSession: (definition = null, options = {}) => createAfflictionEditorSession(definition, options),
    create: (options = {}) => createEmbeddedAfflictionEditor(options),
    render: (context, options = {}) => renderAfflictionEditor(context, options),
    prepareContext: (session, options = {}) => prepareAfflictionEditorContext(session, options)
  });
}
