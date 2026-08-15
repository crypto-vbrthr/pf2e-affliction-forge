import { MODULE_ID } from "../../constants.js";
import {
  getAfflictionFlags,
  isAfflictionController,
  isAfflictionResidualEffect,
  isAfflictionStageEffect
} from "../documents/affliction-flags.js";

let initialized = false;

function itemCollection(actor) {
  if (!actor?.items) return [];
  if (Array.isArray(actor.items)) return actor.items;
  try { return [...actor.items]; } catch { return []; }
}

function rootElement(html) {
  if (!html) return null;
  if (globalThis.HTMLElement && html instanceof HTMLElement) return html;
  if (globalThis.HTMLElement && html?.[0] instanceof HTMLElement) return html[0];
  if (globalThis.HTMLElement && html?.element instanceof HTMLElement) return html.element;
  return html?.querySelectorAll ? html : null;
}

function actorFromApplication(application) {
  const candidate = application?.actor
    ?? application?.document
    ?? application?.object
    ?? application?.token?.actor
    ?? null;
  if (candidate?.documentName === "Actor") return candidate;
  if (candidate?.parent?.documentName === "Actor") return candidate.parent;
  return null;
}

function itemFromApplication(application) {
  const candidate = application?.document ?? application?.item ?? application?.object ?? null;
  return candidate?.documentName === "Item" ? candidate : null;
}

export function concealedAfflictionItemIds(actor) {
  const items = itemCollection(actor);
  const controllerStates = new Map();
  const concealed = new Set();

  for (const item of items) {
    if (!isAfflictionController(item)) continue;
    const flags = getAfflictionFlags(item);
    const identification = flags?.state?.identification?.state ?? "identified";
    controllerStates.set(flags?.instanceId ?? flags?.state?.instanceId, identification);
    if (identification === "hidden") concealed.add(item.id);
  }

  for (const item of items) {
    if (!isAfflictionStageEffect(item) && !isAfflictionResidualEffect(item)) continue;
    const flags = getAfflictionFlags(item);
    const identification = controllerStates.get(flags?.instanceId) ?? "identified";
    if (identification !== "identified") concealed.add(item.id);
  }

  return concealed;
}

function nodeDocumentId(node) {
  const values = [
    node?.dataset?.itemId,
    node?.dataset?.entryId,
    node?.dataset?.documentId,
    node?.dataset?.id
  ].filter(Boolean);
  for (const value of values) return String(value);

  const uuid = String(node?.dataset?.itemUuid ?? node?.dataset?.uuid ?? "");
  const match = uuid.match(/\.Item\.([^\.]+)$/);
  return match?.[1] ?? null;
}

export function scrubAfflictionPlayerVisibility(application, html) {
  if (globalThis.game?.user?.isGM) return false;
  const actor = actorFromApplication(application);
  const root = rootElement(html);
  if (!actor || !root) return false;

  const concealed = concealedAfflictionItemIds(actor);
  if (concealed.size === 0) return false;

  const candidates = root.querySelectorAll(
    "[data-item-id], [data-entry-id], [data-document-id], [data-id], [data-item-uuid], [data-uuid]"
  );
  let changed = false;
  for (const node of candidates) {
    const id = nodeDocumentId(node);
    if (!id || !concealed.has(id)) continue;
    node.hidden = true;
    if (node.style) node.style.display = "none";
    node.setAttribute?.(`data-${MODULE_ID}-concealed`, "");
    changed = true;
  }
  return changed;
}

export function guardRestrictedAfflictionItemSheet(application) {
  if (globalThis.game?.user?.isGM) return false;
  const item = itemFromApplication(application);
  if (!item?.parent || item.parent.documentName !== "Actor") return false;

  if (isAfflictionController(item)) {
    const state = getAfflictionFlags(item)?.state;
    if (state?.identification?.state !== "hidden") return false;
  } else if (isAfflictionStageEffect(item) || isAfflictionResidualEffect(item)) {
    const flags = getAfflictionFlags(item);
    const controllers = itemCollection(item.parent).filter(isAfflictionController);
    const controller = controllers.find((entry) => {
      const controllerFlags = getAfflictionFlags(entry);
      return (controllerFlags?.instanceId ?? controllerFlags?.state?.instanceId) === flags?.instanceId;
    });
    if ((getAfflictionFlags(controller)?.state?.identification?.state ?? "identified") === "identified") return false;
  } else {
    return false;
  }

  void application?.close?.({ force: true });
  return true;
}

export function initializeAfflictionVisibilityRuntime() {
  if (initialized) return;
  initialized = true;

  // Keep hidden Afflictions out of player-facing Actor sheets without changing
  // Actor ownership or the runtime documents the authoritative GM needs.
  const handleRender = (application, html) => {
    scrubAfflictionPlayerVisibility(application, html);
    guardRestrictedAfflictionItemSheet(application);
  };
  Hooks.on("renderApplicationV2", handleRender);
  Hooks.on("renderApplication", handleRender);

  console.info(`${MODULE_ID} | Affliction identification visibility runtime initialized.`);
}
