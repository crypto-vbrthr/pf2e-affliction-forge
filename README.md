# PF2E Affliction Forge

Current development build: **0.1.34**

Version **0.1.34** adds direct attack and ability reference editing: Affliction Templates can be dropped onto eligible PF2e attack/ability Item sheets or directly onto embedded attack/ability rows on Actor sheets. The source Item stores only a stable Affliction reference plus trigger/application policy; runtime progression remains owned by the Affliction Engine after application.

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
- onset, maximum active duration (excluding onset), stage duration, and narrative stage descriptions
- optional Critical Forge `EffectDefinition` per stage
- persistent inert PF2e `effect` Items for Affliction Templates
- active controller Items with definition snapshots, instance IDs, stage state, pending checks, last-check history, bounded runtime events, and lethal-stage mortality audit data
- generated, instance-scoped persistent stage effects through Critical Forge's public Effect Engine API
- instant stage mechanics through Critical Forge `api.effects.execute()`, including one-shot damage and immediate death
- same-stage interval resolution that preserves persistent stage Items while rerunning instant mechanics
- manual stage transitions, reapplication, identification changes, and cleanup
- Affliction Engine execution of initial and stage saves
- automatic saves without a modifier dialog
- GM-manual saves with the PF2e roll dialog
- player-manual saves opened directly as PF2e roll dialogs on the selected owner client
- whispered player-save cards retained as audit/retry fallback
- public and GM-only result routing
- hidden/suspected save requests that do not reveal the affliction identity or DC in the request text
- player-facing identification presentation: hidden controllers concealed, suspected controllers generic, identified controllers fully restored
- hidden/suspected stage-effect rows concealed from non-GM Actor-sheet presentation
- lethal-stage cause-of-death record, GM/public-safe chat messaging, and controller runtime event log
- searchable multi-library template catalog with world, compendium, and registered external provider sources
- read-only provider libraries with copy-to-world editing workflow and write protection through the public API
- public `api.libraries` / `api.providers` contracts for content modules, library enable state, metadata, and filtered searches
- machine-readable ability/spell/attack references under `flags.pf2e-affliction-forge.afflictionReferences`
- direct drag-and-drop reference zones on melee, weapon, action, feat, and spell Item sheets, plus embedded Actor-sheet item rows
- reference trigger/application metadata for host modules without coupling progression logic into those hosts
- custom draggable `@Affliction[UUID]{Label}` rich-text links plus ordinary `@UUID[...]` drop compatibility
- direct drag-and-drop from the Forge library, Item/compendium entries, and description links onto Actor sheets or canvas tokens
- public `api.references` and `api.application` contracts for Creature Forge and other external modules
- Save, Save As, clone/copy, and live deletion synchronization across the library catalog
- Embedded Affliction Editor and public UI API for future hosts such as Creature Forge
- GM-authoritative world-time scheduler using `game.time.worldTime` / `updateWorldTime`
- automatic onset completion and due stage-save processing
- configurable catch-up (`all` or `next`) with a safety limit
- maximum-active-duration enforcement anchored to the first effective stage
- `Active Afflictions` registry grouped by Actor with explicit manager launch
- public `api.instances.listAll()` world-wide runtime catalog
- best-effort inline manager control on GM Actor-sheet controller rows, with Item-sheet/API fallbacks
- per-controller serialization for save resolution and mutable runtime transitions
- resumable pending saves after reload, GM authority handoff, or player-owner disconnect
- revision-aware/fault-isolated runtime reconciliation, including synthetic token Actors
- structural multi-target commit before any irreversible instant damage/death execution
- lethal catch-up stop once controller mortality records a successful death

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

For external attacks, abilities, spells, and generators, prefer the dedicated reference/application layer:

```js
const abilitySource = api.references.addToSource(source, {
  id: "venom",
  templateUuid: "Compendium.my-module.afflictions.Item.venom",
  trigger: "on-hit",
  application: "prompt"
});

await api.application.applyItemReference(abilityItem, "venom", targetActor, {
  context: { attackDegree: "success" }
});
```

A description can expose the same template as a draggable link:

```text
@Affliction[Compendium.my-module.afflictions.Item.venom]{Smaragdvipergift}
```

Low-level `api.instances.apply*()` methods remain available for integrations that explicitly need to create a controller without running the initial check.

A `pf2eAfflictionForgeReady` hook is emitted on `ready` with the API object. See `docs/API.md`, `docs/DATA_CONTRACT.md`, `docs/EMBEDDED_EDITOR.md`, `docs/LIBRARIES.md`, and `docs/REFERENCES_AND_DND.md` for the public contracts.

## Runtime boundary

0.1.34 includes the hardened world-time scheduler, active-duration anchoring, player-save routing/recovery, identification visibility layer, public library/provider discovery, an explicit Active Afflictions runtime registry, revision-aware reconciliation, controller mutation serialization, and a scroll-safe controller manager. Foundry's canonical `game.time.worldTime` is the clock; the designated active GM is the only client that commits automatic progression. The scheduler discovers due controllers and delegates every save/progression decision to `api.engine.process()`.

Round-based stage durations also use Foundry world-time seconds. Foundry's configured combat round time therefore feeds the same scheduler when combat advances world time. Dedicated turn-specific scheduling remains outside this block.

Hidden controllers and unidentified stage-effect rows are now removed from non-GM Actor-sheet presentation through Foundry render hooks. Suspected controllers remain visible under a generic identity, while identified controllers restore their authored identity. This is a UI/runtime concealment boundary, not a cryptographic security boundary against a technically privileged client inspecting raw document data.


## Runtime reconciliation

Active Affliction controllers own their generated persistent stage Items. Applying an Affliction no longer opens the controller manager automatically. The manager is an explicit GM diagnostic tool and exposes a runtime repair action. The public API also provides `api.instances.reconcile()`, `reconcileActor()`, and `reconcileAll()` to restore missing or stale generated stage output without replaying instant damage/death components.

- 0.1.34: Affliction templates can be linked directly to attacks and abilities by dropping them onto eligible Item sheets or embedded Actor-sheet rows.
- 0.1.33: Affliction templates can be dropped directly onto Actor Directory entries.
