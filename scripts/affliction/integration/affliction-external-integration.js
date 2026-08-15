import { AFFLICTION_DRAG_MIME, MODULE_ID } from "../../constants.js";
import { extractAfflictionDefinitionFromItem } from "../documents/affliction-item-adapter.js";
import { getAfflictionFlags, isAfflictionTemplate } from "../documents/affliction-flags.js";
import { promptSourceDcApplication } from "./source-dc-prompt.js";

let textIntegrationInitialized = false;
let referenceLinkDelegationInitialized = false;
let runtimeIntegrationInitialized = false;

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function api() {
  return globalThis.game?.modules?.get?.(MODULE_ID)?.api ?? null;
}

async function promptSourceDcForTemplate(templateUuid) {
  if (!templateUuid || typeof globalThis.fromUuid !== "function") return {};
  const template = await globalThis.fromUuid(templateUuid);
  if (!template || !isAfflictionTemplate(template)) return {};
  const definition = extractAfflictionDefinitionFromItem(template, { normalize: true });
  return promptSourceDcApplication(definition);
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
  const afflictionJson = JSON.stringify(payload);

  // Keep the module-specific payload in its own MIME type for Affliction Forge
  // drop targets, but advertise a native Foundry Item payload as text/plain.
  // ProseMirror's built-in ContentLink plugin understands Document drag data,
  // so this provides a robust rich-text fallback even if a custom PM plugin is
  // not available in a particular sheet/editor implementation.
  const nativeItemJson = payload.templateUuid
    ? JSON.stringify({ type: "Item", uuid: payload.templateUuid })
    : afflictionJson;

  transfer.setData("text/plain", nativeItemJson);
  try { transfer.setData("application/json", afflictionJson); } catch { /* Browser-dependent */ }
  try { transfer.setData(AFFLICTION_DRAG_MIME, afflictionJson); } catch { /* Browser-dependent */ }
  transfer.effectAllowed = "copy";
  return true;
}


function rootElement(html) {
  if (typeof HTMLElement !== "undefined" && html instanceof HTMLElement) return html;
  if (typeof HTMLElement !== "undefined" && html?.[0] instanceof HTMLElement) return html[0];
  if (typeof HTMLElement !== "undefined" && html?.element instanceof HTMLElement) return html.element;
  return html?.querySelectorAll ? html : null;
}

function isActorDirectory(application, root) {
  const documentName = application?.documentName
    ?? application?.collection?.documentName
    ?? application?.options?.documentName
    ?? "";
  if (String(documentName).toLowerCase() === "actor") return true;
  const tabName = application?.tabName ?? application?.options?.tabName ?? application?.id ?? "";
  if (String(tabName).toLowerCase().includes("actor")) return true;
  return Boolean(root?.matches?.("#actors, .actors-directory") || root?.querySelector?.("#actors, .actors-directory"));
}

function parseTransferJson(transfer) {
  if (!transfer?.getData) return null;
  for (const type of [AFFLICTION_DRAG_MIME, "text/plain", "application/json"]) {
    try {
      const raw = transfer.getData(type);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Ignore unavailable MIME types and non-JSON drag data.
    }
  }
  return null;
}

export function readAfflictionDragEventData(event) {
  const data = parseTransferJson(event?.dataTransfer);
  return api()?.application?.parseDropData?.(data) ?? null;
}

function eventAdvertisesAffliction(event) {
  const types = [...(event?.dataTransfer?.types ?? [])].map((value) => String(value));
  if (types.includes(AFFLICTION_DRAG_MIME)) return true;
  return Boolean(readAfflictionDragEventData(event));
}

export function actorIdFromDirectoryRow(row) {
  const dataset = row?.dataset ?? {};
  return String(dataset.entryId ?? dataset.documentId ?? dataset.actorId ?? "").trim() || null;
}

function directoryActorRow(target, root) {
  const row = target?.closest?.("[data-entry-id], [data-document-id], [data-actor-id], .directory-item.actor");
  if (!row) return null;
  if (root?.contains && !root.contains(row)) return null;
  return row;
}

function clearDirectoryDropHighlight(root) {
  for (const row of root?.querySelectorAll?.(".pf2e-affliction-actor-drop-target") ?? []) {
    row.classList.remove("pf2e-affliction-actor-drop-target");
  }
}

async function applyDirectoryDrop(actor, parsed) {
  if (!actor || !parsed) return false;
  try {
    const sourceDcOptions = await promptSourceDcForTemplate(parsed.templateUuid);
    if (sourceDcOptions === null) return false;
    await api()?.application?.applyDropData?.({
      type: "Affliction",
      source: MODULE_ID,
      templateUuid: parsed.templateUuid,
      uuid: parsed.templateUuid,
      label: parsed.label,
      sourceUuid: parsed.sourceUuid,
      referenceId: parsed.referenceId
    }, actor, {
      ...sourceDcOptions,
      application: "drag-drop-actor-directory"
    });
    notify("info", "PF2E_AFFLICTION_FORGE.Reference.DropApplied", {
      name: parsed.label ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction")
    });
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Affliction drop on Actor Directory entry failed.`, error);
    notify("error", "PF2E_AFFLICTION_FORGE.Reference.DropFailed");
    return false;
  }
}

export function installAfflictionActorDirectoryDropTargets(application, html) {
  if (!globalThis.game?.user?.isGM) return false;
  const root = rootElement(html);
  if (!root || !isActorDirectory(application, root)) return false;
  if (root.dataset?.afflictionForgeActorDirectoryDrop === "true") return true;
  if (root.dataset) root.dataset.afflictionForgeActorDirectoryDrop = "true";

  root.addEventListener?.("dragover", (event) => {
    if (!eventAdvertisesAffliction(event)) return;
    const row = directoryActorRow(event.target, root);
    if (!row || !actorIdFromDirectoryRow(row)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    clearDirectoryDropHighlight(root);
    row.classList?.add?.("pf2e-affliction-actor-drop-target");
  }, true);

  root.addEventListener?.("dragleave", (event) => {
    const row = directoryActorRow(event.target, root);
    if (!row) return;
    const related = event.relatedTarget;
    if (related && row.contains?.(related)) return;
    row.classList?.remove?.("pf2e-affliction-actor-drop-target");
  }, true);

  root.addEventListener?.("dragend", () => clearDirectoryDropHighlight(root), true);

  root.addEventListener?.("drop", (event) => {
    const parsed = readAfflictionDragEventData(event);
    if (!parsed) return;
    const row = directoryActorRow(event.target, root);
    const actorId = actorIdFromDirectoryRow(row);
    const actor = actorId ? globalThis.game?.actors?.get?.(actorId) : null;
    if (!actor) return;

    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    clearDirectoryDropHighlight(root);
    void applyDirectoryDrop(actor, parsed);
  }, true);

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

export async function openAfflictionReferenceTemplate(uuid) {
  const normalizedUuid = String(uuid ?? "").trim();
  if (!normalizedUuid) return false;
  try {
    if (globalThis.game?.user?.isGM) {
      await api()?.ui?.forge?.open?.({ templateUuid: normalizedUuid });
      return true;
    }
    const referencedDocument = typeof globalThis.fromUuid === "function" ? await globalThis.fromUuid(normalizedUuid) : null;
    referencedDocument?.sheet?.render?.(true);
    return Boolean(referencedDocument);
  } catch (error) {
    console.warn(`${MODULE_ID} | Affliction reference could not be opened.`, error);
    return false;
  }
}

export async function handleAfflictionReferenceLinkClick(event) {
  const anchor = event?.target?.closest?.(".pf2e-affliction-reference-link");
  if (!anchor) return false;
  const uuid = String(anchor.dataset?.afflictionTemplateUuid ?? anchor.dataset?.uuid ?? "").trim();
  if (!uuid) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  await openAfflictionReferenceTemplate(uuid);
  return true;
}

export function handleAfflictionReferenceLinkDragStart(event) {
  const anchor = event?.target?.closest?.(".pf2e-affliction-reference-link");
  if (!anchor) return false;
  const uuid = String(anchor.dataset?.afflictionTemplateUuid ?? anchor.dataset?.uuid ?? "").trim();
  if (!uuid) return false;
  const label = String(anchor.dataset?.afflictionLabel ?? anchor.textContent ?? "").trim();
  const sourceUuid = String(anchor.dataset?.afflictionSourceUuid ?? "").trim() || null;
  try {
    const payload = api()?.application?.createDragData?.(uuid, { label, sourceUuid });
    return payload ? writeDragData(event, payload) : false;
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not create Affliction reference drag data.`, error);
    return false;
  }
}

function initializeAfflictionReferenceLinkDelegation() {
  if (referenceLinkDelegationInitialized) return true;
  const doc = globalThis.document;
  if (!doc?.addEventListener) return false;
  referenceLinkDelegationInitialized = true;
  // Enriched HTML can be serialized and reconstructed by Foundry before it is
  // inserted into Chat or a sheet. Element-local listeners do not survive that
  // round-trip, while data attributes do. Delegated handlers therefore make
  // Affliction links reliable in ChatMessages, journals, and sheet descriptions.
  doc.addEventListener("click", (event) => { void handleAfflictionReferenceLinkClick(event); });
  doc.addEventListener("dragstart", (event) => { handleAfflictionReferenceLinkDragStart(event); });
  return true;
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
  anchor.dataset.afflictionLabel = label;
  if (sourceUuid) anchor.dataset.afflictionSourceUuid = sourceUuid;
  anchor.draggable = true;
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-biohazard";
  anchor.append(icon, document.createTextNode(` ${label}`));
  anchor.title = `${localize("PF2E_AFFLICTION_FORGE.Reference.OpenTemplate")} · ${localize("PF2E_AFFLICTION_FORGE.Reference.DragHint")}`;
  anchor.setAttribute("aria-label", `${label}: ${localize("PF2E_AFFLICTION_FORGE.Reference.OpenTemplate")}`);
  return anchor;
}

export function initializeAfflictionTextIntegration() {
  initializeAfflictionReferenceLinkDelegation();
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
    void (async () => {
      const sourceDcOptions = await promptSourceDcApplication(definition);
      if (sourceDcOptions === null) return null;
      return moduleApi?.engine?.applyDefinition?.(definition, actor, {
        ...sourceDcOptions,
        sourceTemplateUuid,
      sourceDefinitionVersion,
      origin: {
        application: "drag-drop-actor-sheet",
        userId: globalThis.game?.user?.id ?? null,
        sourceTemplateUuid
      }
      });
    })().then((result) => {
      if (!result) return;
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
    const sourceDcOptions = await promptSourceDcForTemplate(parsed.templateUuid);
    if (sourceDcOptions === null) return true;
    await moduleApi.application.applyDropData(data, actor, {
      ...sourceDcOptions,
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
      const sourceDcOptions = await promptSourceDcForTemplate(templateUuid);
      if (sourceDcOptions === null) return;
      await api()?.application?.apply?.({
        ...sourceDcOptions,
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
  globalThis.Hooks?.on?.("renderActorDirectory", installAfflictionActorDirectoryDropTargets);
  globalThis.Hooks?.on?.("renderSidebarTab", installAfflictionActorDirectoryDropTargets);

  const currentActors = globalThis.document?.querySelector?.("#actors, .actors-directory");
  if (currentActors) installAfflictionActorDirectoryDropTargets({ tabName: "actors", documentName: "Actor" }, currentActors);
}

export { writeDragData };
