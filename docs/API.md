# Public API 0.1.38

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

### Player-result handoff and pending recovery

Normally consumer modules should not call `acceptPlayerResult()` directly. The player-save runtime uses it after a requested PF2e save has been correlated back to the authoritative GM:

```js
await api.engine.acceptPlayerResult(payload);
```

The engine verifies the pending request ID, requested check, permitted user, Actor ownership, and the controller's still-current persisted request immediately before applying progression. Duplicate or stale deliveries therefore resolve as `status: "stale"` rather than progressing the Affliction twice.

Interrupted interactive checks can be resumed explicitly:

```js
await api.engine.resumePending(controllerUuid);
await api.engine.resumePending(controllerUuid, { reason: "manual-retry" });
```

Resumption preserves completed results in a multi-save gate and reissues only unresolved checks. The scheduler invokes the same recovery path on world ready, after an actual GM-authority handoff for an abandoned GM dialog, or when an `awaiting-player` request can no longer be answered by its selected active owner.

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

## Runtime recovery and concurrency

0.1.30 serializes save resolution and mutable instance operations per controller. This protects duplicate player-result delivery, rapid manual stage changes, identification edits, end operations, and rejected mutations from overlapping on the same runtime instance. A rejected operation does not poison the queue for later work.

Startup reconciliation is best-effort per controller and per Actor: one malformed/legacy controller is reported but does not prevent healthy instances from repairing or stop the scheduler from starting. Reconciliation never replays instant damage/death and is revision-aware, so a stale repair pass cannot overwrite a newer transition. The world runtime catalog and reconciliation both include unlinked synthetic token Actors.

Automatic catch-up stops for controllers whose mortality audit records a successful lethal-stage death. The controller remains present for GM cause-of-death/history inspection until explicitly ended. Dedicated start/end-of-turn scheduling remains intentionally outside the world-time interval model.

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

Reconciliation repairs controller-owned persistent stage output only. It never re-executes instant components such as damage or death. `reconcileActor()` now reports an additive `errors` array and continues past malformed controllers so healthy sibling instances can still repair. `reconcileAll()` likewise isolates Actor-level failures.

## Ability / Spell / Attack Reference API

Affliction references are machine-readable metadata for host Items and generated sources. They do not turn the host Item itself into an Affliction controller or template.

```js
const reference = api.references.create({
  id: "venom",
  templateUuid: "Compendium.my-module.afflictions.Item.venom",
  label: "Smaragdvipergift",
  trigger: "on-hit",
  application: "prompt"
});
```

Supported trigger metadata:

```js
api.catalogs.referenceTriggers();
// ["manual", "on-use", "on-hit", "on-damage", "failed-save",
//  "critical-failure", "custom"]
```

Supported application metadata:

```js
api.catalogs.referenceApplicationModes();
// ["manual", "prompt", "automatic"]
```

These values describe the host's intended trigger policy. Affliction Forge does not inspect arbitrary attack or spell rolls to guess that a trigger occurred. The host module decides when its trigger is satisfied and then calls the external application API.

Reference helpers:

```js
api.references.create(options)
api.references.normalize(reference)
api.references.validate(reference)
api.references.list(documentOrSource)
api.references.get(documentOrSource, referenceId)
api.references.set(document, references)
api.references.add(document, reference)
api.references.remove(document, referenceId)
api.references.withReferences(source, references)
api.references.addToSource(source, reference)
api.references.removeFromSource(source, referenceId)
api.references.toText(referenceOrUuid, { label, syntax })
api.references.summary(reference)
```

For generated Creature Forge content, `addToSource()` is usually preferable because the source can be prepared before the Foundry Item exists:

```js
const source = api.references.addToSource(abilitySource, {
  id: "spore-rot",
  templateUuid: afflictionTemplate.uuid,
  trigger: "failed-save",
  application: "automatic"
});
```

References are stored under:

```js
flags["pf2e-affliction-forge"].afflictionReferences
```

The host Item is not marked `managed: true`; controller/template detection therefore remains unambiguous.

## External Application API

`api.application` is the preferred facade for external modules. It delegates actual creation and initial save processing to `api.engine`, but also records the host source and reference metadata in controller origin data.

```js
await api.application.apply({
  templateUuid,
  targets,
  source: sourceItem,
  application: "creature-forge",
  context: { attackDegree: "success" }
});
```

Apply a direct reference:

```js
await api.application.applyReference(reference, targets, {
  source: sourceItem,
  context: { attackDegree: "success" }
});
```

Apply a named reference stored on an Item:

```js
await api.application.applyItemReference(abilityItem, "venom", targets, {
  context: { attackDegree: "success" }
});
```

Additional helpers:

```js
api.application.resolveReference(sourceOrReference, { referenceId })
api.application.createDragData(templateUuid, options)
api.application.parseDropData(data)
api.application.applyDropData(data, target, options)
```

After a successful external application the module emits:

```js
Hooks.on("pf2eAfflictionForgeApplied", payload => {
  // payload.templateUuid
  // payload.reference
  // payload.sourceUuid
  // payload.application
  // payload.result
});
```

## Drag & Drop and Rich-Text References

A Template can be exposed in a description with either a normal Foundry UUID link or the Affliction-specific draggable syntax:

```text
@UUID[Compendium.my-module.afflictions.Item.venom]{Smaragdvipergift}
@Affliction[Compendium.my-module.afflictions.Item.venom]{Smaragdvipergift}
```

The `@Affliction` form is enriched into a draggable link and opens the template in Affliction Forge for GMs. Ordinary `@UUID` Item links remain useful and compatible.

Supported application paths:

- drag an Affliction Forge library row onto an Actor sheet
- drag an Affliction Template Item/compendium entry onto an Actor sheet
- drag a normal `@UUID` Affliction Template link onto an Actor sheet
- drag an `@Affliction` link onto an Actor sheet
- drag the same template/reference forms directly onto a canvas token

Actor-sheet Item drops are intercepted before Foundry creates the embedded Item. The inert template copy is cancelled and the Affliction Engine creates a real controller instance instead. Drag application is GM-only.


## Reference host helpers (0.1.34)

```js
api.catalogs.referenceHostItemTypes();
// ["melee", "weapon", "action", "feat", "spell"]

api.references.isHostItem(item);

api.references.hostDefaults(item);
// melee/weapon -> { eligible: true, trigger: "on-hit", application: "prompt", ... }
// action/feat/spell -> { eligible: true, trigger: "on-use", application: "prompt", ... }
```

These helpers expose the same eligibility/default contract used by the built-in Attack & Ability Affliction Drop Zones so external hosts such as Creature Forge can match the Forge UI without duplicating policy.

## Rich-text reference insertion

`api.references.toText()` remains the canonical formatter used by the 0.1.38 ProseMirror drop integration:

```js
const link = api.references.toText(templateUuid, {
  label: "Smaragdvipergift"
});
// @Affliction[...]{Smaragdvipergift}
```

External modules do not need to implement editor drop handling themselves when they use Affliction Forge drag payloads created through `api.application.createDragData()`.
