import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = readFileSync(join(root, "scripts/affliction/runtime/affliction-instance-service.js"), "utf8");
const manager = readFileSync(join(root, "scripts/affliction/runtime/affliction-controller-app.js"), "utf8");
const managerTemplate = readFileSync(join(root, "templates/affliction-forge/affliction-controller-app.hbs"), "utf8");
const hostTemplate = readFileSync(join(root, "templates/affliction-forge/affliction-forge-app.hbs"), "utf8");
const integration = readFileSync(join(root, "scripts/affliction/forge/affliction-forge.js"), "utf8");

test("active runtime consumes only Critical Forge public Effect source API", () => {
  assert.match(runtime, /getCriticalForgeApi/);
  assert.match(runtime, /criticalApi\.effects\.toItemSources/);
  assert.doesNotMatch(runtime, /pf2e-critical-forge\/scripts|effect-engine\//);
});

test("generated stage effects are source-tagged by controller instance", () => {
  assert.match(runtime, /documentKind:\s*DOCUMENT_KINDS\.STAGE_EFFECT/);
  assert.match(runtime, /instanceId:\s*state\.instanceId/);
  assert.match(runtime, /controllerUuid/);
  assert.match(runtime, /stageId:\s*stage\.id/);
  assert.match(runtime, /stageNumber:\s*stage\.number/);
});

test("official host exposes application while active controller sheets expose management", () => {
  assert.match(hostTemplate, /data-action="applyToSelection"/);
  assert.match(integration, /pf2e-affliction-forge-manage/);
  assert.match(integration, /api\.ui\.controller\.open\(item\)/);
  assert.match(managerTemplate, /data-action="previousStage"/);
  assert.match(managerTemplate, /data-action="reapplyStage"/);
  assert.match(managerTemplate, /data-action="nextStage"/);
  assert.match(managerTemplate, /data-action="endAffliction"/);
  assert.match(manager, /instances\.setIdentification/);
});
