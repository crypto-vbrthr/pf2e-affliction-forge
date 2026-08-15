# Affliction References, Drag & Drop, and External Application

## Purpose

Affliction Forge owns Affliction runtime progression. Host Items describe **which Affliction Template is referenced** and **which semantic trigger applies**. Version 0.1.39 can evaluate those references directly for supported native PF2e chat workflows. External systems such as Creature Forge, hazards, or adventure modules can still call the public Application API explicitly for custom workflows.

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

For native PF2e chat workflows, Affliction Forge 0.1.39 evaluates the supported triggers itself. Custom/nonstandard host workflows remain explicit: the host decides when its custom trigger has happened and calls `api.application`.

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

The reference remains the stable contract. Starting with 0.1.39, the native PF2e combat-trigger runtime can observe supported PF2e ChatMessages and call `api.application.applyItemReference(...)` itself. External integrations still use the same method when their workflow cannot be represented by the built-in trigger classifier.


## Native PF2e combat trigger runtime (0.1.39)

The authoritative active GM listens to newly created PF2e ChatMessages and converts supported PF2e message context into semantic Affliction trigger events. The runtime operates on PF2e message flags/origin metadata, not on rendered chat-card DOM.

Current mapping:

```text
PF2e attack-roll
├── on-use              always when a target can be resolved
└── on-hit              success or criticalSuccess

PF2e damage-taken
└── on-damage           only after positive damage was actually applied

PF2e saving-throw
├── failed-save         failure or criticalFailure
└── critical-failure    criticalFailure only

PF2e spell-cast / supported host Item-use card
└── on-use
```

`on-damage` intentionally waits for PF2e's post-application `damage-taken` message. A damage roll by itself is not sufficient because resistance, immunity, shields, healing/reversal, or zero effective damage can change what actually happened to the target.

For saving throws the runtime resolves the source Item from the PF2e message Item/origin/context data. If a source Item or target Actor cannot be resolved, no Affliction is guessed or applied.

Reference application modes are enforced by the runtime:

```text
manual     -> trigger is recognized, no automatic application
prompt     -> authoritative GM receives a confirmation dialog
automatic  -> reference is applied immediately
```

Every successful application still routes through `api.application.applyItemReference(...)`, so controller creation, initial exposure saves, onset, scheduling, stage effects, and audit metadata remain in the existing Affliction Engine. Trigger processing is deduplicated per ChatMessage/reference/target and only the authoritative active GM commits applications.

Public inspection/processing helpers are exposed under `api.triggers`; external modules do not need to reproduce PF2e chat parsing when the built-in mapping is sufficient.

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

## Injury poison coatings (0.1.57)

A poison Affliction may declare `delivery.injuryPoison: true`. When that template is dropped onto a writable PF2e `weapon` or `melee` Item, the normal trigger/application dialog is replaced by a charge prompt. The prompt defaults to `1` and accepts any positive integer.

The concrete host reference stores the mutable coating state:

```js
{
  schemaVersion: 1,
  id: "...",
  templateUuid: "...",
  trigger: "on-damage",
  application: "automatic",
  enabled: true,
  delivery: {
    type: "injury-poison",
    charges: 3
  },
  metadata: {}
}
```

The template itself remains stateless. Two different weapons can therefore carry different remaining charge counts of the same poison. A single host carries at most one injury-poison reference; applying another coating replaces the prior injury poison after UI confirmation, while non-poison Affliction references remain untouched.

Runtime semantics are fixed for injury-poison references:

```text
attack-roll success / criticalSuccess
└── no poison action yet; wait for actually applied damage

direct positive slashing/piercing damage-taken from the coated host
├── apply the Affliction through api.application.applyItemReference(...)
└── only after successful runtime application: consume 1 charge

known damage-taken without qualifying slashing/piercing delivery
└── consume 1 charge without applying the Affliction

positive direct damage with no trustworthy serialized damage type
└── preserve the charge and emit an ambiguity hook/GM warning

attack-roll criticalFailure from the coated host
└── consume 1 charge without applying the Affliction
```

A damage application that produces no qualifying direct slashing/piercing damage spends the coating without exposing the target, matching the injury-poison delivery rule. At zero charges the reference is removed from the Item. The apply/consume transaction is serialized per source Item/reference, so concurrent damage messages cannot spend one final charge twice. A runtime application error leaves the charge intact and retryable.

The public helpers are `api.references.createInjuryPoison()`, `isInjuryPoison()`, `injuryPoisonCharges()`, `consumeInjuryPoisonCharge()`, and `isInjuryPoisonHost()`.
