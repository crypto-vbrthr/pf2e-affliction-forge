import { IDENTIFICATION_STATES, MODULE_ID } from "../../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

function localize(key) {
  return game.i18n.localize(key);
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
      resizable: false
    },
    position: {
      width: 520,
      height: 410
    },
    actions: {
      previousStage: AfflictionControllerApp.#previousStage,
      nextStage: AfflictionControllerApp.#nextStage,
      reapplyStage: AfflictionControllerApp.#reapplyStage,
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
