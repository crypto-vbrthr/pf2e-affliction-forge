# Architecture 0.1.46

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
            │      ├── bounded runtime event log
            │      ├── lethal-stage mortality audit data
            │      ├── identification state
            │      └── optional pause metadata
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

## Library boundary

```text
World Items ───────────────┐
Implicit Item Compendia ──┼──► Affliction Library Service ──► Forge / consumers
Registered Provider Packs ┘              │
                                         ├── search/filter
                                         ├── enabled state
                                         ├── read-only policy
                                         └── provider metadata
```

The library layer is discovery and policy, not a new persistence format. Canonical templates remain PF2e `effect` Items and references remain Foundry UUIDs. A registered provider claims one or more Item compendium packs and can mark its library read-only even if the pack itself is technically writable. Public Affliction template updates and Save-As destinations respect that library policy. Unregistered visible Item compendia retain backward-compatible implicit-library discovery.

External content modules register providers through `api.providers.register()` after `pf2eAfflictionForgeReady`; they do not need to implement any runtime affliction logic.

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
- **Every Actor has at most one live controller for a given Affliction `definitionId`**. Pending, incubating, active, paused, and terminal retained controllers reserve that identity; duplicate application attempts are skipped until the controller ends or is removed.

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
           │      └── whispered request document → player PF2e roll → synchronized tagged roll message → GM accepts
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

A returned player result is accepted only when its request/check/user still matches the controller's pending state and Actor ownership. Save processing and result acceptance are serialized per controller, and the persisted request is revalidated immediately before progression. World reload, GM authority recovery, and an unavailable player owner can resume the pending gate without discarding results that were already completed.

## Identification boundary

Runtime presentation is resolved from the controller's current identification state:

- `hidden`: generic controller identity is stored, token icon is disabled, and the controller plus generated stage-effect rows are concealed from non-GM Actor-sheet renders
- `suspected`: a generic suspected-affliction controller remains visible, while generated stage-effect rows stay concealed so stage mechanics do not identify the source
- `identified`: authored name, image, description, traits, level, token icon, and generated stage-effect presentation are restored
- hidden/suspected player save-request text never reveals the affliction name or DC
- player-manual checks execute on the selected owner's client through PF2e's native Statistic roll dialog; synchronized request/roll ChatMessages are the primary correlation transport and the module socket is a fallback
- instant-damage/death labels use generic unidentified-affliction wording until identification

The concealment layer is a Foundry UI/runtime presentation boundary. The authoritative controller still snapshots the definition on the Actor, so it should not be treated as cryptographic secrecy from a technically privileged client capable of inspecting raw document data.

Lethal stage execution is audited separately from ordinary stage state. A successful Critical Forge `death` result stores the causing stage/category/timestamp and appends a runtime event; a prevented death effect records an immunity event without claiming cause of death.

## Runtime concurrency and reconciliation boundary

0.1.30 keeps one logical mutation stream per active controller. Affliction Engine save resolution and instance-service stage/identification/end mutations are serialized, while reconciliation uses revision snapshots and retries rather than writing stale generated output over a newer controller state. Reconciliation is also fault-isolated per controller/Actor and never replays instant mechanics. Multi-target application structurally commits all controller/persistent output before any irreversible instant damage/death executes. Actor/definition application locks are acquired in stable order, so overlapping multi-target calls cannot race into duplicate controllers or deadlock each other; already affected targets are filtered while eligible siblings continue normally.

Generated stage-effect deletion hooks are coalesced, manually deleted controllers clean only their own generated output, and runtime discovery includes world Actors plus unlinked synthetic token Actors. Once `state.mortality.dead` records a successful lethal-stage outcome, automatic scheduler catch-up stops for that controller while the controller remains available for audit/GM management.

## Time boundary

The scheduler remains deliberately thin around the existing engine:

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

World settings control automatic scheduling, catch-up mode (`all` or `next`), and a catch-up safety limit. `maximumDuration` is enforced as a runtime deadline anchored to `state.activeStartedAt`, the instant the first effective stage becomes active. Onset/incubation is excluded and later stage transitions never reset the deadline. Backwards world-time updates do not replay past events.

Foundry's configured combat round time advances world time during combat, so round-based stage durations participate in the same clock. Dedicated turn-specific/event scheduling can be added later without changing the engine contract.


## Reconciliation ownership

Generated stage-effect Items are disposable runtime output owned by an Affliction controller. The controller snapshot/state remains authoritative. Reconciliation may rebuild missing or stale persistent stage output, synchronize stored UUIDs, and remove orphaned generated Items. It must not replay instant mechanics.


## Active Afflictions registry

The main Forge has two host views: `Templates` for authoring/library work and `Active Afflictions` for runtime discovery. The active registry is read-only and obtains controller descriptors through `api.instances.listAll()`. It never mutates runtime state directly; each row delegates intervention to the existing controller manager through `api.ui.controller.open()`. Controller create/update/delete hooks only invalidate and refresh the registry view. Applying an Affliction remains non-interruptive and never opens the manager automatically.

## External reference and application layer

Version 0.1.34 adds a consumer-facing layer above the Affliction Engine. Host modules store machine-readable template references on their own Items or generated Item sources and call `api.application` only when the host-specific trigger is satisfied. The application facade records origin metadata and then delegates immediately to the existing high-level Affliction Engine.

```text
Attack / Ability / Spell / Creature Forge
        ↓ AfflictionReference
api.application
        ↓
Affliction Engine
        ↓
Controller / Scheduler
        ↓
Critical Forge Effect Engine
```

Drag & Drop is only another frontend to this same application boundary. Template Item drops on Actor sheets are converted into controller applications rather than embedded as inert template Items. Canvas drops resolve the token under the drop point and use the same application facade.

The host Item is not marked as an Affliction Forge managed document merely because it carries references. Managed-document flags remain exclusive to the Affliction runtime/persistence document kinds.


### Actor Directory drop integration (0.1.34)

The external integration layer binds only to rendered Actor Directory roots and consumes the module-specific Affliction drag MIME payload in capture phase. Valid drops resolve the target Actor by directory entry id and route through the public Application Service. Unrelated Actor-directory drag operations are left untouched.


## Attack/ability host reference UI (0.1.34)

The host reference UI is an integration layer above `affliction-reference-service.js`. It does not apply Afflictions and does not own runtime progression. It only edits reference metadata on eligible PF2e Items.

```text
Affliction Template drag
        ↓
Item sheet panel or embedded Actor-sheet Item row
        ↓
reference configuration (trigger + application policy)
        ↓
flags.pf2e-affliction-forge.afflictionReferences
        ↓
later host trigger
        ↓
api.application
        ↓
Affliction Engine
```

Actor-sheet drop listeners run in the capture phase and consume a valid Affliction drop only when the pointer is over an eligible `data-item-id` row. Drops elsewhere on the Actor sheet continue to use the normal Actor-application path.


## Native PF2e combat trigger runtime (0.1.39)

`affliction-combat-trigger-runtime.js` is an integration adapter between PF2e ChatMessage semantics and the existing reference/application layer. It does not own Affliction progression.

```text
PF2e ChatMessage
        ↓ context/origin/target
Combat Trigger Runtime
        ↓ semantic trigger match
AfflictionReference
        ↓ manual | prompt | automatic
api.application.applyItemReference()
        ↓
Affliction Engine
```

The adapter runs only on the authoritative active GM, deduplicates message/reference/target tuples, and treats PF2e `damage-taken` as the `on-damage` boundary so rolled damage is not confused with actually applied damage. Custom trigger types deliberately remain the responsibility of the external host and use the same public Application Service directly.

### Injury-poison consumable reference path (0.1.42)

Injury poison is modeled as a definition capability plus host-local consumable state. `AfflictionDefinition.delivery.injuryPoison` says that the template may be used as a coating; the remaining charge count is stored only on the concrete `AfflictionReference.delivery` attached to a `weapon` or `melee` Item. This keeps one template stateless while allowing multiple independently coated hosts.

```text
Poison template (delivery.injuryPoison = true)
        ↓ drop on weapon / melee Item
charge prompt (default 1)
        ↓
AfflictionReference.delivery = { type: "injury-poison", charges: N }
        ↓
PF2e attack criticalFailure ─────────────→ consume charge only
PF2e direct positive damage → apply via Application Service → consume charge
                                                        ↓
                                              remove reference at 0
```

The combat runtime serializes the complete apply/consume transaction per source Item + reference, then re-reads the live host reference under that lock. This prevents the last remaining charge from poisoning two targets when separate damage messages arrive concurrently. Application occurs before charge mutation; a runtime application error leaves the charge intact and the message retryable.


## Contract/runtime hardening in 0.1.42

- Runtime application now enforces one live controller per Actor + Affliction `definitionId`, including pending exposure/incubation reservations and concurrent apply calls.
- Public API compatibility is versioned independently (`api.version = 0.1.0`, `api.moduleVersion = 0.1.46`).
- Combat-trigger idempotency is committed only after a successful application or an intentional terminal decision; transient failures remain retryable.
- Strict reconciliation can verify generated stage-effect content, not merely controller/stage ownership flags.
- Identification updates use batch embedded-document updates when available and fall back to strict reconciliation after a partial failure.
- Paused controllers keep persistent mechanics but are excluded from scheduling. Resume shifts active timing anchors so neither stage duration nor maximum active duration advances while paused.
- GM lifecycle reporting uses one privacy contract, including lethal-stage messages.
- Controller-manager stage navigation is enabled only for active, nonlethal controllers; stage 0 remains reserved for initial exposure/onset state.
- Controller-state validation enforces status/stage and pause-metadata invariants so malformed runtime states cannot be persisted by ordinary mutations.
- A committed lethal result is terminal for engine progression and ordinary manual stage/pause/instant retry mutations; reconciliation, identification, inspection, and explicit end remain available for audit/cleanup.
- Poison definitions can opt into injury-poison delivery. Charge state is host-local, positive weapon damage applies before consuming a charge, critical attack failure consumes without application, and the last charge removes the reference.


## Remastered rules coverage in 0.1.45

The definition layer now models virulent/Ausgeprägt progression natively and distinguishes authored fixed save DCs from source/dynamic DCs. Dynamic DCs are resolved at the application boundary and snapshotted into the active controller definition; the runtime never reaches back into a mutable originating spell/item to recalculate an already active affliction.


## Grouped save UX and source-DC application in 0.1.45

A gate with several `checkIds` is still one progression decision, but its interactive saves are now surfaced as one batch. GM-manual checks open one persistent Affliction save application; player-owned checks are delivered in one targeted batch request and use the same application on the selected owner's client. The window records every individual result and leaves the final results visible after resolution. `Roll all` uses PF2e's statistic roll directly, while an advanced per-row action retains the native PF2e modifier dialog for situational modifiers.

Once all checks in a multi-save gate are resolved, the authoritative GM writes one summary card containing the individual results and the configured combined result. Ausgeprägt/Virulent is not converted into two simultaneous rolls: its two successful stage saves remain separated by the Affliction's normal stage interval. Chat reporting instead exposes the persisted consecutive-success state (`1/2`, `2/2`, interrupted, or critical-success reduction).

Dynamic/source save DCs remain an application-boundary concern. The Forge's direct Apply action and Actor-sheet template drop prompt the GM for source DCs before creating a controller. External consumers remain non-interactive and must pass `saveDc`, `saveDcs`, or equivalent values through application context. The resolved numeric DC is snapshotted into the controller definition while `dcMode: "source"` remains as provenance.

## Virulent single-save window in 0.1.46

Virulent/Ausgeprägt stage progression still performs exactly one save at each normal stage interval. Unlike ordinary single-save gates, a due virulent stage save is routed through the Affliction save window so the current consecutive-success streak is visible before rolling. The next required success remains a later regular stage save; the UI never synthesizes an immediate second save.
