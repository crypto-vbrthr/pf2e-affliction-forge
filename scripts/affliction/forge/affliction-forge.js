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

  app ??= new AfflictionForgeApp(options);
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

export function initializeAfflictionForgeUi() {
  if (initialized) return;
  initialized = true;

  ensureAfflictionForgeStyles();

  Hooks.on("renderItemDirectory", injectAfflictionForgeButton);
  Hooks.on("renderSidebarTab", injectAfflictionForgeButton);

  const current = document.querySelector("#items, .items-directory");
  if (current) injectAfflictionForgeButton({ tabName: "items" }, current);

  console.info(`${MODULE_ID} | Affliction Forge container and Item sidebar integration initialized.`);
}
