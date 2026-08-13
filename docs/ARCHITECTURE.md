# Architecture 0.1.1

```text
AfflictionDefinition
        │
        ├── normalizer
        ├── validator ───────► Critical Forge Effect validator
        ├── Item adapter
        │
        └── Embedded Affliction Editor
                 │
                 └── Critical Forge Embedded Effect Editor per stage
```

The UI is intentionally split into host and editor responsibilities:

```text
Affliction Forge Container       Future Creature Forge
          │                              │
          └──────────┬───────────────────┘
                     ▼
          Embedded Affliction Editor
                     │
                     └── Stage Effect Editor
```

The shared editor never persists or applies a template. It accepts an `AfflictionDefinition`, edits it, validates it, and returns the current definition to its host.

The later runtime remains separated:

```text
Affliction Template
   │ apply
   ▼
Controller Item on Actor
   │
   ▼
Affliction Engine
   │
   └── Critical Forge Effect Engine
          └── generated current-stage Effect Item(s)
```

## Ownership rules

- Affliction Forge owns affliction definitions, stage progression, controller state, timing semantics, and the shared Affliction Editor.
- Host containers own persistence, application, linking, and workflow buttons.
- Critical Forge Effect Engine owns translation of a stage Effect Definition into PF2e mechanical effects.
- Critical Forge's public Embedded Effect Editor owns editing the stage Effect Definition.
- The stage Effect Item is output, never runtime truth.
- Active controllers keep a definition snapshot.
- Template items are inert and contain no Rule Elements.
- External modules should consume only the public API and the ready hook.


## Saving-throw policies and identification

Affliction Definitions own semantic save policies (`automatic | player | gm` and `public | gmOnly`). Individual checks may override root defaults. The Affliction Engine will later translate those semantics into PF2e/Foundry roll workflows.

Templates own only the initial identification state. Active controllers own the current identification state, allowing a hidden affliction to become suspected or identified without mutating its source template.
