# PF2E Affliction Forge

Current development build: **0.1.7**

Version **0.1.7** hardens the visual integration of the Critical Forge component editor inside Affliction stages. Embedded component cards now inherit the same Critical Forge field, panel, border, focus, and type-accent styling as the standalone Effect Editor, while the Affliction editor remains the single scroll owner.

The editor is deliberately host-agnostic: it edits an `AfflictionDefinition`, embeds Critical Forge's public Effect Editor for stage mechanics, performs live validation, and returns the edited definition to its container. Persistence and actor application remain outside the editor.

## Current 0.1.x scope

- versioned `AfflictionDefinition` schema
- poison, disease, curse, and custom affliction types
- reusable save-check definitions
- initial exposure resolution and per-stage progression resolution
- support for multiple saves through explicit combination modes
- onset, maximum duration, stage duration, narrative stage description
- optional Critical Forge `EffectDefinition` per stage
- normalization and structured validation
- inert PF2e `effect` Item source for Affliction Templates
- explicit module flags distinguishing templates, controllers, and generated stage effects
- versioned controller-state contract for later runtime work
- public API foundation
- Embedded Affliction Editor with create/edit/view modes
- save-check, exposure, onset, progression, and stage editing
- stage add/remove/duplicate/reorder controls
- Critical Forge Embedded Effect Editor mounted per stage in a compact components-only presentation
- live validation and public `api.ui.afflictionEditor` contract
- integration/compatibility boundary for PF2E Critical Forge

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
```

A `pf2eAfflictionForgeReady` hook is emitted on `ready` with the API object. See `docs/EMBEDDED_EDITOR.md` for the reusable UI contract.

## Design boundary

An Item in the Items Directory or a compendium is an **Affliction Template**. It contains the complete definition but no running state and no Rule Elements of its own.

When application/runtime arrives, applying a template will create an **Affliction Controller** embedded on an Actor. That controller will carry a definition snapshot and runtime state. Current-stage mechanical effects will be separate PF2e Effect Items generated through Critical Forge's Effect Engine.
