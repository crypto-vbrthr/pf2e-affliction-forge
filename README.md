# PF2E Affliction Forge

Current development build: **0.1.13**

Version **0.1.13** adds the first active runtime slice: templates or draft definitions can be applied to Actors, creating a persistent Affliction Controller plus separately tagged current-stage Effect Items compiled through Critical Forge. GMs can manually move between stages, reapply the current stage, change identification state, or end the affliction.

The editor is deliberately host-agnostic: it edits an `AfflictionDefinition`, embeds Critical Forge's public Effect Editor for stage mechanics, performs live validation, and returns the edited definition to its container. Persistence and actor application remain outside the editor.

## Current 0.1.x scope

- versioned `AfflictionDefinition` schema
- poison, disease, curse, and custom affliction types
- reusable save-check definitions
- root saving-throw defaults plus per-check execution/visibility overrides (`automatic | player | gm`, `public | gmOnly`)
- identification start state (`hidden | suspected | identified`) copied into mutable active-controller state
- initial exposure resolution and per-stage progression resolution
- support for multiple saves through explicit combination modes
- onset, maximum duration, stage duration, narrative stage description
- optional Critical Forge `EffectDefinition` per stage
- normalization and structured validation
- persistent inert PF2e `effect` Items for Affliction Templates in the world Item Library or writable Item compendia
- explicit module flags distinguishing templates, controllers, and generated stage effects
- versioned active controller-state contract with per-instance snapshot, stage state, identification state, effect UUIDs, and revision
- public API foundation plus `api.templates` persistence service
- Embedded Affliction Editor with create/edit/view modes
- save-check, exposure, onset, progression, and stage editing
- stage add/remove/duplicate/reorder controls
- Critical Forge Embedded Effect Editor mounted per stage in a compact components-only presentation
- live validation and public `api.ui.afflictionEditor` contract
- integration/compatibility boundary for PF2E Critical Forge
- searchable world/compendium template library in the official Forge container
- Save, Save As, protected-compendium copy, and in-place update while preserving template UUIDs
- direct "Edit in Affliction Forge" entry from Affliction Template Item sheets
- `Apply to Selection` workflow using controlled tokens (or targeted tokens as fallback)
- active Affliction Controller Items embedded on Actors
- Critical Forge-generated stage Effect Items tagged to a single affliction instance
- manual previous/next/reapply stage transitions with rollback protection
- compact GM controller manager reachable from active controller Item sheets
- public `api.instances` runtime service for other modules

## Dependency

PF2E Affliction Forge requires **PF2E Critical Forge 1.0.1-rc.1 or later**. Affliction stage mechanics are stored as Critical Forge Effect Definitions and validated through its public `api.effects.validate()` contract.

The Embedded Affliction Editor uses Critical Forge's public `api.ui.effectEditor` interface and does not import Effect Forge internals.

## Public API

After `init`:

```js
const api = game.modules.get("pf2e-affliction-forge").api;

const definition = api.definitions.create({
  name: "Aschenfieber",
  afflictionType: "disease",
  level: 8
});

const normalized = api.definitions.normalize(definition);
const report = api.definitions.validate(normalized);
const itemSource = api.documents.buildTemplateSource(normalized);
const item = await api.templates.create(normalized);
await api.templates.update(item, { ...normalized, name: "Aschenfieber, überarbeitet" });
```

A `pf2eAfflictionForgeReady` hook is emitted on `ready` with the API object. See `docs/EMBEDDED_EDITOR.md` for the reusable UI contract.

## Design boundary

An Item in the Items Directory or a compendium is an **Affliction Template**. It contains the complete definition but no running state and no Rule Elements of its own.

Applying a template or definition creates an **Affliction Controller** embedded on an Actor. The controller carries a normalized definition snapshot and its own runtime state. Current-stage mechanics are separate PF2e Effect Items generated through Critical Forge's public Effect Engine source API and tagged with the controller instance ID.

Version 0.1.13 intentionally remains manual: it records `nextCheckAt`, save policies, and identification state, but does not yet execute saving throws, resolve progression automatically, or run a world-time/combat scheduler.
