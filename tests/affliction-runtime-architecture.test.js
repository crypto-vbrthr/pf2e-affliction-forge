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

test("player-manual saves use ChatMessage-backed direct client dialogs, tagged PF2e result correlation, blind GM-only routing, and socket fallback", () => {
  assert.equal(moduleManifest.socket, true);
  assert.match(saveRuntime, /renderChatMessageHTML/);
  assert.match(saveRuntime, /module\.\$\{MODULE_ID\}/);
  assert.match(saveRuntime, /type:\s*"save-request"/);
  assert.match(saveRuntime, /handlePlayerSavePrompt/);
  assert.match(saveRuntime, /handleIncomingSaveRequestMessage/);
  assert.match(saveRuntime, /captureTaggedPlayerSaveMessageForGm/);
  assert.match(saveRuntime, /affliction-forge:request:/);
  assert.match(saveRuntime, /performPlayerRequest\(request\)/);
  assert.match(saveRuntime, /api\?\.engine\?\.acceptPlayerResult/);
  assert.match(engine, /emitPlayerSavePrompt/);
  assert.match(engine, /preferredPlayerOwnerId/);
  assert.match(saveRoller, /execution === "player" \? "blindroll" : "gmroll"/);
  assert.match(saveRuntime, /HiddenSaveRequestDetail/);
});

test("world-time scheduler uses canonical Foundry time hooks and active-GM authority", () => {
  const scheduler = readFileSync(join(root, "scripts/affliction/runtime/affliction-scheduler.js"), "utf8");
  const settings = readFileSync(join(root, "scripts/settings.js"), "utf8");
  assert.match(scheduler, /updateWorldTime/);
  assert.match(scheduler, /userConnected/);
  assert.match(scheduler, /game\?\.users\?\.activeGM/);
  assert.match(scheduler, /engine\.process\(current, \{ atTime: nextDue \}\)/);
  assert.match(scheduler, /maximum-duration/);
  assert.match(settings, /schedulerCatchUpMode/);
  assert.match(settings, /schedulerCatchUpLimit/);
});

test("application no longer opens the diagnostic controller manager automatically", () => {
  const host = readFileSync(join(root, "scripts/affliction/forge/affliction-forge-app.js"), "utf8");
  assert.doesNotMatch(host, /application\.controllers\.length\s*===\s*1[^\n]*ui\.controller\.open/);
  assert.match(integration, /api\.ui\.controller\.open\(item\)/);
  assert.match(managerTemplate, /data-action="reconcileRuntime"/);
});

test("runtime exposes reconciliation APIs and startup hardening before scheduler processing", () => {
  const publicApi = readFileSync(join(root, "scripts/api/public-api.js"), "utf8");
  assert.match(runtime, /async reconcile\(controllerOrUuid/);
  assert.match(runtime, /async reconcileActor\(actorOrUuid/);
  assert.match(runtime, /async reconcileAll\(/);
  assert.match(publicApi, /reconcile:\s*\(controllerOrUuid/);
  assert.match(publicApi, /reconcileActor:/);
  assert.match(publicApi, /reconcileAll:/);
  assert.match(main, /await api\.instances\?\.reconcileAll/);
  assert.ok(main.indexOf("reconcileAll") < main.indexOf("scheduler?.start"));
});


test("Forge exposes an Active Afflictions registry with explicit manager actions", () => {
  const host = readFileSync(join(root, "scripts/affliction/forge/affliction-forge-app.js"), "utf8");
  assert.match(hostTemplate, /data-action="showTemplates"/);
  assert.match(hostTemplate, /data-action="showActive"/);
  assert.match(hostTemplate, /data-action="manageActive"/);
  assert.match(hostTemplate, /data-affliction-active-row/);
  assert.match(host, /instances\.listAll\(\)/);
  assert.match(host, /ui\.controller\.open\(uuid\)/);
});

test("GM Actor sheets get a best-effort inline controller manager entry point", () => {
  assert.match(integration, /injectAfflictionControllerRowControls/);
  assert.match(integration, /pf2e-affliction-inline-manage/);
  assert.match(integration, /api\.ui\.controller\.open\(controller\)/);
  assert.match(integration, /Hooks\.on\("renderApplicationV2", injectAfflictionControllerRowControls\)/);
});

test("active registry is refreshed from controller create update and delete hooks", () => {
  assert.match(integration, /handleActiveAfflictionChanged/);
  assert.match(integration, /Hooks\.on\("createItem", handleActiveAfflictionChanged\)/);
  assert.match(integration, /Hooks\.on\("updateItem", handleActiveAfflictionChanged\)/);
  assert.match(integration, /Hooks\.on\("deleteItem", handleActiveAfflictionChanged\)/);
});


test("controller manager uses a taller resizable viewport with a guarded outer scrollbar", () => {
  const css = readFileSync(join(root, "styles/affliction-forge.css"), "utf8");
  assert.match(manager, /width:\s*560/);
  assert.match(manager, /height:\s*700/);
  assert.match(manager, /ResizeObserver/);
  assert.match(manager, /#enforceLayout/);
  assert.match(manager, /overflowY:\s*"auto"/);
  assert.match(manager, /scrollbarGutter:\s*"stable"/);
  assert.match(css, /\.affliction-controller-app \.window-content/);
  assert.match(css, /\.affliction-controller-app \.affliction-controller-shell/);
  assert.match(css, /overflow-y:\s*auto/);
})
