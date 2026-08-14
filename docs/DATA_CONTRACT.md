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

`saveDefaults` defines how saving throws are executed by the Affliction Engine.

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

Version 0.1.18 executes this contract. `automatic` uses a PF2e roll without the modifier dialog, `gm` keeps the GM roll dialog, and `player` creates a player-owner request with a GM fallback when no active player owner is available. `gmOnly` maps to GM-only execution for GM rolls and blind execution for player rolls.

## Identification

`identification.initialState` defines how a newly applied instance is intended to begin:

- `hidden`: the affliction itself is not presented to the affected player
- `suspected`: the player may be told that something is wrong without receiving the full affliction identity
- `identified`: the affliction can be presented with its full identity

The template stores the start state. The controller stores the current runtime state, so identifying an affliction later does not require rewriting its template.

Version 0.1.23 uses this as live controller state. Hidden controllers and unidentified stage-effect rows are concealed from non-GM Actor-sheet presentation; suspected controllers remain visible only under a generic identity; identified controllers restore authored presentation. Hidden/suspected save prompts omit the affliction identity and DC. Player-manual checks are requested directly on the selected owner's client through PF2e's native roll dialog.

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

Critical Forge classifies components by execution lifetime. Persistent components are converted to stage Effect Items through `api.effects.toItemSources()`. Instant components, including normal one-shot `damage` and immediate `death`, are not stored as stage Items and are executed through `api.effects.execute()`. `death` may use Critical Forge category `direct` or `death-effect`; Affliction Forge deliberately does not reinterpret those semantics. Entering a stage executes its instant components once. If a stage interval resolves back into the same stage, the existing persistent Items remain in place and the instant components execute again. Hidden/suspected afflictions use a generic execution label so PF2e damage breakdown presentation does not reveal the affliction name.

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


`maximumDuration` is the maximum **active** duration. Its clock starts when the first effective stage begins, not at exposure. Onset/incubation time is excluded. The controller persists that once-only anchor as `activeStartedAt`; later stage changes and same-stage renewals do not reset it. A controller that is still `pending` or `incubating` therefore has no maximum-duration deadline yet.

The controller contract remains schema v2 and now carries live save-resolution state:

```js
{
  schemaVersion: 2,
  instanceId: "...",

  // pending | incubating | active | paused | recovered | ended
  status: "active",
  currentStage: 1,

  appliedAt: 100000,
  stageEnteredAt: 100000,
  activeStartedAt: 100000,
  nextCheckAt: 128800,

  identification: {
    state: "hidden",
    identifiedAt: null,
    identifiedBy: null
  },

  recoverySuccesses: 0,
  activeStageEffectUuids: [],

  // Non-null while one or more required saves are still unresolved.
  pendingCheck: null,

  // Used when the initial result determines a stage before onset finishes.
  onsetTargetStage: null,

  // Audit snapshot of the most recently completed check gate.
  lastCheck: null,

  // Present only while status === "paused". Persistent stage mechanics stay
  // applied, but scheduler-owned clocks do not advance until resume().
  pause: null,

  revision: 1
}
```

When paused, `pause` stores the pause timestamp, the previous schedulable
status (`active` or `incubating`), and the due time that was frozen. Resuming
shifts `stageEnteredAt`, `onsetStartedAt`, `activeStartedAt`, and the saved due
time by the elapsed pause duration. The controller schema remains v2 because
this is an optional additive runtime field.

Default controller creation mirrors the definition:

- `initialCheck` present -> `pending`, stage 0
- no `initialCheck` + onset -> `incubating`, stage 0, `onsetTargetStage: 1`
- neither -> `active`, stage 1

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

Generated stage-effect Item(s) use `documentKind: "affliction-stage-effect"` and carry the same `instanceId`, `controllerUuid`, `stageId`, and `stageNumber`. They also retain an `identifiedPresentation` snapshot so runtime identification changes can restore the authored stage-effect name/image/description without recompiling the stage. This source tagging remains the authoritative cleanup boundary.

Automatic and manual save checks, progression, instant stage mechanics, world-time due-event discovery, chronological historical catch-up, maximum-active-duration enforcement, non-GM Actor-sheet concealment, and lethal-stage audit logging are live in 0.1.25. In `all` catch-up mode, interactive GM saves are awaited one after another within the same scheduler pass; player saves resume catch-up when their result returns. Dedicated turn-specific scheduling remains later runtime work.


## Pending-check runtime shape

`pendingCheck` is engine-owned resumable state. A representative shape is:

```js
{
  requestId: "affliction-check....",
  kind: "initial",       // initial | stage
  stageNumber: 0,
  combine: "single",
  checkIds: ["primary"],
  outcomes: { /* gate outcome directives */ },
  requestedAt: 100000,
  requestedByUserId: "GM_USER_ID",
  baseRevision: 2,

  requests: {
    primary: {
      checkId: "primary",
      status: "awaiting-player",
      execution: "player",
      visibility: "gmOnly",
      userIds: ["PLAYER_USER_ID"],
      messageId: "CHAT_MESSAGE_ID"
    }
  },

  results: {
    primary: {
      checkId: "primary",
      statistic: "fortitude",
      dc: 27,
      degree: "failure",
      total: 24,
      d20: 9,
      execution: "player",
      visibility: "gmOnly",
      userId: "PLAYER_USER_ID",
      resolvedAt: 100012
    }
  }
}
```

The runtime may add diagnostic fields over the 0.1.x line, but consumers should treat `pendingCheck` as engine-owned and use `api.engine.process()` / `acceptPlayerResult()` instead of mutating it directly.

## Last-check audit shape

After a gate fully resolves, `lastCheck` records the decision that produced the current state:

```js
{
  requestId: "affliction-check....",
  kind: "stage",
  stageNumber: 2,
  degree: "success",
  directive: { action: "stage-delta", delta: -1 },
  results: { /* resolved per-check results */ },
  resolvedAt: 128800
}
```

This is diagnostic/audit state. The current stage and active generated-effect UUIDs remain authoritative for runtime behavior.


### Runtime events and mortality

`state.events` is a bounded newest-preserving audit history (maximum 50 entries) containing world-time timestamp, event type, optional stage identity, and event-specific data. It is runtime metadata only and does not alter progression.

`state.mortality` remains `null` unless Critical Forge reports that a `death` instant component was actually applied. A death-effect immunity result creates a `death-resisted` event but does not populate mortality, so the Affliction Forge never claims a blocked death effect as the cause of death.
