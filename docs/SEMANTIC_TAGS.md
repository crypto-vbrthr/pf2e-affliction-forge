# Semantic Tags & Creature Forge Contract

Affliction Forge 0.1.63 standardizes machine-readable Affliction tags without changing the schema-v2 persistence format.

## Storage contract

Semantic tags are stored in the existing root-level `themes: []` array. No schema migration is required.

```js
{
  themes: [
    "family:spider",
    "creature:animal",
    "habitat:jungle",
    "theme:venom",
    "origin:natural",
    "delivery:bite",
    "legacy-free-theme"
  ]
}
```

A semantic tag uses the stable form `namespace:value`. Namespace and value slugs are lower-case ASCII with spaces/underscores normalized to hyphens. Free themes without a recognized namespace remain valid and are preserved unchanged.

The contract is intentionally extensible: the built-in vocabulary is a recommended common vocabulary, not a closed validator. Consumers should use the public parser/matcher rather than hard-code assumptions about future values.

## Namespaces

| Namespace | Meaning | Examples |
| --- | --- | --- |
| `creature` | broad creature type suited to carrying/using the affliction | `animal`, `undead`, `fiend`, `plant` |
| `family` | narrower creature family | `spider`, `snake`, `scorpion`, `rat` |
| `habitat` | environment where the affliction naturally fits | `jungle`, `swamp`, `underground`, `urban` |
| `theme` | mechanical/narrative affliction identity | `venom`, `disease`, `curse`, `spores` |
| `origin` | source of the affliction | `natural`, `alchemical`, `occult`, `divine` |
| `delivery` | delivery vector or creature ability | `bite`, `sting`, `injury`, `aura` |

The complete built-in vocabulary is exposed through `api.semanticTags.vocabulary()`.

## Public API

```js
api.semanticTags.version
api.semanticTags.namespaces()
api.semanticTags.vocabulary()
api.semanticTags.defaultWeights()
api.semanticTags.normalizeValue(value)
api.semanticTags.build(namespace, value)
api.semanticTags.parse(tag)
api.semanticTags.isSemantic(tag)
api.semanticTags.profile(input)
api.semanticTags.toTags(profile)
api.semanticTags.splitThemes(themes)
api.semanticTags.mergeThemes({ free, tags })
api.semanticTags.matches(themes, profile, { mode })
api.semanticTags.score(themes, profile, { weights })
```

Example:

```js
const profile = {
  creature: ["animal"],
  family: ["spider"],
  habitat: ["jungle"],
  theme: ["venom"],
  delivery: ["bite"],
  origin: ["natural"]
};

const result = api.semanticTags.score(definition.themes, profile);
// { score, possible, coverage, matched, missing }
```

Default Creature Forge matching weights are:

```js
{
  creature: 3,
  family: 5,
  habitat: 2,
  theme: 4,
  origin: 2,
  delivery: 5
}
```

Consumers may override weights per request. Affliction Forge deliberately provides scoring primitives rather than owning Creature Forge generation policy.

## Library search

The library service accepts structured semantic filters in addition to the legacy `themes` filter:

```js
await api.libraries.search({
  types: ["poison"],
  minLevel: 4,
  maxLevel: 8,
  tags: {
    family: ["spider"],
    delivery: ["bite"]
  },
  tagMode: "all" // "all" (default) or "any"
});
```

Library descriptors expose both the canonical flat `themes` array and parsed `semanticTags` grouped by namespace.

## Authoring UI

The embedded Affliction Editor displays one comma-separated authoring field per semantic namespace. It automatically writes the prefixes into `themes[]`. A separate **Free Themes** field preserves legacy and provider-specific themes that are not part of the structured contract.

This keeps the editor host-agnostic and means external content libraries can author Creature Forge-ready content without a separate data model.

## Provider guidance

Provider modules should tag each individual Affliction definition. Provider/library `metadata.themes` describes the library itself and is not inherited by contained definitions.

Recommended content pattern:

```js
{
  name: "Jungle Widow Venom",
  afflictionType: "poison",
  level: 6,
  themes: [
    "creature:animal",
    "family:spider",
    "habitat:jungle",
    "theme:venom",
    "origin:natural",
    "delivery:bite"
  ]
}
```

References remain UUID-based. Semantic tags are discovery and matching metadata only; they never replace the canonical Affliction UUID.
