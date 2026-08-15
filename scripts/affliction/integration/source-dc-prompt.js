function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function statisticLabel(statistic) {
  const key = {
    fortitude: "PF2E.SavesFortitude",
    reflex: "PF2E.SavesReflex",
    will: "PF2E.SavesWill"
  }[statistic];
  const value = key ? globalThis.game?.i18n?.localize?.(key) : null;
  return value && value !== key ? value : String(statistic ?? "");
}

export function sourceDcChecks(definition) {
  return (definition?.checks ?? []).filter((check) => check?.dcMode === "source");
}

export function sourceDcApplicationOptions(values = {}, checks = []) {
  const list = Array.isArray(checks) ? checks : [];
  if (list.length === 0) return {};
  const saveDcs = {};
  for (const [index, check] of list.entries()) {
    const raw = values?.[`dc_${index}`] ?? values?.[`dc.${check.id}`] ?? values?.dc?.[check.id] ?? values?.[check.id] ?? values?.saveDc;
    const dc = Number(raw);
    if (!Number.isInteger(dc) || dc < 1 || dc > 100) {
      throw new RangeError(`${check.label || check.id}: ${localize("PF2E_AFFLICTION_FORGE.Runtime.SourceDcInvalid")}`);
    }
    saveDcs[check.id] = dc;
  }
  if (list.length === 1) return { saveDc: saveDcs[list[0].id] };
  return { saveDcs };
}

function makePromptContent(definition, checks) {
  const root = document.createElement("div");
  const wrapper = document.createElement("div");
  wrapper.className = "pf2e-affliction-source-dc-dialog";

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = globalThis.game?.i18n?.format?.("PF2E_AFFLICTION_FORGE.Runtime.SourceDcPromptHint", {
    name: definition?.name ?? ""
  }) ?? localize("PF2E_AFFLICTION_FORGE.Runtime.SourceDcPromptHint");
  wrapper.append(hint);

  for (const [index, check] of checks.entries()) {
    const label = document.createElement("label");
    label.className = "pf2e-affliction-source-dc-row";
    const span = document.createElement("span");
    const name = String(check.label ?? "").trim() || check.id;
    span.textContent = `${name} · ${statisticLabel(check.statistic)}`;
    const input = document.createElement("input");
    input.type = "number";
    input.name = `dc_${index}`;
    input.min = "1";
    input.max = "100";
    input.step = "1";
    input.required = true;
    input.autofocus = checks[0]?.id === check.id;
    label.append(span, input);
    wrapper.append(label);
  }

  root.append(wrapper);
  return root;
}

/**
 * UI helper for GM-facing application flows. Public APIs stay fail-closed and
 * never summon UI implicitly; consumer modules should still pass saveDc/saveDcs.
 */
export async function promptSourceDcApplication(definition) {
  const checks = sourceDcChecks(definition);
  if (checks.length === 0) return {};
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.input || !globalThis.document) {
    throw new Error(localize("PF2E_AFFLICTION_FORGE.Runtime.SourceDcRequired"));
  }

  const form = await DialogV2.input({
    window: { title: localize("PF2E_AFFLICTION_FORGE.Runtime.SourceDcPromptTitle") },
    content: makePromptContent(definition, checks),
    ok: { label: localize("PF2E_AFFLICTION_FORGE.Runtime.SourceDcApply") },
    modal: true,
    rejectClose: false
  });
  if (!form) return null;
  return sourceDcApplicationOptions(form, checks);
}
