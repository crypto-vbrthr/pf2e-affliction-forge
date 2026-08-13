import { IDENTIFICATION_STATES, MODULE_ID } from "../../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

function localize(key) {
  return game.i18n.localize(key);
}

function formatDueAt(timestamp) {
  if (!Number.isFinite(timestamp)) return localize("PF2E_AFFLICTION_FORGE.Runtime.NoDueTime");
  const now = Number(game.time?.worldTime ?? 0);
  const seconds = Math.max(0, timestamp - now);
  if (seconds <= 0) return localize("PF2E_AFFLICTION_FORGE.Runtime.DueNow");
  if (seconds < 60) return game.i18n.format("PF2E_AFFLICTION_FORGE.Runtime.DueSeconds", { value: Math.ceil(seconds) });
  if (seconds < 3600) return game.i18n.format("PF2E_AFFLICTION_FORGE.Runtime.DueMinutes", { value: Math.ceil(seconds / 60) });
  if (seconds < 86400) return game.i18n.format("PF2E_AFFLICTION_FORGE.Runtime.DueHours", { value: Math.ceil(seconds / 3600) });
  return game.i18n.format("PF2E_AFFLICTION_FORGE.Runtime.DueDays", { value: Math.ceil(seconds / 86400) });
}

const apps = new Map();

export class AfflictionControllerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  controllerUuid;

  static DEFAULT_OPTIONS = {
    id: "pf2e-affliction-controller",
    classes: ["pf2e-affliction-forge", "affliction-controller-app"],
    window: {
      title: "PF2E_AFFLICTION_FORGE.Runtime.WindowTitle",
      icon: "fa-solid fa-biohazard",
      resizable: true
    },
    position: {
      width: 520,
      height: 520
    },
    actions: {
      previousStage: AfflictionControllerApp.#previousStage,
      nextStage: AfflictionControllerApp.#nextStage,
      reapplyStage: AfflictionControllerApp.#reapplyStage,
      processCheck: AfflictionControllerApp.#processCheck,
      setIdentification: AfflictionControllerApp.#setIdentification,
      endAffliction: AfflictionControllerApp.#endAffliction
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/affliction-forge/affliction-controller-app.hbs`
    }
  };

  constructor(controllerUuid, options = {}) {
    super(options);
    this.controllerUuid = controllerUuid;
  }

  #api() {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) throw new Error("Affliction Forge API is unavailable.");
    return api;
  }

  async #controller() {
    return this.#api().instances.get(this.controllerUuid);
  }

  async _prepareContext() {
    const controller = await this.#controller();
    const info = this.#api().instances.inspect(controller);
    const state = info.state;
    const stage = info.currentStage;
    const engineInfo = await this.#api().engine.inspect(controller);
    const pending = state.pendingCheck;
    const totalChecks = pending?.checkIds?.length ?? engineInfo.plan?.checks?.length ?? 0;
    const resolvedChecks = pending ? Object.values(pending.results ?? {}).filter((entry) => entry?.degree).length : 0;
    const lastDegree = state.lastCheck?.degree ?? null;
    const processLabelKey = state.status === "incubating"
      ? "PF2E_AFFLICTION_FORGE.Runtime.CompleteOnset"
      : state.status === "pending"
        ? "PF2E_AFFLICTION_FORGE.Runtime.ProcessInitialSave"
        : "PF2E_AFFLICTION_FORGE.Runtime.ProcessStageSave";
    return {
      ...info,
      statusLabel: localize(`PF2E_AFFLICTION_FORGE.Runtime.Status.${state.status}`),
      stageLabel: stage
        ? `${localize("PF2E_AFFLICTION_FORGE.Editor.Stage")} ${stage.number}${stage.name ? ` · ${stage.name}` : ""}`
        : localize("PF2E_AFFLICTION_FORGE.Runtime.NoStage"),
      activeEffectCount: state.activeStageEffectUuids?.length ?? 0,
      canPrevious: state.currentStage > 0,
      canNext: state.currentStage < info.stageCount,
      canReapply: state.currentStage > 0,
      canProcess: ["pending", "incubating", "active"].includes(state.status),
      processLabel: localize(processLabelKey),
      dueLabel: formatDueAt(state.nextCheckAt),
      pendingSummary: totalChecks > 0 ? `${resolvedChecks}/${totalChecks}` : null,
      lastCheckLabel: lastDegree ? localize(`PF2E_AFFLICTION_FORGE.Runtime.Degree.${lastDegree}`) : localize("PF2E_AFFLICTION_FORGE.Runtime.NoCheckResult"),
      identificationStates: IDENTIFICATION_STATES.map((value) => ({
        value,
        label: localize({ hidden: "PF2E_AFFLICTION_FORGE.Identification.Hidden", suspected: "PF2E_AFFLICTION_FORGE.Identification.Suspected", identified: "PF2E_AFFLICTION_FORGE.Identification.Identified" }[value]),
        selected: state.identification?.state === value
      }))
    };
  }

  async close(options = {}) {
    apps.delete(this.controllerUuid);
    return super.close(options);
  }

  async #rerenderAfter(action) {
    await action;
    try {
      await this.#controller();
      await this.render({ force: true });
    } catch {
      await this.close({ force: true });
    }
  }

  static async #previousStage() {
    try {
      await this.#rerenderAfter(this.#api().instances.advance(this.controllerUuid, -1));
    } catch (error) {
      console.error(`${MODULE_ID} | Previous Affliction stage failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #nextStage() {
    try {
      await this.#rerenderAfter(this.#api().instances.advance(this.controllerUuid, 1));
    } catch (error) {
      console.error(`${MODULE_ID} | Next Affliction stage failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #reapplyStage() {
    try {
      await this.#rerenderAfter(this.#api().instances.reapplyStage(this.controllerUuid));
    } catch (error) {
      console.error(`${MODULE_ID} | Reapply Affliction stage failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #processCheck() {
    try {
      const result = await this.#api().engine.process(this.controllerUuid, { force: true });
      if (result?.status === "pending") {
        ui.notifications.info(localize("PF2E_AFFLICTION_FORGE.Runtime.CheckPending"));
      } else if (result?.status === "not-due") {
        ui.notifications.warn(localize("PF2E_AFFLICTION_FORGE.Runtime.NotDue"));
      }
      await this.#rerenderAfter(Promise.resolve());
    } catch (error) {
      console.error(`${MODULE_ID} | Affliction save processing failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #setIdentification() {
    try {
      const select = this.element?.querySelector?.("[data-affliction-identification]");
      const value = String(select?.value ?? "");
      await this.#rerenderAfter(this.#api().instances.setIdentification(this.controllerUuid, value));
    } catch (error) {
      console.error(`${MODULE_ID} | Affliction identification update failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }

  static async #endAffliction() {
    const confirmed = await DialogV2.confirm({
      window: { title: localize("PF2E_AFFLICTION_FORGE.Runtime.EndTitle") },
      content: `<p>${localize("PF2E_AFFLICTION_FORGE.Runtime.EndPrompt")}</p>`,
      modal: true,
      rejectClose: false
    });
    if (!confirmed) return;
    try {
      await this.#api().instances.end(this.controllerUuid);
      ui.notifications.info(localize("PF2E_AFFLICTION_FORGE.Runtime.Ended"));
      await this.close({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Ending Affliction failed.`, error);
      ui.notifications.error(String(error?.message ?? error));
    }
  }
}

export async function openAfflictionController(controllerOrUuid, options = {}) {
  if (!game.user?.isGM) {
    ui.notifications.warn(localize("PF2E_AFFLICTION_FORGE.Forge.GmOnly"));
    return null;
  }
  const api = game.modules.get(MODULE_ID)?.api;
  const controller = await api.instances.get(controllerOrUuid);
  const uuid = controller.uuid;
  let app = apps.get(uuid);
  if (!app) {
    app = new AfflictionControllerApp(uuid, {
      ...options,
      id: options.id ?? `pf2e-affliction-controller-${controller.id}`
    });
    apps.set(uuid, app);
  }
  await app.render({ force: true });
  app.bringToFront?.();
  return app;
}
