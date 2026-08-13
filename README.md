# PF2E Affliction Forge

Version **0.1.0** establishes the foundation and public data contract for a staged PF2e affliction framework.

This release deliberately does **not** ship the Affliction Editor or automatic runtime yet. It fixes the contracts those later layers will consume, so the editor, Creature Forge integrations, content packs, and Affliction Engine can be built without rewriting the stored format.

## 0.1.0 scope

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
- integration/compatibility boundary for PF2E Critical Forge

## Dependency

PF2E Affliction Forge requires **PF2E Critical Forge 1.0.1-rc.1 or later**. Affliction stage mechanics are stored as Critical Forge Effect Definitions and validated through its public `api.effects.validate()` contract.

The later Embedded Affliction Editor will use Critical Forge's public `api.ui.effectEditor` interface rather than importing Effect Forge internals.

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

A `pf2eAfflictionForgeReady` hook is emitted on `ready` with the API object.

## Design boundary

An Item in the Items Directory or a compendium is an **Affliction Template**. It contains the complete definition but no running state and no Rule Elements of its own.

When application/runtime arrives, applying a template will create an **Affliction Controller** embedded on an Actor. That controller will carry a definition snapshot and runtime state. Current-stage mechanical effects will be separate PF2e Effect Items generated through Critical Forge's Effect Engine.
