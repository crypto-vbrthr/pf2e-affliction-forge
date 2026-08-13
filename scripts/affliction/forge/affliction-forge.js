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

export function injectAfflictionTemplateHeaderControl(application, controls) {
  if (!game.user?.isGM || !Array.isArray(controls)) return;
  const item = itemFromSheetApplication(application);
  if (!item || !game.modules.get(MODULE_ID)?.api?.documents?.isTemplate?.(item)) return;
  if (controls.some((entry) => entry.action === "pf2e-affliction-forge-edit")) return;
  controls.unshift({
    action: "pf2e-affliction-forge-edit",
    label: localize("PF2E_AFFLICTION_FORGE.Forge.EditInForge"),
    icon: "fa-solid fa-biohazard",
    ownership: "OWNER",
    onClick: () => void openAfflictionForge({ templateUuid: item.uuid })
  });
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
  if (!item || !game.modules.get(MODULE_ID)?.api?.documents?.isTemplate?.(item)) return;
  if (buttons.some((entry) => entry.class === "pf2e-affliction-forge-edit")) return;
  buttons.unshift({
    class: "pf2e-affliction-forge-edit",
    label: localize("PF2E_AFFLICTION_FORGE.Forge.EditInForge"),
    icon: "fas fa-biohazard",
    onclick: () => void openAfflictionForge({ templateUuid: item.uuid })
  });
}

export function initializeAfflictionForgeUi() {
  if (initialized) return;
  initialized = true;

  ensureAfflictionForgeStyles();

  Hooks.on("renderItemDirectory", injectAfflictionForgeButton);
  Hooks.on("renderSidebarTab", injectAfflictionForgeButton);
  Hooks.on("getHeaderControlsApplicationV2", injectAfflictionTemplateHeaderControl);
  Hooks.on("getItemSheetHeaderButtons", injectLegacyAfflictionTemplateHeaderButton);
  Hooks.on("deleteItem", handleAfflictionTemplateDeleted);

  const current = document.querySelector("#items, .items-directory");
  if (current) injectAfflictionForgeButton({ tabName: "items" }, current);

  console.info(`${MODULE_ID} | Affliction Forge container and Item sidebar integration initialized.`);
}
