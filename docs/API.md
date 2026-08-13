# Public API 0.1.9

```js
const api = game.modules.get("pf2e-affliction-forge").api;
```

## Definition API

```js
api.definitions.create(options)
api.definitions.createCheck(options)
api.definitions.createInitialCheck()
api.definitions.createStageCheck()
api.definitions.createStage(options)
api.definitions.normalize(definition)
api.definitions.validate(definition)
api.definitions.assertValid(definition)
api.definitions.resolveStageCheck(definition, stageOrNumber)
```

Stage Effect Definitions are validated via `pf2e-critical-forge.api.effects.validate()` when Critical Forge is available.

## Embedded UI API

```js
api.ui.afflictionEditor.modes
api.ui.afflictionEditor.template
api.ui.afflictionEditor.createSession(definition, options)
api.ui.afflictionEditor.create(options)
api.ui.afflictionEditor.prepareContext(session, options)
api.ui.afflictionEditor.render(context, options)
```

Typical external-container use:

```js
const editor = api.ui.afflictionEditor.create({
  definition,
  mode: "edit",
  onChange: (definition) => {
    draft.affliction = definition;
  }
});

await editor.mount(htmlElement);
const edited = editor.value;
editor.destroy();
```

The editor contains no persistence or actor-application buttons. The host container owns those actions.


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

Creating a template produces an inert PF2e `effect` Item with no Rule Elements. Updating a writable template preserves its Item UUID and increments `flags.pf2e-affliction-forge.definitionVersion`. Cloning creates a new Affliction definition identity and records the source template UUID. Locked compendium templates are intended to be opened read-only and copied before editing.

## Document API

```js
api.documents.buildTemplateSource(definition)
api.documents.readDefinition(item)
api.documents.inspect(item)
api.documents.kindOf(item)
api.documents.isManaged(item)
api.documents.isTemplate(item)
api.documents.isController(item)
```

`buildTemplateSource()` remains the low-level source adapter. Use `api.templates` for persistent Foundry documents.

## Controller contract

```js
api.controllers.createState(definition, options)
api.controllers.validateState(state, definition)
```

These functions establish persistence shape only. Version 0.1.9 does not schedule checks or transition stages.

## Critical Forge integration

```js
api.integration.criticalForge.getApi()
api.integration.criticalForge.compatibility()
```

The compatibility report includes whether both `api.effects.validate` and `api.ui.effectEditor.create` are available.

## Ready hook

```js
Hooks.once("pf2eAfflictionForgeReady", (api) => {
  // Consumer module registration can begin here.
});
```
