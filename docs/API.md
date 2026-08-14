# Public API 0.1.26

```js
const api = game.modules.get("pf2e-affliction-forge").api;
```

## Definition API

```js
api.definitions.create(options)
api.definitions.createCheck(options)
api.definitions.createSavePolicy(options)
api.definitions.createInitialCheck()
api.definitions.createStageCheck()
api.definitions.createStage(options)
api.definitions.normalize(definition)
api.definitions.validate(definition)
api.definitions.assertValid(definition)
api.definitions.resolveStageCheck(definition, stageOrNumber)
api.definitions.resolveSavePolicy(definition, checkOrId)
```

Stage Effect Definitions are validated through Critical Forge's public `api.effects.validate()` contract when available.

## Save-policy and identification catalogs

```js
api.catalogs.saveExecutionModes()   // ["automatic", "player", "gm"]
api.catalogs.saveVisibilityModes()  // ["public", "gmOnly"]
api.catalogs.identificationStates() // ["hidden", "suspected", "identified"]
```

`api.definitions.resolveSavePolicy()` resolves per-check overrides against root `saveDefaults`.

## Affliction Engine

The engine is the canonical high-level runtime entry point. It owns save execution and progression decisions while delegating mechanical stage effects to the instance service/Critical Forge boundary.

### Apply and process immediately

```js
const application = await api.engine.apply({
  templateUuid,
  targetActorUuid,
  origin: {
    sourceActorUuid,
    sourceItemUuid
  }
});
```

Alternative forms:

```js
await api.engine.applyTemplate(templateUuid, targets, options);
await api.engine.applyDefinition(definition, targets, options);
```

The result is:

```js
{
  created: [/* every controller initially created */],
  controllers: [/* controllers still present after initial resolution */],
  results: [/* processInitial result per successfully processed controller */],
  errors: [/* recoverable initial-processing errors */]
}
```

An initial success that rejects the affliction removes that controller, so it remains in `created` but not in `controllers`.

If initial processing fails unexpectedly, the controller is intentionally left pending and returned in `controllers`; the GM can retry it from the controller manager rather than losing the affliction instance.

### Process an existing controller

```js
await api.engine.process(controllerUuid);
await api.engine.process(controllerUuid, { force: true });
await api.engine.processInitial(controllerUuid);
```

Without `force`, a controller whose `nextCheckAt` lies in the future returns `status: "not-due"`. `force: true` is used by the current manual controller UI and is also useful for diagnostics.

The engine understands:

- initial exposure gates
- active-stage gates
- automatic, player, and GM execution policies
- public and GM-only result visibility
- multiple-save combination modes
- degree-of-success transition directives
- onset after initial resolution
- recovery/rejection/end transitions
- resumable pending player-save requests

### Player-result handoff

Normally consumer modules should not call this directly. The module socket runtime uses it after a player submits a requested save:

```js
await api.engine.acceptPlayerResult(payload);
```

The engine verifies the pending request ID, requested check, permitted user, and Actor ownership before accepting the result.

### Pure resolution helpers

```js
api.engine.normalizeDegree(value)
api.engine.combineDegrees(values, mode)
api.engine.resolveDirective(definition, state, directive)
```

These are useful for diagnostics and integrations that need to preview progression without executing a PF2e roll.

## Save execution semantics

`execution: "automatic"`

- the GM client executes the affected Actor's PF2e save
- the PF2e modifier dialog is skipped

`execution: "gm"`

- the GM executes the save
- the PF2e modifier dialog remains available

`execution: "player"`

- one active non-GM owner is selected for the interactive request; the Actor's assigned user is preferred when available
- the selected player receives a whispered request ChatMessage; its creation on that client immediately opens PF2e's native save dialog
- a whispered chat request is also created as an audit/retry fallback
- the completed PF2e roll carries the unique Affliction request id, so the authoritative GM can accept it directly from the synchronized PF2e roll ChatMessage
- the module socket remains available as a fallback result path
- if no active player owner exists, execution falls back to a GM-manual roll

`visibility: "public"` produces a public roll result. `visibility: "gmOnly"` uses a GM roll for GM execution and a blind roll for player execution.

When identification is `hidden` or `suspected`, the rendered player request uses a generic title and does not include the affliction name or DC.

## Low-level active instance API

The instance service remains public because some integrations need explicit control over controller creation and manual transitions:

```js
api.instances.apply({ templateUuid, targetActorUuid, ...options })
api.instances.applyTemplate(templateOrUuid, targets, options)
api.instances.applyDefinition(definition, targets, options)
api.instances.get(controllerOrUuid)
api.instances.inspect(controller)
api.instances.presentation(controllerOrUuid)
api.instances.events(controllerOrUuid)
api.instances.listForActor(actorOrUuid)
api.instances.listAll()
api.instances.setStage(controllerOrUuid, stageNumber, options)
api.instances.advance(controllerOrUuid, delta, options)
api.instances.reapplyStage(controllerOrUuid, options)
api.instances.executeStageInstant(controllerOrUuid)
api.instances.completeOnset(controllerOrUuid, options)
api.instances.setIdentification(controllerOrUuid, state, options)
api.instances.end(controllerOrUuid, options)
```

**Important:** `api.instances.apply*()` is a low-level creation path. It does not execute the initial exposure save. For normal Creature Forge, ability, spell, chat-card, or drag-and-drop application, prefer `api.engine.apply*()`.

Stage mechanics use two public Critical Forge paths: persistent components are compiled through `api.effects.toItemSources()`, while instant components are executed through `api.effects.execute()`. This includes one-shot `damage` and lethal `death` components; the latter retain Critical Forge's `direct` versus `death-effect` semantics. Every generated persistent stage effect is tagged with its controller `instanceId`, so parallel applications cannot clean up each other's mechanics.

When `setStage()` resolves back to the already active stage, persistent Items are preserved and the stage interval is renewed; only instant mechanics execute again. `reapplyStage()` is the explicit repair/refresh operation and rebuilds persistent output before executing instant mechanics. `executeStageInstant()` is available for an explicit retry or diagnostic execution of the current active stage.

## Controller state helpers

```js
api.controllers.createState(definition, options)
api.controllers.validateState(state, definition)
```

Default state creation now mirrors runtime semantics:

- initial check present -> `pending`, stage 0
- no initial check + onset -> `incubating`, stage 0
- neither -> `active`, stage 1

These are low-level contract helpers. Prefer `api.engine` or `api.instances` for active runtime work.

## Embedded UI API

```js
api.ui.afflictionEditor.modes
api.ui.afflictionEditor.template
api.ui.afflictionEditor.createSession(definition, options)
api.ui.afflictionEditor.create(options)
api.ui.afflictionEditor.prepareContext(session, options)
api.ui.afflictionEditor.render(context, options)
```

The embedded editor owns definition editing only. Host containers own persistence and application.

```js
const editor = api.ui.afflictionEditor.create({
  definition,
  mode: "edit",
  onChange: (definition) => { draft.affliction = definition; }
});
await editor.mount(htmlElement);
const edited = editor.value;
editor.destroy();
```

## Library Service & Provider API

The library layer organizes Affliction Templates without changing their canonical UUID references. World Items form the built-in writable library, unclaimed Item compendia remain discoverable as implicit compendium libraries, and external modules can register curated provider libraries.

```js
api.libraries.list()
api.libraries.get(libraryId)
api.libraries.search({ query, libraryIds, types, themes, minLevel, maxLevel })
api.libraries.templates(options)
api.libraries.setEnabled(libraryId, enabled)
api.libraries.isEnabled(libraryId)
api.libraries.forDocument(item)
api.libraries.forPack(packCollection)
api.libraries.canWriteDestination(packCollection)
api.libraries.summary()
```

Provider modules should register after `pf2eAfflictionForgeReady`:

```js
Hooks.once("pf2eAfflictionForgeReady", (api) => {
  api.providers.register({
    id: "undead-horrors",
    label: "Undead Horrors",
    moduleId: "pf2e-affliction-undead-horrors",
    version: "1.0.0",
    libraries: [{
      id: "undead-horrors.core",
      label: "Undead Horrors",
      packs: [
        "pf2e-affliction-undead-horrors.diseases",
        "pf2e-affliction-undead-horrors.curses"
      ],
      writable: false,
      metadata: { themes: ["undead", "decay"] }
    }]
  });
});
```

A provider library defaults to read-only. Read-only means Affliction Forge and its public template API refuse in-place updates or Save-As destinations into that library. Templates can still be opened, applied, referenced by UUID, or cloned into the writable world library. The underlying Foundry pack remains the storage authority.

For simple one-library providers, `api.libraries.register({...})` is a convenience registration form.

```js
api.libraries.register({
  id: "venoms-and-toxins",
  label: "Venoms & Toxins",
  moduleId: "pf2e-affliction-venoms",
  packs: ["pf2e-affliction-venoms.afflictions"],
  writable: false
});
```

Library membership is storage-based: a template belongs to the world library or to the registered/implicit library that owns its compendium pack. Attacks, abilities, spells, and controllers should continue storing the template UUID, not a library/name pair.

## Template persistence API

```js
api.templates.create(definition, { pack, folder })
api.templates.get(itemOrUuid)
api.templates.read(itemOrUuid)
api.templates.update(itemOrUuid, definition)
api.templates.clone(itemOrUuid, { definition, name, pack, folder })
api.templates.copyDefinition(definition, { name, pack, newIdentity })
api.templates.list({ includeWorld, includeCompendia })
api.templates.inspect(item)
api.templates.canUpdate(item)
api.templates.writableDestinations()
```

Templates are inert PF2e `effect` Items with no Rule Elements. Updating a writable template preserves its Item UUID and increments `definitionVersion`.

## World-time scheduler

0.1.18 starts the scheduler automatically on `ready`. The public surface is also available for diagnostics and explicit processing:

```js
api.scheduler.status();
api.scheduler.isAuthoritative();
await api.scheduler.processDue();
await api.scheduler.processDue({ mode: "next" });
await api.scheduler.processDue({ worldTime: game.time.worldTime, maxTransitions: 10 });
```

The scheduler listens to Foundry `updateWorldTime`, processes overdue controllers once at `ready`, and uses the designated `game.users.activeGM` as the sole authority. It delegates each due event to `api.engine.process(controllerUuid, { atTime: nextCheckAt })`.

World settings:

- automatic scheduler enabled/disabled
- catch-up mode `all` or `next`
- catch-up safety limit, default 25 transitions per controller per pass

`all` walks historical due timestamps until the controller catches up, becomes pending on a manual/player save, ends, or hits the safety limit. `next` consumes exactly one due event per scheduler pass. `maximumDuration` is enforced automatically from the first active-stage timestamp (`activeStartedAt`); onset/incubation time is excluded.

## Runtime UI

```js
api.ui.controller.open(controllerOrUuid) // same manager opened from Active Afflictions registry
```

The GM controller manager can now:

- process an initial exposure check
- process/force the current stage check
- complete onset manually
- move/reapply stages manually
- change identification state
- end the affliction

## Document API

```js
api.documents.buildTemplateSource(definition)
api.documents.readDefinition(item)
api.documents.inspect(item)
api.documents.kindOf(item)
api.documents.isManaged(item)
api.documents.isTemplate(item)
api.documents.isController(item)
api.documents.isStageEffect(item)
```

## Critical Forge integration

```js
api.integration.criticalForge.getApi()
api.integration.criticalForge.compatibility()
```

The compatibility report includes `effectApiAvailable`, `effectSourceApiAvailable`, `effectExecutionApiAvailable`, `deathComponentAvailable`, and `effectEditorAvailable`. Runtime stage instant effects require Critical Forge 1.0.1-rc.3 or later.

## Remaining runtime hardening after 0.1.18

- dedicated turn-specific scheduling where a future effect needs start/end-of-turn semantics rather than world-time intervals
- strict non-GM hiding of hidden controller Items on Actor sheets
- richer GM-facing transition/death-cause audit presentation

World-time due-event discovery, historical catch-up, and maximum-duration enforcement are active in 0.1.18.

## Ready hook

```js
Hooks.once("pf2eAfflictionForgeReady", (api) => {
  // Consumer module registration can begin here.
});
```


### Runtime presentation and event audit

```js
const presentation = await api.instances.presentation(controllerUuid);
const events = await api.instances.events(controllerUuid);
```

`presentation()` resolves the current `hidden | suspected | identified` policy into player-facing controller/stage identity and concealment behavior. `events()` returns a deep-cloned bounded audit log for the active controller. Successful lethal-stage execution also stores `state.mortality` and emits `pf2eAfflictionForgeDeath`.


### Runtime reconciliation (0.1.27)

```js
await api.instances.reconcile(controllerUuid);
await api.instances.reconcileActor(actorUuid);
await api.instances.reconcileAll({ cleanupOrphans: true });
```

Reconciliation repairs controller-owned persistent stage output only. It never re-executes instant components such as damage or death.
