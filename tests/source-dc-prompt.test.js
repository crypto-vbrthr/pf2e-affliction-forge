import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/foundry-mock.js";

installFoundryMock();
globalThis.game.i18n = { localize: (key) => key };

const { sourceDcApplicationOptions, sourceDcChecks } = await import("../scripts/affliction/integration/source-dc-prompt.js");

test("source-DC UI helper returns one shared saveDc for a single external check", () => {
  const definition = {
    checks: [
      { id: "spell", label: "Spell DC", statistic: "fortitude", dcMode: "source", dc: null },
      { id: "fixed", statistic: "will", dcMode: "fixed", dc: 20 }
    ]
  };
  const checks = sourceDcChecks(definition);
  assert.deepEqual(checks.map((check) => check.id), ["spell"]);
  assert.deepEqual(sourceDcApplicationOptions({ dc_0: "31" }, checks), { saveDc: 31 });
});

test("source-DC UI helper returns saveDcs keyed by stable check id for several external checks", () => {
  const checks = [
    { id: "body", label: "Body" },
    { id: "mind", label: "Mind" }
  ];
  assert.deepEqual(sourceDcApplicationOptions({ dc_0: 27, dc_1: 29 }, checks), {
    saveDcs: { body: 27, mind: 29 }
  });
});

test("source-DC UI helper rejects invalid application DCs before runtime creation", () => {
  assert.throws(
    () => sourceDcApplicationOptions({ dc_0: 0 }, [{ id: "primary", label: "Primary" }]),
    /Primary/
  );
});
