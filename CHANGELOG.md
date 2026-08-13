# Changelog

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
