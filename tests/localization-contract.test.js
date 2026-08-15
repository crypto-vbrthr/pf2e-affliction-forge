import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const language of ["de", "en"]) {
  test(`${language} localization contains no parent/child key collisions`, async () => {
    const url = new URL(`../lang/${language}.json`, import.meta.url);
    const translations = JSON.parse(await readFile(url, "utf8"));
    const keys = new Set(Object.keys(translations));
    const collisions = [];

    for (const key of keys) {
      const segments = key.split(".");
      for (let index = 1; index < segments.length; index += 1) {
        const parent = segments.slice(0, index).join(".");
        if (keys.has(parent)) collisions.push(`${parent} < ${key}`);
      }
    }

    assert.deepEqual(collisions, []);
  });
}
