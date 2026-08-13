# Architecture 0.1.0

```text
AfflictionDefinition
        │
        ├── normalizer
        ├── validator ───────► Critical Forge Effect validator
        │
        └── Item adapter
               │
               ▼
       Affliction Template
       (PF2e effect Item)
```

The runtime/UI layers are deliberately not implemented yet, but their boundaries are fixed:

```text
Future Affliction Forge Container
        │
        ▼
Embedded Affliction Editor
        │
        └── embeds Critical Forge Effect Editor per stage

Template
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

- Affliction Forge owns affliction definitions, stage progression, controller state, and timing semantics.
- Critical Forge Effect Engine owns translation of a stage Effect Definition into PF2e mechanical effects.
- The stage Effect Item is output, never runtime truth.
- Active controllers keep a definition snapshot.
- Template items are inert and contain no Rule Elements.
- External modules should consume only the public API and the ready hook.
