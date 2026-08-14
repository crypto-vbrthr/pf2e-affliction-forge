import { MODULE_ID } from "./constants.js";

export const SCHEDULER_CATCH_UP_MODES = Object.freeze([
  "all",
  "next"
]);

export const SCHEDULER_SETTING_KEYS = Object.freeze({
  ENABLED: "schedulerEnabled",
  CATCH_UP_MODE: "schedulerCatchUpMode",
  CATCH_UP_LIMIT: "schedulerCatchUpLimit"
});

export const LIBRARY_SETTING_KEYS = Object.freeze({
  STATES: "libraryStates"
});

function queueSchedulerAfterSettingChange() {
  void globalThis.game?.modules?.get?.(MODULE_ID)?.api?.scheduler?.requestProcess?.({ reason: "setting-change" });
}

export function registerAfflictionForgeSettings() {
  if (typeof globalThis.game?.settings?.register !== "function") return false;

  game.settings.register(MODULE_ID, SCHEDULER_SETTING_KEYS.ENABLED, {
    name: "PF2E_AFFLICTION_FORGE.Settings.SchedulerEnabled.Name",
    hint: "PF2E_AFFLICTION_FORGE.Settings.SchedulerEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: queueSchedulerAfterSettingChange
  });

  game.settings.register(MODULE_ID, SCHEDULER_SETTING_KEYS.CATCH_UP_MODE, {
    name: "PF2E_AFFLICTION_FORGE.Settings.CatchUpMode.Name",
    hint: "PF2E_AFFLICTION_FORGE.Settings.CatchUpMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      all: "PF2E_AFFLICTION_FORGE.Settings.CatchUpMode.All",
      next: "PF2E_AFFLICTION_FORGE.Settings.CatchUpMode.Next"
    },
    default: "all",
    onChange: queueSchedulerAfterSettingChange
  });

  game.settings.register(MODULE_ID, SCHEDULER_SETTING_KEYS.CATCH_UP_LIMIT, {
    name: "PF2E_AFFLICTION_FORGE.Settings.CatchUpLimit.Name",
    hint: "PF2E_AFFLICTION_FORGE.Settings.CatchUpLimit.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 100, step: 1 },
    default: 25,
    onChange: queueSchedulerAfterSettingChange
  });

  // Internal world-state map. Library providers can be registered after init,
  // so their enabled/disabled state cannot be represented by static Foundry
  // settings. The Library Service stores dynamic states here instead.
  game.settings.register(MODULE_ID, LIBRARY_SETTING_KEYS.STATES, {
    name: "Affliction library states",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  return true;
}

function getSetting(key, fallback) {
  try {
    const value = globalThis.game?.settings?.get?.(MODULE_ID, key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function readSchedulerSettings() {
  const enabled = Boolean(getSetting(SCHEDULER_SETTING_KEYS.ENABLED, true));
  const requestedMode = String(getSetting(SCHEDULER_SETTING_KEYS.CATCH_UP_MODE, "all"));
  const catchUpMode = SCHEDULER_CATCH_UP_MODES.includes(requestedMode) ? requestedMode : "all";
  const requestedLimit = Math.trunc(Number(getSetting(SCHEDULER_SETTING_KEYS.CATCH_UP_LIMIT, 25)) || 25);
  const catchUpLimit = Math.max(1, Math.min(100, requestedLimit));
  return Object.freeze({ enabled, catchUpMode, catchUpLimit });
}
