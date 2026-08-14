# Changelog

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
