import {
  createDefaultInitialCheck,
  createDefaultSaveCheck,
  createDefaultStage,
  createDefaultStageCheck
} from "../schema/affliction-defaults.js";
import { normalizeAfflictionDefinition } from "../schema/affliction-normalizer.js";
import { deepClone, randomId } from "../schema/utils.js";

function snapshot(value) {
  return JSON.stringify(value);
}

function reindexStages(stages) {
  return stages.map((stage, index) => ({
    ...stage,
    number: index + 1
  }));
}

function replaceCheckIdInGate(gate, oldId, newId) {
  if (!gate || !Array.isArray(gate.checkIds)) return;
  gate.checkIds = gate.checkIds.map((id) => id === oldId ? newId : id);
}

function removeCheckIdFromGate(gate, removedId, fallbackId = null) {
  if (!gate || !Array.isArray(gate.checkIds)) return;
  gate.checkIds = gate.checkIds.filter((id) => id !== removedId);
  if (gate.checkIds.length === 0 && fallbackId) gate.checkIds = [fallbackId];
  if (gate.combine === "single" && gate.checkIds.length > 1) gate.checkIds = [gate.checkIds[0]];
}

export class AfflictionEditorSession {
  constructor(definition = null, { mode = "edit" } = {}) {
    this.mode = ["create", "edit", "view"].includes(mode) ? mode : "edit";
    this.definition = normalizeAfflictionDefinition(definition ?? {}, { createDefaults: true });
    this.collapsedStages = new Set();
    this.cleanSnapshot = "";
    this.dirty = false;
    this.markClean();
  }

  get readOnly() {
    return this.mode === "view";
  }

  get value() {
    return deepClone(this.definition);
  }

  loadDefinition(definition, { mode = this.mode } = {}) {
    this.mode = ["create", "edit", "view"].includes(mode) ? mode : "edit";
    this.definition = normalizeAfflictionDefinition(definition ?? {}, { createDefaults: true });
    this.collapsedStages.clear();
    this.markClean();
    return this;
  }

  markClean() {
    this.cleanSnapshot = snapshot(this.definition);
    this.dirty = false;
    return this;
  }

  markDirty() {
    this.dirty = true;
    return this;
  }

  refreshDirty() {
    this.dirty = snapshot(this.definition) !== this.cleanSnapshot;
    return this.dirty;
  }

  setDefinition(definition) {
    this.definition = normalizeAfflictionDefinition(definition ?? {}, { createDefaults: true });
    this.refreshDirty();
    return this;
  }

  addCheck(options = {}) {
    const index = this.definition.checks.length;
    const id = String(options.id ?? `check-${index + 1}`).trim() || `check-${index + 1}`;
    this.definition.checks.push(createDefaultSaveCheck({ ...options, id }));
    this.markDirty();
    return this.definition.checks.length - 1;
  }

  removeCheck(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.definition.checks.length) return false;
    if (this.definition.checks.length <= 1) return false;
    const [removed] = this.definition.checks.splice(index, 1);
    const fallbackId = this.definition.checks[0]?.id ?? null;
    removeCheckIdFromGate(this.definition.initialCheck, removed.id, fallbackId);
    removeCheckIdFromGate(this.definition.defaultStageCheck, removed.id, fallbackId);
    for (const stage of this.definition.stages) removeCheckIdFromGate(stage.check, removed.id, fallbackId);
    this.markDirty();
    return true;
  }

  renameCheck(index, newId) {
    const check = this.definition.checks[index];
    if (!check) return false;
    const nextId = String(newId ?? "").trim();
    if (!nextId || nextId === check.id) return false;
    const oldId = check.id;
    check.id = nextId;
    replaceCheckIdInGate(this.definition.initialCheck, oldId, nextId);
    replaceCheckIdInGate(this.definition.defaultStageCheck, oldId, nextId);
    for (const stage of this.definition.stages) replaceCheckIdInGate(stage.check, oldId, nextId);
    this.markDirty();
    return true;
  }

  setInitialCheckEnabled(enabled) {
    this.definition.initialCheck = enabled
      ? (this.definition.initialCheck ?? createDefaultInitialCheck())
      : null;
    this.markDirty();
    return this.definition.initialCheck;
  }

  setDefaultStageCheckEnabled(enabled) {
    this.definition.defaultStageCheck = enabled
      ? (this.definition.defaultStageCheck ?? createDefaultStageCheck())
      : null;
    this.markDirty();
    return this.definition.defaultStageCheck;
  }

  setStageCheckOverride(index, enabled) {
    const stage = this.definition.stages[index];
    if (!stage) return null;
    stage.check = enabled
      ? deepClone(this.definition.defaultStageCheck ?? createDefaultStageCheck())
      : null;
    this.markDirty();
    return stage.check;
  }

  addStage(options = {}) {
    const number = this.definition.stages.length + 1;
    const stage = {
      ...createDefaultStage({ number }),
      ...deepClone(options),
      number,
      id: String(options.id ?? `stage-${number}`).trim() || `stage-${number}`
    };
    this.definition.stages.push(stage);
    this.markDirty();
    return this.definition.stages.length - 1;
  }

  duplicateStage(index) {
    const source = this.definition.stages[index];
    if (!source) return -1;
    const copy = deepClone(source);
    const nextNumber = index + 2;
    copy.id = randomId(`${source.id || "stage"}-copy`);
    if (copy.effect?.id) copy.effect.id = `${this.definition.id}.${copy.id}.effect`;
    this.definition.stages.splice(index + 1, 0, copy);
    this.definition.stages = reindexStages(this.definition.stages);
    this.markDirty();
    return index + 1;
  }

  removeStage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.definition.stages.length) return false;
    if (this.definition.stages.length <= 1) return false;
    const [removed] = this.definition.stages.splice(index, 1);
    this.collapsedStages.delete(removed.id);
    this.definition.stages = reindexStages(this.definition.stages);
    this.markDirty();
    return true;
  }

  moveStage(index, direction) {
    const target = direction === "up" ? index - 1 : direction === "down" ? index + 1 : -1;
    if (target < 0 || target >= this.definition.stages.length) return false;
    const [stage] = this.definition.stages.splice(index, 1);
    this.definition.stages.splice(target, 0, stage);
    this.definition.stages = reindexStages(this.definition.stages);
    this.markDirty();
    return true;
  }

  toggleStageCollapsed(index) {
    const stage = this.definition.stages[index];
    if (!stage) return false;
    if (this.collapsedStages.has(stage.id)) this.collapsedStages.delete(stage.id);
    else this.collapsedStages.add(stage.id);
    return this.collapsedStages.has(stage.id);
  }

  isStageCollapsed(index) {
    const stage = this.definition.stages[index];
    return Boolean(stage && this.collapsedStages.has(stage.id));
  }

  setStageEffect(index, effectDefinition) {
    const stage = this.definition.stages[index];
    if (!stage) return false;
    stage.effect = effectDefinition == null ? null : deepClone(effectDefinition);
    this.markDirty();
    return true;
  }

  clearStageEffect(index) {
    return this.setStageEffect(index, null);
  }
}

export function createAfflictionEditorSession(definition = null, options = {}) {
  return new AfflictionEditorSession(definition, options);
}
