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
  createPlayerSaveBatchRequestMessage,
  emitPlayerSavePrompt,
  emitPlayerSaveBatchPrompt,
  openAfflictionSaveBatchDialog,
  preferredPlayerOwnerId
} from "./affliction-save-runtime.js";
import { scheduledDueAt } from "./affliction-instance-service.js";


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('\"', "&quot;")
    .replaceAll("'", "&#39;");
}

function localize(key, fallback = null) {
  const value = globalThis.game?.i18n?.localize?.(key);
  return value && value !== key ? value : (fallback ?? key);
}

function formatMessage(key, data = {}, fallback = null) {
  const value = globalThis.game?.i18n?.format?.(key, data);
  return value && value !== key ? value : (typeof fallback === "function" ? fallback() : (fallback ?? key));
}

function gmWhisperIds() {
  const ChatMessage = globalThis.ChatMessage;
  const recipients = ChatMessage?.getWhisperRecipients?.("GM") ?? [];
  const ids = recipients.map((user) => user?.id ?? user).filter(Boolean);
  if (ids.length > 0) return ids;
  const users = [...(globalThis.game?.users ?? [])];
  const gmIds = users.filter((user) => user?.isGM).map((user) => user.id).filter(Boolean);
  if (gmIds.length > 0) return gmIds;
  return globalThis.game?.user?.isGM && globalThis.game.user.id ? [globalThis.game.user.id] : [];
}

function afflictionTemplateLink(flags, definition) {
  const uuid = typeof flags?.sourceTemplateUuid === "string" ? flags.sourceTemplateUuid.trim() : "";
  if (uuid) return `@Affliction[${uuid}]`;
  return `<strong>${escapeHtml(definition?.name ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction", "Affliction"))}</strong>`;
}

async function createAfflictionAppliedGmMessage(controller) {
  const ChatMessage = globalThis.ChatMessage;
  if (!ChatMessage?.create || !controller?.parent) return null;
  const flags = getAfflictionFlags(controller);
  if (!flags?.definitionSnapshot || !flags?.state) return null;

  const definition = normalizeAfflictionDefinition(flags.definitionSnapshot);
  const actor = controller.parent;
  const actorName = escapeHtml(actor?.name ?? localize("PF2E_AFFLICTION_FORGE.Runtime.ActorUnavailable", "Actor"));
  const afflictionLink = afflictionTemplateLink(flags, definition);
  const message = formatMessage("PF2E_AFFLICTION_FORGE.Runtime.AppliedGmChat", {
    actor: actorName,
    affliction: afflictionLink
  }, () => `${actorName} is now affected by ${afflictionLink}.`);

  try {
    return await ChatMessage.create({
      content: `<p><i class="fa-solid fa-biohazard"></i> ${message}</p>`,
      speaker: ChatMessage.getSpeaker?.({ actor }) ?? {},
      whisper: gmWhisperIds(),
      flags: {
        [MODULE_ID]: {
          runtimeEvent: "affliction-applied",
          instanceId: flags.state.instanceId ?? flags.instanceId ?? null,
          controllerUuid: controller.uuid ?? null,
          sourceTemplateUuid: flags.sourceTemplateUuid ?? null
        }
      }
    });
  } catch (error) {
    console.warn(`${MODULE_ID} | GM Affliction application chat message could not be created.`, error);
    return null;
  }
}

function saveStatisticLabel(statistic) {
  const key = {
    fortitude: "PF2E.SavesFortitude",
    reflex: "PF2E.SavesReflex",
    will: "PF2E.SavesWill"
  }[statistic];
  const translated = key ? globalThis.game?.i18n?.localize?.(key) : null;
  return translated && translated !== key ? translated : String(statistic ?? "");
}

function degreeLabel(degree) {
  return localize(`PF2E_AFFLICTION_FORGE.Runtime.Degree.${degree}`, String(degree ?? ""));
}

async function createAfflictionCheckResolvedGmMessage({ controller, definition, state, plan, pending, resolution }) {
  const ChatMessage = globalThis.ChatMessage;
  if (!ChatMessage?.create || !controller?.parent || !resolution?.complete) return null;
  const actor = controller.parent;
  const rows = plan.checks.map((check) => {
    const result = pending.results?.[check.id] ?? {};
    const label = escapeHtml(String(check.label ?? "").trim() || saveStatisticLabel(check.statistic));
    const statistic = escapeHtml(saveStatisticLabel(check.statistic));
    const degree = escapeHtml(degreeLabel(result.degree));
    const total = result.total == null ? "—" : escapeHtml(result.total);
    const d20 = result.d20 == null ? "—" : escapeHtml(result.d20);
    return `<li><strong>${label}</strong> · ${statistic} ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.DCShort", "SG"))} ${escapeHtml(check.dc)} · ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.TotalShort", "Gesamt"))} ${total} · d20 ${d20} · <strong>${degree}</strong></li>`;
  }).join("");

  const combined = plan.checks.length > 1
    ? `<p><strong>${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.CombinedResult", "Gesamtergebnis"))}:</strong> ${escapeHtml(degreeLabel(resolution.degree))}</p>`
    : "";

  let virulent = "";
  if (pending.kind === "stage" && definition?.progression?.virulent === true) {
    const prior = Math.max(0, Math.trunc(Number(state?.recoverySuccesses ?? 0)));
    if (resolution.degree === "criticalSuccess") {
      virulent = `<p class="pf2e-affliction-virulent"><strong>${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Editor.Virulent", "Ausgeprägt"))}:</strong> ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.VirulentCriticalSuccess"))}</p>`;
    } else if (resolution.degree === "success" && prior >= 1) {
      virulent = `<p class="pf2e-affliction-virulent"><strong>${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Editor.Virulent", "Ausgeprägt"))}:</strong> ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.VirulentTwoSuccesses"))}</p>`;
    } else if (resolution.degree === "success") {
      virulent = `<p class="pf2e-affliction-virulent"><strong>${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Editor.Virulent", "Ausgeprägt"))}:</strong> ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.VirulentOneSuccess"))}</p>`;
    } else if (prior > 0) {
      virulent = `<p class="pf2e-affliction-virulent"><strong>${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Editor.Virulent", "Ausgeprägt"))}:</strong> ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.VirulentStreakBroken"))}</p>`;
    }
  }

  const content = `
    <div class="pf2e-affliction-save-summary">
      <h4><i class="fa-solid fa-dice-d20"></i> ${escapeHtml(definition?.name ?? "")} · ${escapeHtml(actor?.name ?? "")}</h4>
      <ul>${rows}</ul>
      ${combined}
      ${virulent}
    </div>`;
  try {
    return await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker?.({ actor }) ?? {},
      whisper: gmWhisperIds(),
      flags: {
        [MODULE_ID]: {
          runtimeEvent: "affliction-save-resolved",
          controllerUuid: controller.uuid ?? null,
          requestId: pending.requestId,
          kind: pending.kind,
          stageNumber: pending.stageNumber
        }
      }
    });
  } catch (error) {
    console.warn(`${MODULE_ID} | Affliction save summary chat message could not be created.`, error);
    return null;
  }
}

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
          const survivingController = await this.instanceService.get(controller.uuid);
          surviving.push(survivingController);
          // Definitions without an initial exposure save are already active or
          // incubating when created. Save-driven applications notify from the
          // initial resolution path below so pending player saves do not produce
          // a false-positive "infected" message before their outcome is known.
          if (result?.status === "not-initial") await createAfflictionAppliedGmMessage(survivingController);
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

    // Critical Forge death components can intentionally leave the controller
    // in place as a cause-of-death/audit record. Once death has been committed,
    // no manual or scheduled save may progress that controller further.
    if (state.mortality?.dead === true) {
      return { status: "dead", controller };
    }

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

    const unresolved = plan.checks.filter((check) => !pending.results?.[check.id]?.degree);
    const playerGroups = new Map();
    const gmChecks = [];
    const automaticChecks = [];

    for (const check of unresolved) {
      const policy = check.policy ?? current.definition.saveDefaults ?? { execution: "player", visibility: "public" };
      if (policy.execution === "automatic") {
        automaticChecks.push(check);
        continue;
      }
      if (policy.execution === "player") {
        const targetUserId = preferredPlayerOwnerId(current.actor);
        if (targetUserId) {
          const group = playerGroups.get(targetUserId) ?? [];
          group.push(check);
          playerGroups.set(targetUserId, group);
          continue;
        }
      }
      gmChecks.push(check);
    }

    // Automatic checks remain non-interactive and are resolved immediately.
    for (const check of automaticChecks) {
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

    // Multiple player-owned saves from the same gate are presented as one
    // Affliction window. A single virulent stage save also uses that window so
    // the current consecutive-success progress remains visible; ordinary single
    // checks retain PF2e's native modifier-dialog path.
    const virulentStage = pending.kind === "stage" && current.definition?.progression?.virulent === true;
    const virulentProgress = virulentStage
      ? { active: true, successes: Math.max(0, Math.trunc(Number(state.recoverySuccesses ?? 0))), required: 2 }
      : null;
    for (const [targetUserId, checks] of playerGroups) {
      if (checks.length === 1 && !virulentStage) {
        const check = checks[0];
        const result = await this.#executeCheck({ controller, actor: current.actor, definition: current.definition, state, pending, check });
        if (result) {
          pending.results[check.id] = result;
          pending.requests[check.id] = {
            ...(pending.requests[check.id] ?? {}),
            status: "resolved",
            resolvedAt: result.resolvedAt
          };
          await this.instanceService.setPendingCheck(controller, pending);
        }
        continue;
      }

      const requests = [];
      let createdRequest = false;
      for (const check of checks) {
        const policy = check.policy ?? current.definition.saveDefaults ?? { execution: "player", visibility: "public" };
        let request = pending.requests?.[check.id];
        if (!request || request.status !== "awaiting-player") {
          request = {
            requestId: pending.requestId,
            controllerUuid: controller.uuid,
            actorUuid: current.actor.uuid,
            checkId: check.id,
            label: check.label ?? "",
            statistic: check.statistic,
            dc: check.dc,
            visibility: policy.visibility,
            identificationState: state.identification?.state ?? "identified",
            targetUserId,
            userIds: [targetUserId],
            requestedByUserId: currentUserId()
          };
          pending.requests[check.id] = { ...request, status: "awaiting-player" };
          createdRequest = true;
        }
        requests.push({ ...request });
      }
      if (createdRequest) {
        await this.instanceService.setPendingCheck(controller, pending);
        const batchData = {
          requestId: pending.requestId,
          controllerUuid: controller.uuid,
          actorUuid: current.actor.uuid,
          identificationState: state.identification?.state ?? "identified",
          targetUserId,
          userIds: [targetUserId],
          requestedByUserId: currentUserId(),
          virulentProgress,
          checks: requests
        };
        await createPlayerSaveBatchRequestMessage(current.actor, batchData);
        emitPlayerSaveBatchPrompt(batchData);
      }
    }

    // Several GM-manual saves in one gate use the same persistent batch window.
    // "Roll all" performs them without spawning several modifier dialogs; each
    // row also offers the native PF2e dialog when a situational modifier is needed.
    if (gmChecks.length > 1 || (gmChecks.length === 1 && virulentStage)) {
      const batchChecks = gmChecks.map((check) => {
        const policy = check.policy ?? current.definition.saveDefaults ?? { execution: "gm", visibility: "public" };
        return {
          ...check,
          execution: "gm",
          visibility: policy.visibility,
          dcVisible: true
        };
      });
      const batch = await openAfflictionSaveBatchDialog(current.actor, batchChecks, {
        id: `pf2e-affliction-save-batch-${String(pending.requestId).replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        virulentProgress
      });
      for (const check of gmChecks) {
        const result = batch?.results?.[check.id];
        if (result) {
          const resolved = pendingResult(check, result, {
            execution: "gm",
            visibility: (check.policy ?? current.definition.saveDefaults)?.visibility ?? "public",
            userId: currentUserId()
          });
          pending.results[check.id] = resolved;
          pending.requests[check.id] = {
            checkId: check.id,
            status: "resolved",
            execution: "gm",
            visibility: resolved.visibility,
            resolvedAt: resolved.resolvedAt
          };
        } else {
          pending.requests[check.id] = {
            checkId: check.id,
            status: "awaiting-gm",
            execution: "gm",
            visibility: (check.policy ?? current.definition.saveDefaults)?.visibility ?? "public"
          };
        }
      }
      await this.instanceService.setPendingCheck(controller, pending);
    } else if (gmChecks.length === 1) {
      const check = gmChecks[0];
      const result = await this.#executeCheck({ controller, actor: current.actor, definition: current.definition, state, pending, check });
      if (result) {
        pending.results[check.id] = result;
        pending.requests[check.id] = {
          ...(pending.requests[check.id] ?? {}),
          status: "resolved",
          resolvedAt: result.resolvedAt
        };
        await this.instanceService.setPendingCheck(controller, pending);
      }
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

    if (plan.checks.length > 1 || (pending.kind === "stage" && current.definition?.progression?.virulent === true)) {
      await createAfflictionCheckResolvedGmMessage({
        controller: current.controller,
        definition: current.definition,
        state: current.state,
        plan,
        pending,
        resolution
      });
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
        const refreshed = await this.instanceService.get(controller.uuid);
        await createAfflictionAppliedGmMessage(refreshed);
        return { status: "incubating", degree: resolution.degree, transition, controller: refreshed };
      }
      await this.instanceService.setStage(controller, transition.targetStage, {
        enteredAt: transitionAt,
        lastCheck,
        // The infection notice emitted immediately after a successful initial
        // exposure already tells the GM that the Affliction took hold. Avoid a
        // second stage-entry message for the same instant. Onset completion and
        // later stage changes still use the normal lifecycle notification path.
        notifyLifecycle: pending.kind !== "initial",
        recoverySuccesses: resolution.recoverySuccesses
      });
      const refreshed = await this.instanceService.get(controller.uuid);
      if (pending.kind === "initial") await createAfflictionAppliedGmMessage(refreshed);
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
        executeInstant: false,
        recoverySuccesses: resolution.recoverySuccesses
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
    nextState.recoverySuccesses = Math.max(0, Math.trunc(Number(resolution.recoverySuccesses ?? 0)));
    nextState.nextCheckAt = null;
    nextState.revision = Number(nextState.revision ?? 0) + 1;
    await this.instanceService.updateRuntimeState(controller, nextState);
    return { status: "resolved-no-transition", degree: resolution.degree, transition, controller };
  }
}

export function createAfflictionEngine(options) {
  return new AfflictionEngine(options);
}
