# Architecture 0.1.18

```text
Affliction Template / Definition
            │
            ▼
      Affliction Engine
            │
            ├── canonical application
            ├── save policy resolution
            ├── PF2e save execution/request routing
            ├── multiple-save combination
            ├── degree-of-success progression
            └── onset/recovery/rejection decisions
            │
            ▼
   Affliction Instance Service
            │
            ├── Controller Item on Actor
            │      ├── definition snapshot
            │      ├── instanceId
            │      ├── current stage/runtime state
            │      ├── pending check state
            │      ├── last-check audit snapshot
            │      └── identification state
            │
            └── Critical Forge Effect Engine
                   ├── toItemSources()
                   │      ▼
                   │  Persistent Stage Effect Item(s)
                   │  tagged with instanceId
                   │
                   └── execute()
                          ▼
                      Instant stage mechanics
                      (for example one-shot damage or death)
```

The editor remains independently embeddable:

```text
Affliction Forge Container       Future Creature Forge
          │                              │
          └──────────┬───────────────────┘
                     ▼
          Embedded Affliction Editor
                     │
                     └── Critical Forge Embedded Effect Editor per stage
```

## Ownership rules

- **Affliction Definition** is the reusable blueprint.
- **Affliction Controller** is the runtime truth for one application on one Actor.
- **Affliction Engine** owns saving-throw execution, pending request orchestration, result combination, and progression decisions.
- **Affliction Instance Service** owns controller persistence, application primitives, stage transitions, generated-effect cleanup, and identification updates.
- **Critical Forge Effect Engine** owns both translation of persistent stage mechanics to PF2e Item sources/Rule Elements and execution of instant components such as one-shot damage and immediate death.
- **Stage Effect Items** are generated mechanical output, never runtime truth.
- **Host containers** own persistence/application buttons. The Embedded Affliction Editor remains persistence-neutral.
- **Templates are inert** and contain no Rule Elements.
- **Active controllers snapshot definitions**, so later template edits cannot mutate an already running case.
- **Every generated stage effect carries the controller `instanceId`**, preventing one affliction instance from removing another's effects.

## Canonical application path

Normal integrations should use the engine rather than create a controller and remember to process exposure themselves:

```text
Template / Definition
        ↓
api.engine.apply*()
        ↓
Instance Service creates controller(s)
        ↓
Initial exposure gate present?
        ├── no → controller begins active/onset according to definition
        └── yes
             ↓
        Affliction Engine processes save policy
             ↓
        reject / stage / onset / pending player result
```

`api.instances.apply*()` remains intentionally lower level for migrations, diagnostics, and integrations that need to defer initial resolution.

## Save execution boundary

```text
Affliction Engine
    ↓ resolve check plan
Save policy
    ├── automatic
    │      └── GM PF2e roll, no modifier dialog
    ├── gm
    │      └── GM PF2e roll, normal modifier dialog
    └── player
           ├── active owner exists
           │      └── whispered request → player PF2e roll → module socket → GM accepts
           └── no active owner
                  └── GM-manual fallback
```

Result visibility is orthogonal:

```text
public
└── public roll result

gmOnly + automatic/gm
└── GM roll

gmOnly + player
└── blind player roll
```

The progression decision is always committed on a GM client.

## Multiple saves

A check gate can require multiple stable save IDs. The engine records each result in `pendingCheck.results`, allowing player requests to resolve asynchronously. Once all required results are available, the configured combination rule produces one degree of success:

- `single`
- `best-degree`
- `worst-degree`
- `all-success`
- `any-success`

That degree maps through the gate's outcome table to a transition directive.

## Transition transaction

For a transition to a different stage:

```text
resolved directive
    ↓
compile new persistent output through Critical Forge
    ↓
remove this instance's old persistent stage effects
    ↓
create new persistent stage effect Items
    ↓
update controller stage + timing + lastCheck
    ↓
execute instant stage mechanics through Critical Forge
```

The persistent output is precompiled before destructive work. If persistent creation or controller update fails, the instance service attempts to remove partial new output and recreate the previous stage output. Instant mechanics are deliberately executed **after** the persistent/controller transition is committed because instant damage and death are irreversible and cannot be safely rolled back. If instant execution fails, the committed stage remains active and the failure is reported for explicit retry.

For a save that resolves back to the same active stage:

```text
renew stageEnteredAt + nextCheckAt + lastCheck
    ↓
keep existing persistent stage Items untouched
    ↓
execute instant stage mechanics again
```

This is the interval behavior needed by poisons and diseases that deal damage or other instant mechanics every phase/round while retaining the same persistent conditions. `reapplyStage()` remains the explicit repair path that rebuilds persistent output as well as rerunning instant mechanics.

`lastCheck` is committed as part of the same stage transition update, avoiding a second state write after progression.

## Initial check and onset

Controllers now have explicit pre-stage states:

```text
initial check present
└── pending, stage 0

no initial check + onset
└── incubating, stage 0, onsetTargetStage 1

neither
└── active, stage 1
```

When an initial result targets a stage and an onset exists, the engine stores that target in `onsetTargetStage` and starts incubation. Completing onset applies the stored target stage.

## Pending player checks

Player-manual saves can outlive the original engine call. The controller stores a resumable `pendingCheck` with:

- request ID
- initial/stage gate identity
- involved check IDs
- request metadata per check
- resolved results per check
- base revision for diagnostics

A returned player result is accepted only when its request/check/user still matches the controller's pending state and Actor ownership.

## Identification boundary

`hidden` and `suspected` already affect runtime presentation and save requests:

- controller/stage Items use PF2e unidentified presentation and hide token icons
- player save-request text does not reveal the affliction name
- player save-request text does not display the DC
- instant-damage breakdown labels use a generic unidentified-affliction label instead of the hidden affliction name

Strict removal of the controller from non-GM Actor-sheet presentation remains a later hardening block.

## Time boundary

0.1.18 hardens the deliberately thin scheduler around the existing engine:

```text
Foundry game.time.worldTime
        ↓
updateWorldTime
        ↓
designated active GM only
        ↓
discover due Affliction controllers
        ↓
api.engine.process(controller, { atTime: nextCheckAt })
        ↓
existing save policy / progression / stage transition logic
```

`nextCheckAt` remains the controller's due-event source of truth. Catch-up processing uses the historical due timestamp as the logical transition time, so a jump from hour 1 to hour 10 can process hour 2, hour 3, and so on without moving all later intervals to hour 10.

The scheduler scans world Actors plus synthetic token Actors from loaded Scenes. Only Foundry's designated `game.users.activeGM` commits automatic transitions, preventing multiple connected GM clients from processing the same due event independently. Outstanding player/GM manual requests block re-issuance until they are resolved or manually retried.

World settings control automatic scheduling, catch-up mode (`all` or `next`), and a catch-up safety limit. `maximumDuration` is enforced as a runtime deadline. Backwards world-time updates do not replay past events.

Foundry's configured combat round time advances world time during combat, so round-based stage durations participate in the same clock. Dedicated turn-specific/event scheduling can be added later without changing the engine contract.
