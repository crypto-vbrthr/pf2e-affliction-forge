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

  // Additive schema-v2 delivery capability. Only valid for afflictionType: "poison".
  delivery: {
    injuryPoison: false
  },

  // Root restrictions are merged with the current stage restrictions.
  restrictions: {
    conditionLocks: [
      { slug: "sickened", minimum: null } // null = cannot reduce/remove current value
    ],
    healing: "none", // none | all | affliction-damage
    blockedCapabilities: [] // currently: speak
  },

  checks: [
    {
      id: "primary",
      label: "",
      kind: "save",
      statistic: "fortitude",
      dcMode: "fixed", // fixed | source
      dc: 27,

      // null inherits saveDefaults
      policy: null
    },
    {
      id: "secret",
      label: "Verdeckter Verlauf",
      kind: "save",
      statistic: "will",
      dcMode: "source",
      dc: null, // supplied by the applying source
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
    aboveMaximumStage: "clamp",
    virulent: false
  },

  stages: [
    {
      id: "stage-1",
      number: 1,
      name: "",
      description: "...",
      duration: { value: 8, unit: "hours" },
      check: null,
      restrictions: {
        conditionLocks: [],
        healing: "none",
        blockedCapabilities: []
      },
      effectPersistence: "stage", // stage | affliction | permanent
      effect: null
    }
  ],

  metadata: {
    originModule: "pf2e-affliction-forge",
    originFeature: "affliction-definition"
  }
}
```

## Save DC source

Each check stores `dcMode`. `fixed` uses the authored integer `dc`. `source` allows `dc: null` on the reusable template and requires the applying caller to provide a concrete DC through `saveDc`, `saveDcs[checkId]`, or the equivalent `origin.context` fields. Active controller snapshots store the resolved number so later progression is deterministic even if the originating spellcaster/item changes. Missing source DCs reject application before controller creation.

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

## Delivery capability: injury poison

`delivery.injuryPoison` is an additive schema-v2 capability and defaults to `false`. It is valid only when `afflictionType === "poison"`. The definition itself never stores remaining charges. Charges belong to a concrete host reference, because the same poison can be applied independently to multiple weapons or attacks.

When an injury poison is attached, the host reference stores:

```js
{
  schemaVersion: 1,
  templateUuid: "...",
  trigger: "on-damage",
  application: "automatic",
  delivery: {
    type: "injury-poison",
    charges: 1
  }
}
```

The attachment dialog defaults to one charge but accepts any positive integer. At runtime, direct positive applied damage from the coated weapon/attack applies the poison first and consumes one charge second. An `attack-roll` critical failure consumes one charge without applying the poison. At zero charges the reference is removed from the host Item.

## Virulent / Ausgeprägt progression

`progression.virulent` is an additive schema-v2 boolean. When true, stage-save progression tracks consecutive successful saves in controller `state.recoverySuccesses`: the first success remains in the current stage and records one success; the second consecutive success reduces by exactly one stage; a critical success reduces by exactly one stage immediately; failure and critical failure clear the streak. Initial exposure resolution is unchanged.

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

These are runtime invariants, not only defaults: `pending` and `incubating` remain in stage 0, `active` controllers are always in stage 1 or higher, and `paused` controllers retain the stage shape of their previous schedulable status. Stage 0 is therefore not a manual predecessor to stage 1; recovery/end is represented by the terminal controller lifecycle instead.

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

Runtime uniqueness is keyed by the controller `definitionId`: an Actor may have only one live Affliction controller with a given `definitionId` at a time. The controller reserves that identity from pending exposure/onset onward. This is a runtime invariant rather than a schema change, so controller schema v2 remains unchanged.

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


## Restriction semantics (0.1.49)

Restrictions are additive schema-v2 fields. Legacy definitions normalize to empty restrictions and `effectPersistence: "stage"`. Root and current-stage restrictions merge at runtime.

- `conditionLocks`: matching PF2e condition Items cannot be deleted. With an integer `minimum`, the value cannot be reduced below it. With `minimum: null`, the value present on that condition Item is the floor for external reductions.
- `healing: "all"`: blocks Actor HP increases while active.
- `healing: "affliction-damage"`: protects only HP damage observed around this affliction's own instant stage execution. The protected amount is stored in controller `state.unhealableDamage`.
- `blockedCapabilities`: machine-readable host-integration restrictions. `speak` is the initial supported capability.
- `effectPersistence: "stage"`: generated persistent stage output is removed when leaving the stage.
- `effectPersistence: "affliction"`: generated persistent output survives later stages and is removed when the affliction ends.
- `effectPersistence: "permanent"`: generated persistent output survives later stages and remains as a detached `affliction-residual-effect` after controller end.

`affliction-damage` intentionally does not claim damage caused by unrelated external events, even when the damage type matches a disease rule. Damage-type-wide healing restrictions require a separate future runtime contract.
