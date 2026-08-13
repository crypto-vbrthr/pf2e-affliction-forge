import { normalizeDegreeOfSuccess } from "./affliction-engine-core.js";

function readD20(roll) {
  const candidates = [
    roll?.dice?.[0]?.total,
    roll?.dice?.[0]?.results?.find?.((entry) => entry?.active !== false)?.result,
    roll?.terms?.find?.((term) => Array.isArray(term?.results) && Number(term?.faces) === 20)
      ?.results?.find?.((entry) => entry?.active !== false)?.result
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value >= 1 && value <= 20) return value;
  }
  return null;
}

function fallbackDegree(roll, dc) {
  const total = Number(roll?.total);
  const target = Number(dc);
  if (!Number.isFinite(total) || !Number.isFinite(target)) return null;
  let index = total >= target + 10 ? 3 : total >= target ? 2 : total <= target - 10 ? 0 : 1;
  const d20 = readD20(roll);
  if (d20 === 20) index = Math.min(3, index + 1);
  if (d20 === 1) index = Math.max(0, index - 1);
  return ["criticalFailure", "failure", "success", "criticalSuccess"][index];
}

export function readPf2eRollDegree(roll, dc) {
  return normalizeDegreeOfSuccess(
    roll?.degreeOfSuccess ??
    roll?.options?.degreeOfSuccess ??
    roll?.options?.outcome
  ) ?? fallbackDegree(roll, dc);
}

export function rollModeForPolicy({ visibility = "public", execution = "automatic" } = {}) {
  if (visibility !== "gmOnly") return "publicroll";
  return execution === "player" ? "blindroll" : "gmroll";
}

export async function rollPf2eSave(actor, check, {
  skipDialog = false,
  visibility = "public",
  execution = "automatic",
  dcVisible = true,
  extraRollOptions = []
} = {}) {
  if (!actor) throw new TypeError("A PF2e Actor is required for a saving throw.");
  const statistic = actor.getStatistic?.(check.statistic) ?? actor.saves?.[check.statistic] ?? null;
  if (!statistic || typeof statistic.roll !== "function") {
    throw new Error(`Saving throw statistic is unavailable: ${check.statistic}`);
  }

  const rollMode = rollModeForPolicy({ visibility, execution });
  const roll = await statistic.roll({
    dc: {
      value: Number(check.dc),
      visible: Boolean(dcVisible)
    },
    skipDialog: Boolean(skipDialog),
    createMessage: true,
    rollMode,
    blind: rollMode === "blindroll",
    extraRollOptions: [
      "affliction-forge",
      `affliction-forge:check:${check.id}`,
      ...extraRollOptions
    ]
  });
  if (!roll) return null;

  const degree = readPf2eRollDegree(roll, check.dc);
  if (!degree) throw new Error("PF2e saving throw completed without a resolvable degree of success.");
  return {
    degree,
    total: Number.isFinite(Number(roll.total)) ? Number(roll.total) : null,
    d20: readD20(roll),
    rollId: roll.id ?? roll._id ?? null,
    roll
  };
}
