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
const engine = readFileSync(join(root, "scripts/affliction/runtime/affliction-engine.js"), "utf8");
const saveRuntime = readFileSync(join(root, "scripts/affliction/runtime/affliction-save-runtime.js"), "utf8");
const saveRoller = readFileSync(join(root, "scripts/affliction/runtime/pf2e-save-roller.js"), "utf8");
const main = readFileSync(join(root, "scripts/main.js"), "utf8");
const moduleManifest = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));

test("active runtime consumes only Critical Forge public Effect source and execution APIs", () => {
  assert.match(runtime, /getCriticalForgeApi/);
  assert.match(runtime, /criticalApi\.effects\.toItemSources/);
  assert.match(runtime, /criticalApi\.effects\.execute/);
  assert.doesNotMatch(runtime, /pf2e-critical-forge\/scripts|effect-engine\//);
});

test("instant runtime declares and diagnoses the Critical Forge rc.3 death-capable dependency", () => {
  const critical = moduleManifest.relationships.requires.find((entry) => entry.id === "pf2e-critical-forge");
  assert.equal(critical.compatibility.minimum, "1.0.1-rc.3");
  assert.match(main, /effectExecutionApiAvailable/);
  assert.match(main, /deathComponentAvailable/);
});

test("same-stage runtime keeps persistent output while instant stage mechanics can execute again", () => {
  assert.match(runtime, /sameActiveStage/);
  assert.match(runtime, /previous\.activeStageEffectUuids/);
  assert.match(runtime, /executeStageInstantEffectsSafely/);
  assert.match(runtime, /refreshPersistent:\s*true/);
});

test("lethal stage components use the same Critical Forge instant execution path as damage", () => {
  assert.match(runtime, /criticalApi\.effects\.execute/);
  assert.doesNotMatch(runtime, /dying|dead.*update|hp\.value/);
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
  assert.match(managerTemplate, /data-action="processCheck"/);
  assert.match(managerTemplate, /data-action="endAffliction"/);
  assert.match(manager, /engine\.process/);
  assert.match(manager, /instances\.setIdentification/);
});

test("Affliction Engine owns save orchestration while PF2e rolls stay behind a small adapter", () => {
  assert.match(engine, /buildCheckPlan/);
  assert.match(engine, /resolveCheckResults/);
  assert.match(engine, /rollPf2eSave/);
  assert.match(saveRoller, /actor\.getStatistic/);
  assert.match(saveRoller, /statistic\.roll/);
  assert.doesNotMatch(engine, /pf2e-critical-forge\/scripts|effect-engine\//);
});

test("player-manual saves use chat requests, blind GM-only routing, and GM-side socket acceptance", () => {
  assert.match(saveRuntime, /renderChatMessageHTML/);
  assert.match(saveRuntime, /module\.\$\{MODULE_ID\}/);
  assert.match(saveRuntime, /api\?\.engine\?\.acceptPlayerResult/);
  assert.match(saveRoller, /execution === "player" \? "blindroll" : "gmroll"/);
  assert.match(saveRuntime, /HiddenSaveRequestDetail/);
});
