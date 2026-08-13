# Public API 0.1.1

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

`buildTemplateSource()` returns PF2e Item source data. It does not create a world Item. Storage services remain a separate layer.

## Controller contract

```js
api.controllers.createState(definition, options)
api.controllers.validateState(state, definition)
```

These functions establish persistence shape only. Version 0.1.1 does not schedule checks or transition stages.

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
