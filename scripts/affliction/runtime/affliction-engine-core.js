import { OUTCOME_KEYS } from "../../constants.js";
import { deepClone } from "../schema/utils.js";
import { resolveSavePolicy, resolveStageCheck } from "../schema/affliction-normalizer.js";

const DEGREE_INDEX = Object.freeze({
  criticalFailure: 0,
  failure: 1,
  success: 2,
  criticalSuccess: 3
});

const DEGREE_KEYS = Object.freeze([
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess"
]);

const DEGREE_ALIASES = new Map([
  ["criticalfailure", "criticalFailure"],
  ["critical-failure", "criticalFailure"],
  ["critical_failure", "criticalFailure"],
  ["failure", "failure"],
  ["success", "success"],
  ["criticalsuccess", "criticalSuccess"],
  ["critical-success", "criticalSuccess"],
  ["critical_success", "criticalSuccess"]
]);

export function normalizeDegreeOfSuccess(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 3) return DEGREE_KEYS[numeric];
  const normalized = String(value).trim().toLowerCase().replaceAll(" ", "");
  return DEGREE_ALIASES.get(normalized) ?? null;
}

export function degreeIndex(value) {
  const degree = normalizeDegreeOfSuccess(value);
  return degree == null ? null : DEGREE_INDEX[degree];
}

export function combineDegrees(values, mode = "single") {
  const degrees = values.map(normalizeDegreeOfSuccess).filter(Boolean);
  if (degrees.length === 0) return null;
  if (mode === "single") return degrees[0];

  const indices = degrees.map((degree) => DEGREE_INDEX[degree]);
  if (mode === "best-degree") return DEGREE_KEYS[Math.max(...indices)];
  if (mode === "worst-degree") return DEGREE_KEYS[Math.min(...indices)];

  if (mode === "all-success") {
    if (indices.every((index) => index >= DEGREE_INDEX.success)) {
      return indices.every((index) => index === DEGREE_INDEX.criticalSuccess) ? "criticalSuccess" : "success";
    }
    return indices.some((index) => index === DEGREE_INDEX.criticalFailure) ? "criticalFailure" : "failure";
  }

  if (mode === "any-success") {
    if (indices.some((index) => index >= DEGREE_INDEX.success)) {
      return indices.some((index) => index === DEGREE_INDEX.criticalSuccess) ? "criticalSuccess" : "success";
    }
    return indices.every((index) => index === DEGREE_INDEX.criticalFailure) ? "criticalFailure" : "failure";
  }

  return degrees[0];
}

export function resolveCheckGate(definition, state) {
  if (!definition || !state) return null;
  if (state.status === "pending" && state.currentStage === 0) {
    if (!definition.initialCheck) return null;
    return {
      kind: "initial",
      stageNumber: 0,
      gate: deepClone(definition.initialCheck)
    };
  }
  if (state.status === "active" && state.currentStage > 0) {
    const gate = resolveStageCheck(definition, state.currentStage);
    if (!gate) return null;
    return {
      kind: "stage",
      stageNumber: state.currentStage,
      gate
    };
  }
  return null;
}

export function buildCheckPlan(definition, state) {
  const resolved = resolveCheckGate(definition, state);
  if (!resolved) return null;
  const checkById = new Map((definition.checks ?? []).map((check) => [check.id, check]));
  const checks = [];
  for (const checkId of resolved.gate.checkIds ?? []) {
    const check = checkById.get(checkId);
    if (!check) continue;
    checks.push({
      ...deepClone(check),
      policy: resolveSavePolicy(definition, check)
    });
  }
  return {
    kind: resolved.kind,
    stageNumber: resolved.stageNumber,
    combine: resolved.gate.combine ?? "single",
    outcomes: deepClone(resolved.gate.outcomes ?? {}),
    checks
  };
}

export function directiveForDegree(plan, degree) {
  const normalized = normalizeDegreeOfSuccess(degree);
  if (!plan || !normalized || !OUTCOME_KEYS.includes(normalized)) return { action: "none" };
  return deepClone(plan.outcomes?.[normalized] ?? { action: "none" });
}

export function resolveDirective(definition, state, directive) {
  const action = directive?.action ?? "none";
  if (action === "reject") return { type: "reject", targetStage: 0 };
  if (action === "recover") return { type: "recover", targetStage: 0 };
  if (action === "none") return { type: "none", targetStage: state.currentStage };
  if (action === "stay") return { type: "stage", targetStage: state.currentStage };

  let targetStage = state.currentStage;
  if (action === "set-stage") targetStage = Math.trunc(Number(directive.stage) || 0);
  if (action === "stage-delta") targetStage += Math.trunc(Number(directive.delta) || 0);

  const maximum = definition?.stages?.length ?? 0;
  if (targetStage < 1) {
    if (definition?.progression?.belowStageOne === "clamp") return { type: "stage", targetStage: Math.min(1, maximum) };
    return { type: "recover", targetStage: 0 };
  }
  if (targetStage > maximum) {
    if (definition?.progression?.aboveMaximumStage === "end") return { type: "end", targetStage: 0 };
    return { type: "stage", targetStage: maximum };
  }
  return { type: "stage", targetStage };
}

export function resolveCheckResults(definition, state, plan, resultMap) {
  const ordered = plan.checks.map((check) => resultMap?.[check.id]?.degree ?? null);
  if (ordered.some((degree) => normalizeDegreeOfSuccess(degree) == null)) {
    return { complete: false, degree: null, directive: null, transition: null };
  }
  const degree = combineDegrees(ordered, plan.combine);
  const directive = directiveForDegree(plan, degree);
  const transition = resolveDirective(definition, state, directive);
  return { complete: true, degree, directive, transition };
}
