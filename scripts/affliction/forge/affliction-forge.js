import { MODULE_ID, MODULE_VERSION } from "../../constants.js";
import { AfflictionForgeApp } from "./affliction-forge-app.js";

let app = null;
let initialized = false;

export function ensureAfflictionForgeStyles() {
  if (!globalThis.document?.head) return null;

  const basePath = `modules/${MODULE_ID}/styles/affliction-forge.css`;
  const versionedHref = `${basePath}?v=${encodeURIComponent(MODULE_VERSION)}`;
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
  let link = links.find((entry) => String(entry.getAttribute("href") ?? entry.href ?? "").includes(basePath));

  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.afflictionForgeStyles = MODULE_VERSION;
    document.head.append(link);
  }

  const current = String(link.getAttribute("href") ?? "");
  if (current !== versionedHref) link.setAttribute("href", versionedHref);
  link.dataset.afflictionForgeStyles = MODULE_VERSION;
  return link;
}

function localize(key) {
  return game.i18n.localize(key);
}

export async function openAfflictionForge(options = {}) {
  if (!game.user?.isGM) {
    ui.notifications.warn(localize("PF2E_AFFLICTION_FORGE.Forge.GmOnly"));
    return null;
  }

  const isNew = !app;
  app ??= new AfflictionForgeApp(options);
  if (options.templateUuid) app.viewMode = "templates";
  else if (["templates", "active"].includes(options.view)) app.viewMode = options.view;
  if (options.templateUuid) {
    const opened = await app.openTemplate(options.templateUuid, {
      confirmDiscard: !isNew,
      render: false
    });
    if (!opened && !isNew) return app;
  }
  await app.render({ force: true });
  app.bringToFront?.();
  return app;
}

function getRoot(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element instanceof HTMLElement) return html.element;
  return null;
}

function isItemDirectory(appRef, root) {
  const tabName = appRef?.tabName ?? appRef?.options?.tabName ?? appRef?.id ?? "";
  if (String(tabName).toLowerCase().includes("item")) return true;
  return Boolean(root?.matches?.("#items, .items-directory") || root?.querySelector?.("#items, .items-directory"));
}

export function injectAfflictionForgeButton(appRef, html) {
  if (!game.user?.isGM) return false;

  const root = getRoot(html);
  if (!root || !isItemDirectory(appRef, root)) return false;
  if (root.querySelector(`[data-${MODULE_ID}-button]`)) return true;

  const selectors = [
    ".directory-header .header-actions",
    ".directory-header .action-buttons",
    ".directory-header",
    ".header-actions",
    "header"
  ];

  const target = selectors.map((selector) => root.querySelector(selector)).find(Boolean);
  if (!target) {
    console.debug(`${MODULE_ID} | No suitable Item Directory button target found.`, root);
    return false;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(`data-${MODULE_ID}-button`, "");
  button.className = "pf2e-affliction-forge-open";
  button.innerHTML = `<i class="fa-solid fa-biohazard"></i> ${localize("PF2E_AFFLICTION_FORGE.Forge.Open")}`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openAfflictionForge();
  });
  target.append(button);
  return true;
}


function itemFromSheetApplication(application) {
  const document = application?.document ?? application?.item ?? application?.object ?? null;
  return document?.documentName === "Item" || document?.constructor?.documentName === "Item" ? document : null;
}

function actorFromSheetApplication(application) {
  const candidate = application?.actor
    ?? (application?.document?.documentName === "Actor" ? application.document : null)
    ?? (application?.object?.documentName === "Actor" ? application.object : null)
    ?? application?.token?.actor
    ?? null;
  return candidate?.documentName === "Actor" ? candidate : null;
}

export function injectAfflictionTemplateHeaderControl(application, controls) {
  if (!game.user?.isGM || !Array.isArray(controls)) return;
  const item = itemFromSheetApplication(application);
  if (!item) return;
  const api = game.modules.get(MODULE_ID)?.api;

  if (api?.documents?.isTemplate?.(item)) {
    if (controls.some((entry) => entry.action === "pf2e-affliction-forge-edit")) return;
    controls.unshift({
      action: "pf2e-affliction-forge-edit",
      label: localize("PF2E_AFFLICTION_FORGE.Forge.EditInForge"),
      icon: "fa-solid fa-biohazard",
      ownership: "OWNER",
      onClick: () => void openAfflictionForge({ templateUuid: item.uuid })
    });
    return;
  }

  if (api?.documents?.isController?.(item)) {
    if (controls.some((entry) => entry.action === "pf2e-affliction-forge-manage")) return;
    controls.unshift({
      action: "pf2e-affliction-forge-manage",
      label: localize("PF2E_AFFLICTION_FORGE.Runtime.Manage"),
      icon: "fa-solid fa-biohazard",
      ownership: "OWNER",
      onClick: () => void api.ui.controller.open(item)
    });
  }
}

export function handleAfflictionTemplateDeleted(item) {
  const api = game.modules.get(MODULE_ID)?.api;
  if (!api?.documents?.isTemplate?.(item)) return false;
  if (!app) return true;

  void app.handleTemplateDeleted(item).catch((error) => {
    console.error(`${MODULE_ID} | Failed to synchronize deleted Affliction template.`, error);
  });
  return true;
}

export function injectLegacyAfflictionTemplateHeaderButton(sheet, buttons) {
  if (!game.user?.isGM || !Array.isArray(buttons)) return;
  const item = itemFromSheetApplication(sheet);
  if (!item) return;
  const api = game.modules.get(MODULE_ID)?.api;

  if (api?.documents?.isTemplate?.(item)) {
    if (buttons.some((entry) => entry.class === "pf2e-affliction-forge-edit")) return;
    buttons.unshift({
      class: "pf2e-affliction-forge-edit",
      label: localize("PF2E_AFFLICTION_FORGE.Forge.EditInForge"),
      icon: "fas fa-biohazard",
      onclick: () => void openAfflictionForge({ templateUuid: item.uuid })
    });
    return;
  }

  if (api?.documents?.isController?.(item)) {
    if (buttons.some((entry) => entry.class === "pf2e-affliction-forge-manage")) return;
    buttons.unshift({
      class: "pf2e-affliction-forge-manage",
      label: localize("PF2E_AFFLICTION_FORGE.Runtime.Manage"),
      icon: "fas fa-biohazard",
      onclick: () => void api.ui.controller.open(item)
    });
  }
}

export function injectAfflictionControllerRowControls(application, html) {
  if (!game.user?.isGM) return false;
  const actor = actorFromSheetApplication(application);
  const root = getRoot(html);
  if (!actor || !root?.querySelectorAll) return false;
  const api = game.modules.get(MODULE_ID)?.api;
  const controllers = [...(actor.items ?? [])].filter((item) => api?.documents?.isController?.(item));
  if (controllers.length === 0) return false;

  let changed = false;
  for (const controller of controllers) {
    const candidates = [...root.querySelectorAll("[data-item-id]")].filter((node) => String(node.dataset?.itemId ?? "") === String(controller.id));
    for (const node of candidates) {
      const row = node.closest?.("li.item, article.item, .item, [data-item-id]") ?? node;
      if (row.querySelector?.(`[data-${MODULE_ID}-inline-manage="${controller.id}"]`)) continue;
      const controls = row.querySelector?.(".item-controls, .controls, .item-actions, .item-buttons, [data-item-controls]");
      if (!(controls instanceof HTMLElement)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "icon pf2e-affliction-inline-manage";
      button.setAttribute(`data-${MODULE_ID}-inline-manage`, controller.id);
      button.title = localize("PF2E_AFFLICTION_FORGE.Runtime.Manage");
      button.innerHTML = '<i class="fa-solid fa-biohazard"></i>';
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void api.ui.controller.open(controller);
      });
      controls.prepend(button);
      changed = true;
      break;
    }
  }
  return changed;
}

export function handleActiveAfflictionChanged(item) {
  const api = game.modules.get(MODULE_ID)?.api;
  if (!api?.documents?.isController?.(item)) return false;
  if (!app) return true;
  void app.handleActiveAfflictionsChanged().catch((error) => {
    console.error(`${MODULE_ID} | Failed to refresh Active Afflictions registry.`, error);
  });
  return true;
}

function authoritativeRuntimeClient() {
  if (!game.user?.isGM) return false;
  const activeGM = game.users?.activeGM;
  return !activeGM?.id || activeGM.id === game.user.id;
}

export function handleAfflictionRuntimeItemDeleted(item, options = {}) {
  const api = game.modules.get(MODULE_ID)?.api;
  if (api?.documents?.isController?.(item)) {
    if (!authoritativeRuntimeClient()) return true;
    void api.instances.cleanupDeletedController(item).catch((error) => {
      console.error(`${MODULE_ID} | Failed to clean orphaned Affliction stage effects.`, error);
    });
    return true;
  }

  if (!api?.documents?.isStageEffect?.(item)) return false;
  const internal = options?.[MODULE_ID] ?? {};
  if (internal.afflictionStageCleanup || internal.afflictionStageRollback || internal.orphanCleanup || internal.afflictionReconcile) return true;
  if (!authoritativeRuntimeClient()) return true;

  const controllerUuid = api.documents.inspect?.(item)?.controllerUuid
    ?? item.flags?.[MODULE_ID]?.controllerUuid
    ?? null;
  if (!controllerUuid) return true;

  // A generated stage Item is controller-owned. Manual deletion is treated as
  // runtime drift and repaired without re-running instant effects.
  void api.instances.reconcile(controllerUuid).catch((error) => {
    console.warn(`${MODULE_ID} | Deleted Affliction stage effect could not be reconciled.`, error);
  });
  return true;
}


export function handleAfflictionLibrariesChanged() {
  if (!app) return true;
  void app.handleLibrariesChanged().catch((error) => {
    console.error(`${MODULE_ID} | Failed to refresh Affliction libraries after provider change.`, error);
  });
  return true;
}

export function initializeAfflictionForgeUi() {
  if (initialized) return;
  initialized = true;

  ensureAfflictionForgeStyles();

  Hooks.on("renderItemDirectory", injectAfflictionForgeButton);
  Hooks.on("renderSidebarTab", injectAfflictionForgeButton);
  Hooks.on("getHeaderControlsApplicationV2", injectAfflictionTemplateHeaderControl);
  Hooks.on("getItemSheetHeaderButtons", injectLegacyAfflictionTemplateHeaderButton);
  Hooks.on("renderApplicationV2", injectAfflictionControllerRowControls);
  Hooks.on("renderApplication", injectAfflictionControllerRowControls);
  Hooks.on("createItem", handleActiveAfflictionChanged);
  Hooks.on("updateItem", handleActiveAfflictionChanged);
  Hooks.on("deleteItem", handleActiveAfflictionChanged);
  Hooks.on("deleteItem", handleAfflictionTemplateDeleted);
  Hooks.on("deleteItem", handleAfflictionRuntimeItemDeleted);
  Hooks.on("pf2eAfflictionForgeLibrariesChanged", handleAfflictionLibrariesChanged);

  const current = document.querySelector("#items, .items-directory");
  if (current) injectAfflictionForgeButton({ tabName: "items" }, current);

  console.info(`${MODULE_ID} | Affliction Forge container and Item sidebar integration initialized.`);
}
