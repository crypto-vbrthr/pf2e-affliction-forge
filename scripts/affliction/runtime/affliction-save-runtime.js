import { MODULE_ID } from "../../constants.js";
import { readD20, readPf2eRollDegree, rollPf2eSave } from "./pf2e-save-roller.js";

const SOCKET_NAME = `module.${MODULE_ID}`;
let initialized = false;
const activePlayerRequests = new Map();
const submittedPlayerRequests = new Set();
const activePlayerPrompts = new Set();

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function escapeHtml(value) {
  const helper = globalThis.foundry?.utils?.escapeHTML;
  if (typeof helper === "function") return helper(String(value ?? ""));
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function usersArray() {
  const users = globalThis.game?.users;
  if (!users) return [];
  if (Array.isArray(users)) return users;
  if (typeof users.filter === "function") return [...users.filter(() => true)];
  return [...users];
}

function gmIds() {
  return usersArray().filter((user) => user.isGM).map((user) => user.id);
}

function primaryActiveGmId() {
  const designated = globalThis.game?.users?.activeGM;
  if (designated?.id) return designated.id;
  return usersArray()
    .filter((user) => user.isGM && user.active !== false)
    .map((user) => user.id)
    .sort()[0] ?? null;
}

function requestKey(request) {
  return `${request?.requestId ?? ""}:${request?.checkId ?? ""}`;
}

function registerPlayerRequest(request) {
  const userId = globalThis.game?.user?.id;
  if (!request || !request.userIds?.includes(userId)) return false;
  activePlayerRequests.set(requestKey(request), { ...request });
  return true;
}

function markRequestSubmitted(request) {
  const key = requestKey(request);
  submittedPlayerRequests.add(key);
  activePlayerRequests.delete(key);
}

function isRequestSubmitted(request) {
  return submittedPlayerRequests.has(requestKey(request));
}

export function playerOwnerIds(actor) {
  if (!actor) return [];
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return usersArray().filter((user) => {
    if (!user || user.isGM || user.active === false) return false;
    if (typeof actor.testUserPermission === "function") return actor.testUserPermission(user, "OWNER");
    return Number(actor.ownership?.[user.id] ?? actor.ownership?.default ?? 0) >= ownerLevel;
  }).map((user) => user.id);
}

/**
 * Select exactly one active player owner to receive an interactive PF2e roll
 * dialog. Prefer the user whose assigned character is the affected actor, then
 * fall back to a deterministic user-id ordering. Opening the same dialog on
 * several owner clients would create competing valid results for one check.
 */
export function preferredPlayerOwnerId(actor) {
  const ownerIds = playerOwnerIds(actor);
  if (ownerIds.length === 0) return null;
  const users = usersArray().filter((user) => ownerIds.includes(user.id));
  const assigned = users.find((user) => user?.character?.uuid === actor?.uuid || user?.character?.id === actor?.id);
  if (assigned?.id) return assigned.id;
  return [...ownerIds].sort((a, b) => String(a).localeCompare(String(b)))[0] ?? null;
}

function statisticLabel(statistic) {
  const key = {
    fortitude: "PF2E.SavesFortitude",
    reflex: "PF2E.SavesReflex",
    will: "PF2E.SavesWill"
  }[statistic];
  const translated = key ? globalThis.game?.i18n?.localize?.(key) : null;
  return translated && translated !== key ? translated : String(statistic ?? "");
}

export async function createPlayerSaveRequestMessage(actor, requestData) {
  if (!globalThis.ChatMessage?.create) return null;
  const identified = requestData.identificationState === "identified";
  const title = identified
    ? localize("PF2E_AFFLICTION_FORGE.Runtime.SaveRequestTitle")
    : localize("PF2E_AFFLICTION_FORGE.Runtime.HiddenSaveRequestTitle");
  const detail = identified
    ? globalThis.game?.i18n?.format?.("PF2E_AFFLICTION_FORGE.Runtime.SaveRequestDetail", {
      statistic: statisticLabel(requestData.statistic),
      dc: requestData.dc
    })
    : globalThis.game?.i18n?.format?.("PF2E_AFFLICTION_FORGE.Runtime.HiddenSaveRequestDetail", {
      statistic: statisticLabel(requestData.statistic)
    });
  const content = `
    <div class="pf2e-affliction-save-request" data-affliction-save-request="${escapeHtml(requestData.requestId)}" data-check-id="${escapeHtml(requestData.checkId)}">
      <h4><i class="fa-solid fa-dice-d20"></i> ${escapeHtml(title)}</h4>
      <p>${escapeHtml(detail)}</p>
      <button type="button" data-action="afflictionRollSave">
        <i class="fa-solid fa-dice-d20"></i> ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.RollSave"))}
      </button>
    </div>`;
  const whisper = [...new Set([...(requestData.userIds ?? []), ...gmIds()])];
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker?.({ actor }) ?? {},
    content,
    whisper,
    flags: {
      [MODULE_ID]: {
        saveRequest: { ...requestData }
      }
    }
  });
}

/** Broadcast a targeted request which causes the selected player's client to
 * invoke PF2e's own Statistic#roll workflow. The module socket broadcasts to
 * connected clients, so recipients must filter on targetUserId. */
export function emitPlayerSavePrompt(requestData) {
  const targetUserId = requestData?.targetUserId ?? requestData?.userIds?.[0] ?? null;
  if (!targetUserId) return false;
  globalThis.game?.socket?.emit?.(SOCKET_NAME, {
    type: "save-request",
    request: {
      ...requestData,
      targetUserId,
      userIds: [targetUserId]
    }
  });
  return true;
}

function emitPlayerResult(request, result) {
  const userId = globalThis.game?.user?.id;
  globalThis.game?.socket?.emit?.(SOCKET_NAME, {
    type: "save-result",
    controllerUuid: request.controllerUuid,
    requestId: request.requestId,
    checkId: request.checkId,
    userId,
    requestedByUserId: request.requestedByUserId ?? null,
    degree: result.degree,
    total: result.total ?? null,
    d20: result.d20 ?? null,
    rollId: result.rollId ?? null
  });
  markRequestSubmitted(request);
}

async function performPlayerRequest(request, button = null) {
  const userId = globalThis.game?.user?.id;
  const key = requestKey(request);
  if (!request?.userIds?.includes(userId) || isRequestSubmitted(request) || activePlayerPrompts.has(key)) return;
  activePlayerPrompts.add(key);
  if (button) button.disabled = true;
  try {
    const actor = await globalThis.fromUuid?.(request.actorUuid);
    if (!actor) throw new Error(localize("PF2E_AFFLICTION_FORGE.Runtime.ActorUnavailable"));
    const result = await rollPf2eSave(actor, {
      id: request.checkId,
      statistic: request.statistic,
      dc: request.dc
    }, {
      skipDialog: false,
      visibility: request.visibility,
      execution: "player",
      dcVisible: request.identificationState === "identified",
      extraRollOptions: [
        `affliction-forge:request:${encodeURIComponent(request.requestId)}`,
        `affliction-forge:controller:${encodeURIComponent(request.controllerUuid)}`
      ]
    });
    if (!result) {
      if (button) button.disabled = false;
      return;
    }
    if (button) {
      button.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.SaveSubmitted"))}`;
    }
    emitPlayerResult(request, result);
  } catch (error) {
    console.error(`${MODULE_ID} | Player Affliction save failed.`, error);
    globalThis.ui?.notifications?.error?.(String(error?.message ?? error));
    if (button) button.disabled = false;
  } finally {
    activePlayerPrompts.delete(key);
  }
}

export async function handlePlayerSavePrompt(payload) {
  const request = payload?.request ?? null;
  const user = globalThis.game?.user;
  if (!request || !user || user.isGM) return;
  const targetUserId = request.targetUserId ?? request.userIds?.[0] ?? null;
  if (targetUserId !== user.id) return;
  if (!registerPlayerRequest(request) || isRequestSubmitted(request)) return;

  // This executes on the selected player's browser. skipDialog=false in
  // performPlayerRequest delegates the UI to PF2e's native save modifier
  // dialog instead of trying to emulate it in the Affliction Forge.
  await performPlayerRequest(request);
}

function bindSaveRequest(message, html) {
  const request = message?.flags?.[MODULE_ID]?.saveRequest;
  if (!registerPlayerRequest(request)) return;
  const root = html?.querySelector?.(".pf2e-affliction-save-request");
  const button = root?.querySelector?.('[data-action="afflictionRollSave"]');
  if (!button) return;
  if (isRequestSubmitted(request)) {
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.SaveSubmitted"))}`;
    return;
  }
  if (button.dataset.afflictionBound === "true") return;
  button.dataset.afflictionBound = "true";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void performPlayerRequest(request, button);
  });
}

function messageAuthorId(message) {
  const author = message?.author?.id ?? message?.user?.id ?? message?.user ?? null;
  return typeof author === "string" ? author : null;
}

function messageActorUuid(message) {
  const actor = message?.speakerActor ?? message?.actor ?? null;
  if (actor?.uuid) return actor.uuid;
  const contextActor = message?.flags?.pf2e?.context?.actor;
  if (typeof contextActor === "string" && contextActor) return contextActor;
  const actorId = message?.speaker?.actor;
  const worldActor = actorId ? globalThis.game?.actors?.get?.(actorId) : null;
  return worldActor?.uuid ?? null;
}

function messageSaveStatistic(message) {
  const context = message?.flags?.pf2e?.context;
  const roll = message?.rolls?.[0];
  const type = context?.type ?? roll?.options?.type ?? null;
  if (type !== "saving-throw") return null;
  const domains = [
    ...(Array.isArray(context?.domains) ? context.domains : []),
    ...(Array.isArray(roll?.options?.domains) ? roll.options.domains : [])
  ];
  return ["fortitude", "reflex", "will"].find((save) => domains.includes(save)) ?? null;
}

function messageRollOptions(message) {
  const contextOptions = message?.flags?.pf2e?.context?.options;
  const rollOptions = message?.rolls?.[0]?.options?.options;
  return [
    ...(Array.isArray(contextOptions) ? contextOptions : []),
    ...(Array.isArray(rollOptions) ? rollOptions : [])
  ].map((option) => String(option));
}

function isAfflictionGeneratedRoll(message) {
  const options = messageRollOptions(message);
  return options.includes("affliction-forge") || options.some((option) => String(option).startsWith("affliction-forge:check:"));
}

function optionValue(options, prefix) {
  const option = options.find((entry) => entry.startsWith(prefix));
  if (!option) return null;
  const encoded = option.slice(prefix.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function requestsFromMessages() {
  const messages = globalThis.game?.messages;
  if (!messages) return [];
  const values = Array.isArray(messages) ? messages : [...messages];
  const found = [];
  for (const message of values) {
    const request = message?.flags?.[MODULE_ID]?.saveRequest;
    if (request) found.push(request);
  }
  return found;
}

export function matchingManualPlayerRequests(message) {
  const userId = globalThis.game?.user?.id;
  if (!userId || globalThis.game?.user?.isGM) return [];
  if (messageAuthorId(message) !== userId) return [];
  if (isAfflictionGeneratedRoll(message)) return [];
  const actorUuid = messageActorUuid(message);
  const statistic = messageSaveStatistic(message);
  if (!actorUuid || !statistic) return [];

  const all = new Map(activePlayerRequests);
  for (const request of requestsFromMessages()) {
    if (request?.userIds?.includes(userId) && !isRequestSubmitted(request)) {
      all.set(requestKey(request), request);
    }
  }
  return [...all.values()].filter((request) => (
    request?.actorUuid === actorUuid &&
    request?.statistic === statistic &&
    request?.userIds?.includes(userId) &&
    !isRequestSubmitted(request)
  ));
}

export function captureManualPlayerSaveMessage(message) {
  const matches = matchingManualPlayerRequests(message);
  if (matches.length === 0) return { status: "ignored" };
  if (matches.length > 1) {
    globalThis.ui?.notifications?.warn?.(localize("PF2E_AFFLICTION_FORGE.Runtime.AmbiguousManualSave"));
    return { status: "ambiguous", requests: matches };
  }

  const request = matches[0];
  const roll = message?.rolls?.[0];
  if (!roll) return { status: "ignored" };
  const degree = readPf2eRollDegree(roll, request.dc);
  if (!degree) return { status: "ignored" };

  emitPlayerResult(request, {
    degree,
    total: Number.isFinite(Number(roll.total)) ? Number(roll.total) : null,
    d20: readD20(roll),
    rollId: roll.id ?? roll._id ?? message?.id ?? null
  });
  return { status: "submitted", request };
}

function findRequestMessage(requestId, checkId = null) {
  const messages = globalThis.game?.messages;
  if (!messages) return null;
  const values = Array.isArray(messages) ? messages : [...messages];
  return values.find((message) => {
    const request = message?.flags?.[MODULE_ID]?.saveRequest;
    return request?.requestId === requestId && (!checkId || request?.checkId === checkId);
  }) ?? null;
}

/**
 * Use the synchronized ChatMessage document as the primary cross-client prompt
 * transport. Whispered request cards are already replicated to the selected
 * player client, even in installations where a newly-added package socket has
 * not yet been provisioned by a full Foundry server restart.
 */
export function handleIncomingSaveRequestMessage(message) {
  const request = message?.flags?.[MODULE_ID]?.saveRequest;
  const user = globalThis.game?.user;
  if (!request || !user || user.isGM) return { status: "ignored" };
  const targetUserId = request.targetUserId ?? request.userIds?.[0] ?? null;
  if (targetUserId !== user.id || !request.userIds?.includes(user.id)) return { status: "ignored" };
  if (!registerPlayerRequest(request) || isRequestSubmitted(request)) return { status: "ignored" };

  // Defer one microtask so the incoming ChatMessage finishes its own document
  // creation lifecycle before PF2e creates the saving-throw ChatMessage.
  const schedule = globalThis.queueMicrotask ?? ((callback) => Promise.resolve().then(callback));
  schedule(() => void performPlayerRequest(request));
  return { status: "prompted", request };
}

/**
 * Authoritative GM-side fallback which consumes the PF2e roll ChatMessage
 * itself. This makes player-save resolution independent of the module socket:
 * the request travels through the whispered request document and the result
 * travels through PF2e's own synchronized roll ChatMessage.
 */
export function captureTaggedPlayerSaveMessageForGm(message) {
  const user = globalThis.game?.user;
  if (!user?.isGM || user.id !== primaryActiveGmId()) return { status: "ignored" };
  const options = messageRollOptions(message);
  const requestId = optionValue(options, "affliction-forge:request:");
  const checkId = optionValue(options, "affliction-forge:check:");
  if (!requestId || !checkId) return { status: "ignored" };

  const requestMessage = findRequestMessage(requestId, checkId);
  const request = requestMessage?.flags?.[MODULE_ID]?.saveRequest;
  if (!request) return { status: "orphaned" };

  const authorId = messageAuthorId(message);
  if (!authorId || !request.userIds?.includes(authorId)) return { status: "unauthorized" };
  const roll = message?.rolls?.[0];
  if (!roll) return { status: "ignored" };
  const degree = readPf2eRollDegree(roll, request.dc);
  if (!degree) return { status: "ignored" };

  const payload = {
    controllerUuid: request.controllerUuid,
    requestId: request.requestId,
    checkId: request.checkId,
    userId: authorId,
    requestedByUserId: request.requestedByUserId ?? null,
    degree,
    total: Number.isFinite(Number(roll.total)) ? Number(roll.total) : null,
    d20: readD20(roll),
    rollId: roll.id ?? roll._id ?? message?.id ?? null
  };
  const api = globalThis.game?.modules?.get?.(MODULE_ID)?.api;
  if (typeof api?.engine?.acceptPlayerResult !== "function") return { status: "unavailable", payload };
  void api.engine.acceptPlayerResult(payload).then((result) => {
    if (result?.status && result.status !== "pending") {
      globalThis.Hooks?.callAll?.("pf2eAfflictionForgeCheckResolved", result);
    }
  }).catch((error) => {
    console.error(`${MODULE_ID} | Could not accept player Affliction save from PF2e roll message.`, error);
    globalThis.ui?.notifications?.error?.(String(error?.message ?? error));
  });
  return { status: "submitted", request, payload };
}

function onCreateChatMessage(message) {
  const request = message?.flags?.[MODULE_ID]?.saveRequest;
  if (request) {
    handleIncomingSaveRequestMessage(message);
    return;
  }

  // On the authoritative GM client, a uniquely tagged PF2e roll message is
  // sufficient to resolve the pending request. No module-socket round trip is
  // required. Other player rolls still use the looser manual correlation as a
  // convenience fallback on the player's own client.
  if (globalThis.game?.user?.isGM) {
    captureTaggedPlayerSaveMessageForGm(message);
    return;
  }
  captureManualPlayerSaveMessage(message);
}

function shouldHandleResult(payload) {
  if (!globalThis.game?.user?.isGM) return false;
  const requested = payload?.requestedByUserId;
  const requestedUser = requested ? globalThis.game?.users?.get?.(requested) : null;
  if (requested && requestedUser?.isGM && requestedUser.active !== false) return globalThis.game.user.id === requested;
  return globalThis.game.user.id === primaryActiveGmId();
}

async function handleSocket(payload) {
  if (payload?.type === "save-request") {
    await handlePlayerSavePrompt(payload);
    return;
  }
  if (payload?.type !== "save-result" || !shouldHandleResult(payload)) return;
  try {
    const api = globalThis.game?.modules?.get?.(MODULE_ID)?.api;
    const result = await api?.engine?.acceptPlayerResult?.(payload);
    if (result?.status && result.status !== "pending") {
      globalThis.Hooks?.callAll?.("pf2eAfflictionForgeCheckResolved", result);
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Could not accept player Affliction save result.`, error);
    globalThis.ui?.notifications?.error?.(String(error?.message ?? error));
  }
}

export function initializeAfflictionSaveRuntime() {
  if (initialized) return;
  initialized = true;
  globalThis.game?.socket?.on?.(SOCKET_NAME, handleSocket);
  globalThis.Hooks?.on?.("renderChatMessageHTML", bindSaveRequest);
  globalThis.Hooks?.on?.("createChatMessage", onCreateChatMessage);
}
