import test from "node:test";
import assert from "node:assert/strict";
import {
  AFFLICTION_SEMANTIC_TAG_CONTRACT_VERSION,
  AFFLICTION_SEMANTIC_TAG_DEFAULT_WEIGHTS,
  buildSemanticTag,
  matchesSemanticTags,
  mergeAfflictionThemes,
  parseSemanticTag,
  scoreSemanticTags,
  splitAfflictionThemes
} from "../scripts/affliction/tags/affliction-semantic-tags.js";

test("semantic tag contract uses stable namespaced tags without replacing free themes", () => {
  assert.equal(AFFLICTION_SEMANTIC_TAG_CONTRACT_VERSION, "1.0.0");
  assert.equal(buildSemanticTag("family", "Giant Spider"), "family:giant-spider");
  assert.equal(buildSemanticTag("unknown", "spider"), null);
  assert.deepEqual(parseSemanticTag("Habitat:Dark Forest"), {
    namespace: "habitat",
    value: "dark-forest",
    tag: "habitat:dark-forest",
    canonical: false
  });

  const split = splitAfflictionThemes([
    "decay",
    "family:spider",
    "habitat:swamp",
    "delivery:bite",
    "family:spider"
  ]);
  assert.deepEqual(split.free, ["decay"]);
  assert.deepEqual(split.tags.family, ["spider"]);
  assert.deepEqual(split.tags.habitat, ["swamp"]);
  assert.deepEqual(split.tags.delivery, ["bite"]);

  assert.deepEqual(mergeAfflictionThemes({
    free: ["decay"],
    tags: { family: ["Spider"], habitat: ["Swamp"] }
  }), ["decay", "family:spider", "habitat:swamp"]);
});

test("Creature Forge semantic matching supports all/any filters and weighted scoring", () => {
  const themes = [
    "creature:animal",
    "family:spider",
    "habitat:jungle",
    "theme:venom",
    "origin:natural",
    "delivery:bite"
  ];
  const profile = {
    creature: ["animal"],
    family: ["spider"],
    habitat: ["jungle"],
    theme: ["venom"],
    origin: ["natural"],
    delivery: ["bite"]
  };

  assert.equal(matchesSemanticTags(themes, profile), true);
  assert.equal(matchesSemanticTags(themes, { family: ["scorpion"], habitat: ["jungle"] }, { mode: "all" }), false);
  assert.equal(matchesSemanticTags(themes, { family: ["scorpion"], habitat: ["jungle"] }, { mode: "any" }), true);

  const scored = scoreSemanticTags(themes, profile);
  const expected = Object.values(AFFLICTION_SEMANTIC_TAG_DEFAULT_WEIGHTS).reduce((sum, value) => sum + value, 0);
  assert.equal(scored.score, expected);
  assert.equal(scored.possible, expected);
  assert.equal(scored.coverage, 1);
  assert.equal(scored.missing.length, 0);

  const partial = scoreSemanticTags(themes, { family: ["spider"], delivery: ["sting"], habitat: ["jungle"] });
  assert.equal(partial.score, AFFLICTION_SEMANTIC_TAG_DEFAULT_WEIGHTS.family + AFFLICTION_SEMANTIC_TAG_DEFAULT_WEIGHTS.habitat);
  assert.deepEqual(partial.missing, ["delivery:sting"]);
});
