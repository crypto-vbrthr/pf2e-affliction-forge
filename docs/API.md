# Public API 0.1.0

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

`buildTemplateSource()` returns PF2e Item source data. It does not create a world Item. Storage services are intentionally deferred until the editor/template-management block.

## Controller contract

```js
api.controllers.createState(definition, options)
api.controllers.validateState(state, definition)
```

These functions establish persistence shape only. Version 0.1.0 does not schedule checks or transition stages.

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
