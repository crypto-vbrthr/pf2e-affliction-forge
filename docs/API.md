# Public API 0.1.13

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

Stage Effect Definitions are validated via `pf2e-critical-forge.api.effects.validate()` when Critical Forge is available.

## Save-policy and identification catalogs

```js
api.catalogs.saveExecutionModes()   // ["automatic", "player", "gm"]
api.catalogs.saveVisibilityModes()  // ["public", "gmOnly"]
api.catalogs.identificationStates() // ["hidden", "suspected", "identified"]
```

`api.definitions.resolveSavePolicy()` resolves per-check overrides against root `saveDefaults`.

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

## Active instance API

Version 0.1.13 introduces the first real runtime service.

```js
api.instances.apply({
  templateUuid,
  targetActorUuid,
  origin: { sourceActorUuid, sourceItemUuid }
});

api.instances.applyTemplate(templateOrUuid, targets, options)
api.instances.applyDefinition(definition, targets, options)
api.instances.get(controllerOrUuid)
api.instances.inspect(controller)
api.instances.listForActor(actorOrUuid)
api.instances.setStage(controllerOrUuid, stageNumber, options)
api.instances.advance(controllerOrUuid, delta, options)
api.instances.reapplyStage(controllerOrUuid, options)
api.instances.setIdentification(controllerOrUuid, state, options)
api.instances.end(controllerOrUuid, options)
```

Applying an affliction creates one controller per target Actor. The controller contains a definition snapshot, unique `instanceId`, source metadata, current stage state, identification state, and generated stage-effect UUIDs.

Stage mechanics are compiled with Critical Forge's public `api.effects.toItemSources()` API. Affliction Forge adds its own source flags and embeds the resulting effect Item(s) on the same Actor. Multiple applications of the same template remain isolated by `instanceId`.

`setStage()` removes only stage effects belonging to that instance, creates the requested stage effects, and then updates controller state. It attempts rollback if the new stage cannot be committed.

`setIdentification()` currently updates the controller's semantic identification state and PF2e `unidentified` / token-icon presentation on generated Items. Strong player-side hiding and chat concealment remain part of the later runtime visibility block.

## Controller state helpers

```js
api.controllers.createState(definition, options)
api.controllers.validateState(state, definition)
```

These are low-level state helpers. Prefer `api.instances` for active runtime work.

## Runtime UI

```js
api.ui.controller.open(controllerOrUuid)
```

The GM-only controller manager provides manual phase previous/next/reapply, identification-state changes, and ending the affliction.

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

## Not yet automated in 0.1.13

- initial exposure saving throws
- stage saving throws and result combination
- automatic progression/recovery resolution
- onset expiry
- world-time scheduler
- combat-round scheduler
- public/GM-only roll routing
- strict non-GM hiding of hidden afflictions

## Ready hook

```js
Hooks.once("pf2eAfflictionForgeReady", (api) => {
  // Consumer module registration can begin here.
});
```
