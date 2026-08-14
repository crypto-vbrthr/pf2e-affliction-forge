# PF2E Affliction Forge

Current development build: **0.1.25**

Version **0.1.25** hardens historical catch-up after large Foundry world-time jumps. In `all` mode, every overdue interval is processed chronologically up to the current world-time horizon, including manual GM saves, and maximum active duration is enforced at its absolute deadline. Interactive dialogs are awaited sequentially rather than requiring another time-advance click.

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
- searchable world/compendium template library with Save, Save As, clone/copy, and live deletion synchronization
- Embedded Affliction Editor and public UI API for future hosts such as Creature Forge
- GM-authoritative world-time scheduler using `game.time.worldTime` / `updateWorldTime`
- automatic onset completion and due stage-save processing
- configurable catch-up (`all` or `next`) with a safety limit
- maximum-active-duration enforcement anchored to the first effective stage

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

0.1.25 includes the hardened world-time scheduler, active-duration anchoring, player-save routing, and identification visibility layer. Foundry's canonical `game.time.worldTime` is the clock; the designated active GM is the only client that commits automatic progression. In catch-up mode `all`, a jump across several phase durations resolves each historical due event in chronological order until the horizon or the maximum active-duration deadline is reached. Manual GM dialogs are sequential, while player results automatically resume the same catch-up chain.

Round-based stage durations also use Foundry world-time seconds. Foundry's configured combat round time therefore feeds the same scheduler when combat advances world time. Dedicated turn-specific scheduling remains outside this block.

Hidden controllers and unidentified stage-effect rows are now removed from non-GM Actor-sheet presentation through Foundry render hooks. Suspected controllers remain visible under a generic identity, while identified controllers restore their authored identity. This is a UI/runtime concealment boundary, not a cryptographic security boundary against a technically privileged client inspecting raw document data.
