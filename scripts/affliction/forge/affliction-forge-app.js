import { MODULE_ID } from "../../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function localize(key) {
  return game.i18n.localize(key);
}

function createDraftDefinition() {
  const api = game.modules.get(MODULE_ID)?.api;
  if (!api) throw new Error("Affliction Forge API is unavailable.");
  return api.definitions.create({
    name: localize("PF2E_AFFLICTION_FORGE.Editor.Untitled")
  });
}

async function copyText(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

export class AfflictionForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  editor = null;
  mountToken = 0;
  resizeObserver = null;

  static DEFAULT_OPTIONS = {
    id: "pf2e-affliction-forge",
    classes: ["pf2e-affliction-forge", "affliction-forge-app"],
    tag: "form",
    window: {
      title: "PF2E_AFFLICTION_FORGE.Forge.WindowTitle",
      icon: "fa-solid fa-biohazard",
      resizable: true
    },
    position: {
      width: 1260,
      height: 860
    },
    actions: {
      newDraft: AfflictionForgeApp.#newDraft,
      validateDraft: AfflictionForgeApp.#validateDraft,
      copyDefinition: AfflictionForgeApp.#copyDefinition,
      closeWindow: AfflictionForgeApp.#closeWindow
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/affliction-forge/affliction-forge-app.hbs`
    }
  };

  constructor(options = {}) {
    super(options);
    this.editor = this.#createEditor(options.definition ?? createDraftDefinition());
  }

  #api() {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) throw new Error("Affliction Forge API is unavailable.");
    return api;
  }

  #createEditor(definition) {
    const api = this.#api();
    return api.ui.afflictionEditor.create({
      definition,
      mode: "create"
    });
  }

  async _prepareContext() {
    const compatibility = this.#api().integration.criticalForge.compatibility();
    return {
      criticalForgeReady: compatibility.effectApiAvailable && compatibility.effectEditorAvailable,
      criticalForgeVersion: compatibility.moduleVersion ?? "—",
      apiVersion: this.#api().version,
      schemaVersion: this.#api().schemaVersion
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const host = this.element?.querySelector?.("[data-affliction-forge-editor-host]");
    if (!(host instanceof HTMLElement)) return;

    this.#installLayoutGuard();

    const token = ++this.mountToken;
    void this.editor.mount(host).then(() => {
      if (token !== this.mountToken) return;
      this.#enforceLayout();
      host.scrollTop = 0;
    }).catch((error) => {
      if (token !== this.mountToken) return;
      console.error(`${MODULE_ID} | Embedded Affliction Editor could not be mounted.`, error);
      host.innerHTML = `
        <div class="affliction-forge-mount-error">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <div>
            <strong>${localize("PF2E_AFFLICTION_FORGE.Forge.EditorMountFailed")}</strong>
            <p>${String(error?.message ?? error)}</p>
          </div>
        </div>`;
    });
  }

  #installLayoutGuard() {
    this.resizeObserver?.disconnect?.();
    this.resizeObserver = null;
    this.#enforceLayout();

    if (typeof ResizeObserver !== "function" || !(this.element instanceof HTMLElement)) return;
    this.resizeObserver = new ResizeObserver(() => this.#enforceLayout());
    this.resizeObserver.observe(this.element);
  }

  #enforceLayout() {
    if (!(this.element instanceof HTMLElement)) return;

    const shell = this.element.querySelector(".affliction-forge-shell");
    const frame = this.element.querySelector(".affliction-forge-editor-frame");
    if (!(shell instanceof HTMLElement) || !(frame instanceof HTMLElement)) return;

    // ApplicationV2 part wrappers differ between Foundry releases and themes.
    // Keep the visible host self-contained instead of relying solely on an
    // inherited percentage-height chain. CSS still owns the appearance; these
    // inline dimensions are a defensive runtime fallback.
    const ownRect = this.element.getBoundingClientRect();
    const parentRect = this.element.parentElement?.getBoundingClientRect?.();
    const candidateHeight = Math.max(
      0,
      ownRect.height || 0,
      parentRect?.height || 0,
      Number(this.position?.height ?? 0) - 36
    );
    const shellHeight = Math.max(420, candidateHeight || 780);

    Object.assign(shell.style, {
      height: `${shellHeight}px`,
      maxHeight: "100%",
      minHeight: "0",
      overflow: "hidden"
    });

    const toolbar = shell.querySelector(".affliction-forge-toolbar");
    const status = shell.querySelector(".affliction-forge-status-line");
    const fixedHeight = (toolbar?.getBoundingClientRect?.().height ?? 0)
      + (status?.getBoundingClientRect?.().height ?? 0);
    const frameHeight = Math.max(280, shellHeight - fixedHeight);

    Object.assign(frame.style, {
      height: `${frameHeight}px`,
      minHeight: "0",
      overflowX: "hidden",
      overflowY: "scroll",
      overscrollBehavior: "contain"
    });
  }

  async close(options = {}) {
    this.mountToken += 1;
    this.resizeObserver?.disconnect?.();
    this.resizeObserver = null;
    this.editor?.destroy?.();
    return super.close(options);
  }

  async #replaceDraft(definition) {
    this.editor?.destroy?.();
    this.editor = this.#createEditor(definition);
    const host = this.element?.querySelector?.("[data-affliction-forge-editor-host]");
    if (host instanceof HTMLElement) {
      await this.editor.mount(host);
      this.#enforceLayout();
      host.scrollTop = 0;
      this.editor.focusFirstField?.();
    }
  }

  static async #newDraft() {
    await this.#replaceDraft(createDraftDefinition());
    ui.notifications.info(localize("PF2E_AFFLICTION_FORGE.Forge.NewDraftCreated"));
  }

  static #validateDraft() {
    try {
      const report = this.editor.refreshValidation?.({ scrollIntoView: false }) ?? this.editor.validate();
      if (report.valid !== false) {
        ui.notifications.info(localize("PF2E_AFFLICTION_FORGE.Forge.ValidationValid"));
        return;
      }
      const errorCount = (report.issues ?? []).filter((issue) => issue.severity === "error").length;
      ui.notifications.warn(game.i18n.format("PF2E_AFFLICTION_FORGE.Forge.ValidationInvalid", { count: errorCount }));
    } catch (error) {
      console.error(`${MODULE_ID} | Draft validation failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #copyDefinition() {
    try {
      const text = JSON.stringify(this.editor.value, null, 2);
      if (!await copyText(text)) {
        ui.notifications.warn(localize("PF2E_AFFLICTION_FORGE.Forge.ClipboardUnavailable"));
        return;
      }
      ui.notifications.info(localize("PF2E_AFFLICTION_FORGE.Forge.DefinitionCopied"));
    } catch (error) {
      console.error(`${MODULE_ID} | Definition copy failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static #closeWindow() {
    this.close();
  }
}
