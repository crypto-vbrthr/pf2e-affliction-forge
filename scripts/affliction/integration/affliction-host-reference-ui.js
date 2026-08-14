import { MODULE_ID } from "../../constants.js";
import {
  afflictionReferenceHostDefaults,
  createAfflictionReference,
  isAfflictionReferenceHostItem,
  readAfflictionReferences
} from "./affliction-reference-service.js";
import { readAfflictionDragEventData } from "./affliction-external-integration.js";

const DROP_HIGHLIGHT = "pf2e-affliction-reference-drop-target";
const PANEL_CLASS = "pf2e-affliction-reference-panel";
const ACTOR_SHEET_BOUND = "afflictionForgeReferenceDropBound";

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function format(key, data = {}) {
  return globalThis.game?.i18n?.format?.(key, data) ?? localize(key);
}

function api() {
  return globalThis.game?.modules?.get?.(MODULE_ID)?.api ?? null;
}

function rootElement(html) {
  if (typeof HTMLElement !== "undefined" && html instanceof HTMLElement) return html;
  if (typeof HTMLElement !== "undefined" && html?.[0] instanceof HTMLElement) return html[0];
  if (typeof HTMLElement !== "undefined" && html?.element instanceof HTMLElement) return html.element;
  return html?.querySelectorAll ? html : null;
}

function itemDocument(application) {
  const candidate = application?.document ?? application?.item ?? application?.object ?? null;
  return candidate?.documentName === "Item" ? candidate : null;
}

function actorDocument(application) {
  const candidate = application?.document ?? application?.actor ?? application?.object ?? null;
  return candidate?.documentName === "Actor" ? candidate : null;
}

function canEditItem(item) {
  if (!globalThis.game?.user?.isGM || !item) return false;
  if (item.isOwner === false) return false;
  const packId = typeof item.pack === "string" ? item.pack : item.compendium?.collection ?? null;
  if (!packId) return true;
  const pack = globalThis.game?.packs?.get?.(packId) ?? item.compendium ?? null;
  return pack?.locked !== true;
}

function optionLabel(kind, value) {
  const key = kind === "trigger"
    ? `PF2E_AFFLICTION_FORGE.Reference.Trigger.${value}`
    : `PF2E_AFFLICTION_FORGE.Reference.Application.${value}`;
  return localize(key);
}

function selectFor({ name, values, selected, disabled = false, kind }) {
  const select = document.createElement("select");
  select.name = name;
  select.disabled = disabled;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = optionLabel(kind, value);
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

async function templateLabel(uuid, fallback = null) {
  if (fallback) return fallback;
  try {
    const template = typeof globalThis.fromUuid === "function" ? await globalThis.fromUuid(uuid) : null;
    return template?.name ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction");
  } catch {
    return localize("PF2E_AFFLICTION_FORGE.Reference.Affliction");
  }
}

function makeReferenceDialogContent({ trigger, application }) {
  const root = document.createElement("div");
  const wrapper = document.createElement("div");
  wrapper.className = "pf2e-affliction-reference-config-dialog";

  const triggerLabel = document.createElement("label");
  const triggerText = document.createElement("span");
  triggerText.textContent = localize("PF2E_AFFLICTION_FORGE.Reference.TriggerLabel");
  triggerLabel.append(triggerText, selectFor({
    name: "trigger",
    values: api()?.catalogs?.referenceTriggers?.() ?? [],
    selected: trigger,
    kind: "trigger"
  }));

  const applicationLabel = document.createElement("label");
  const applicationText = document.createElement("span");
  applicationText.textContent = localize("PF2E_AFFLICTION_FORGE.Reference.ApplicationLabel");
  applicationLabel.append(applicationText, selectFor({
    name: "application",
    values: api()?.catalogs?.referenceApplicationModes?.() ?? [],
    selected: application,
    kind: "application"
  }));

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = localize("PF2E_AFFLICTION_FORGE.Reference.HostPolicyHint");

  wrapper.append(triggerLabel, applicationLabel, hint);
  root.append(wrapper);
  return root;
}

async function promptReferenceConfiguration(item, parsed) {
  const moduleApi = api();
  if (!moduleApi || !item || !parsed) return null;
  const defaults = afflictionReferenceHostDefaults(item);
  if (!defaults.eligible) return null;

  const existing = readAfflictionReferences(item).find((reference) => reference.templateUuid === parsed.templateUuid) ?? null;
  const label = await templateLabel(parsed.templateUuid, parsed.label ?? existing?.label ?? null);
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  const initial = {
    trigger: existing?.trigger ?? defaults.trigger,
    application: existing?.application ?? defaults.application
  };

  let values = initial;
  if (DialogV2?.input) {
    const form = await DialogV2.input({
      window: {
        title: format("PF2E_AFFLICTION_FORGE.Reference.AttachTitle", { item: item.name ?? "" })
      },
      content: makeReferenceDialogContent(initial),
      ok: { label: localize("PF2E_AFFLICTION_FORGE.Reference.Attach") },
      modal: true,
      rejectClose: false
    });
    if (!form) return null;
    values = {
      trigger: String(form.trigger ?? initial.trigger),
      application: String(form.application ?? initial.application)
    };
  }

  return createAfflictionReference({
    id: existing?.id,
    templateUuid: parsed.templateUuid,
    label,
    trigger: values.trigger,
    application: values.application,
    enabled: existing?.enabled ?? true,
    metadata: existing?.metadata ?? {}
  });
}

async function attachDroppedReference(item, parsed, { application = null } = {}) {
  if (!canEditItem(item)) return false;
  const reference = await promptReferenceConfiguration(item, parsed);
  if (!reference) return false;
  await api()?.references?.add?.(item, reference);
  globalThis.ui?.notifications?.info?.(format("PF2E_AFFLICTION_FORGE.Reference.Attached", {
    affliction: reference.label ?? localize("PF2E_AFFLICTION_FORGE.Reference.Affliction"),
    item: item.name ?? ""
  }));
  try { await application?.render?.({ force: true }); } catch { application?.render?.(true); }
  item.actor?.sheet?.render?.(false);
  item.parent?.sheet?.render?.(false);
  return true;
}

async function updateReference(item, referenceId, changes = {}, application = null) {
  const references = readAfflictionReferences(item);
  const index = references.findIndex((entry) => entry.id === referenceId);
  if (index < 0) return false;
  references[index] = createAfflictionReference({ ...references[index], ...changes, id: referenceId });
  await api()?.references?.set?.(item, references);
  try { await application?.render?.({ force: true }); } catch { application?.render?.(true); }
  return true;
}

async function removeReference(item, referenceId, application = null) {
  await api()?.references?.remove?.(item, referenceId);
  try { await application?.render?.({ force: true }); } catch { application?.render?.(true); }
  item.actor?.sheet?.render?.(false);
  item.parent?.sheet?.render?.(false);
}

async function openReferenceTemplate(reference) {
  if (!reference?.templateUuid) return;
  if (globalThis.game?.user?.isGM) {
    await api()?.ui?.forge?.open?.({ templateUuid: reference.templateUuid });
    return;
  }
  const template = typeof globalThis.fromUuid === "function" ? await globalThis.fromUuid(reference.templateUuid) : null;
  template?.sheet?.render?.(true);
}

function panelMountTarget(root) {
  if (!root) return null;
  if (root.matches?.("form")) return root;
  return root.querySelector?.("form .sheet-body, form, .sheet-body, .window-content") ?? root;
}

async function renderItemReferencePanel(application, html) {
  const item = itemDocument(application);
  if (!item || !isAfflictionReferenceHostItem(item)) return false;
  const root = rootElement(html);
  if (!root || typeof document === "undefined") return false;

  root.querySelector?.(`.${PANEL_CLASS}`)?.remove?.();
  const mount = panelMountTarget(root);
  if (!mount) return false;

  const editable = canEditItem(item);
  const references = readAfflictionReferences(item);
  const moduleApi = api();
  const triggerValues = moduleApi?.catalogs?.referenceTriggers?.() ?? [];
  const applicationValues = moduleApi?.catalogs?.referenceApplicationModes?.() ?? [];

  const panel = document.createElement("section");
  panel.className = PANEL_CLASS;
  panel.dataset.afflictionReferenceHost = item.uuid ?? item.id ?? "";

  const header = document.createElement("header");
  const title = document.createElement("h3");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-biohazard";
  title.append(icon, document.createTextNode(` ${localize("PF2E_AFFLICTION_FORGE.Reference.HostSection")}`));
  const summary = document.createElement("span");
  summary.className = "pf2e-affliction-reference-count";
  summary.textContent = format("PF2E_AFFLICTION_FORGE.Reference.Count", { count: references.length });
  header.append(title, summary);

  const list = document.createElement("div");
  list.className = "pf2e-affliction-reference-list";
  if (references.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint pf2e-affliction-reference-empty";
    empty.textContent = localize("PF2E_AFFLICTION_FORGE.Reference.HostEmpty");
    list.append(empty);
  }

  for (const reference of references) {
    const row = document.createElement("div");
    row.className = "pf2e-affliction-reference-row";
    row.dataset.referenceId = reference.id;

    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "pf2e-affliction-reference-open";
    const refIcon = document.createElement("i");
    refIcon.className = "fa-solid fa-biohazard";
    const label = await templateLabel(reference.templateUuid, reference.label);
    nameButton.append(refIcon, document.createTextNode(` ${label}`));
    nameButton.title = localize("PF2E_AFFLICTION_FORGE.Reference.OpenTemplate");
    nameButton.addEventListener("click", () => void openReferenceTemplate(reference));

    const trigger = selectFor({
      name: "trigger",
      values: triggerValues,
      selected: reference.trigger,
      disabled: !editable,
      kind: "trigger"
    });
    trigger.title = localize("PF2E_AFFLICTION_FORGE.Reference.TriggerLabel");
    trigger.addEventListener("change", () => void updateReference(item, reference.id, { trigger: trigger.value }, application));

    const applicationMode = selectFor({
      name: "application",
      values: applicationValues,
      selected: reference.application,
      disabled: !editable,
      kind: "application"
    });
    applicationMode.title = localize("PF2E_AFFLICTION_FORGE.Reference.ApplicationLabel");
    applicationMode.addEventListener("change", () => void updateReference(item, reference.id, { application: applicationMode.value }, application));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon fa-solid fa-trash pf2e-affliction-reference-remove";
    remove.disabled = !editable;
    remove.title = localize("PF2E_AFFLICTION_FORGE.Reference.Remove");
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => void removeReference(item, reference.id, application));

    row.append(nameButton, trigger, applicationMode, remove);
    list.append(row);
  }

  const drop = document.createElement("div");
  drop.className = "pf2e-affliction-reference-drop-zone";
  if (!editable) drop.classList.add("is-readonly");
  const dropIcon = document.createElement("i");
  dropIcon.className = "fa-solid fa-biohazard";
  const dropText = document.createElement("span");
  dropText.textContent = editable
    ? localize("PF2E_AFFLICTION_FORGE.Reference.DropOnHost")
    : localize("PF2E_AFFLICTION_FORGE.Reference.ReadOnlyHost");
  drop.append(dropIcon, dropText);

  if (editable) {
    drop.addEventListener("dragover", (event) => {
      if (!readAfflictionDragEventData(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      drop.classList.add("is-dragover");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
    drop.addEventListener("drop", (event) => {
      const parsed = readAfflictionDragEventData(event);
      if (!parsed) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      drop.classList.remove("is-dragover");
      void attachDroppedReference(item, parsed, { application });
    });
  }

  panel.append(header, list, drop);
  mount.append(panel);
  return true;
}

function actorItemRow(target, root) {
  const row = target?.closest?.("[data-item-id]");
  if (!row) return null;
  if (root?.contains && !root.contains(row)) return null;
  return row;
}

function actorItemFromRow(actor, row) {
  const itemId = String(row?.dataset?.itemId ?? "").trim();
  return itemId ? actor?.items?.get?.(itemId) ?? null : null;
}

function clearActorReferenceHighlights(root) {
  for (const element of root?.querySelectorAll?.(`.${DROP_HIGHLIGHT}`) ?? []) {
    element.classList.remove(DROP_HIGHLIGHT);
  }
}

function decorateActorReferenceRows(actor, root) {
  for (const row of root?.querySelectorAll?.("[data-item-id]") ?? []) {
    const item = actorItemFromRow(actor, row);
    if (!isAfflictionReferenceHostItem(item)) continue;
    const count = readAfflictionReferences(item).length;
    row.querySelector?.(".pf2e-affliction-reference-badge")?.remove?.();
    if (count <= 0 || typeof document === "undefined") continue;
    const badge = document.createElement("span");
    badge.className = "pf2e-affliction-reference-badge";
    badge.title = format("PF2E_AFFLICTION_FORGE.Reference.HostBadge", { count });
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-biohazard";
    badge.append(icon, document.createTextNode(` ${count}`));
    const controls = row.querySelector?.(".item-controls, .controls, .item-name, .name") ?? row;
    controls.append?.(badge);
  }
}

export function installAfflictionActorSheetReferenceDropTargets(application, html) {
  if (!globalThis.game?.user?.isGM) return false;
  const actor = actorDocument(application);
  const root = rootElement(html);
  if (!actor || !root) return false;

  decorateActorReferenceRows(actor, root);
  if (root.dataset?.[ACTOR_SHEET_BOUND] === "true") return true;
  if (root.dataset) root.dataset[ACTOR_SHEET_BOUND] = "true";

  root.addEventListener?.("dragover", (event) => {
    const parsed = readAfflictionDragEventData(event);
    if (!parsed) return;
    const row = actorItemRow(event.target, root);
    const item = actorItemFromRow(actor, row);
    if (!row || !isAfflictionReferenceHostItem(item) || !canEditItem(item)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    clearActorReferenceHighlights(root);
    row.classList?.add?.(DROP_HIGHLIGHT);
  }, true);

  root.addEventListener?.("dragleave", (event) => {
    const row = actorItemRow(event.target, root);
    if (!row) return;
    const related = event.relatedTarget;
    if (related && row.contains?.(related)) return;
    row.classList?.remove?.(DROP_HIGHLIGHT);
  }, true);

  root.addEventListener?.("dragend", () => clearActorReferenceHighlights(root), true);

  root.addEventListener?.("drop", (event) => {
    const parsed = readAfflictionDragEventData(event);
    if (!parsed) return;
    const row = actorItemRow(event.target, root);
    const item = actorItemFromRow(actor, row);
    if (!row || !isAfflictionReferenceHostItem(item) || !canEditItem(item)) return;

    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    clearActorReferenceHighlights(root);
    void attachDroppedReference(item, parsed, { application });
  }, true);

  return true;
}

export function installAfflictionItemReferenceUi(application, html) {
  void renderItemReferencePanel(application, html);
}

export function installAfflictionReferenceHostUi(application, html) {
  installAfflictionItemReferenceUi(application, html);
  installAfflictionActorSheetReferenceDropTargets(application, html);
}

let referenceHostUiInitialized = false;

export function initializeAfflictionReferenceHostUi() {
  if (referenceHostUiInitialized) return true;
  referenceHostUiInitialized = true;
  globalThis.Hooks?.on?.("renderApplicationV2", installAfflictionReferenceHostUi);
  globalThis.Hooks?.on?.("renderItemSheet", installAfflictionReferenceHostUi);
  globalThis.Hooks?.on?.("renderActorSheet", installAfflictionReferenceHostUi);
  return true;
}
