"use client";

// Power and sample-size planner (E3). A stateless study-design calculator, the
// GraphPad Prism / G*Power job of answering three questions before any data is
// collected:
//   - Sample size: how many subjects do I need to detect this effect?
//   - Power: with this many subjects, how likely am I to detect it?
//   - Effect size: with this many subjects, what is the smallest effect I can
//     reliably detect?
//
// It runs entirely against the engine's power.ts functions, which are reference
// validated against statsmodels. Nothing here touches the Loro doc or any stored
// shape; the planner has no persistence by design, because a power calculation is
// a what-if a researcher reruns freely, not a result worth saving. The answer is
// stated in plain language so the design decision is legible at a glance.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .bg-brand-action text-white transition-colors hover:bg-brand-action/90, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import {
  powerTwoSampleT,
  sampleSizeTwoSampleT,
  detectableDTwoSampleT,
  powerPairedT,
  sampleSizePairedT,
  detectableDzPairedT,
  powerOneWayAnova,
  sampleSizeOneWayAnova,
  detectableFOneWayAnova,
  cohenFFromEtaSquared,
  powerCorrelation,
  sampleSizeCorrelation,
  detectableRCorrelation,
} from "@/lib/datahub/engine";

// The test families the planner covers. Each family names its effect-size unit so
// the input label and the plain-language answer read correctly.
type Family = "twoSampleT" | "pairedT" | "oneWayAnova" | "correlation";

// Which quantity to solve for. The other three become the inputs.
type Solve = "sampleSize" | "power" | "effect";

const FAMILY_META: Record<
  Family,
  { label: string; blurb: string; effectLabel: string; effectName: string }
> = {
  twoSampleT: {
    label: "Two-sample t-test",
    blurb: "Two independent groups, equal sizes. Effect is Cohen's d.",
    effectLabel: "Cohen's d",
    effectName: "d",
  },
  pairedT: {
    label: "Paired t-test",
    blurb: "Two measurements on the same subjects. Effect is Cohen's dz.",
    effectLabel: "Cohen's dz",
    effectName: "dz",
  },
  oneWayAnova: {
    label: "One-way ANOVA",
    blurb: "Three or more groups. Effect is Cohen's f.",
    effectLabel: "Cohen's f",
    effectName: "f",
  },
  correlation: {
    label: "Pearson correlation",
    blurb: "Linear association between two measures. Effect is the correlation r.",
    effectLabel: "correlation r",
    effectName: "r",
  },
};

const SOLVE_META: Record<Solve, { label: string }> = {
  sampleSize: { label: "Sample size" },
  power: { label: "Power" },
  effect: { label: "Effect size" },
};

// A small numeric field so every input reads the same. We keep the raw string in
// state and parse on use, so a half-typed value (like "0.") never snaps back.
function NumberField({
  label,
  value,
  onChange,
  step,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </label>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
      />
      {hint ? (
        <p className="mt-0.5 text-[11px] text-foreground-muted">{hint}</p>
      ) : null}
    </div>
  );
}

// Round a percentage cleanly for the plain-language answer.
function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export default function PowerPlannerDialog({
  open,
  onCancel,
}: {
  open: boolean;
  onCancel: () => void;
}) {
  const [family, setFamily] = useState<Family>("twoSampleT");
  const [solve, setSolve] = useState<Solve>("sampleSize");

  // Inputs. Held as strings so partial entry is calm; parsed at compute time.
  const [effect, setEffect] = useState("0.8");
  const [alpha, setAlpha] = useState("0.05");
  const [power, setPower] = useState("0.8");
  const [n, setN] = useState("26"); // per-group / pairs / total, family dependent
  const [k, setK] = useState("3"); // number of groups, ANOVA only
  const [etaInput, setEtaInput] = useState(false); // ANOVA effect entered as eta2

  // Reset to the common default on each open so a stale answer never lingers.
  useEffect(() => {
    if (!open) return;
    setFamily("twoSampleT");
    setSolve("sampleSize");
    setEffect("0.8");
    setAlpha("0.05");
    setPower("0.8");
    setN("26");
    setK("3");
    setEtaInput(false);
  }, [open]);

  // Escape closes, so the calculator is never a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const meta = FAMILY_META[family];
  const isAnova = family === "oneWayAnova";

  // The N input means different things per family, so the label adapts.
  const nLabel =
    family === "twoSampleT"
      ? "N per group"
      : family === "pairedT"
        ? "Number of pairs"
        : family === "oneWayAnova"
          ? "Total N (all groups)"
          : "Number of pairs (N)";

  // Compute the answer for the chosen direction. Everything is pure and cheap, so
  // we recompute on every keystroke rather than gate behind a button.
  const result = useMemo<{ kind: "ok"; text: string } | { kind: "bad"; text: string }>(() => {
    const a = Number(alpha);
    const pw = Number(power);
    const eff = Number(effect);
    const nn = Math.round(Number(n));
    const kk = Math.round(Number(k));

    if (!(a > 0 && a < 1)) return { kind: "bad", text: "Enter an alpha between 0 and 1, such as 0.05." };

    // The ANOVA effect can be entered as eta-squared and converted to Cohen's f.
    const anovaF = isAnova && etaInput ? cohenFFromEtaSquared(eff) : eff;

    if (solve === "sampleSize") {
      if (!(pw > 0 && pw < 1)) return { kind: "bad", text: "Enter a target power between 0 and 1, such as 0.8." };
      let need: number | null = null;
      if (family === "twoSampleT") need = sampleSizeTwoSampleT(eff, a, pw);
      else if (family === "pairedT") need = sampleSizePairedT(eff, a, pw);
      else if (family === "oneWayAnova") {
        if (!(kk >= 2)) return { kind: "bad", text: "An ANOVA needs at least 2 groups." };
        need = sampleSizeOneWayAnova(kk, anovaF, a, pw);
      } else need = sampleSizeCorrelation(eff, a, pw);
      if (need === null)
        return { kind: "bad", text: "No finite sample size reaches that power for this effect. Increase the effect size or lower the target power." };
      if (family === "twoSampleT")
        return { kind: "ok", text: `To detect ${meta.effectName} = ${eff} at ${pct(pw)} power with alpha ${a}, you need N = ${need} per group (${need * 2} total).` };
      if (family === "oneWayAnova") {
        const per = Math.ceil(need / kk);
        return { kind: "ok", text: `To detect ${meta.effectName} = ${anovaF.toFixed(3)} across ${kk} groups at ${pct(pw)} power with alpha ${a}, you need N = ${need} total (about ${per} per group).` };
      }
      return { kind: "ok", text: `To detect ${meta.effectName} = ${eff} at ${pct(pw)} power with alpha ${a}, you need N = ${need} ${family === "correlation" ? "pairs" : "pairs"}.` };
    }

    if (solve === "power") {
      if (!(nn >= 2)) return { kind: "bad", text: "Enter a sample size of at least 2." };
      let achieved = NaN;
      if (family === "twoSampleT") achieved = powerTwoSampleT(nn, eff, a);
      else if (family === "pairedT") achieved = powerPairedT(nn, eff, a);
      else if (family === "oneWayAnova") {
        if (!(kk >= 2)) return { kind: "bad", text: "An ANOVA needs at least 2 groups." };
        if (!(nn > kk)) return { kind: "bad", text: "Total N must be larger than the number of groups." };
        achieved = powerOneWayAnova(nn, kk, anovaF, a);
      } else {
        if (!(nn >= 4)) return { kind: "bad", text: "A correlation needs at least 4 pairs." };
        achieved = powerCorrelation(nn, eff, a);
      }
      if (!Number.isFinite(achieved)) return { kind: "bad", text: "Could not compute power for those inputs." };
      const unit = family === "twoSampleT" ? `${nn} per group` : family === "oneWayAnova" ? `${nn} total across ${kk} groups` : `${nn} pairs`;
      const effLabel = isAnova ? `${meta.effectName} = ${anovaF.toFixed(3)}` : `${meta.effectName} = ${eff}`;
      return { kind: "ok", text: `With ${unit} at alpha ${a}, you have ${pct(achieved)} power to detect ${effLabel}.` };
    }

    // solve === "effect"
    if (!(pw > 0 && pw < 1)) return { kind: "bad", text: "Enter a target power between 0 and 1, such as 0.8." };
    if (!(nn >= 2)) return { kind: "bad", text: "Enter a sample size of at least 2." };
    let detectable: number | null = null;
    if (family === "twoSampleT") detectable = detectableDTwoSampleT(nn, a, pw);
    else if (family === "pairedT") detectable = detectableDzPairedT(nn, a, pw);
    else if (family === "oneWayAnova") {
      if (!(kk >= 2)) return { kind: "bad", text: "An ANOVA needs at least 2 groups." };
      if (!(nn > kk)) return { kind: "bad", text: "Total N must be larger than the number of groups." };
      detectable = detectableFOneWayAnova(nn, kk, a, pw);
    } else {
      if (!(nn >= 4)) return { kind: "bad", text: "A correlation needs at least 4 pairs." };
      detectable = detectableRCorrelation(nn, a, pw);
    }
    if (detectable === null || !Number.isFinite(detectable))
      return { kind: "bad", text: "Could not solve for a detectable effect at those inputs." };
    const unit = family === "twoSampleT" ? `${nn} per group` : family === "oneWayAnova" ? `${nn} total across ${kk} groups` : `${nn} pairs`;
    return { kind: "ok", text: `With ${unit} at ${pct(pw)} power and alpha ${a}, the smallest effect you can detect is ${meta.effectName} = ${detectable.toFixed(3)}.` };
  }, [family, solve, effect, alpha, power, n, k, isAnova, etaInput, meta]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="datahub-power-planner-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Power and sample-size planner"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface-overlay p-5 shadow-xl"
      >
        <div className="flex items-start gap-2">
          <Icon name="gauge" className="mt-0.5 h-5 w-5 shrink-0 text-brand-action" />
          <div>
            <h2 className="text-title font-semibold text-foreground">
              Power and sample-size planner
            </h2>
            <p className="mt-1 text-meta text-foreground-muted">
              Design a study before you collect data. Pick a test, choose what to
              solve for, and read the answer. Nothing here is saved, so try as
              many what-ifs as you like.
            </p>
          </div>
        </div>

        <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Test
        </label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(Object.keys(FAMILY_META) as Family[]).map((f) => {
            const active = family === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFamily(f)}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-sky-400 bg-accent-soft"
                    : "border-border bg-surface-raised hover:bg-surface-sunken"
                }`}
                data-testid={`power-family-${f}`}
              >
                <span className="block text-body font-medium text-foreground">
                  {FAMILY_META[f].label}
                </span>
                <span className="mt-0.5 block text-[11px] text-foreground-muted">
                  {FAMILY_META[f].blurb}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Solve for
        </label>
        <div className="mt-1 inline-flex rounded-md border border-border bg-surface-raised p-0.5">
          {(Object.keys(SOLVE_META) as Solve[]).map((s) => {
            const active = solve === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSolve(s)}
                className={`rounded px-3 py-1 text-meta font-semibold transition-colors ${
                  active
                    ? "bg-accent-soft text-foreground"
                    : "text-foreground-muted hover:text-foreground"
                }`}
                data-testid={`power-solve-${s}`}
              >
                {SOLVE_META[s].label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {/* Effect size is an input unless we are solving for it. */}
          {solve !== "effect" && (
            <div>
              <NumberField
                label={isAnova && etaInput ? "eta-squared" : meta.effectLabel}
                value={effect}
                onChange={setEffect}
                step="0.01"
              />
              {isAnova && (
                <button
                  type="button"
                  onClick={() => setEtaInput((v) => !v)}
                  className="mt-1 text-[11px] font-medium text-brand-action hover:underline"
                >
                  {etaInput ? "Enter as Cohen's f instead" : "Enter as eta-squared instead"}
                </button>
              )}
            </div>
          )}

          {/* Sample size is an input unless we are solving for it. */}
          {solve !== "sampleSize" && (
            <NumberField label={nLabel} value={n} onChange={setN} step="1" />
          )}

          {/* Target power is an input when solving for N or effect. */}
          {solve !== "power" && (
            <NumberField
              label="Target power"
              value={power}
              onChange={setPower}
              step="0.05"
              hint="Commonly 0.8 or 0.9."
            />
          )}

          <NumberField
            label="Alpha"
            value={alpha}
            onChange={setAlpha}
            step="0.01"
            hint="Two-sided, commonly 0.05."
          />

          {isAnova && (
            <NumberField label="Number of groups (k)" value={k} onChange={setK} step="1" />
          )}
        </div>

        <div
          className={`mt-4 rounded-md border px-3 py-2.5 text-body ${
            result.kind === "ok"
              ? "border-sky-400 bg-accent-soft text-foreground"
              : "border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
          }`}
          data-testid="power-planner-result"
          aria-live="polite"
        >
          {result.text}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-body font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
