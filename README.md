# PF2E Affliction Forge

Current development build: **0.1.16**

Version **0.1.16** extends the instant-stage integration to lethal final stages. Affliction stages can combine persistent mechanics with one-shot damage and Critical Forge `death` components; the Affliction runtime only decides when the stage fires while Critical Forge owns the actual death semantics.

The editor remains deliberately host-agnostic: it edits an `AfflictionDefinition`, embeds Critical Forge's public Effect Editor for stage mechanics, performs live validation, and returns the edited definition to its container. The official Affliction Forge container owns persistence and application.

## Current 0.1.x scope

- versioned `AfflictionDefinition` schema v2
- poison, disease, curse, and custom affliction types
- reusable save-check definitions
- saving-throw defaults plus per-check overrides (`automatic | player | gm`, `public | gmOnly`)
- identification state (`hidden | suspected | identified`)
- initial exposure checks and per-stage checks
- multiple-save resolution through `single`, `best-degree`, `worst-degree`, `all-success`, and `any-success`
- degree-of-success directives for reject, recover, stay, stage delta, and explicit stage selection
- onset, maximum duration metadata, stage duration, and narrative stage descriptions
- optional Critical Forge `EffectDefinition` per stage
- persistent inert PF2e `effect` Items for Affliction Templates
- active controller Items with definition snapshots, instance IDs, stage state, pending checks, and last-check history
- generated, instance-scoped persistent stage effects through Critical Forge's public Effect Engine API
- instant stage mechanics through Critical Forge `api.effects.execute()`, including one-shot damage and immediate death
- same-stage interval resolution that preserves persistent stage Items while rerunning instant mechanics
- manual stage transitions, reapplication, identification changes, and cleanup
- Affliction Engine execution of initial and stage saves
- automatic saves without a modifier dialog
- GM-manual saves with the PF2e roll dialog
- player-manual save requests through whispered chat cards
- public and GM-only result routing
- hidden/suspected save requests that do not reveal the affliction identity or DC in the request text
- searchable world/compendium template library with Save, Save As, clone/copy, and live deletion synchronization
- Embedded Affliction Editor and public UI API for future hosts such as Creature Forge

## Dependency

PF2E Affliction Forge requires **PF2E Critical Forge 1.0.1-rc.3 or later**. Affliction stage mechanics are stored as Critical Forge Effect Definitions. Persistent components are compiled through `api.effects.toItemSources()`, while instant components such as one-shot damage and `death` execute through `api.effects.execute()`. The `death` component supports Critical Forge's `direct` and `death-effect` categories; Affliction Forge does not duplicate immunity or death handling.

The Embedded Affliction Editor consumes Critical Forge's public `api.ui.effectEditor` interface and imports no Effect Forge internals.

## Public API

After `init`:

```js
const api = game.modules.get("pf2e-affliction-forge").api;
```

For normal runtime application, use the Affliction Engine entry point so the initial exposure check is processed immediately:

```js
const application = await api.engine.apply({
  templateUuid,
  targetActorUuid,
  origin: { sourceActorUuid, sourceItemUuid }
});

console.log(application.controllers); // surviving/pending active instances
console.log(application.results);     // initial-resolution results
```

Low-level `api.instances.apply*()` methods remain available for integrations that explicitly need to create a controller without running the initial check.

A `pf2eAfflictionForgeReady` hook is emitted on `ready` with the API object. See `docs/API.md`, `docs/DATA_CONTRACT.md`, and `docs/EMBEDDED_EDITOR.md` for the public contracts.

## Runtime boundary

0.1.16 deliberately does **not** include the world-time/combat scheduler yet. `nextCheckAt` is already maintained, and `api.engine.process(controllerUuid)` respects due times unless called with `{ force: true }`. The later scheduler only needs to discover due controllers and hand them to this tested engine.

Strict player-sheet concealment of hidden controllers is also a later hardening block. Hidden/suspected save prompts already avoid exposing the affliction name and DC in their rendered request text.
