# Affliction Data Contract v2

Version 0.1.11 introduces schema v2. Schema-v1 definitions are accepted by the normalizer and upgraded in memory to v2. Unknown future schema versions remain rejected.

## Root definition

```js
{
  schemaVersion: 2,
  id: "example.ashen-fever",
  name: "Aschenfieber",
  description: "<p>...</p>",
  img: "icons/svg/biohazard.svg",
  afflictionType: "disease",
  level: 8,
  rarity: "common",
  traits: ["disease"],
  themes: ["ash", "fever"],

  saveDefaults: {
    execution: "player",   // automatic | player | gm
    visibility: "public"   // public | gmOnly
  },

  identification: {
    initialState: "identified" // hidden | suspected | identified
  },

  checks: [
    {
      id: "primary",
      label: "",
      kind: "save",
      statistic: "fortitude",
      dc: 27,

      // null inherits saveDefaults
      policy: null
    },
    {
      id: "secret",
      label: "Verdeckter Verlauf",
      kind: "save",
      statistic: "will",
      dc: 25,
      policy: {
        execution: "gm",
        visibility: "gmOnly"
      }
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

## Saving-throw policy

`saveDefaults` defines how saving throws are intended to be executed later by the Affliction Engine.

Execution modes:

- `automatic`: the engine performs the check
- `player`: the affected player's user is prompted to roll
- `gm`: a GM is prompted to roll

Visibility modes:

- `public`: the resulting check is public
- `gmOnly`: the result is restricted to the GM side of the workflow

Every save definition has `policy: null` by default. `null` means the check inherits `saveDefaults`. A non-null policy overrides both execution and visibility for that check.

Use:

```js
api.definitions.resolveSavePolicy(definition, "primary")
```

to obtain the effective policy without duplicating inheritance logic in consumer modules.

Version 0.1.11 defines and edits this contract only. It does not yet execute rolls or control chat visibility.

## Identification

`identification.initialState` defines how a newly applied instance is intended to begin:

- `hidden`: the affliction itself is not presented to the affected player
- `suspected`: the player may be told that something is wrong without receiving the full affliction identity
- `identified`: the affliction can be presented with its full identity

The template stores the start state. The controller stores the current runtime state, so identifying an affliction later does not require rewriting its template.

Version 0.1.13 stores this as live controller state and updates PF2e `unidentified` / token-icon presentation. Strict player-sheet/chat concealment is still reserved for a later visibility/runtime block.

## Check gates and multiple saves

Saving throws use stable IDs so the same save can be referenced by initial exposure and any number of stages.

Multiple checks are represented by multiple `checkIds`. Supported combination modes are:

- `single`
- `best-degree`
- `worst-degree`
- `all-success`
- `any-success`

Check gates store explicit transition directives:

- `none`
- `reject`
- `recover`
- `stay`
- `set-stage`
- `stage-delta`

A stage with `check: null` inherits `defaultStageCheck`.

## Stage Effect Definition

`stage.effect` is either `null` or a PF2E Critical Forge Effect Definition. Affliction Forge treats it as semantic stage mechanics and validates it through the Critical Forge public Effect API.

The **Affliction Engine owns the stage lifetime**. Stage effects are therefore normalized by the editor to an unlimited lifetime and later replaced/removed by the Affliction runtime.

## Template persistence

Affliction Templates use PF2e Item type `effect`, contain no Rule Elements, and store the definition in module flags:

```js
flags["pf2e-affliction-forge"] = {
  managed: true,
  documentKind: "affliction-template",
  schemaVersion: 2,
  definitionId: "...",
  definitionVersion: 1,
  definition: { /* schema-v2 snapshot */ }
}
```

Schema-v1 templates remain discoverable. Opening them normalizes their definition to schema v2; saving them writes the current schema.

## Active-controller state

The controller contract is now schema v2:

```js
{
  schemaVersion: 2,
  instanceId: "...",
  status: "active",
  currentStage: 1,
  appliedAt: 100000,
  stageEnteredAt: 100000,
  nextCheckAt: null,

  identification: {
    state: "hidden",
    identifiedAt: null,
    identifiedBy: null
  },

  recoverySuccesses: 0,
  activeStageEffectUuids: [],
  pendingCheck: null,
  revision: 1
}
```

In 0.1.13 this state is live. Application creates the controller and manual stage transitions update `currentStage`, `stageEnteredAt`, `nextCheckAt`, `activeStageEffectUuids`, and `revision`.

The controller Item additionally stores:

```js
flags["pf2e-affliction-forge"] = {
  managed: true,
  documentKind: "affliction-controller",
  definitionId: "...",
  definitionSnapshot: { /* normalized schema-v2 definition */ },
  instanceId: "affliction-instance....",
  sourceTemplateUuid: "..." || null,
  sourceDefinitionVersion: 4 || null,
  origin: { /* source module/actor/item/token metadata */ },
  state: { /* controller state above */ }
}
```

Generated stage-effect Item(s) use `documentKind: "affliction-stage-effect"` and carry the same `instanceId`, `controllerUuid`, `stageId`, and `stageNumber`. This source tagging is the authoritative cleanup boundary.

Automatic checks, automatic progression, and strict player visibility remain later runtime work.
