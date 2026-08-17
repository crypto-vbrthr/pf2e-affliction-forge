# Affliction Libraries & Providers

Affliction Forge 0.1.26 introduces a catalog layer over ordinary PF2e Affliction Template Items.

## Built-in sources

- `world`: writable Affliction Templates stored in the world's Item collection.
- `compendium:<collection>`: implicit libraries for visible Item compendia that contain Affliction Templates and have not been claimed by a registered provider.
- provider libraries: named libraries registered by external modules and backed by one or more Item compendium packs.

Library membership never replaces the template UUID. The UUID remains the stable reference used by abilities, spells, Creature Forge integrations, and active controllers.

## Registering a provider

```js
Hooks.once("pf2eAfflictionForgeReady", (api) => {
  api.providers.register({
    id: "undead-horrors",
    label: "Undead Horrors",
    moduleId: "pf2e-affliction-undead-horrors",
    version: "1.0.0",
    libraries: [{
      id: "undead-horrors.core",
      label: "Undead Horrors",
      packs: ["pf2e-affliction-undead-horrors.afflictions"],
      writable: false,
      enabledByDefault: true,
      metadata: { themes: ["undead", "decay"] }
    }]
  });
});
```

Provider pack ownership is exclusive. Registering the same compendium pack into two provider libraries is rejected so template-to-library resolution stays deterministic.

## Read-only behavior

`writable: false` is the default for provider libraries. The Forge opens those templates in view mode, excludes the provider packs from writable Save-As destinations, and rejects in-place updates through `api.templates.update()`. Users can copy a template into the world library and edit the copy there.

## Search

```js
const matches = await api.libraries.search({
  libraryIds: ["undead-horrors.core"],
  types: ["disease", "curse"],
  themes: ["undead"],
  tags: { creature: ["undead"], theme: ["disease"] },
  tagMode: "all",
  minLevel: 5,
  maxLevel: 10,
  query: "rot"
});
```

Search results are template descriptors enriched with `libraryId`, `libraryLabel`, `providerId`, `providerLabel`, `writable`, `afflictionType`, `level`, `rarity`, `traits`, `themes`, and parsed `semanticTags`. Structured `tags` filters use the 0.1.63 semantic-tag contract while legacy `themes` filtering remains unchanged.

## Enable state

`api.libraries.setEnabled(id, false)` stores a dynamic world-level state. Disabled libraries remain registered but are omitted from default library searches. This is intentionally separate from Foundry module activation.

## Semantic tags

Provider libraries should tag each Affliction definition, not only the library metadata. Structured tags are stored in `definition.themes` and documented in `SEMANTIC_TAGS.md`. Library `metadata.themes` is descriptive metadata and is not inherited by definitions.
