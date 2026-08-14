# Affliction References, Drag & Drop, and External Application

## Purpose

Affliction Forge owns Affliction runtime progression. External systems such as Creature Forge, attacks, spells, hazards, or adventure modules should only describe **which Affliction Template is referenced** and **when their own trigger is satisfied**.

A host never implements onset, stage progression, saving throws, world-time scheduling, stage effects, or recovery itself.

```text
Creature / Ability / Spell
        ↓ reference + trigger metadata
External Application API
        ↓
Affliction Engine
        ↓
Controller / Scheduler / Critical Forge Effect Engine
```

## Reference contract

```js
{
  schemaVersion: 1,
  id: "venom",
  templateUuid: "Compendium.my-module.afflictions.Item.venom",
  label: "Smaragdvipergift",
  trigger: "on-hit",
  application: "prompt",
  enabled: true,
  metadata: {}
}
```

References on Foundry Items are stored in:

```js
flags["pf2e-affliction-forge"].afflictionReferences
```

The source Item is **not** an Affliction Forge managed document. `managed: true` remains exclusive to Templates, Controllers, and generated stage/residual effects.

## Trigger metadata

The reference trigger is descriptive metadata for the host:

- `manual`
- `on-use`
- `on-hit`
- `on-damage`
- `failed-save`
- `critical-failure`
- `custom`

Affliction Forge does not parse arbitrary PF2e attack/spell workflows to infer these triggers. The host that owns the ability decides when the trigger has happened and calls `api.application`.

## Application policy metadata

- `manual`: host surfaces the reference but does not automatically apply it
- `prompt`: host should ask the GM/player before calling the application API
- `automatic`: host may call the application API immediately once its trigger is satisfied

An explicit `api.application.apply*()` call always means “apply now”; the policy is not reinterpreted inside the Affliction Engine.

## Generated source example

```js
const source = afflictionApi.references.addToSource(abilitySource, {
  id: "spore-rot",
  templateUuid: generatedAffliction.uuid,
  trigger: "failed-save",
  application: "automatic"
});
```

This lets Creature Forge prepare a valid ability Item source before the Item document exists.

## Existing Item example

```js
await afflictionApi.references.add(abilityItem, {
  id: "venom",
  templateUuid: venom.uuid,
  trigger: "on-hit",
  application: "prompt"
});
```

Later:

```js
await afflictionApi.application.applyItemReference(
  abilityItem,
  "venom",
  targetActor,
  { context: { attackDegree: "success" } }
);
```

The created controller records source Item/Actor, reference id, trigger, application mode, and supplied host context in its origin metadata.

## Rich-text references

Normal Foundry links remain valid:

```text
@UUID[Compendium.my-module.afflictions.Item.venom]{Smaragdvipergift}
```

Affliction Forge additionally registers:

```text
@Affliction[Compendium.my-module.afflictions.Item.venom]{Smaragdvipergift}
```

The latter renders as a draggable Affliction link. For a GM, clicking it opens the template in Affliction Forge.

## Drag & Drop

### Actor sheet

Dropping an Affliction Template Item onto an Actor sheet is intercepted in `preCreateItem`. The ordinary embedded template creation is cancelled synchronously and the definition is applied through the Affliction Engine. This prevents an inert Template Item from masquerading as an active case.

Custom Affliction drag payloads from Forge library rows and `@Affliction` links use the `dropActorSheetData` hook and route to the same application facade.

### Canvas token

`dropCanvasData` accepts both Affliction Forge drag payloads and normal Item UUID drops. If the dropped Item is an Affliction Template and the coordinates lie on a token, the template is applied to that token's Actor.

### Permissions

Drag application is GM-only. A non-GM drop is intercepted/rejected rather than embedding an inert template by accident.

## External application facade

```js
await api.application.apply({
  templateUuid,
  targets,
  source: abilityItem,
  application: "creature-forge",
  context: {
    attackDegree: "success",
    damageApplied: true
  }
});
```

or:

```js
await api.application.applyReference(reference, targets, {
  source: abilityItem
});
```

The facade delegates to the high-level Affliction Engine, so initial exposure saves are processed immediately and all later progression belongs to the normal Controller/Scheduler runtime.

## Actor Directory drops

Affliction Forge drag payloads can be dropped directly onto Actor entries in Foundry's Actors sidebar. The directory row is highlighted while the Affliction is over a valid Actor target. The drop is consumed by Affliction Forge and routed through `api.application.applyDropData(..., { application: "drag-drop-actor-directory" })`; it never embeds the template Item on the Actor. Actor-sheet and Canvas-token drops remain supported in parallel.


## Attack and ability drop zones (0.1.34)

Eligible PF2e Item hosts are `melee`, `weapon`, `action`, `feat`, and `spell`. Their Item sheets receive an Affliction reference panel. A GM can drop an Affliction Template onto that panel and choose the host trigger and application policy.

The same operation works directly on embedded eligible Item rows on an Actor sheet. A drop on such a row is consumed before the generic Actor-sheet Affliction drop, so the Affliction becomes part of the attack/ability instead of being immediately applied to the Actor. Linked rows receive a compact biohazard count badge.

Defaults are intentionally conservative:

```text
melee / weapon  -> on-hit + prompt
action / feat   -> on-use + prompt
spell           -> on-use + prompt
```

The Item stores only:

```js
flags["pf2e-affliction-forge"].afflictionReferences
```

No Affliction Template is embedded in the host Item or Actor. The reference panel may update the trigger/application policy or remove the link. Read-only compendium Items expose existing references but cannot be changed in place.

This UI does not infer whether a native PF2e attack actually hit. The reference is the stable contract; a host integration that observes the trigger calls `api.application.applyItemReference(...)`. This keeps attack/chat workflow interpretation separate from Affliction progression.

## Rich-text drop insertion (0.1.36)

An Affliction drag payload can be dropped directly into Foundry's ProseMirror editors. The Forge installs a small editor plugin through the `createProseMirrorEditor` hook and inserts canonical source text through a ProseMirror transaction at the actual drop position:

```text
@Affliction[Compendium.my-module.afflictions.Item.venom]{Smaragdvipergift}
```

The source syntax is intentionally stored rather than bespoke HTML. When the containing description, Journal entry, ability text, or chat content is rendered, the normal Affliction text enricher turns it into the existing clickable/draggable content link. Clicking the enriched link opens the Affliction Template in the Forge for a GM, while drag operations retain the normal Actor/Token/reference semantics.

The same drag payload therefore remains context-sensitive:

```text
Drop on Actor/Token        -> apply Affliction
Drop on attack/ability     -> store afflictionReference
Drop in rich text          -> insert @Affliction[...] link
```

Textarea/plain-content fallbacks insert the same source syntax and emit normal input/change events. ProseMirror DOM is never modified directly; its transaction is the source of truth so the editor can persist the change correctly.

### 0.1.37 native ProseMirror fallback

Affliction drags now carry two coordinated representations:

- `application/x-pf2e-affliction-forge`: the semantic Affliction payload used by Forge drop targets
- `text/plain`: a native Foundry `{ type: "Item", uuid }` drag payload understood by the core ProseMirror ContentLink plugin

This makes drops into Foundry v14 rich-text editors robust even when the custom Affliction ProseMirror plugin cannot claim the drop. Forge-owned drop targets always prefer the dedicated Affliction MIME payload.
