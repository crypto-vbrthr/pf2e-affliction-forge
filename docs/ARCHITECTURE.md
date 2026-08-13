# Architecture 0.1.13

```text
Affliction Template / Definition
            │
            ▼
   Affliction Instance Service
            │
            ├── Controller Item on Actor
            │      ├── immutable-ish definition snapshot
            │      ├── instanceId
            │      ├── current stage/runtime state
            │      └── identification state
            │
            └── Critical Forge Effect Engine
                   │ toItemSources()
                   ▼
             Stage Effect Item(s)
             tagged with instanceId
```

The editor architecture remains host-agnostic:

```text
Affliction Forge Container       Future Creature Forge
          │                              │
          └──────────┬───────────────────┘
                     ▼
          Embedded Affliction Editor
                     │
                     └── Critical Forge Embedded Effect Editor per stage
```

## Ownership rules

- **Affliction Definition** is the reusable blueprint.
- **Affliction Controller** is the runtime truth for one application on one Actor.
- **Affliction Instance Service** owns application, manual stage transitions, instance cleanup, and controller state updates.
- **Critical Forge Effect Engine** owns translation from semantic stage Effect Definitions to PF2e Item sources and Rule Elements.
- **Stage Effect Items** are generated output, never runtime truth.
- **Host containers** own persistence/application buttons. The Embedded Affliction Editor remains persistence-neutral.
- **Templates are inert** and contain no Rule Elements.
- **Active controllers snapshot definitions**, so later template edits cannot mutate an already running case.
- **Every generated stage effect carries the controller `instanceId`**, preventing one affliction instance from removing another's effects. Its Critical Forge runtime EffectDefinition ID is also instance-scoped.

## Manual transition transaction

```text
requested stage
    ↓
compile new stage through Critical Forge
    ↓
remove this instance's old stage effects
    ↓
create new stage effect items
    ↓
update controller state + effect UUIDs
```

If creation or controller update fails, the service attempts to delete partial new output and recreate the old stage effect set before surfacing the error.

## Time boundary

0.1.13 calculates and stores `nextCheckAt` for onset/stage durations, but does not watch it. Rounds use Foundry's configured round duration only as stored world-time metadata. The later scheduler will decide whether a due event is processed by world time or combat round/turn semantics.

## Save policies and identification

Save execution (`automatic | player | gm`) and result visibility (`public | gmOnly`) are still semantic runtime configuration only. No rolls are automatically executed in this block.

Identification is now mutable on active controllers. The runtime updates PF2e `unidentified` and token-icon presentation on controller/stage items, while strict player-side concealment remains a later UI/runtime concern.
