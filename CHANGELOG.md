# Changelog

## 0.1.43

### Final Release

- promotes the fully reviewed 0.1.42 release-candidate code to the final 0.1.43 release without additional runtime changes
- retains duplicate-Affliction protection: one live controller per Actor and Affliction `definitionId`, including pending exposure and incubation
- retains charge-aware injury-poison coatings for weapons/attack Items, including default 1-charge attachment, positive-damage application-before-consumption, critical-failure consumption, depletion cleanup, concurrency protection, and visible Strike charge feedback
- keeps public API compatibility at `0.1.0`, Affliction schema v2, Controller schema v2, and reference schema v1; no migration is required from the reviewed RC
- updates module/package metadata, manifest download target, documentation, and release-contract tests to module version `0.1.43`

## 0.1.42

### Contract & Runtime Hardening

- separates the public API compatibility version (`0.1.0`) from the module release version (`0.1.42`)
- makes failed automatic combat-trigger applications retryable; idempotency is committed only after successful application or an intentional skip/manual/no-target decision
- enforces one live controller per Actor and Affliction `definitionId`; duplicate applications skip already affected targets, overlapping applications are serialized, and the same Affliction can be applied again after its prior controller ends
- tracks in-flight trigger keys separately to prevent duplicate concurrent application without poisoning later retries
- adds strict runtime reconciliation that detects and rebuilds manually altered generated stage-effect content without replaying instant damage or death
- makes the controller manager's “Runtime reparieren” action use strict reconciliation
- hardens identification changes with batch embedded Item updates when available and strict reconciliation after partial update failure
- adds public `api.instances.pause()` / `resume()` semantics; paused afflictions keep persistent output while stage, onset, and maximum-active-duration clocks are frozen
- adds pause/resume controls and audit events to the runtime manager
- excludes malformed provider templates from level-bounded library searches instead of letting unknown levels pass filters
- standardizes lethal-stage lifecycle chat as GM-only and keeps persisted Affliction links in the audit message
- prevents controller-manager stage navigation from bypassing pending exposure or incubation gates, and reserves stage 0 exclusively for those workflows
- rejects semantically impossible controller status/stage combinations and blocks active-to-stage-0 transitions
- treats a recorded lethal result as terminal across engine processing and manual stage/pause/instant-retry mutations
- preserves existing Affliction/Controller schema v2; pause metadata is an optional additive runtime field
- adds poison-only `delivery.injuryPoison` authoring in the embedded Affliction Editor without changing Affliction schema v2
- dropping an injury poison onto `weapon` or `melee` Items asks for a positive charge count and defaults to 1
- stores injury-poison charges on the concrete host reference, not on the global Affliction template; reference schema remains v1 with additive delivery metadata
- applies injury poison only after direct positive applied weapon/attack damage, then consumes exactly 1 charge; attack-roll critical failure consumes 1 charge without application
- removes exhausted injury-poison references automatically and exposes remaining charges in the host reference panel
- serializes injury-poison apply/consume transactions per host reference so a final charge cannot be spent twice by concurrent damage events
- adds public injury-poison reference helpers and `pf2eAfflictionForgeChargeConsumed` runtime hook
- adds regression coverage for trigger retry, strict reconcile, pause/resume timing, pending-save pause rejection, malformed library levels, injury-poison ordering, depletion, critical-failure consumption, and concurrent charge use

## 0.1.41

### GM Lifecycle Chat & Affliction Link Interaction Hardening

- fixes Affliction links in ChatMessages by using delegated click/drag handling that survives Foundry HTML enrichment and reconstruction
- clicking an Affliction chat link now opens the persisted template in the Affliction Forge for GMs
- reports real stage changes to the GM, including onset completion into the first active stage
- reports recovery, maximum active duration expiry, and explicit Affliction ending to the GM
- lifecycle messages include a persisted `@Affliction[...]` template reference when available
- suppresses duplicate stage-entry reporting for the same instant as a successful initial-exposure infection notice
- suppresses terminal lifecycle chat for rejected initial exposure and internal rollback cleanup
- adds regression coverage for delegated chat-link opening and lifecycle message routing

## 0.1.40

### GM Affliction Application Notifications

- whispers the GM when an Affliction actually takes hold after exposure resolution
- delays the notice until an initial save has confirmed infection
- includes a persisted Affliction template reference when available
- does not announce rejected initial exposure

## 0.1.39

### Native PF2e Combat Trigger Evaluation

- evaluates stored Affliction references against native PF2e ChatMessage context on the authoritative active GM
- maps attack rolls to `on-use` and successful/critical attacks to `on-hit`
- maps PF2e post-application `damage-taken` messages to `on-damage` only when positive damage was actually applied
- maps failed saves to `failed-save` and critical failures additionally to `critical-failure`
- supports `on-use` for PF2e spell-use and supported Item-use chat workflows when a target can be resolved
- enforces reference application policy: `manual` records no automatic action, `prompt` asks the GM, and `automatic` applies immediately
- routes every triggered application through the existing public Application Service and Affliction Engine
- resolves save-source Items from PF2e Item/origin/context metadata rather than rendered chat-card DOM
- deduplicates per message/reference/target and bounds the runtime dedupe cache
- adds public `api.triggers.inspectMessage()`, `matches()`, `processMessage()`, and `status()` helpers
- emits `pf2eAfflictionForgeTriggerApplied` after a successful trigger-driven application
- adds regression coverage for attack hits/misses, applied damage, healing/reversal, failed/critical saves, origin resolution, automatic application, deduplication, and manual policy

## 0.1.38

### Attack & Ability Reference Dialog Theme Hardening

- improved contrast of trigger/application selects in the attach-reference dialog
- added a dark native color scheme for the Foundry modal so Chromium renders the opened option list with matching background/text colors
- explicitly themed option and optgroup foreground/background colors, including selected and disabled entries
- kept the host-sheet reference panel theme-adaptive and unchanged

## 0.1.37

### Rich Text Drop Compatibility Hardening

- fixes Affliction drops doing nothing in Foundry v14 editable ProseMirror documents
- advertises a native Foundry `Item` drag payload through `text/plain` while retaining the semantic Affliction payload in the module MIME type
- lets Foundry's native ProseMirror ContentLink plugin provide a reliable fallback when the custom Affliction ProseMirror plugin is unavailable or ordered after core plugins
- also listens for the v14 `<prose-mirror>` custom element `plugins` configuration event in addition to the global `createProseMirrorEditor` hook
- broadens ProseMirror Plugin constructor discovery across hook state and plugin records
- preserves Actor, Token, Actor Directory, Attack/Ability and custom Affliction drop behavior through the dedicated module MIME payload
- adds regression tests for native rich-text drag payloads and custom-element plugin installation


## 0.1.35 - Attack & Ability Host-Sheet Theme Integration

- replaces the fixed dark reference-panel surfaces introduced in 0.1.34 with host-sheet-adaptive `currentColor` tints
- linked-affliction rows, selectors, buttons, counters, badges, and drop zones now inherit the surrounding PF2e sheet text palette
- adds local adaptive accent/border/surface tokens so parchment/light sheets remain readable while dark and third-party themes keep appropriate contrast
- restores explicit focus/hover affordances for reference selectors and linked-template buttons without importing the Affliction Forge window palette into PF2e Item sheets
- keeps destructive remove actions visually distinct and preserves existing drag/drop/reference behavior unchanged
- adds regression coverage for the theme-adaptive host-sheet CSS contract

## 0.1.34 - Attack & Ability Affliction Drop Zones

- adds dedicated Affliction reference panels to eligible PF2e `melee`, `weapon`, `action`, `feat`, and `spell` Item sheets
- Affliction Templates can be dropped into the panel and are stored as stable `afflictionReferences` on the host Item rather than copied as embedded Items
- dropping an Affliction onto an embedded eligible Item row on an Actor sheet links it to that attack/ability instead of applying the Affliction to the Actor
- linked Actor-sheet rows receive a compact biohazard count badge and highlight as Affliction drop targets during drag-over
- linking prompts for trigger (`on-hit`, `on-use`, `on-damage`, `failed-save`, etc.) and application policy (`manual`, `prompt`, `automatic`)
- melee/weapon hosts default to `on-hit + prompt`; action/feat/spell hosts default to `on-use + prompt`
- existing links can be opened, retargeted to a different trigger/application policy, or removed directly from the host Item sheet
- read-only compendium Items show existing references without offering mutation/drop actions
- extends the public reference API with host eligibility/default helpers and a supported host-item-type catalog
- preserves the existing rule that references are metadata only: runtime progression begins only when the host or external integration calls `api.application`
- adds regression coverage for host defaults, Item-sheet drop-zone wiring, and direct Actor-sheet attack-row drops

## 0.1.33 - Direct Actor Directory Drop

- Affliction templates can now be dropped directly onto Actor entries in Foundry's Actors sidebar directory.
- Actor Directory drops route through the same public Application Service and Affliction Engine as Actor-sheet and Canvas-token drops.
- Added a dedicated Affliction drag MIME marker so Actor-directory rows can advertise a copy drop target without hijacking unrelated directory drag operations.
- Actor rows receive a temporary visual highlight while a valid Affliction payload is dragged over them.
- Existing Actor-sheet, Canvas-token, `@Affliction[...]`, ability-reference, and external application workflows remain unchanged.

## 0.1.32

### Drag & Drop, Ability References & External Application API

- adds a first-class machine-readable Affliction reference contract for attacks, abilities, spells, generated Creature Forge content, and other Item sources
- stores references under `flags.pf2e-affliction-forge.afflictionReferences` without turning the source Item itself into a managed Affliction document
- adds reference trigger metadata (`manual`, `on-use`, `on-hit`, `on-damage`, `failed-save`, `critical-failure`, `custom`) and application-policy metadata (`manual`, `prompt`, `automatic`) for external consumers
- adds public `api.references` helpers for create/validate/list/get/set/add/remove, source-level embedding, and description-link generation
- adds public `api.application` as the canonical external application facade above `api.engine`, preserving source Item, source Actor, reference id, trigger, application mode, and host context in controller origin metadata
- adds draggable `@Affliction[UUID]{Label}` rich-text references and keeps ordinary `@UUID[...]` Item links compatible with template drops
- makes Affliction Forge library rows directly draggable
- transforms a dropped Affliction Template on an Actor sheet into an engine-managed controller application instead of leaving an inert template Item embedded on the Actor
- supports custom Affliction drag payloads on Actor sheets and both custom/reference Item drops directly onto canvas tokens
- blocks non-GM drag application instead of allowing an inert Affliction Template to be embedded by accident
- emits `pf2eAfflictionForgeApplied` after successful external application for loosely coupled consumer modules
- adds dedicated reference/application documentation and regression coverage for reference persistence, drag payloads, external origin metadata, enrichers, Actor-sheet interception, and canvas-token drops

## 0.1.31

### Live Manager Synchronization & Runtime UI Refresh

- keeps an open controller manager synchronized with controller changes caused by scheduler, saves, identification changes, stage transitions, reconciliation, and lethal-stage metadata
- refreshes displayed remaining time on world-time updates even when no transition occurs
- debounces related Item updates into one manager refresh and preserves outer/event-log scroll positions
- closes an open manager cleanly if its controller is deleted

## 0.1.30

### Runtime Review & Edge-Case Hardening

- serializes Affliction Engine processing, pending-save resumption, and player-result acceptance per controller so duplicate client deliveries cannot progress one instance twice
- serializes mutable controller operations such as stage changes, identification changes, instant retries, onset starts, and endings; a rejected mutation no longer poisons later queued work
- revalidates the persisted pending request immediately before save resolution and discards stale results after manual GM intervention
- adds public `api.engine.resumePending()` and automatic recovery for interrupted pending saves on world ready
- reissues only unresolved checks while preserving already completed results in multi-save gates
- recovers an `awaiting-player` request when its selected owner disconnects or loses ownership, using the normal fallback policy
- reopens an abandoned GM request only on actual GM-authority recovery, not on unrelated player connection changes
- bounds the in-memory player-save de-duplication history
- includes unlinked/synthetic token Actors in the world-wide active-Affliction registry and runtime discovery
- coalesces manual stage-effect deletion storms into one reconciliation pass
- makes reconciliation revision-aware so a stale repair pass cannot overwrite a newer manual/runtime transition
- isolates corrupt controllers during Actor/world reconciliation so healthy Afflictions still repair and the scheduler can continue starting
- cleans generated output when a controller is manually deleted without touching sibling instances
- defers irreversible multi-target instant mechanics until all controller and persistent-stage creation has structurally committed
- stops automatic catch-up once an Affliction has recorded a successful lethal-stage death, preserving its controller for cause-of-death/audit inspection
- adds regression coverage for duplicate save delivery, pending-save recovery, manual intervention races, rejected mutation queues, synthetic Actors, corrupt-controller isolation, deletion cleanup, stale reconciliation, multi-target rollback, and lethal catch-up

## 0.1.29

### Controller Manager Viewport & Scroll Hardening

- increases the default `Leiden verwalten` window from 520×520 to 560×700 while keeping it resizable
- makes the full controller manager body the primary vertical scroll viewport so every runtime section remains reachable
- adds ApplicationV2 height-chain hardening for `.window-content` and the controller shell
- adds a runtime `ResizeObserver` fallback so scroll sizing is recalculated when the manager is resized or a Foundry theme/wrapper reports different content dimensions
- keeps the event log's own bounded history viewport while ensuring the manager footer and `Leiden beenden` action can always be reached through the outer scrollbar
- disconnects the manager layout observer cleanly on close
- adds regression coverage for default size, scrollbar CSS, and runtime layout guarding

## 0.1.28

### Active Afflictions Registry & Manager Entry Points

- adds a dedicated `Active Afflictions` tab to the main Affliction Forge window
- groups all active controller instances by Actor and shows current status, stage, identification state, next due time, and lethal state
- adds search/filtering and a manual refresh action for active runtime instances
- opens the existing controller manager explicitly from each active-registry row
- adds public `api.instances.listAll()` for runtime consumers that need a world-wide controller catalog
- refreshes an open Active Afflictions registry when controllers are created, updated, or deleted
- adds a best-effort inline biohazard manager button to controller rows on GM Actor sheets when the current PF2e sheet exposes an item-controls container
- keeps the existing controller Item-sheet header action and `api.ui.controller.open()` as stable fallback entry points
- keeps application non-intrusive: applying an Affliction still never opens the manager automatically

## 0.1.27

### Runtime Manager UX & Reconciliation Hardening

- applying an Affliction no longer opens the controller manager automatically
- controller manager remains available as an explicit GM diagnostic/intervention tool
- added `instances.reconcile()`, `reconcileActor()`, and `reconcileAll()` public runtime APIs
- reconciliation rebuilds missing/wrong persistent stage output without re-running instant damage or death
- stale stage-effect UUIDs are synchronized back into controller state
- orphaned generated stage effects are removed during world-ready reconciliation
- manual deletion of a controller-owned stage effect is automatically repaired by the authoritative GM
- added a controller-manager `Repair runtime` action

## 0.1.26

### Library Service & Provider API

- adds a first-class Affliction Library Service above the existing template persistence layer
- treats world Affliction Items as the built-in writable library and preserves unregistered visible Item compendia as backward-compatible implicit libraries
- adds public `api.libraries` search, metadata, enable-state, source-resolution, write-policy, and summary contracts
- adds public `api.providers` registration/list/unregister contracts for external content modules
- supports providers with one or multiple named libraries backed by one or more Item compendium packs
- defaults provider libraries to read-only and enforces that policy for in-place template updates and Save-As/create destinations through the public API
- keeps read-only templates openable/applicable and preserves the existing copy-to-world editing workflow
- makes provider pack ownership exclusive so template-to-library resolution remains deterministic
- enriches template descriptors with affliction type, level, rarity, traits, themes, library identity, provider identity, and effective write state
- adds filtered library search by query, library, affliction type, theme, and level range
- persists dynamic library enabled/disabled state as hidden world configuration
- adds a Library selector to the Forge template pane and shows provider/library labels and read-only state
- refreshes an open Forge when providers are registered or library enable state changes
- adds provider/library documentation and regression coverage for read-only policy, search metadata, and enabled state

## 0.1.25

### Large Time-Jump Catch-up & Maximum-Duration Hardening

- fully processes every historically due interval during large world-time jumps in the default `all` catch-up mode
- keeps manual GM saves sequential instead of stopping catch-up after one interactive dialog
- resumes player-save catch-up automatically when an asynchronous player result returns
- evaluates maximum active duration as an absolute competing deadline during historical catch-up
- stops creating stage-save requests once the maximum active-duration deadline is reached
- preserves the optional `next` catch-up mode for deliberately one-step-at-a-time processing
- adds regression coverage for one-minute stages, ten-minute jumps, sequential interactive saves, and a five-minute maximum active-duration deadline

## 0.1.24

### Maximum Active Duration Semantics

- changes `maximumDuration` runtime semantics to PF2e-style active duration: onset/incubation time is excluded
- adds `activeStartedAt` to controller runtime state and anchors it exactly once when the first effective stage becomes active
- preserves `activeStartedAt` across later stage changes, same-stage renewals, reapplication, and catch-up processing
- makes `controllerMaximumDurationAt()` derive its deadline from the active-stage start instead of `appliedAt`
- adds a migration fallback for pre-0.1.24 controllers using the earliest recorded `stage-entered` runtime event before falling back conservatively
- clarifies the editor label as “Maximum active duration” / “Maximale Wirkungsdauer” and explains that onset does not count
- adds regression coverage for onset + active duration, direct-active application, and stage-transition clock preservation

## 0.1.23

### Visibility & Identification Runtime Hardening

- adds runtime presentation policies for `hidden`, `suspected`, and `identified` controller states
- hidden controller Items now use a generic identity and no player-facing token icon; suspected controllers use a generic visible identity; identified controllers restore the authored name, image, description, traits, and level
- generated stage Effect Items retain their identified presentation privately in module flags while hidden/suspected runtime presentation uses generic names/images and no token icon
- non-GM Actor-sheet renders conceal hidden controllers and all hidden/suspected stage-effect rows through Foundry's generic application render hooks
- changing identification at runtime immediately updates both controller and generated stage-effect presentation
- adds a bounded runtime event log to active controller state and exposes it through `api.instances.events()`
- adds `api.instances.presentation()` for consumers that need the resolved runtime visibility policy
- successful Critical Forge `death` execution records cause-of-death metadata on the controller, including stage, category, affliction name, and world-time timestamp
- lethal-stage execution emits a dedicated `pf2eAfflictionForgeDeath` hook and creates an identification-safe chat message: public only when identified, otherwise GM-only
- death-effect immunity results are recorded as audit events and GM-only chat messages without marking the affliction as the cause of death
- controller manager now shows a lethal-stage summary and a scrollable newest-first runtime event log
- runtime audit/chat failures are isolated from the committed stage transition so irreversible instant mechanics are never rolled back by logging failures

## 0.1.22

### ChatMessage-backed Player Save Transport

- makes the synchronized whispered save-request ChatMessage the primary transport for opening the PF2e saving-throw dialog on the selected player's client
- tags the resulting PF2e roll with a unique request/controller/check identity so the authoritative GM can resolve it without relying on socket result delivery
- keeps the module socket and manual-save correlation as fallbacks
- fixes the online-player case where only the request card appeared and the subsequent saving throw did not advance the affliction

## 0.1.21

### Direct Player Save Dialog & Socket Runtime

- declares the Foundry module socket namespace in `module.json` so player/GM runtime messages are officially relayed between connected clients
- replaces the chat-card-first player-save UX with a targeted client request that immediately invokes PF2e's native `Statistic.roll()` workflow on the selected player's browser
- keeps `skipDialog: false`, so the player receives PF2e's normal saving-throw modifier dialog instead of an Affliction-specific imitation
- returns the completed PF2e roll result to the requesting/authoritative GM and feeds it directly into the existing pending-check resolver
- persists the pending request before notifying the player client, preventing fast remote rolls from racing the GM-side controller state and being rejected as stale
- chooses exactly one active owner for an interactive prompt, preferring the user whose assigned character is the affected Actor and otherwise using deterministic user-id ordering
- retains the whispered request card as an audit/retry fallback if the player closes the direct dialog or a socket prompt is missed
- retains unambiguous manual Actor-sheet roll correlation as a secondary compatibility path
- adds regression coverage for targeted socket dispatch, owner selection, direct PF2e roll execution, and returned player results

## 0.1.20

### Player Save Request & Manual Roll Correlation

- pending player-save requests now accept matching PF2e saving throws rolled manually from the actor sheet
- correlates manual saves by authorized player, actor UUID, and requested save statistic
- keeps the existing request-card button as the deterministic path and ignores its generated roll in the manual-capture hook to prevent duplicate submission
- refuses ambiguous correlation when more than one pending request matches the same actor/save and asks the player to use the specific request card instead
- records pending requests from both rendered and newly created chat messages so the workflow survives chat rerenders and normal client activity
- adds a `createChatMessage` runtime listener for player-save result capture

## 0.1.19

- Fixes a runtime timestamp coercion bug where the default `atTime: null` became numeric `0` through `Number(null)`. Initial saves could therefore anchor onset at world-time zero, making a one-minute onset immediately overdue in established worlds.
- Persists `onsetStartedAt` when incubation actually begins. Initial exposure checks no longer imply that onset started when the controller was created.
- Keeps definition-derived onset and stage durations as the minimum timing floor while retaining later explicit `nextCheckAt` schedule overrides.
- Adds an integrated regression covering: initial save at t=1000, one-minute onset, one combat round (6 s) with no progression, phase 1 at t=1060, no stage save after another round, and the first stage save only at t=1120.
- Hardens nullable time handling in pending-check timestamps and manual scheduler calls.

## 0.1.18

### World-Time Timing & Save-Loop Hardening

- keeps the PF2e initial exposure save immediate, but removes pending initial checks from world-time scheduling entirely
- creates initial-check controllers with `nextCheckAt: null`, preventing the scheduler from racing the application-time save dialog
- adds a shared canonical due-time calculation used by both the scheduler and Affliction Engine
- treats persisted `nextCheckAt` as a cache/override that may delay, but can never shorten, the onset or current-stage duration defined by the affliction
- prevents a stale 1-round due timestamp from completing a 1-minute onset or requesting a 1-minute stage save after only one round
- treats any incomplete `pendingCheck` as in-flight, including the brief period while a PF2e GM roll dialog is open before an `awaiting-gm` marker exists
- limits interactive GM save resolution to one overdue interval per scheduler pass so catch-up cannot cascade through multiple roll dialogs without another explicit scheduling action
- ignores zero-delta `updateWorldTime` events used by calendar/time synchronization
- preserves automatic catch-up across multiple overdue intervals
- adds regression coverage for one-minute onset/stage timing, pending initial checks, in-progress GM checks, and manual-dialog cascade prevention

## 0.1.17

### World-Time Scheduler & Automatic Stage Processing

- adds a GM-authoritative world-time scheduler driven by Foundry's canonical `game.time.worldTime` and `updateWorldTime` hook
- uses Foundry's designated `game.users.activeGM` as the single scheduler authority and re-evaluates authority on `userConnected`
- discovers Affliction controllers on world Actors and synthetic token Actors from loaded Scenes
- automatically completes due onset periods and hands due stage checks to the existing Affliction Engine without duplicating save/progression rules
- anchors historical catch-up transitions to each controller's original `nextCheckAt`, preventing large time jumps from shifting every later interval to the final world time
- preserves asynchronous player/GM save requests and never reissues an already outstanding manual request on each world-time tick
- queues a fresh scheduler pass after a player save result is accepted so additional historical intervals can continue catching up immediately
- adds configurable catch-up modes: process all due intervals or only the next due step
- adds a per-controller catch-up safety limit, default 25, to prevent runaway processing after extreme time jumps
- enforces `maximumDuration` as a runtime deadline and ends the affliction when that deadline is reached
- processes overdue controllers once on `ready`, covering time advanced before or while the world was offline
- ignores backwards world-time changes; rewinding time never replays already processed affliction events
- exposes `api.scheduler` for status, manual due processing, and diagnostics
- fixes stage-check `none` outcomes so they consume/renew the interval instead of leaving `nextCheckAt` permanently overdue
- aligns player-result GM routing with Foundry's designated `activeGM`
- adds scheduler settings, DE/EN localization, public API coverage, and historical catch-up regression tests

## 0.1.15

### Stage Instant Effects Integration

- requires PF2E Critical Forge 1.0.1-rc.2 and consumes its public `api.effects.execute()` instant-execution contract
- executes instant stage mechanics such as one-shot `damage` when an active stage is entered
- keeps Critical Forge `toItemSources()` as the persistent-output path, so instant-only stages create no empty PF2e Effect Items
- executes stage instant mechanics after persistent state and controller state are committed; irreversible damage is never used as a rollback boundary
- preserves existing persistent stage Items when a save resolves to the same stage and reruns only the instant stage mechanics for the new interval
- keeps explicit manual `reapplyStage()` as the repair/refresh path that rebuilds persistent output and reruns instant mechanics
- exposes `api.instances.executeStageInstant()` for explicit retry/diagnostic execution of the current active stage
- reports failed instant execution without rolling an already committed stage transition back
- avoids leaking hidden/suspected affliction names through Critical Forge instant-damage breakdown labels
- adds Critical Forge execution-API compatibility diagnostics, DE/EN runtime error text, and regression coverage for mixed, instant-only, same-stage, reapply, and failure semantics

## 0.1.14

### Affliction Engine Core & Save Resolution

- adds the first authoritative GM-side Affliction Engine for initial exposure and active-stage checks
- adds canonical `api.engine.apply()`, `applyTemplate()`, and `applyDefinition()` paths that create controllers and immediately process initial saves
- keeps low-level `api.instances.apply*()` available for integrations that intentionally need controller creation without initial resolution
- executes PF2e Fortitude, Reflex, and Will saves through actor statistics
- supports automatic rolls, manual GM rolls, and player-owned chat save requests
- routes save results as public, GM-only, or blind-player rolls according to the schema-v2 save policy
- hides affliction identity and DC from rendered player requests while an affliction is hidden or suspected
- resolves multiple required saves using `single`, `best-degree`, `worst-degree`, `all-success`, and `any-success` combination modes
- converts degree-of-success outcomes into rejection, recovery, explicit stages, stage deltas, staying in stage, or end-of-affliction transitions
- starts onset after a successful initial infection/exposure resolution and remembers the eventual target stage
- stores resumable `pendingCheck` state and a `lastCheck` audit snapshot on active controllers
- adds controller-manager actions for initial exposure checks, stage saves, and manual onset completion
- keeps stage transition and last-check persistence in one controller transition update
- prevents save-policy fallback from mutating normalized definition data
- aligns low-level controller-state defaults with initial-check/onset semantics
- adds socket routing for player save results and deterministic GM-side result acceptance
- exposes core degree normalization/combination/directive helpers through the public API
- adds DE/EN runtime localization and regression coverage for automatic, GM-manual, onset, multi-save, canonical application, and transition history behavior

## 0.1.13

### Controller Application & Manual Stage Transitions

- adds active Affliction Controller Items with unique `instanceId`, source metadata, definition snapshots, identification state, stage state, and revision tracking
- adds application of templates/definitions to one or more Actors through the public instance API
- creates current-stage mechanics through Critical Forge's public Effect source API
- tags every generated stage effect with controller/instance/stage ownership metadata
- keeps multiple applications of the same affliction isolated from one another
- adds manual previous/next/reapply stage transitions with best-effort rollback on stage-effect creation failure
- adds active identification changes and controller/stage-item presentation updates
- adds controller cleanup and explicit end/recovery removal
- calculates and stores onset/stage `nextCheckAt` values for the later scheduler
- adds the GM controller manager and the official Forge action to apply the current definition to selected/targeted Actors

## 0.1.12

### Deleted Template Lifecycle Hardening

- fixes a deleted Affliction Template being resurrected as a dirty local draft when it had been the Forge's current template
- resets the editor to a fresh clean draft when its backing Item is deleted, whether the Forge is open or currently closed/cached
- prevents the misleading unsaved-changes prompt when switching away after deleting the previously opened template
- removes the deleted descriptor from the in-memory library immediately before invalidating/re-indexing the full template cache
- preserves normal live deletion refresh for non-current templates without disturbing the template currently being edited
- updates regression coverage for deletion while open and for the cached closed-Forge lifecycle


## 0.1.11

### Save Policy & Affliction Identification Contract

- bumps the Affliction Definition schema to v2 and the reserved controller-state schema to v2
- migrates schema-v1 Affliction Definitions to v2 during normalization without altering stored source documents until they are saved
- adds root saving-throw defaults for execution (`automatic`, `player`, `gm`) and result visibility (`public`, `gmOnly`)
- adds optional per-save overrides while preserving inherited defaults as the compact common case
- adds public `resolveSavePolicy()` semantics and API catalogs for execution/visibility modes
- adds initial affliction identification state (`hidden`, `suspected`, `identified`) to templates
- reserves current identification state, identification timestamp, and identifying user in the controller-state contract
- extends the Embedded Affliction Editor with saving-throw defaults, per-check overrides, and identification controls
- keeps inherited per-check policy displays synchronized immediately when root defaults change
- adds DE/EN localization, migration/validation coverage, controller-state tests, and public API tests

## 0.1.10

### Live Template Deletion Synchronization

- listens to Foundry's post-delete `deleteItem` document hook and invalidates the Affliction Template library immediately
- removes deleted world or compendium Affliction Templates from the open Forge without requiring a Foundry restart
- preserves the editor contents as an unsaved draft if the template currently being edited is deleted externally
- avoids rerendering a closed Forge while still invalidating its cached library for the next open
- adds regression coverage for the delete hook and host-side deletion handling contract

## 0.1.9

### Validation Localization & Save-As Dialog Hardening

- fixes Foundry V14 `DialogV2.input` Save As failure by keeping the supplied outer content DIV attribute-free and moving styling to an inner wrapper
- resolves Critical Forge `messageKey` validation issues through the Critical Forge localization namespace and formats their data placeholders
- shows nested Effect validation locations as human-readable phase/component labels instead of raw zero-based object paths
- preserves provider message keys for diagnostics while presenting localized messages to the GM
- adds regression coverage for the DialogV2 content contract and nested Effect warning adaptation

## 0.1.8

### Template Service & Item Library Persistence

- adds public `api.templates` persistence service for create, read, update, clone, list, and destination discovery
- saves Affliction Templates as inert PF2e `effect` Items in the world Item Library or writable Item compendia
- preserves the Item UUID when an existing writable template is updated
- tracks a monotonic `definitionVersion` in Affliction Forge flags
- clones templates with a new Affliction definition identity and records `copiedFromUuid`
- adds a searchable template library pane to the official Affliction Forge container
- adds Save and Save As workflows with destination selection
- opens protected compendium templates read-only and supports copying them into the world Item Library
- adds unsaved-change protection when opening another template, starting a new draft, or closing the Forge
- adds "Edit in Affliction Forge" integration for Affliction Template Item sheets in ApplicationV2 and legacy header hooks
- expands automated coverage for persistence, UUID stability, cloning, library discovery, and host architecture

## 0.1.7

### Embedded Effect Visual Integration

- restores the Critical Forge `--ef-*` visual theme inside embedded stage-effect editors so inputs, selects, text areas, cards, and panel surfaces render as recognizable controls instead of flat text
- keeps the public Critical Forge Embedded Effect Editor as the sole component editor; Affliction Forge only supplies the missing host theme context
- removes the nested component-list scrollbar in Affliction stages so the outer Affliction editor owns scrolling and component boundaries remain visible
- adds clearer spacing and a subtle card shadow while preserving Critical Forge type-specific component border accents

## 0.1.6

### Frozen Effect Ownership Hardening

- fixes reopening the Affliction Forge after editing a stage effect when Critical Forge returns a deeply frozen Effect Definition
- stage-effect metadata synchronization now clones the Critical Forge definition before applying Affliction-owned ID, name, image, duration, and metadata
- nested Effect Editor changes now cross the existing `AfflictionEditorSession.setStageEffect()` clone boundary instead of assigning a frozen definition directly
- remounting an existing local draft with edited stage effects is now safe
- adds regression coverage for frozen Effect Definitions and the no-direct-assignment integration contract

## 0.1.5

### Check Reference Sync & Compact Stage Effect Editing

- save-check labels and IDs now update all "used checks" references immediately while typing
- check-reference pills are indexed by the source check instead of relying on stale rendered text
- validation display no longer duplicates field paths such as `name name must be a non-empty string`
- stage Effect Definitions now have Affliction-owned ID, name, image, and unlimited lifecycle metadata kept in sync automatically
- the nested Critical Forge Effect Editor is reduced to its mechanical Components section inside an Affliction stage
- added an explicit stage-effect summary showing the current number of mechanical components
- clarified in the UI that effect identity and lifecycle are managed by the Affliction stage
- added regression tests for live check-reference markup, compact embedded effect presentation, and validation message formatting

## 0.1.4

### UI Runtime Hardening

- force-loads the Affliction Forge stylesheet with a module-version cache buster so the embedded editor cannot silently open unstyled after an update
- adds a runtime ApplicationV2 layout guard with `ResizeObserver` and an explicit scrollable editor viewport as a fallback for theme/wrapper differences
- makes the editor scrollbar permanent and visibly styled
- `Neues Leiden` remounts the draft, resets the editor viewport to the top, and focuses the name field
- `Validieren` refreshes validation in place and no longer jumps the entire window to the validation section
- tightens editor field, phase-header, action-button, and dark-panel styling for a usable host layout
- adds regression tests for stylesheet loading and runtime scroll fallback

## 0.1.3

- fixed the Affliction Forge ApplicationV2 height chain so the embedded editor scrolls inside the window
- hardened editable mode so create/edit sessions cannot inherit an accidental disabled fieldset state
- switched the host container root to a form, matching the proven Critical Forge ApplicationV2 pattern
- validation now refreshes the visible validation section without moving the host viewport
- creating a new draft focuses the name field after remounting
- added host/editor regression tests for scrolling and editable state

## 0.1.2

### Container & Item Sidebar Integration

- added the official ApplicationV2 Affliction Forge host window
- added GM-only Item sidebar integration
- host mounts the reusable Embedded Affliction Editor through the public UI API
- added local draft, validation, copy-definition, and close actions

## 0.1.1

### Embedded Affliction Editor & Public UI API

- added reusable `EmbeddedAfflictionEditor` and `AfflictionEditorSession`
- added public `api.ui.afflictionEditor` contract with create/edit/view modes
- added editing for basic metadata, checks, exposure, onset, maximum duration, progression, and stages
- added stage add/remove/duplicate/reorder and per-stage progression overrides
- embedded Critical Forge's public Effect Editor for mechanical stage effects
- added live Affliction Definition validation including nested Effect Definition validation
- kept persistence, application, and container actions outside the shared editor
- added responsive editor styles and German/English localization
- expanded automated editor/API architecture tests

## 0.1.0

### Foundation & Data Contract

- added versioned AfflictionDefinition schema v1
- added normalizer and structured validator
- added reusable save checks, multiple-check combination contract, and explicit degree-of-success transitions
- added onset, maximum duration, stages, stage overrides, themes, traits, rarity, and level metadata
- added stage Effect Definition integration boundary with PF2E Critical Forge
- added inert PF2e Effect Item template adapter and explicit Affliction Forge document flags
- reserved controller-state schema and active snapshot contract
- added public API 0.1.0 and `pf2eAfflictionForgeReady` hook
- added Critical Forge compatibility diagnostics
- added Node test suite for data, item, controller, and public API contracts

### RC polish: injury-poison Strike visibility
- Injury-poison charge prompts now persist an explicit HTML `value` attribute so the charge field is visibly prefilled with `1` when DialogV2 serializes its content.
- PF2e character-sheet Strike rows now show each enabled injury poison attached to the Strike weapon, including its remaining charges.
- The Strike coating indicator is informational and visible to players as well as GMs; attachment/editing remains GM-controlled.
