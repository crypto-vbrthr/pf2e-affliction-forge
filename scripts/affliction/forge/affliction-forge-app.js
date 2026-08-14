import { MODULE_ID } from "../../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

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

function makeSaveAsContent(name, destinations) {
  // Foundry V14 requires an HTMLElement supplied as DialogV2 content to be a
  // plain outer DIV without attributes. Put our styling hook on an inner wrapper.
  const root = document.createElement("div");
  const wrapper = document.createElement("div");
  wrapper.className = "affliction-forge-save-as-dialog";

  const nameLabel = document.createElement("label");
  nameLabel.textContent = localize("PF2E_AFFLICTION_FORGE.Forge.TemplateName");
  const nameInput = document.createElement("input");
  nameInput.name = "name";
  nameInput.type = "text";
  nameInput.value = name;
  nameInput.autofocus = true;
  nameLabel.append(nameInput);

  const destinationLabel = document.createElement("label");
  destinationLabel.textContent = localize("PF2E_AFFLICTION_FORGE.Forge.Destination");
  const destination = document.createElement("select");
  destination.name = "pack";
  for (const option of destinations) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    destination.append(node);
  }
  destinationLabel.append(destination);

  wrapper.append(nameLabel, destinationLabel);
  root.append(wrapper);
  return root;
}

export class AfflictionForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  editor = null;
  mountToken = 0;
  resizeObserver = null;
  currentTemplate = null;
  library = [];
  libraryCatalog = [];
  libraryLoaded = false;
  libraryError = null;
  selectedLibraryId = "";

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
      width: 1380,
      height: 880
    },
    actions: {
      newDraft: AfflictionForgeApp.#newDraft,
      saveTemplate: AfflictionForgeApp.#saveTemplate,
      saveAsTemplate: AfflictionForgeApp.#saveAsTemplate,
      validateDraft: AfflictionForgeApp.#validateDraft,
      copyDefinition: AfflictionForgeApp.#copyDefinition,
      applyToSelection: AfflictionForgeApp.#applyToSelection,
      refreshLibrary: AfflictionForgeApp.#refreshLibrary,
      openTemplate: AfflictionForgeApp.#openTemplate,
      copyTemplateToWorld: AfflictionForgeApp.#copyTemplateToWorld,
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
    this.editor = this.#createEditor(options.definition ?? createDraftDefinition(), options.definition ? "edit" : "create");
  }

  #api() {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) throw new Error("Affliction Forge API is unavailable.");
    return api;
  }

  #createEditor(definition, mode = "create") {
    const api = this.#api();
    return api.ui.afflictionEditor.create({
      definition,
      mode,
      onChange: () => this.#syncPersistenceUi()
    });
  }

  async #ensureLibrary() {
    if (this.libraryLoaded) return;
    try {
      this.library = await this.#api().libraries.search();
      const usedLibraryIds = new Set(this.library.map((entry) => entry.libraryId).filter(Boolean));
      this.libraryCatalog = this.#api().libraries.list().filter((entry) => entry.registered || usedLibraryIds.has(entry.id));
      if (this.selectedLibraryId && !this.libraryCatalog.some((entry) => entry.id === this.selectedLibraryId && entry.enabled)) {
        this.selectedLibraryId = "";
      }
      this.libraryError = null;
    } catch (error) {
      this.library = [];
      this.libraryCatalog = [];
      this.libraryError = String(error?.message ?? error);
      console.error(`${MODULE_ID} | Template library could not be loaded.`, error);
    }
    this.libraryLoaded = true;
  }

  #invalidateLibrary() {
    this.libraryLoaded = false;
  }


  async handleLibrariesChanged() {
    this.#invalidateLibrary();
    if (!(this.element instanceof HTMLElement) || !this.element.isConnected) return true;
    await this.render({ force: true });
    return true;
  }

  async handleTemplateDeleted(document) {
    const uuid = String(document?.uuid ?? "").trim();
    if (!uuid) return false;

    // Remove the descriptor immediately so even an already-rendered library can
    // never keep a dead entry around while the asynchronous refresh is pending.
    this.library = this.library.filter((entry) => entry.uuid !== uuid);
    this.#invalidateLibrary();

    if (this.currentTemplate?.uuid === uuid) {
      // Deleting the backing Item is an explicit destructive action. Do not
      // resurrect that deleted template as a dirty local draft: that causes the
      // deleted affliction to reappear on the next Forge open and triggers a
      // misleading unsaved-changes prompt when switching templates. Reset to a
      // fresh, clean draft instead.
      this.currentTemplate = null;
      this.editor?.setData?.(createDraftDefinition(), { mode: "create", rerender: false });
      this.editor?.markClean?.();
    }

    // A closed ApplicationV2 instance can remain cached by the module. Its
    // in-memory editor has already been reset above, while the invalidated
    // library will be re-indexed on the next open.
    if (!(this.element instanceof HTMLElement) || !this.element.isConnected) return true;

    await this.render({ force: true });
    return true;
  }

  async _prepareContext() {
    await this.#ensureLibrary();
    const compatibility = this.#api().integration.criticalForge.compatibility();
    const currentUuid = this.currentTemplate?.uuid ?? null;
    const entries = this.library.map((entry) => ({
      ...entry,
      active: entry.uuid === currentUuid,
      searchable: [
        entry.name,
        entry.sourceLabel,
        entry.libraryLabel,
        entry.providerLabel,
        entry.afflictionType,
        entry.rarity,
        ...(entry.traits ?? []),
        ...(entry.themes ?? [])
      ].filter(Boolean).join(" ").toLocaleLowerCase(game.i18n.lang),
      sourceIcon: entry.world
        ? "fa-solid fa-globe"
        : entry.providerId
          ? "fa-solid fa-books"
          : "fa-solid fa-box-archive"
    }));
    const libraries = this.libraryCatalog.map((library) => ({
      ...library,
      selected: library.id === this.selectedLibraryId,
      statusIcon: library.writable ? "fa-solid fa-pen" : "fa-solid fa-lock"
    }));
    const current = this.currentTemplate;
    const isDraft = !current;
    const canSave = isDraft || current.writable;

    return {
      criticalForgeReady: compatibility.effectApiAvailable
        && compatibility.effectSourceApiAvailable
        && compatibility.effectExecutionApiAvailable
        && compatibility.effectEditorAvailable,
      criticalForgeVersion: compatibility.moduleVersion ?? "—",
      apiVersion: this.#api().version,
      schemaVersion: this.#api().schemaVersion,
      templates: entries,
      libraries,
      selectedLibraryId: this.selectedLibraryId,
      libraryError: this.libraryError,
      templateCount: entries.length,
      libraryCount: libraries.filter((entry) => entry.enabled).length,
      isDraft,
      canSave,
      currentTemplateName: current?.name ?? localize("PF2E_AFFLICTION_FORGE.Forge.UnsavedDraft"),
      currentSourceLabel: current?.libraryLabel ?? current?.sourceLabel ?? localize("PF2E_AFFLICTION_FORGE.Forge.Unsaved"),
      currentDefinitionVersion: current?.definitionVersion ?? null,
      currentReadOnly: Boolean(current && !current.writable)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const host = this.element?.querySelector?.("[data-affliction-forge-editor-host]");
    if (!(host instanceof HTMLElement)) return;

    this.#installLayoutGuard();
    this.#bindLibraryFilter();

    const token = ++this.mountToken;
    void this.editor.mount(host).then(() => {
      if (token !== this.mountToken) return;
      this.#enforceLayout();
      host.scrollTop = 0;
      this.#syncPersistenceUi();
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

  #bindLibraryFilter() {
    const search = this.element?.querySelector?.("[data-affliction-library-filter]");
    const source = this.element?.querySelector?.("[data-affliction-library-source]");

    const apply = () => {
      const query = search instanceof HTMLInputElement
        ? String(search.value ?? "").trim().toLocaleLowerCase(game.i18n.lang)
        : "";
      const libraryId = source instanceof HTMLSelectElement ? String(source.value ?? "") : this.selectedLibraryId;
      this.selectedLibraryId = libraryId;
      for (const row of this.element.querySelectorAll("[data-affliction-template-row]")) {
        const haystack = String(row.dataset.search ?? "");
        const rowLibrary = String(row.dataset.libraryId ?? "");
        const matchesQuery = !query || haystack.includes(query);
        const matchesLibrary = !libraryId || rowLibrary === libraryId;
        row.hidden = !(matchesQuery && matchesLibrary);
      }
    };

    if (search instanceof HTMLInputElement) search.addEventListener("input", apply);
    if (source instanceof HTMLSelectElement) source.addEventListener("change", apply);
    apply();
  }

  #syncPersistenceUi() {
    if (!(this.element instanceof HTMLElement)) return;
    const dirty = Boolean(this.editor?.dirty);
    this.element.classList.toggle("affliction-forge-dirty", dirty);
    const indicator = this.element.querySelector("[data-affliction-persistence-state]");
    if (indicator instanceof HTMLElement) {
      const unsavedDraft = !this.currentTemplate;
      indicator.textContent = unsavedDraft
        ? localize("PF2E_AFFLICTION_FORGE.Forge.Unsaved")
        : dirty
          ? localize("PF2E_AFFLICTION_FORGE.Forge.UnsavedChanges")
          : localize("PF2E_AFFLICTION_FORGE.Forge.SavedState");
      indicator.classList.toggle("dirty", unsavedDraft || dirty);
    }
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
    const workspace = this.element.querySelector(".affliction-forge-workspace");
    const frame = this.element.querySelector(".affliction-forge-editor-frame");
    if (!(shell instanceof HTMLElement) || !(workspace instanceof HTMLElement) || !(frame instanceof HTMLElement)) return;

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
    const workspaceHeight = Math.max(280, shellHeight - fixedHeight);

    Object.assign(workspace.style, {
      height: `${workspaceHeight}px`,
      minHeight: "0",
      overflow: "hidden"
    });
    Object.assign(frame.style, {
      height: "100%",
      minHeight: "0",
      overflowX: "hidden",
      overflowY: "scroll",
      overscrollBehavior: "contain"
    });
  }

  async #confirmDiscard() {
    if (!this.editor?.dirty) return true;
    return Boolean(await DialogV2.confirm({
      window: { title: localize("PF2E_AFFLICTION_FORGE.Forge.DiscardTitle") },
      content: `<p>${localize("PF2E_AFFLICTION_FORGE.Forge.DiscardPrompt")}</p>`,
      modal: true,
      rejectClose: false
    }));
  }

  async close(options = {}) {
    if (!options.force && !await this.#confirmDiscard()) return this;
    this.mountToken += 1;
    this.resizeObserver?.disconnect?.();
    this.resizeObserver = null;
    this.editor?.destroy?.();
    return super.close(options);
  }

  async #replaceDefinition(definition, { mode = "create", currentTemplate = null, render = true } = {}) {
    this.editor?.destroy?.();
    this.editor = this.#createEditor(definition, mode);
    this.currentTemplate = currentTemplate;
    if (render) await this.render({ force: true });
  }

  async openTemplate(templateUuid, { confirmDiscard = true, render = true } = {}) {
    if (confirmDiscard && !await this.#confirmDiscard()) return false;
    const item = await this.#api().templates.get(templateUuid);
    const definition = this.#api().documents.readDefinition(item);
    const descriptor = this.#api().templates.inspect(item);
    await this.#replaceDefinition(definition, {
      mode: descriptor?.writable ? "edit" : "view",
      currentTemplate: descriptor,
      render
    });
    return true;
  }

  async #beginNewDraft() {
    if (!await this.#confirmDiscard()) return false;
    await this.#replaceDefinition(createDraftDefinition(), { mode: "create", currentTemplate: null });
    this.editor.focusFirstField?.();
    return true;
  }

  #validateForPersistence() {
    const report = this.editor.refreshValidation?.({ scrollIntoView: false }) ?? this.editor.validate();
    const errors = (report.issues ?? []).filter((issue) => issue.severity === "error");
    if (report.valid === false || errors.length > 0) {
      ui.notifications.warn(game.i18n.format("PF2E_AFFLICTION_FORGE.Forge.ValidationInvalid", { count: errors.length }));
      return null;
    }
    return this.editor.value;
  }

  async #saveCurrent() {
    const definition = this.#validateForPersistence();
    if (!definition) return null;

    let document;
    if (this.currentTemplate) {
      const loaded = await this.#api().templates.get(this.currentTemplate.uuid);
      if (!this.#api().templates.canUpdate(loaded)) {
        ui.notifications.warn(localize("PF2E_AFFLICTION_FORGE.Forge.ReadOnlySaveAs"));
        return null;
      }
      document = await this.#api().templates.update(loaded, definition);
    } else {
      document = await this.#api().templates.create(definition);
    }

    this.currentTemplate = this.#api().templates.inspect(document);
    this.editor.setData(this.#api().documents.readDefinition(document), { mode: "edit", rerender: false });
    this.editor.markClean();
    this.#invalidateLibrary();
    await this.render({ force: true });
    ui.notifications.info(game.i18n.format("PF2E_AFFLICTION_FORGE.Forge.TemplateSaved", { name: document.name }));
    return document;
  }

  async #promptSaveAs(defaultName) {
    const destinations = this.#api().templates.writableDestinations();
    const fd = await DialogV2.input({
      window: { title: localize("PF2E_AFFLICTION_FORGE.Forge.SaveAs") },
      content: makeSaveAsContent(defaultName, destinations),
      ok: { label: localize("PF2E_AFFLICTION_FORGE.Forge.Save") },
      modal: true,
      rejectClose: false
    });
    if (!fd) return null;
    const name = String(fd.name ?? "").trim();
    if (!name) {
      ui.notifications.warn(localize("PF2E_AFFLICTION_FORGE.Forge.NameRequired"));
      return null;
    }
    return { name, pack: String(fd.pack ?? "").trim() || null };
  }

  async #saveAs() {
    const definition = this.#validateForPersistence();
    if (!definition) return null;
    const options = await this.#promptSaveAs(definition.name);
    if (!options) return null;

    let document;
    if (this.currentTemplate) {
      document = await this.#api().templates.clone(this.currentTemplate.uuid, {
        definition,
        name: options.name,
        pack: options.pack
      });
    } else {
      document = await this.#api().templates.copyDefinition(definition, {
        name: options.name,
        pack: options.pack,
        newIdentity: false
      });
    }

    this.currentTemplate = this.#api().templates.inspect(document);
    this.editor.setData(this.#api().documents.readDefinition(document), {
      mode: this.currentTemplate?.writable ? "edit" : "view",
      rerender: false
    });
    this.editor.markClean();
    this.#invalidateLibrary();
    await this.render({ force: true });
    ui.notifications.info(game.i18n.format("PF2E_AFFLICTION_FORGE.Forge.TemplateSaved", { name: document.name }));
    return document;
  }

  async #copyTemplateWorld(uuid) {
    if (!await this.#confirmDiscard()) return null;
    const document = await this.#api().templates.clone(uuid, { pack: null });
    this.#invalidateLibrary();
    await this.openTemplate(document.uuid, { confirmDiscard: false, render: true });
    ui.notifications.info(game.i18n.format("PF2E_AFFLICTION_FORGE.Forge.TemplateCopiedToWorld", { name: document.name }));
    return document;
  }

  #selectedTargets() {
    const controlled = [...(globalThis.canvas?.tokens?.controlled ?? [])];
    if (controlled.length > 0) return controlled;
    const targeted = [...(game.user?.targets ?? [])];
    return targeted;
  }

  async #applyCurrentToSelection() {
    const definition = this.#validateForPersistence();
    if (!definition) return [];
    const targets = this.#selectedTargets();
    if (targets.length === 0) {
      ui.notifications.warn(localize("PF2E_AFFLICTION_FORGE.Runtime.NoTargets"));
      return [];
    }

    const stableTemplateReference = this.currentTemplate && !this.editor?.dirty
      ? this.currentTemplate
      : null;
    const options = {
      sourceTemplateUuid: stableTemplateReference?.uuid ?? null,
      sourceDefinitionVersion: stableTemplateReference?.definitionVersion ?? null,
      origin: {
        application: "affliction-forge",
        userId: game.user?.id ?? null
      }
    };
    const application = await this.#api().engine.applyDefinition(definition, targets, options);
    ui.notifications.info(game.i18n.format("PF2E_AFFLICTION_FORGE.Runtime.AppliedCount", {
      name: definition.name,
      count: application.created.length
    }));
    if (application.errors.length > 0) {
      console.warn(`${MODULE_ID} | Some initial Affliction checks could not be completed.`, application.errors);
    }
    if (application.controllers.length === 1) await this.#api().ui.controller.open(application.controllers[0]);
    return application.controllers;
  }

  static async #newDraft() {
    if (await this.#beginNewDraft()) ui.notifications.info(localize("PF2E_AFFLICTION_FORGE.Forge.NewDraftCreated"));
  }

  static async #saveTemplate() {
    try {
      await this.#saveCurrent();
    } catch (error) {
      console.error(`${MODULE_ID} | Template save failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #saveAsTemplate() {
    try {
      await this.#saveAs();
    } catch (error) {
      console.error(`${MODULE_ID} | Template Save As failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
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

  static async #applyToSelection() {
    try {
      await this.#applyCurrentToSelection();
    } catch (error) {
      console.error(`${MODULE_ID} | Affliction application failed.`, error);
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

  static async #refreshLibrary() {
    this.#invalidateLibrary();
    await this.render({ force: true });
  }

  static async #openTemplate(_event, target) {
    const uuid = String(target?.dataset?.templateUuid ?? "").trim();
    if (!uuid) return;
    try {
      await this.openTemplate(uuid);
    } catch (error) {
      console.error(`${MODULE_ID} | Template open failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #copyTemplateToWorld(_event, target) {
    const uuid = String(target?.dataset?.templateUuid ?? "").trim();
    if (!uuid) return;
    try {
      await this.#copyTemplateWorld(uuid);
    } catch (error) {
      console.error(`${MODULE_ID} | Template copy failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #closeWindow() {
    await this.close();
  }
}
