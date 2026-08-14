import { MODULE_ID } from "../../constants.js";
import { extractAfflictionDefinitionFromItem } from "../documents/affliction-item-adapter.js";
import { getAfflictionFlags, isAfflictionTemplate } from "../documents/affliction-flags.js";

let textIntegrationInitialized = false;
let runtimeIntegrationInitialized = false;

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function api() {
  return globalThis.game?.modules?.get?.(MODULE_ID)?.api ?? null;
}

function authoritativeGm() {
  if (!globalThis.game?.user?.isGM) return false;
  const activeGM = globalThis.game?.users?.activeGM;
  return !activeGM?.id || activeGM.id === globalThis.game.user.id;
}

function notify(level, key, data = null) {
  const ui = globalThis.ui?.notifications;
  if (!ui) return;
  const message = data && globalThis.game?.i18n?.format
    ? globalThis.game.i18n.format(key, data)
    : localize(key);
  ui[level]?.(message);
}

function writeDragData(event, payload) {
  const transfer = event?.dataTransfer;
  if (!transfer || !payload) return false;
  const json = JSON.stringify(payload);
  transfer.setData("text/plain", json);
  try { transfer.setData("application/json", json); } catch { /* Browser-dependent */ }
  transfer.effectAllowed = "copy";
  return true;
}

async function templateName(uuid) {
  try {
    const document = typeof globalThis.fromUuid === "function" ? await globalThis.fromUuid(uuid) : null;
    return document?.name ?? null;
  } catch {
    return null;
  }
}

async function enrichAfflictionReference(match, options = {}) {
  const uuid = String(match?.[1] ?? "").trim();
  if (!uuid || typeof document === "undefined") return null;
  const explicitLabel = String(match?.[2] ?? "").trim();
  const label = explicitLabel || await templateName(uuid) || localize("PF2E_AFFLICTION_FORGE.Reference.Affliction");
  const sourceUuid = options?.relativeTo?.uuid ?? null;
  const anchor = document.createElement("a");
  anchor.className = "content-link pf2e-affliction-reference-link";
  anchor.dataset.afflictionTemplateUuid = uuid;
  anchor.dataset.uuid = uuid;
  anchor.draggable = true;
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-biohazard";
  anchor.append(icon, document.createTextNode(` ${label}`));
  anchor.title = localize("PF2E_AFFLICTION_FORGE.Reference.DragHint");

  anchor.addEventListener("dragstart", (event) => {
    try {
      const payload = api()?.application?.createDragData?.(uuid, { label, sourceUuid });
      if (payload) writeDragData(event, payload);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not create Affliction reference drag data.`, error);
    }
  });

  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      try {
        if (globalThis.game?.user?.isGM) {
          await api()?.ui?.forge?.open?.({ templateUuid: uuid });
          return;
        }
        const document = typeof globalThis.fromUuid === "function" ? await globalThis.fromUuid(uuid) : null;
        document?.sheet?.render?.(true);
      } catch (error) {
        console.warn(`${MODULE_ID} | Affliction reference could not be opened.`, error);
      }
    })();
  });
  return anchor;
}

export function initializeAfflictionTextIntegration() {
  if (textIntegrationInitialized) return true;
  const enrichers = globalThis.CONFIG?.TextEditor?.enrichers;
  if (!Array.isArray(enrichers)) return false;
  textIntegrationInitialized = true;
  if (enrichers.some((entry) => entry.id === `${MODULE_ID}.reference`)) return true;
  enrichers.push({
    id: `${MODULE_ID}.reference`,
    pattern: /@Affliction\[([^\]]+)\](?:\{([^}]+)\})?/gi,
    enricher: enrichAfflictionReference
  });
  return true;
}

function inferSourceTemplateUuid(document, data = {}) {
  const candidates = [
    data?._stats?.compendiumSource,
    document?._stats?.compendiumSource,
    data?.flags?.core?.sourceId,
    document?.flags?.core?.sourceId
  ].filter((value) => typeof value === "string" && value);
  if (candidates.length > 0) return candidates[0];

  const id = data?._id ?? document?.id ?? null;
  if (id && globalThis.game?.items?.get?.(id)?.uuid) return globalThis.game.items.get(id).uuid;
  return null;
}

function scheduleTemplateApplication({ document, data, options = {} }) {
  const moduleApi = api();
  const actor = document?.parent;
  if (!actor || actor.documentName !== "Actor") return;
  if (!globalThis.game?.user?.isGM) {
    notify("warn", "PF2E_AFFLICTION_FORGE.Reference.GmOnlyApply");
    return;
  }

  const definition = extractAfflictionDefinitionFromItem(document, { normalize: true });
  const flags = getAfflictionFlags(document) ?? {};
  const sourceTemplateUuid = inferSourceTemplateUuid(document, data);
  const sourceDefinitionVersion = Number(flags.definitionVersion ?? 1);
  const schedule = globalThis.queueMicrotask ?? ((callback) => Promise.resolve().then(callback));
  schedule(() => {
    void moduleApi?.engine?.applyDefinition?.(definition, actor, {
      sourceTemplateUuid,
      sourceDefinitionVersion,
      origin: {
        application: "drag-drop-actor-sheet",
        userId: globalThis.game?.user?.id ?? null,
        sourceTemplateUuid
      }
    }).then((result) => {
      const count = result?.created?.length ?? 0;
      if (count > 0) notify("info", "PF2E_AFFLICTION_FORGE.Reference.DropApplied", { name: definition.name });
    }).catch((error) => {
      console.error(`${MODULE_ID} | Dropped Affliction template could not be applied to Actor.`, error);
      notify("error", "PF2E_AFFLICTION_FORGE.Reference.DropFailed");
    });
  });
}

export function interceptEmbeddedAfflictionTemplateCreation(document, data, options = {}) {
  if (options?.[MODULE_ID]?.allowTemplateEmbedding) return;
  if (!document?.parent || document.parent.documentName !== "Actor") return;
  if (!isAfflictionTemplate(document)) return;

  // A template dropped on an Actor is not an inert owned Item. Cancel the
  // ordinary Item creation synchronously, then route the semantic application
  // through the Affliction Engine. Foundry preCreate hooks are cancellable but
  // are not awaited, so the actual application is scheduled separately.
  try {
    scheduleTemplateApplication({ document, data, options });
  } catch (error) {
    console.error(`${MODULE_ID} | Dropped Affliction template could not be prepared for application.`, error);
    notify("error", "PF2E_AFFLICTION_FORGE.Reference.DropFailed");
  }
  return false;
}

async function applyCustomDropToActor(actor, data) {
  const moduleApi = api();
  const parsed = moduleApi?.application?.parseDropData?.(data);
  if (!parsed) return false;
  if (!globalThis.game?.user?.isGM) {
    notify("warn", "PF2E_AFFLICTION_FORGE.Reference.GmOnlyApply");
    return true;
  }
  try {
    await moduleApi.application.applyDropData(data, actor, {
      application: "drag-drop-actor-sheet"
    });
    notify("info", "PF2E_AFFLICTION_FORGE.Reference.DropApplied", { name: parsed.label ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction") });
  } catch (error) {
    console.error(`${MODULE_ID} | Affliction drop on Actor sheet failed.`, error);
    notify("error", "PF2E_AFFLICTION_FORGE.Reference.DropFailed");
  }
  return true;
}

export function handleAfflictionActorSheetDrop(actor, _sheet, data) {
  if (data?.type !== "Affliction" || data?.source !== MODULE_ID) return;
  void applyCustomDropToActor(actor, data);
  return false;
}

function tokenAtCanvasPoint(canvas, x, y) {
  const tokens = [...(canvas?.tokens?.placeables ?? [])].reverse();
  for (const token of tokens) {
    try {
      if (token?.bounds?.contains?.(x, y)) return token;
    } catch {
      // Fall back to rectangular document geometry below.
    }
    const doc = token?.document;
    const gridSize = Number(canvas?.grid?.size ?? canvas?.dimensions?.size ?? 0);
    if (!doc || !Number.isFinite(gridSize) || gridSize <= 0) continue;
    const left = Number(doc.x ?? 0);
    const top = Number(doc.y ?? 0);
    const width = Number(doc.width ?? 1) * gridSize;
    const height = Number(doc.height ?? 1) * gridSize;
    if (x >= left && x <= left + width && y >= top && y <= top + height) return token;
  }
  return null;
}

async function templateUuidFromCanvasDrop(data) {
  const parsed = api()?.application?.parseDropData?.(data);
  if (parsed) return parsed.templateUuid;
  if (data?.type !== "Item") return null;
  const uuid = typeof data.uuid === "string" ? data.uuid : null;
  if (!uuid || typeof globalThis.fromUuid !== "function") return null;
  try {
    const item = await globalThis.fromUuid(uuid);
    return isAfflictionTemplate(item) ? item.uuid : null;
  } catch {
    return null;
  }
}

export function handleAfflictionCanvasDrop(canvas, data, _event) {
  void (async () => {
    const templateUuid = await templateUuidFromCanvasDrop(data);
    if (!templateUuid) return;
    if (!authoritativeGm()) {
      notify("warn", "PF2E_AFFLICTION_FORGE.Reference.GmOnlyApply");
      return;
    }
    const x = Number(data?.x);
    const y = Number(data?.y);
    const token = Number.isFinite(x) && Number.isFinite(y) ? tokenAtCanvasPoint(canvas, x, y) : null;
    if (!token?.actor) {
      notify("warn", "PF2E_AFFLICTION_FORGE.Reference.DropNoToken");
      return;
    }
    try {
      await api()?.application?.apply?.({
        templateUuid,
        targets: token,
        application: "drag-drop-canvas",
        origin: {
          tokenUuid: token.document?.uuid ?? null,
          sceneUuid: canvas?.scene?.uuid ?? null
        }
      });
      notify("info", "PF2E_AFFLICTION_FORGE.Reference.DropApplied", { name: token.actor.name ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction") });
    } catch (error) {
      console.error(`${MODULE_ID} | Affliction drop on Canvas token failed.`, error);
      notify("error", "PF2E_AFFLICTION_FORGE.Reference.DropFailed");
    }
  })();
}

export function initializeAfflictionExternalRuntimeIntegration() {
  if (runtimeIntegrationInitialized) return;
  runtimeIntegrationInitialized = true;
  globalThis.Hooks?.on?.("preCreateItem", interceptEmbeddedAfflictionTemplateCreation);
  globalThis.Hooks?.on?.("dropActorSheetData", handleAfflictionActorSheetDrop);
  globalThis.Hooks?.on?.("dropCanvasData", handleAfflictionCanvasDrop);
}

export { writeDragData };
