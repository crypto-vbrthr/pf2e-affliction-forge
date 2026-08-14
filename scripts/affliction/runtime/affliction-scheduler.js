import { MODULE_ID } from "../../constants.js";
import { readSchedulerSettings } from "../../settings.js";
import { getAfflictionFlags, isAfflictionController } from "../documents/affliction-flags.js";
import { normalizeAfflictionDefinition } from "../schema/affliction-normalizer.js";
import { durationToWorldSeconds, scheduledDueAt } from "./affliction-instance-service.js";

function worldTime() {
  const value = Number(globalThis.game?.time?.worldTime);
  return Number.isFinite(value) ? value : 0;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  try { return [...collection]; } catch { return []; }
}

function actorItems(actor) {
  return collectionValues(actor?.items);
}

function sceneTokens(scene) {
  return collectionValues(scene?.tokens);
}

export function activeGmUsers() {
  const users = collectionValues(globalThis.game?.users);
  if (users.length === 0 && globalThis.game?.user?.isGM) return [globalThis.game.user];
  return users
    .filter((user) => user?.isGM && user?.active !== false)
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

export function authoritativeGmId() {
  const designated = globalThis.game?.users?.activeGM;
  if (designated?.id) return designated.id;
  return activeGmUsers()[0]?.id ?? null;
}

export function isAuthoritativeGmClient() {
  const user = globalThis.game?.user;
  if (!user?.isGM) return false;
  const authoritative = authoritativeGmId();
  return authoritative == null || authoritative === user.id;
}

export function collectRuntimeActors() {
  const byUuid = new Map();
  const add = (actor) => {
    if (!actor || actor.documentName !== "Actor") return;
    const key = actor.uuid ?? `Actor.${actor.id ?? byUuid.size}`;
    if (!byUuid.has(key)) byUuid.set(key, actor);
  };

  for (const actor of collectionValues(globalThis.game?.actors)) add(actor);

  // Unlinked token actors are synthetic and are not guaranteed to live in
  // game.actors. Include token actors from loaded scenes so their controllers
  // participate in world-time scheduling as well.
  for (const scene of collectionValues(globalThis.game?.scenes)) {
    for (const token of sceneTokens(scene)) add(token?.actor ?? token?.document?.actor ?? null);
  }

  return [...byUuid.values()];
}

export function collectAfflictionControllers() {
  const controllers = [];
  for (const actor of collectRuntimeActors()) {
    for (const item of actorItems(actor)) {
      if (isAfflictionController(item)) controllers.push(item);
    }
  }
  return controllers;
}

function finiteWorldTime(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function controllerActiveStartedAt(controller) {
  const flags = getAfflictionFlags(controller);
  if (!flags?.definitionSnapshot || !flags?.state) return null;
  const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
  const state = flags.state;

  const explicit = finiteWorldTime(state.activeStartedAt);
  if (explicit != null) return explicit;

  // Migration path for controllers created before 0.1.24. Runtime events are
  // the strongest evidence because stageEnteredAt only describes the current
  // stage and would incorrectly restart the overall active-duration clock.
  const enteredEvents = (Array.isArray(state.events) ? state.events : [])
    .filter((event) => event?.type === "stage-entered" && Number(event?.stageNumber) > 0)
    .map((event) => finiteWorldTime(event?.at))
    .filter((value) => value != null);
  if (enteredEvents.length > 0) return Math.min(...enteredEvents);

  if (state.status !== "active" || Number(state.currentStage) <= 0) return null;

  // Old immediate-stage controllers started being active at application time.
  if (!definition.initialCheck && !definition.onset) {
    const appliedAt = finiteWorldTime(state.appliedAt);
    if (appliedAt != null) return appliedAt;
  }

  // Last-resort migration fallback. This deliberately errs late rather than
  // ending a legacy affliction too early when its original active start cannot
  // be reconstructed with confidence.
  return finiteWorldTime(state.stageEnteredAt);
}

export function controllerMaximumDurationAt(controller) {
  const flags = getAfflictionFlags(controller);
  if (!flags?.definitionSnapshot || !flags?.state) return null;
  const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
  const seconds = durationToWorldSeconds(definition.maximumDuration);
  const activeStartedAt = controllerActiveStartedAt(controller);
  if (seconds == null || activeStartedAt == null) return null;
  return activeStartedAt + seconds;
}

function blockingPendingCheck(state) {
  const pending = state?.pendingCheck;
  if (!pending) return false;

  // Any incomplete persisted check means another engine invocation is already
  // responsible for it. This also covers the short interval while a PF2e GM
  // roll dialog is open, before an explicit `awaiting-gm` request marker exists.
  const ids = Array.isArray(pending.checkIds) ? pending.checkIds : [];
  if (ids.length === 0) return true;
  return ids.some((id) => !pending.results?.[id]?.degree);
}

function unresolvedPendingRequests(state) {
  const pending = state?.pendingCheck;
  if (!pending) return [];
  const ids = Array.isArray(pending.checkIds) ? pending.checkIds : [];
  return ids
    .filter((id) => !pending.results?.[id]?.degree)
    .map((id) => ({ checkId: id, request: pending.requests?.[id] ?? null }));
}

function activeUser(userId) {
  if (!userId) return null;
  const users = globalThis.game?.users;
  const user = users?.get?.(userId) ?? collectionValues(users).find((entry) => entry?.id === userId) ?? null;
  return user && user.active !== false ? user : null;
}

function playerRequestStillAnswerable(controller, request) {
  const userIds = Array.isArray(request?.userIds) ? request.userIds : [];
  if (userIds.length === 0) return false;
  const actor = controller?.parent?.documentName === "Actor" ? controller.parent : null;
  return userIds.some((userId) => {
    const user = activeUser(userId);
    if (!user || user.isGM) return false;
    if (actor && typeof actor.testUserPermission === "function") return actor.testUserPermission(user, "OWNER");
    return true;
  });
}

function pendingRecoveryNeeded(controller, state, reason) {
  const unresolved = unresolvedPendingRequests(state);
  if (unresolved.length === 0) return false;
  if (reason === "ready") return true;
  if (reason === "gm-authority-change" && unresolved.some(({ request }) => request?.status === "awaiting-gm")) return true;
  return unresolved.some(({ request }) => request?.status === "awaiting-player" && !playerRequestStillAnswerable(controller, request));
}

function schedulableState(state) {
  // Initial exposure saves are resolved by AfflictionEngine.apply*() and are
  // intentionally not world-time events. A pending initial save is retried by
  // its player/GM workflow or from the controller manager, never by the clock.
  return ["incubating", "active"].includes(state?.status);
}

export function controllerCanonicalDueAt(controller) {
  const flags = getAfflictionFlags(controller);
  if (!flags?.definitionSnapshot || !flags?.state) return null;
  return scheduledDueAt(flags.definitionSnapshot, flags.state);
}

function terminalResult(status) {
  return ["rejected", "recovered", "ended", "inactive"].includes(status);
}

function continuationResult(status) {
  return ["onset-complete", "stage-changed", "resolved-no-transition", "incubating"].includes(status);
}

function localize(key, data = null) {
  if (data && typeof globalThis.game?.i18n?.format === "function") return game.i18n.format(key, data);
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function notifyWarning(key, data = null) {
  globalThis.ui?.notifications?.warn?.(localize(key, data));
}

function notifyError(key, data = null) {
  globalThis.ui?.notifications?.error?.(localize(key, data));
}

export class AfflictionScheduler {
  #engine;
  #instanceService;
  #controllerProvider;
  #authorityResolver;
  #settingsProvider;
  #hookIds = [];
  #queue = Promise.resolve();
  #running = false;
  #inFlight = new Set();
  #lastRun = null;
  #lastAuthorityGmId = null;

  constructor({
    engine,
    instanceService,
    controllerProvider = collectAfflictionControllers,
    authorityResolver = isAuthoritativeGmClient,
    settingsProvider = readSchedulerSettings
  } = {}) {
    if (!engine || typeof engine.process !== "function") throw new TypeError("AfflictionScheduler requires an Affliction Engine.");
    if (!instanceService || typeof instanceService.get !== "function") throw new TypeError("AfflictionScheduler requires an Affliction Instance Service.");
    this.#engine = engine;
    this.#instanceService = instanceService;
    this.#controllerProvider = controllerProvider;
    this.#authorityResolver = authorityResolver;
    this.#settingsProvider = settingsProvider;
    this.#lastAuthorityGmId = authoritativeGmId();
  }

  get started() {
    return this.#hookIds.length > 0;
  }

  get authoritative() {
    return Boolean(this.#authorityResolver());
  }

  status() {
    return Object.freeze({
      started: this.started,
      running: this.#running,
      authoritative: this.authoritative,
      authoritativeGmId: authoritativeGmId(),
      worldTime: worldTime(),
      settings: this.#settingsProvider(),
      lastRun: this.#lastRun ? { ...this.#lastRun } : null
    });
  }

  start() {
    if (this.started || typeof globalThis.Hooks?.on !== "function") return this;

    this.#hookIds.push(["updateWorldTime", Hooks.on("updateWorldTime", (time, delta, options, userId) => {
      // Zero-delta updates can occur during calendar/time synchronization. They
      // must not consume an Affliction interval or re-open a manual save.
      if (Number(delta) <= 0) return;
      void this.requestProcess({
        worldTime: Number.isFinite(Number(time)) ? Number(time) : worldTime(),
        reason: "world-time",
        delta: Number(delta) || 0,
        options,
        userId
      });
    })]);

    this.#hookIds.push(["userConnected", Hooks.on("userConnected", (user, connected) => {
      // A presence change can invalidate a persisted player request. Only call
      // it an authority change when Foundry actually selected a different GM;
      // otherwise an unrelated player login must not reopen an active GM dialog.
      const nextAuthority = authoritativeGmId();
      const authorityChanged = nextAuthority !== this.#lastAuthorityGmId;
      this.#lastAuthorityGmId = nextAuthority;
      void this.requestProcess({
        reason: authorityChanged ? "gm-authority-change" : "user-presence-change",
        userId: user?.id ?? null,
        connected: Boolean(connected)
      });
    })]);

    // Process controllers which became overdue while the world was offline.
    void this.requestProcess({ reason: "ready" });
    return this;
  }

  stop() {
    if (typeof globalThis.Hooks?.off === "function") {
      for (const [hook, id] of this.#hookIds) Hooks.off(hook, id);
    }
    this.#hookIds = [];
    return this;
  }

  requestProcess(options = {}) {
    const task = async () => this.processDue(options);
    this.#queue = this.#queue.then(task, task);
    return this.#queue;
  }

  async processDue({
    worldTime: requestedWorldTime = worldTime(),
    mode = null,
    maxTransitions = null,
    reason = "manual"
  } = {}) {
    const settings = this.#settingsProvider();
    const horizon = requestedWorldTime != null && Number.isFinite(Number(requestedWorldTime))
      ? Number(requestedWorldTime)
      : worldTime();
    const catchUpMode = mode ?? settings.catchUpMode;
    const limit = Math.max(1, Math.trunc(Number(maxTransitions ?? settings.catchUpLimit) || settings.catchUpLimit));

    if (!settings.enabled) return { status: "disabled", processed: [], horizon, reason };
    if (!this.authoritative) return { status: "not-authoritative", processed: [], horizon, reason };

    this.#running = true;
    const processed = [];
    const errors = [];
    try {
      const controllers = await Promise.resolve(this.#controllerProvider());
      for (const controller of controllers ?? []) {
        if (!controller?.uuid || this.#inFlight.has(controller.uuid)) continue;
        this.#inFlight.add(controller.uuid);
        try {
          const result = await this.#processController(controller, {
            horizon,
            mode: catchUpMode,
            maxTransitions: limit,
            reason
          });
          if (result.actions.length > 0 || result.status !== "not-due") processed.push(result);
        } catch (error) {
          console.error(`${MODULE_ID} | Scheduler failed to process Affliction controller.`, {
            controllerUuid: controller.uuid,
            error
          });
          errors.push({ controllerUuid: controller.uuid, error });
          notifyError("PF2E_AFFLICTION_FORGE.Scheduler.ProcessingFailed", {
            name: controller.name ?? controller.uuid
          });
        } finally {
          this.#inFlight.delete(controller.uuid);
        }
      }

      this.#lastRun = {
        at: worldTime(),
        horizon,
        reason,
        processedControllers: processed.length,
        errors: errors.length
      };
      return { status: errors.length > 0 ? "partial" : "processed", processed, errors, horizon, reason };
    } finally {
      this.#running = false;
    }
  }

  async #processController(controller, { horizon, mode, maxTransitions, reason }) {
    const actions = [];
    let transitions = 0;
    let current = controller;

    while (transitions < maxTransitions) {
      try {
        current = await this.#instanceService.get(current.uuid);
      } catch {
        return { controllerUuid: controller.uuid, status: "removed", actions, reason };
      }

      const flags = getAfflictionFlags(current);
      const state = flags?.state ?? {};

      // A lethal stage can leave the controller in place for GM-visible cause
      // of death and audit history. Once this Affliction has actually killed
      // its target, automatic time progression must stop so catch-up cannot
      // manufacture later saves, damage, or repeated death execution.
      if (state.mortality?.dead === true) {
        return { controllerUuid: current.uuid, status: "dead", actions, reason };
      }

      if (state.status === "pending") {
        const canResume = typeof this.#engine.resumePending === "function"
          && (reason === "ready" || pendingRecoveryNeeded(current, state, reason));
        if (!canResume) {
          return { controllerUuid: current.uuid, status: "pending-initial", actions, reason };
        }
        const result = await this.#engine.resumePending(current, { reason });
        transitions += 1;
        actions.push({ type: "resume-pending", at: state.pendingCheck?.effectiveAt ?? horizon, status: result?.status ?? "unknown" });
        if (terminalResult(result?.status)) return { controllerUuid: current.uuid, status: result.status, actions, reason };
        if (result?.status === "pending") return { controllerUuid: current.uuid, status: "pending", actions, reason };
        if (mode === "next") return { controllerUuid: current.uuid, status: "processed-next", actions, reason };
        if (!continuationResult(result?.status)) return { controllerUuid: current.uuid, status: result?.status ?? "stopped", actions, reason };
        continue;
      }
      if (!schedulableState(state)) {
        return { controllerUuid: current.uuid, status: "inactive", actions, reason };
      }

      const maximumAt = controllerMaximumDurationAt(current);
      const nextDue = controllerCanonicalDueAt(current);

      // Maximum duration is another due event. If it occurs before (or at) the
      // next stage check, the affliction ends without manufacturing a later save.
      if (Number.isFinite(maximumAt) && maximumAt <= horizon && (nextDue == null || maximumAt <= nextDue)) {
        await this.#instanceService.end(current, { reason: "maximum-duration" });
        actions.push({ type: "maximum-duration", at: maximumAt });
        return { controllerUuid: current.uuid, status: "maximum-duration", actions, reason };
      }

      if (nextDue == null || nextDue > horizon) {
        return { controllerUuid: current.uuid, status: actions.length ? "caught-up" : "not-due", actions, reason };
      }

      // A player request or cancelled/manual GM roll must never be re-issued on
      // every world-time tick. It remains pending until explicitly resolved or retried.
      if (blockingPendingCheck(state)) {
        const canResume = typeof this.#engine.resumePending === "function" && pendingRecoveryNeeded(current, state, reason);
        if (!canResume) {
          return { controllerUuid: current.uuid, status: "pending-manual", actions, reason };
        }
        const result = await this.#engine.resumePending(current, { reason });
        transitions += 1;
        actions.push({ type: "resume-pending", at: state.pendingCheck?.effectiveAt ?? nextDue, status: result?.status ?? "unknown" });
        if (terminalResult(result?.status)) return { controllerUuid: current.uuid, status: result.status, actions, reason };
        if (result?.status === "pending") return { controllerUuid: current.uuid, status: "pending", actions, reason };
        if (mode === "next") return { controllerUuid: current.uuid, status: "processed-next", actions, reason };
        if (!continuationResult(result?.status)) return { controllerUuid: current.uuid, status: result?.status ?? "stopped", actions, reason };
        continue;
      }

      const result = await this.#engine.process(current, { atTime: nextDue });
      transitions += 1;
      actions.push({ type: "engine", at: nextDue, status: result?.status ?? "unknown" });

      if (terminalResult(result?.status)) {
        return { controllerUuid: current.uuid, status: result.status, actions, reason };
      }
      if (result?.status === "pending") {
        return { controllerUuid: current.uuid, status: "pending", actions, reason };
      }

      // In full catch-up mode, interactive GM saves also continue through all
      // historical due events up to the requested world-time horizon.
      // AfflictionEngine.process() awaits PF2e's modifier dialog, so dialogs are
      // strictly sequential rather than stacked. Player-owned saves remain
      // asynchronous: their accepted result queues a fresh scheduler pass at
      // the unchanged current world-time horizon.
      if (["no-check", "not-due"].includes(result?.status)) {
        return { controllerUuid: current.uuid, status: result.status, actions, reason };
      }

      // "next" is the safe catch-up mode: one historical due event is consumed
      // per scheduler pass even if the world time jumped across many intervals.
      if (mode === "next") {
        return { controllerUuid: current.uuid, status: "processed-next", actions, reason };
      }

      if (!continuationResult(result?.status)) {
        return { controllerUuid: current.uuid, status: result?.status ?? "stopped", actions, reason };
      }
    }

    const refreshed = await this.#instanceService.get(current.uuid).catch(() => null);
    const state = getAfflictionFlags(refreshed)?.state ?? null;
    const remainingDue = refreshed ? controllerCanonicalDueAt(refreshed) : null;
    if (state && remainingDue != null && remainingDue <= horizon) {
      notifyWarning("PF2E_AFFLICTION_FORGE.Scheduler.CatchUpLimitReached", {
        name: refreshed?.name ?? controller.name ?? controller.uuid,
        limit: maxTransitions
      });
      return { controllerUuid: controller.uuid, status: "catch-up-limit", actions, reason };
    }

    return { controllerUuid: controller.uuid, status: "caught-up", actions, reason };
  }
}

export function createAfflictionScheduler(options) {
  return new AfflictionScheduler(options);
}
