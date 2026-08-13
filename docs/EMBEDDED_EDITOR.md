# Embedded Affliction Editor

The Affliction Editor is a reusable UI surface. It does not create, update, delete, or apply Foundry Items. The host container owns persistence and application actions.

## Public contract

```js
const api = game.modules.get("pf2e-affliction-forge").api;

const editor = api.ui.afflictionEditor.create({
  definition,
  mode: "edit",
  onChange: (definition, session) => {
    // host may mirror draft state here
  }
});

await editor.mount(containerElement);

const currentDefinition = editor.value;
const report = editor.validate();

editor.markClean();
editor.unmount();
editor.destroy();
```

Supported modes are `create`, `edit`, and `view`. View mode disables editing controls, including nested Critical Forge Effect Editors.

## Stage Effect editing

Each stage may contain one Critical Forge `EffectDefinition`. When present, the Affliction Editor mounts Critical Forge's public embedded editor API into the stage card:

```text
Host Container
  └─ Embedded Affliction Editor
       └─ Stage
            └─ Critical Forge Embedded Effect Editor
```

No Critical Forge implementation classes are imported. Only `pf2e-critical-forge.api.ui.effectEditor` and the existing Effect Definition validation API are consumed.

Inside an Affliction stage the nested editor uses a compact components-only presentation. The Affliction stage owns the generated Effect Definition's ID, name, image, and unlimited lifecycle, so those Critical Forge sections are intentionally hidden while its component editor remains fully reusable.

## Host responsibilities

The host decides what happens to the editor value. Typical hosts can provide actions such as:

- Save template
- Save as copy
- Apply to selected actor
- Link to a creature ability
- Cancel draft

Those actions intentionally do not exist inside the shared editor surface.


## Official host container (0.1.5)

Affliction Forge now ships an official ApplicationV2 container which mounts the same public embedded editor. It can be opened from the Foundry Items sidebar or programmatically:

```js
await game.modules.get("pf2e-affliction-forge").api.ui.forge.open();
```

The host owns window-level actions. The embedded editor still contains no Item persistence or actor-application behavior.
