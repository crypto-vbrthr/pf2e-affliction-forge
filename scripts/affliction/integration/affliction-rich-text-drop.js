import { MODULE_ID } from "../../constants.js";
import { readAfflictionDragEventData } from "./affliction-external-integration.js";

let initialized = false;
let pluginWarningShown = false;
let fallbackInstalled = false;
let customElementPluginListenerInstalled = false;

function api() {
  return globalThis.game?.modules?.get?.(MODULE_ID)?.api ?? null;
}

export function readRichTextAfflictionDragData(event) {
  const custom = readAfflictionDragEventData(event);
  if (custom) return custom;

  let data = null;
  try {
    const TextEditor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation
      ?? globalThis.TextEditor?.implementation
      ?? globalThis.TextEditor;
    data = TextEditor?.getDragEventData?.(event) ?? null;
  } catch {
    data = null;
  }
  if (data?.type !== "Item" || typeof data?.uuid !== "string") return null;

  let document = null;
  try {
    const resolver = globalThis.foundry?.utils?.fromUuidSync ?? globalThis.fromUuidSync;
    document = typeof resolver === "function" ? resolver(data.uuid) : null;
  } catch {
    document = null;
  }
  if (!document || api()?.documents?.isTemplate?.(document) !== true) return null;
  return Object.freeze({
    type: "Affliction",
    templateUuid: data.uuid,
    label: document.name ?? null,
    sourceUuid: null,
    referenceId: null
  });
}

export function afflictionTextFromDragData(parsed) {
  if (!parsed?.templateUuid) return null;
  try {
    return api()?.references?.toText?.(parsed.templateUuid, {
      label: parsed.label ?? null,
      syntax: "affliction"
    }) ?? `@Affliction[${parsed.templateUuid}]${parsed.label ? `{${parsed.label}}` : ""}`;
  } catch {
    return `@Affliction[${parsed.templateUuid}]${parsed.label ? `{${parsed.label}}` : ""}`;
  }
}

function pluginConstructor(plugins = {}, options = {}) {
  const direct = globalThis.ProseMirror?.Plugin
    ?? globalThis.foundry?.prosemirror?.Plugin;
  if (typeof direct === "function") return direct;

  const candidates = [
    ...Object.values(plugins ?? {}),
    ...(Array.isArray(options?.state?.plugins) ? options.state.plugins : [])
  ];
  for (const plugin of candidates) {
    const constructor = plugin?.constructor;
    if (typeof constructor !== "function") continue;
    if (constructor.name === "Plugin") return constructor;
    if (plugin && "spec" in plugin && ("props" in plugin || "key" in plugin)) return constructor;
  }
  return null;
}

export function handleAfflictionProseMirrorDrop(view, event) {
  const parsed = readRichTextAfflictionDragData(event);
  if (!parsed) return false;
  const text = afflictionTextFromDragData(parsed);
  if (!text || !view?.state?.tr?.insertText || typeof view.dispatch !== "function") return false;

  const coords = {
    left: Number(event?.clientX ?? 0),
    top: Number(event?.clientY ?? 0)
  };
  const atCoords = typeof view.posAtCoords === "function" ? view.posAtCoords(coords) : null;
  const position = Number.isInteger(atCoords?.pos)
    ? atCoords.pos
    : Number(view.state.selection?.from ?? 0);

  try {
    const transaction = view.state.tr.insertText(text, position, position);
    view.dispatch(transaction);
    view.focus?.();
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not insert Affliction reference into ProseMirror.`, error);
    return false;
  }
}

export function installAfflictionProseMirrorDropPlugin(_uuid, plugins = {}, options = {}) {
  if (!plugins || typeof plugins !== "object") return false;
  if (plugins.afflictionForgeDrop) return true;
  const Plugin = pluginConstructor(plugins, options);
  if (!Plugin) {
    if (!pluginWarningShown) {
      pluginWarningShown = true;
      console.warn(`${MODULE_ID} | ProseMirror Plugin constructor unavailable; falling back to DOM text-drop integration.`);
    }
    return false;
  }

  plugins.afflictionForgeDrop = new Plugin({
    props: {
      handleDrop: (view, event) => handleAfflictionProseMirrorDrop(view, event)
    }
  });
  return true;
}


function pluginsFromCustomElementEvent(event) {
  const detail = event?.detail;
  if (!detail || typeof detail !== "object") return null;
  if (detail.plugins && typeof detail.plugins === "object") return { plugins: detail.plugins, options: detail };
  // Foundry's prose-mirror custom element exposes a `plugins` configuration
  // event. Keep this permissive because v13/v14 builds have differed in the
  // exact shape of the CustomEvent detail.
  const values = Object.values(detail);
  if (values.some((value) => value?.constructor?.name === "Plugin" || value?.spec)) {
    return { plugins: detail, options: {} };
  }
  return null;
}

export function handleProseMirrorPluginsEvent(event) {
  const target = event?.target;
  if (target?.tagName && String(target.tagName).toLowerCase() !== "prose-mirror") return false;
  const configured = pluginsFromCustomElementEvent(event);
  if (!configured) return false;
  return installAfflictionProseMirrorDropPlugin(
    target?.id ?? target?.name ?? "prose-mirror",
    configured.plugins,
    configured.options
  );
}

function installCustomElementPluginListener() {
  if (customElementPluginListenerInstalled || !globalThis.document?.addEventListener) return false;
  customElementPluginListenerInstalled = true;
  globalThis.document.addEventListener("plugins", handleProseMirrorPluginsEvent, true);
  return true;
}

function textareaTarget(target) {
  if (!target) return null;
  if (target.tagName === "TEXTAREA") return target;
  return target.closest?.("textarea") ?? null;
}

function contentEditableTarget(target) {
  if (!target?.closest) return null;
  const editable = target.closest('[contenteditable="true"]');
  if (!editable) return null;
  // Real ProseMirror editors are handled by the editor plugin so that the
  // transaction is persisted in the editor state. Never mutate that DOM here.
  if (editable.classList?.contains("ProseMirror") || editable.closest?.(".ProseMirror")) return null;
  return editable;
}

function insertIntoTextarea(textarea, text) {
  const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : String(textarea.value ?? "").length;
  const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
  if (typeof textarea.setRangeText === "function") {
    textarea.setRangeText(text, start, end, "end");
  } else {
    const value = String(textarea.value ?? "");
    textarea.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
  }
  textarea.dispatchEvent?.(new Event("input", { bubbles: true }));
  textarea.dispatchEvent?.(new Event("change", { bubbles: true }));
  textarea.focus?.();
}

function insertIntoContentEditable(editable, text) {
  const selection = globalThis.getSelection?.();
  if (!selection) return false;
  let range = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editable.contains?.(range.commonAncestorContainer)) {
    range = globalThis.document?.createRange?.();
    if (!range) return false;
    range.selectNodeContents(editable);
    range.collapse(false);
  }
  range.deleteContents();
  const node = globalThis.document?.createTextNode?.(text);
  if (!node) return false;
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editable.dispatchEvent?.(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  editable.focus?.();
  return true;
}

export function handleAfflictionPlainTextDrop(event) {
  const parsed = readRichTextAfflictionDragData(event);
  if (!parsed) return false;
  const text = afflictionTextFromDragData(parsed);
  if (!text) return false;

  const textarea = textareaTarget(event.target);
  const editable = textarea ? null : contentEditableTarget(event.target);
  if (!textarea && !editable) return false;

  event.preventDefault?.();
  event.stopPropagation?.();
  if (textarea) insertIntoTextarea(textarea, text);
  else insertIntoContentEditable(editable, text);
  return true;
}

function installFallbackTextDrop() {
  if (fallbackInstalled || !globalThis.document?.addEventListener) return false;
  fallbackInstalled = true;
  globalThis.document.addEventListener("drop", handleAfflictionPlainTextDrop, true);
  return true;
}

export function initializeAfflictionRichTextDropIntegration() {
  if (initialized) return true;
  initialized = true;
  globalThis.Hooks?.on?.("createProseMirrorEditor", installAfflictionProseMirrorDropPlugin);
  installCustomElementPluginListener();
  installFallbackTextDrop();
  return true;
}
