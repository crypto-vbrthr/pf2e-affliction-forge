# Affliction Data Contract v1

## Root definition

```js
{
  schemaVersion: 1,
  id: "example.ashen-fever",
  name: "Aschenfieber",
  description: "<p>...</p>",
  img: "icons/svg/biohazard.svg",
  afflictionType: "disease",
  level: 8,
  rarity: "common",
  traits: ["disease"],
  themes: ["ash", "fever"],

  checks: [
    {
      id: "primary",
      label: "",
      kind: "save",
      statistic: "fortitude",
      dc: 27
    }
  ],

  initialCheck: {
    checkIds: ["primary"],
    combine: "single",
    outcomes: {
      criticalSuccess: { action: "reject" },
      success: { action: "reject" },
      failure: { action: "set-stage", stage: 1 },
      criticalFailure: { action: "set-stage", stage: 2 }
    }
  },

  onset: { value: 1, unit: "days" },
  maximumDuration: null,

  defaultStageCheck: {
    checkIds: ["primary"],
    combine: "single",
    outcomes: {
      criticalSuccess: { action: "stage-delta", delta: -2 },
      success: { action: "stage-delta", delta: -1 },
      failure: { action: "stage-delta", delta: 1 },
      criticalFailure: { action: "stage-delta", delta: 2 }
    }
  },

  progression: {
    belowStageOne: "recover",
    aboveMaximumStage: "clamp"
  },

  stages: [
    {
      id: "stage-1",
      number: 1,
      name: "",
      description: "...",
      duration: { value: 8, unit: "hours" },
      check: null,
      effect: null
    }
  ],

  metadata: {
    originModule: "pf2e-affliction-forge",
    originFeature: "affliction-definition"
  }
}
```

## Checks

Version 1 supports saving throws using `fortitude`, `reflex`, or `will`. Checks have stable IDs so the same save can be referenced by the initial exposure and by any number of stages.

Multiple checks are represented by multiple `checkIds`. The combination mode is explicit:

- `single`
- `best-degree`
- `worst-degree`
- `all-success`
- `any-success`

This is intentionally a data contract only in 0.1.0. Runtime execution of those modes belongs to the later Affliction Engine.

## Stage progression

Every check gate stores explicit transition directives. Supported v1 actions are:

- `none`
- `reject`
- `recover`
- `stay`
- `set-stage`
- `stage-delta`

A stage with `check: null` inherits `defaultStageCheck`. This keeps normal PF2e-style progressions concise while allowing a stage to override the recovery rule completely.

## Stage Effect Definition

`stage.effect` is either `null` or a normal PF2E Critical Forge Effect Definition. Affliction Forge treats it as semantic stage mechanics and validates it through the Critical Forge public Effect API.

The **Affliction Engine owns the stage lifetime**. A stage effect must therefore not be treated as the source of truth for when a stage ends. Later runtime code may rewrite/override the stored Effect Definition duration when generating an active stage Effect Item.

## Template persistence

Affliction Templates use PF2e Item type `effect`, but intentionally contain no Rule Elements. The actual affliction definition is stored below:

```js
flags["pf2e-affliction-forge"] = {
  managed: true,
  documentKind: "affliction-template",
  schemaVersion: 1,
  definitionId: "...",
  definition: { /* snapshot */ }
}
```

This means a template can live in the Items Directory or an Item compendium without accidentally applying stage mechanics.

## Active instances

The runtime contract is already reserved. An applied template will become an embedded controller with:

```js
{
  managed: true,
  documentKind: "affliction-controller",
  definitionSnapshot: { /* stable snapshot */ },
  instanceId: "...",
  sourceTemplateUuid: "...",
  state: {
    schemaVersion: 1,
    status: "active",
    currentStage: 1,
    appliedAt: 100000,
    stageEnteredAt: 100000,
    nextCheckAt: null,
    recoverySuccesses: 0,
    activeStageEffectUuids: [],
    pendingCheck: null,
    revision: 1
  }
}
```

The controller snapshot prevents later template edits from silently mutating afflictions already running on Actors.
