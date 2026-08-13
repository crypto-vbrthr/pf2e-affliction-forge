import { MODULE_ID } from "../../constants.js";
import { rollPf2eSave } from "./pf2e-save-roller.js";

const SOCKET_NAME = `module.${MODULE_ID}`;
let initialized = false;

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

export function playerOwnerIds(actor) {
  if (!actor) return [];
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return usersArray().filter((user) => {
    if (!user || user.isGM || user.active === false) return false;
    if (typeof actor.testUserPermission === "function") return actor.testUserPermission(user, "OWNER");
    return Number(actor.ownership?.[user.id] ?? actor.ownership?.default ?? 0) >= ownerLevel;
  }).map((user) => user.id);
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

async function performPlayerRequest(request, button) {
  const userId = globalThis.game?.user?.id;
  if (!request?.userIds?.includes(userId)) return;
  button.disabled = true;
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
      dcVisible: request.identificationState === "identified"
    });
    if (!result) {
      button.disabled = false;
      return;
    }
    button.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(localize("PF2E_AFFLICTION_FORGE.Runtime.SaveSubmitted"))}`;
    globalThis.game?.socket?.emit?.(SOCKET_NAME, {
      type: "save-result",
      controllerUuid: request.controllerUuid,
      requestId: request.requestId,
      checkId: request.checkId,
      userId,
      requestedByUserId: request.requestedByUserId ?? null,
      degree: result.degree,
      total: result.total,
      d20: result.d20,
      rollId: result.rollId
    });
  } catch (error) {
    console.error(`${MODULE_ID} | Player Affliction save failed.`, error);
    globalThis.ui?.notifications?.error?.(String(error?.message ?? error));
    button.disabled = false;
  }
}

function bindSaveRequest(message, html) {
  const request = message?.flags?.[MODULE_ID]?.saveRequest;
  if (!request || !request.userIds?.includes(globalThis.game?.user?.id)) return;
  const root = html?.querySelector?.(".pf2e-affliction-save-request");
  const button = root?.querySelector?.('[data-action="afflictionRollSave"]');
  if (!button || button.dataset.afflictionBound === "true") return;
  button.dataset.afflictionBound = "true";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void performPlayerRequest(request, button);
  });
}

function shouldHandleResult(payload) {
  if (!globalThis.game?.user?.isGM) return false;
  const requested = payload?.requestedByUserId;
  const requestedUser = requested ? globalThis.game?.users?.get?.(requested) : null;
  if (requested && requestedUser?.isGM && requestedUser.active !== false) return globalThis.game.user.id === requested;
  return globalThis.game.user.id === primaryActiveGmId();
}

async function handleSocket(payload) {
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
}
