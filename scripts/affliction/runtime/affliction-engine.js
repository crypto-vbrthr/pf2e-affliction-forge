import { MODULE_ID } from "../../constants.js";
import { getAfflictionFlags } from "../documents/affliction-flags.js";
import { normalizeAfflictionDefinition } from "../schema/affliction-normalizer.js";
import { deepClone, randomId } from "../schema/utils.js";
import {
  buildCheckPlan,
  normalizeDegreeOfSuccess,
  resolveCheckResults
} from "./affliction-engine-core.js";
import { rollPf2eSave } from "./pf2e-save-roller.js";
import {
  createPlayerSaveRequestMessage,
  emitPlayerSavePrompt,
  preferredPlayerOwnerId
} from "./affliction-save-runtime.js";
import { scheduledDueAt } from "./affliction-instance-service.js";

function nowWorldTime() {
  const value = Number(globalThis.game?.time?.worldTime);
  return Number.isFinite(value) ? value : 0;
}

function currentUserId() {
  return globalThis.game?.user?.id ?? null;
}

function assertGm() {
  if (!globalThis.game?.user?.isGM) throw new Error("Affliction Engine progression requires an active GM client.");
}

function pendingResult(check, result, { execution, visibility, userId = null, resolvedAt = nowWorldTime() } = {}) {
  return {
    checkId: check.id,
    statistic: check.statistic,
    dc: check.dc,
    degree: normalizeDegreeOfSuccess(result.degree),
    total: result.total ?? null,
    d20: result.d20 ?? null,
    rollId: result.rollId ?? null,
    execution,
    visibility,
    userId,
    resolvedAt
  };
}

function createPending(plan, state, { effectiveAt = nowWorldTime() } = {}) {
  const requestId = randomId("affliction-check");
  return {
    schemaVersion: 1,
    requestId,
    kind: plan.kind,
    stageNumber: plan.stageNumber,
    combine: plan.combine,
    checkIds: plan.checks.map((check) => check.id),
    outcomes: deepClone(plan.outcomes),
    requestedAt: nowWorldTime(),
    effectiveAt: effectiveAt != null && Number.isFinite(Number(effectiveAt)) ? Number(effectiveAt) : nowWorldTime(),
    requestedByUserId: currentUserId(),
    baseRevision: state.revision,
    requests: {},
    results: {}
  };
}

function pendingMatches(pending, plan) {
  if (!pending || pending.kind !== plan.kind || pending.stageNumber !== plan.stageNumber) return false;
  const left = [...(pending.checkIds ?? [])];
  const right = plan.checks.map((check) => check.id);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class AfflictionEngine {
  #controllerQueues = new Map();

  constructor({ instanceService }) {
    this.instanceService = instanceService;
  }

  #controllerKey(controllerOrUuid) {
    if (typeof controllerOrUuid === "string" && controllerOrUuid) return controllerOrUuid;
    return controllerOrUuid?.uuid ?? controllerOrUuid?.id ?? "__global__";
  }

  #serialize(controllerOrUuid, task) {
    const key = this.#controllerKey(controllerOrUuid);
    const previous = this.#controllerQueues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.then(() => undefined, () => undefined);
    this.#controllerQueues.set(key, tail);
    void tail.then(() => {
      if (this.#controllerQueues.get(key) === tail) this.#controllerQueues.delete(key);
    });
    return run;
  }

  async applyTemplate(templateOrUuid, targets, options = {}) {
    assertGm();
    const controllers = await this.instanceService.applyTemplate(templateOrUuid, targets, options);
    return this.#processAppliedControllers(controllers);
  }

  async applyDefinition(definition, targets, options = {}) {
    assertGm();
    const controllers = await this.instanceService.applyDefinition(definition, targets, options);
    return this.#processAppliedControllers(controllers);
  }

  async #processAppliedControllers(controllers) {
    const created = [...controllers];
    const surviving = [];
    const results = [];
    const errors = [];

    for (const controller of created) {
      try {
        const result = await this.processInitial(controller);
        results.push({ controllerUuid: controller.uuid, ...result });
        if (!["rejected", "recovered", "ended"].includes(result?.status)) {
          surviving.push(await this.instanceService.get(controller.uuid));
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Initial Affliction save processing failed.`, error);
        errors.push({ controllerUuid: controller.uuid, error });
        // Keep the controller alive in its pending state. A GM can retry the
        // initial check from the controller manager instead of losing the case.
        surviving.push(await this.instanceService.get(controller.uuid));
      }
    }

    return {
      created,
      controllers: surviving,
      results,
      errors
    };
  }

  async inspect(controllerOrUuid) {
    const controller = await this.instanceService.get(controllerOrUuid);
    const flags = getAfflictionFlags(controller);
    const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
    return {
      controller,
      actor: controller.parent,
      definition,
      state: deepClone(flags.state),
      plan: buildCheckPlan(definition, flags.state)
    };
  }

  async processInitial(controllerOrUuid) {
    const current = await this.inspect(controllerOrUuid);
    if (current.state.status !== "pending" || current.state.currentStage !== 0) {
      return { status: "not-initial", controller: current.controller };
    }
    return this.process(current.controller, { force: true });
  }

  async process(controllerOrUuid, { force = false, atTime = null } = {}) {
    assertGm();
    return this.#serialize(controllerOrUuid, () => this.#processUnlocked(controllerOrUuid, { force, atTime }));
  }

  async #processUnlocked(controllerOrUuid, { force = false, atTime = null } = {}) {
    const current = await this.inspect(controllerOrUuid);
    const { controller, state } = current;
    // `Number(null)` is 0. Treating the default null as a valid timestamp
    // anchored every initial save and manual process call at world-time zero,
    // making onset and stage deadlines appear massively overdue. Null means
    // "use the current Foundry world time"; only explicit finite values are
    // accepted as historical scheduler anchors.
    const processAt = atTime != null && Number.isFinite(Number(atTime))
      ? Number(atTime)
      : nowWorldTime();

    if (state.status === "incubating") {
      const dueAt = scheduledDueAt(current.definition, state);
      if (!force && Number.isFinite(dueAt) && processAt < dueAt) {
        return { status: "not-due", controller, dueAt };
      }
      await this.instanceService.completeOnset(controller, { enteredAt: processAt });
      return { status: "onset-complete", controller: await this.instanceService.get(controller.uuid) };
    }

    if (!["pending", "active"].includes(state.status)) {
      return { status: "inactive", controller };
    }
    const dueAt = scheduledDueAt(current.definition, state);
    if (!force && Number.isFinite(dueAt) && processAt < dueAt) {
      return { status: "not-due", controller, dueAt };
    }

    const plan = current.plan;
    if (!plan || plan.checks.length === 0) return { status: "no-check", controller };
    let pending = pendingMatches(state.pendingCheck, plan)
      ? deepClone(state.pendingCheck)
      : createPending(plan, state, { effectiveAt: processAt });
    if (!pendingMatches(state.pendingCheck, plan)) {
      await this.instanceService.setPendingCheck(controller, pending);
    }

    for (const check of plan.checks) {
      if (pending.results?.[check.id]?.degree) continue;
      const result = await this.#executeCheck({ controller, actor: current.actor, definition: current.definition, state, pending, check });
      if (!result) continue;
      pending.results[check.id] = result;
      pending.requests[check.id] = {
        ...(pending.requests[check.id] ?? {}),
        status: "resolved",
        resolvedAt: result.resolvedAt
      };
      await this.instanceService.setPendingCheck(controller, pending);
    }

    return this.#finalizeIfComplete(controller, pending);
  }

  async #executeCheck({ controller, actor, definition, state, pending, check }) {
    const policy = check.policy ?? definition.saveDefaults ?? { execution: "player", visibility: "public" };
    let execution = policy.execution;
    const visibility = policy.visibility;
    const dcVisible = state.identification?.state === "identified" || globalThis.game?.user?.isGM;

    if (execution === "player") {
      const targetUserId = preferredPlayerOwnerId(actor);
      if (targetUserId) {
        const request = pending.requests[check.id];
        if (!request || request.status !== "awaiting-player") {
          const requestData = {
            requestId: pending.requestId,
            controllerUuid: controller.uuid,
            actorUuid: actor.uuid,
            checkId: check.id,
            statistic: check.statistic,
            dc: check.dc,
            visibility,
            identificationState: state.identification?.state ?? "identified",
            targetUserId,
            userIds: [targetUserId],
            requestedByUserId: currentUserId()
          };
          pending.requests[check.id] = {
            ...requestData,
            status: "awaiting-player"
          };
          // Persist before notifying another client. A very fast player roll
          // can otherwise return before the authoritative GM knows the request
          // exists and would be rejected as stale.
          await this.instanceService.setPendingCheck(controller, pending);
          // Keep a whisper card as an audit/retry path, but the primary UX is
          // the targeted socket request below, which opens PF2e's native save
          // dialog immediately on the selected player's client.
          await createPlayerSaveRequestMessage(actor, requestData);
          emitPlayerSavePrompt(requestData);
        }
        return null;
      }
      // No active player owner can answer the request. Fall back to a GM manual roll.
      execution = "gm";
    }

    const result = await rollPf2eSave(actor, check, {
      skipDialog: execution === "automatic",
      visibility,
      execution,
      dcVisible
    });
    if (!result) {
      pending.requests[check.id] = {
        checkId: check.id,
        status: execution === "gm" ? "awaiting-gm" : "cancelled",
        execution,
        visibility
      };
      await this.instanceService.setPendingCheck(controller, pending);
      return null;
    }
    return pendingResult(check, result, {
      execution,
      visibility,
      userId: currentUserId()
    });
  }

  async acceptPlayerResult(payload = {}) {
    assertGm();
    if (!payload?.controllerUuid) return { status: "invalid", controller: null };
    return this.#serialize(payload.controllerUuid, () => this.#acceptPlayerResultUnlocked(payload));
  }

  async #acceptPlayerResultUnlocked(payload = {}) {
    let inspected;
    try {
      inspected = await this.inspect(payload.controllerUuid);
    } catch (error) {
      // Duplicate socket/ChatMessage deliveries can arrive after a resolving
      // result has already ended and deleted the controller. Treat that as a
      // stale result instead of surfacing a spurious runtime error.
      let resolved = null;
      if (typeof globalThis.fromUuid === "function") {
        try { resolved = await globalThis.fromUuid(payload.controllerUuid); } catch { resolved = null; }
      }
      if (!resolved) return { status: "stale", controller: null };
      throw error;
    }
    const { controller, actor, definition, state, plan } = inspected;
    const pending = deepClone(state.pendingCheck);
    if (!pending || pending.requestId !== payload.requestId) return { status: "stale", controller };
    const check = plan?.checks?.find((entry) => entry.id === payload.checkId);
    const request = pending.requests?.[payload.checkId];
    if (!check || !request || request.status !== "awaiting-player") return { status: "stale", controller };
    if (!request.userIds?.includes(payload.userId)) return { status: "unauthorized", controller };
    const user = globalThis.game?.users?.get?.(payload.userId) ?? [...(globalThis.game?.users ?? [])].find?.((entry) => entry.id === payload.userId);
    if (user && typeof actor.testUserPermission === "function" && !actor.testUserPermission(user, "OWNER")) {
      return { status: "unauthorized", controller };
    }
    const degree = normalizeDegreeOfSuccess(payload.degree);
    if (!degree) return { status: "invalid", controller };

    pending.results[check.id] = pendingResult(check, {
      degree,
      total: payload.total ?? null,
      d20: payload.d20 ?? null,
      rollId: payload.rollId ?? null
    }, {
      execution: "player",
      visibility: request.visibility,
      userId: payload.userId,
      resolvedAt: nowWorldTime()
    });
    pending.requests[check.id] = { ...request, status: "resolved", resolvedAt: nowWorldTime() };
    await this.instanceService.setPendingCheck(controller, pending);
    return this.#finalizeIfComplete(controller, pending);
  }

  async resumePending(controllerOrUuid, { reason = "manual-resume" } = {}) {
    assertGm();
    return this.#serialize(controllerOrUuid, () => this.#resumePendingUnlocked(controllerOrUuid, { reason }));
  }

  async #resumePendingUnlocked(controllerOrUuid, { reason = "manual-resume" } = {}) {
    const current = await this.inspect(controllerOrUuid);
    const { controller, state } = current;
    const pending = state.pendingCheck ? deepClone(state.pendingCheck) : null;

    // A legacy/interrupted initial application may have reached pending state
    // before the request object itself was persisted. Re-run the initial plan.
    if (!pending) {
      if (state.status !== "pending") return { status: "no-pending", controller };
      return this.#processUnlocked(controller, { force: true, atTime: nowWorldTime() });
    }

    const checkIds = Array.isArray(pending.checkIds) ? pending.checkIds : [];
    let reset = 0;
    pending.requests ??= {};
    for (const checkId of checkIds) {
      if (pending.results?.[checkId]?.degree) continue;
      if (pending.requests?.[checkId]) reset += 1;
      delete pending.requests[checkId];
    }
    pending.resumeCount = Number(pending.resumeCount ?? 0) + 1;
    pending.lastResumedAt = nowWorldTime();
    pending.lastResumeReason = reason;
    await this.instanceService.setPendingCheck(controller, pending);

    const effectiveAt = pending.effectiveAt != null && Number.isFinite(Number(pending.effectiveAt))
      ? Number(pending.effectiveAt)
      : nowWorldTime();
    const result = await this.#processUnlocked(controller, { force: true, atTime: effectiveAt });
    return { ...result, resumed: true, resetRequests: reset, reason };
  }

  async #finalizeIfComplete(controller, pending) {
    const current = await this.inspect(controller);
    const persisted = current.state.pendingCheck;
    // Manual stage changes, ending the Affliction, or another accepted result
    // can invalidate an in-flight resolution. Never apply a transition from a
    // request which is no longer the controller's current pending check.
    if (!persisted || persisted.requestId !== pending.requestId) {
      return { status: "stale", controller: current.controller };
    }
    pending = deepClone(persisted);
    const plan = current.plan;
    if (!plan || !pendingMatches(pending, plan)) return { status: "stale", controller: current.controller };
    const resolution = resolveCheckResults(current.definition, current.state, plan, pending.results);
    if (!resolution.complete) {
      return {
        status: "pending",
        controller,
        pendingCheck: deepClone(pending),
        remaining: plan.checks.filter((check) => !pending.results?.[check.id]?.degree).map((check) => check.id)
      };
    }

    const transitionAt = pending.effectiveAt != null && Number.isFinite(Number(pending.effectiveAt))
      ? Number(pending.effectiveAt)
      : nowWorldTime();
    const lastCheck = {
      requestId: pending.requestId,
      kind: pending.kind,
      stageNumber: pending.stageNumber,
      degree: resolution.degree,
      directive: deepClone(resolution.directive),
      results: deepClone(pending.results),
      effectiveAt: transitionAt,
      resolvedAt: nowWorldTime()
    };
    const transition = resolution.transition;

    if (transition.type === "reject") {
      await this.instanceService.end(controller, { reason: "rejected" });
      return { status: "rejected", degree: resolution.degree, transition };
    }
    if (transition.type === "recover") {
      await this.instanceService.end(controller, { reason: "recovered" });
      return { status: "recovered", degree: resolution.degree, transition };
    }
    if (transition.type === "end") {
      await this.instanceService.end(controller, { reason: "ended" });
      return { status: "ended", degree: resolution.degree, transition };
    }
    if (transition.type === "stage") {
      if (pending.kind === "initial" && current.definition.onset) {
        await this.instanceService.beginOnset(controller, transition.targetStage, { startedAt: transitionAt, lastCheck });
        return { status: "incubating", degree: resolution.degree, transition, controller: await this.instanceService.get(controller.uuid) };
      }
      await this.instanceService.setStage(controller, transition.targetStage, {
        enteredAt: transitionAt,
        lastCheck
      });
      const refreshed = await this.instanceService.get(controller.uuid);
      return { status: "stage-changed", degree: resolution.degree, transition, controller: refreshed };
    }

    // A stage check with an explicit no-op still consumes its interval. Renew
    // the stage clock without rebuilding persistent output or replaying instant
    // mechanics, otherwise nextCheckAt would remain in the past forever.
    if (pending.kind === "stage" && current.state.status === "active" && current.state.currentStage > 0) {
      await this.instanceService.setStage(controller, current.state.currentStage, {
        enteredAt: transitionAt,
        lastCheck,
        refreshPersistent: false,
        executeInstant: false
      });
      return {
        status: "resolved-no-transition",
        degree: resolution.degree,
        transition,
        controller: await this.instanceService.get(controller.uuid)
      };
    }

    const nextState = deepClone(current.state);
    nextState.pendingCheck = null;
    nextState.lastCheck = lastCheck;
    nextState.nextCheckAt = null;
    nextState.revision = Number(nextState.revision ?? 0) + 1;
    await this.instanceService.updateRuntimeState(controller, nextState);
    return { status: "resolved-no-transition", degree: resolution.degree, transition, controller };
  }
}

export function createAfflictionEngine(options) {
  return new AfflictionEngine(options);
}
