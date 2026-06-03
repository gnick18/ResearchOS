"use client";

import { useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import {
  evaluateExpression,
  type AngleMode,
} from "@/lib/calculators/scientific";
import {
  molesFromMass,
  massFromConcVolumeMw,
  concFromMolesVolume,
  dilutionV1,
  serialDilution,
  sequenceStats,
  tmWallace,
  naMolesFromMass,
  concFromA260,
  bufferRecipe,
  type NucleicAcidKind,
} from "@/lib/calculators/calculators";
import { nearestNeighborTm } from "@/lib/calculators/tm-nn";
import {
  parseNum,
  formatNum,
  concToBase,
  volToBase,
  volFromBase,
  massToBase,
  moleFromBase,
  CONC_UNITS,
  VOL_UNITS,
  MASS_UNITS,
  type ConcUnit,
  type VolUnit,
  type MassUnit,
} from "@/lib/calculators/units";

/**
 * Calculator icon (outline beaker + small "=" mark). Inline SVG to match the
 * rest of the app's custom iconography. `aria-hidden` because the button
 * carries the accessible label.
 */
function CalculatorIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 11h2M14 11h2" />
      <path d="M8 15h2M14 15h2" />
      <path d="M8 18.5h2M14 18.5h2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function CalculatorsButton() {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <Tooltip label="Lab calculators" placement="top">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          aria-label="Open lab calculators"
          data-tour-target="lab-calculators-button"
          className="pointer-events-auto w-12 h-12 rounded-full bg-white border border-gray-200 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-gray-600 hover:text-gray-900"
        >
          <CalculatorIcon />
        </button>
      </Tooltip>

      {showModal && <CalculatorsModal onClose={() => setShowModal(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal shell + tabs
// ---------------------------------------------------------------------------

type TabId =
  | "scientific"
  | "molarity"
  | "dilution"
  | "serial"
  | "tm"
  | "nucleic"
  | "buffer";

const TABS: { id: TabId; label: string }[] = [
  { id: "scientific", label: "Scientific" },
  { id: "molarity", label: "Molarity" },
  { id: "dilution", label: "Dilution" },
  { id: "serial", label: "Serial dilution" },
  { id: "tm", label: "Primer Tm" },
  { id: "nucleic", label: "DNA / RNA" },
  { id: "buffer", label: "Buffer recipe" },
];

function CalculatorsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("scientific");

  return (
    <div
      // pointer-events-auto: this modal renders inside AppShell's
      // floating-cluster div which is `pointer-events-none`, so without
      // this override the backdrop + close button would silently no-op.
      // Mirrors the BetaDonationButton DonationModal pattern.
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
      // Marker for TourSpotlight popup-occluding sweep so the walkthrough
      // ring hides while this modal is mounted.
      data-tour-popup-occluding="calculators-modal"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-sky-100 text-sky-600">
              <CalculatorIcon className="w-4 h-4" />
            </span>
            Lab calculators
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Calculator type"
          className="flex flex-wrap gap-1 px-4 pt-3 border-b border-gray-100"
        >
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  "px-3 py-1.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px " +
                  (active
                    ? "border-sky-500 text-sky-700 bg-sky-50"
                    : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50")
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          {tab === "scientific" && <ScientificCalcTab />}
          {tab === "molarity" && <MolarityTab />}
          {tab === "dilution" && <DilutionTab />}
          {tab === "serial" && <SerialTab />}
          {tab === "tm" && <TmTab />}
          {tab === "nucleic" && <NucleicTab />}
          {tab === "buffer" && <BufferTab />}
        </div>

        <p className="px-6 py-3 text-[11px] text-gray-400 border-t border-gray-100">
          Quick bench math, computed live in your browser. Nothing here is
          saved.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared field primitives
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-gray-600 mb-1">
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400";
const selectCls =
  "rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400";

function NumberWithUnit<U extends string>({
  label,
  value,
  onValue,
  unit,
  onUnit,
  units,
  placeholder,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  unit: U;
  onUnit: (u: U) => void;
  units: readonly U[];
  placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={placeholder}
          className={inputCls}
        />
        <select
          value={unit}
          onChange={(e) => onUnit(e.target.value as U)}
          className={selectCls}
          aria-label={`${label} unit`}
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function PlainNumber({
  label,
  value,
  onValue,
  placeholder,
  suffix,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={placeholder}
          className={inputCls}
        />
        {suffix && <span className="text-xs text-gray-500 whitespace-nowrap">{suffix}</span>}
      </div>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-base font-semibold text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}

function ResultCard({
  children,
  empty,
}: {
  children?: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-400">
        Enter the values above to see results.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-4">{children}</div>
  );
}

// ---------------------------------------------------------------------------
// 0. Scientific calculator (general-purpose, on mathjs)
// ---------------------------------------------------------------------------

type KeyVariant = "digit" | "fn" | "op" | "accent" | "muted";

function CalcKey({
  label,
  onPress,
  ariaLabel,
  variant = "digit",
  className = "",
}: {
  label: React.ReactNode;
  onPress: () => void;
  ariaLabel?: string;
  variant?: KeyVariant;
  className?: string;
}) {
  const variants: Record<KeyVariant, string> = {
    digit: "bg-gray-50 text-gray-900 hover:bg-gray-100",
    fn: "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50",
    op: "bg-sky-50 text-sky-700 hover:bg-sky-100",
    accent: "bg-sky-600 text-white hover:bg-sky-700",
    muted: "bg-gray-100 text-gray-600 hover:bg-gray-200",
  };
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={ariaLabel}
      className={`rounded-lg py-2.5 text-sm font-medium tabular-nums transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${variants[variant]} ${className}`}
    >
      {label}
    </button>
  );
}

function ScientificCalcTab() {
  const [expr, setExpr] = useState("");
  const [angleMode, setAngleMode] = useState<AngleMode>("rad");
  const [ans, setAns] = useState(0);
  const [memory, setMemory] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const result = useMemo(
    () => evaluateExpression(expr, { angleMode, ans, memory }),
    [expr, angleMode, ans, memory],
  );

  const focusCaret = (pos: number) => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const insert = (text: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? expr.length;
    setExpr(expr.slice(0, start) + text + expr.slice(end));
    focusCaret(start + text.length);
  };

  const backspace = () => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? expr.length;
    if (start === end) {
      if (start === 0) return;
      setExpr(expr.slice(0, start - 1) + expr.slice(end));
      focusCaret(start - 1);
    } else {
      setExpr(expr.slice(0, start) + expr.slice(end));
      focusCaret(start);
    }
  };

  const clearAll = () => {
    setExpr("");
    focusCaret(0);
  };

  const commit = () => {
    if (!result.ok) return;
    setAns(result.value);
    setExpr(result.display);
    focusCaret(result.display.length);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearAll();
    }
  };

  // [display label, text to insert, accessible name]
  const FN_KEYS: [string, string, string][] = [
    ["sin", "sin(", "sine"],
    ["cos", "cos(", "cosine"],
    ["tan", "tan(", "tangent"],
    ["ln", "ln(", "natural log"],
    ["log", "log10(", "log base 10"],
    ["asin", "asin(", "inverse sine"],
    ["acos", "acos(", "inverse cosine"],
    ["atan", "atan(", "inverse tangent"],
    ["√", "sqrt(", "square root"],
    ["x^y", "^", "power"],
    ["(", "(", "open parenthesis"],
    [")", ")", "close parenthesis"],
    ["π", "pi", "pi"],
    ["e", "e", "euler's number"],
    ["x!", "!", "factorial"],
  ];

  const showResult = result.ok || expr.trim() !== "";

  return (
    <div className="space-y-4">
      {/* Display */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <input
          ref={inputRef}
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type an expression, e.g. sqrt(2) * sin(45)"
          aria-label="Expression"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent text-lg font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none"
        />
        <div
          className="mt-1 text-right text-2xl font-semibold tabular-nums min-h-[2rem]"
          aria-live="polite"
        >
          {result.ok ? (
            <span className="text-gray-900">= {result.display}</span>
          ) : showResult ? (
            <span className="text-gray-300">=</span>
          ) : (
            <span className="text-gray-300">0</span>
          )}
        </div>
      </div>

      {/* Angle mode + memory */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
          {(["deg", "rad"] as AngleMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setAngleMode(m)}
              aria-pressed={angleMode === m}
              className={
                "px-3 py-1.5 transition-colors " +
                (angleMode === m
                  ? "bg-sky-600 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50")
              }
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400 px-1 tabular-nums">M={memory}</span>
          <CalcKey label="MC" variant="muted" ariaLabel="memory clear" onPress={() => setMemory(0)} className="px-2.5 py-1" />
          <CalcKey label="MR" variant="muted" ariaLabel="memory recall" onPress={() => insert("M")} className="px-2.5 py-1" />
          <CalcKey
            label="M+"
            variant="muted"
            ariaLabel="memory add"
            onPress={() => {
              if (result.ok) setMemory((v) => v + result.value);
            }}
            className="px-2.5 py-1"
          />
        </div>
      </div>

      {/* Function keys */}
      <div className="grid grid-cols-5 gap-1.5">
        {FN_KEYS.map(([label, text, aria], i) => (
          <CalcKey key={i} label={label} variant="fn" ariaLabel={aria} onPress={() => insert(text)} />
        ))}
      </div>

      {/* Number pad + operators */}
      <div className="grid grid-cols-4 gap-1.5">
        <CalcKey label="AC" variant="muted" ariaLabel="clear all" onPress={clearAll} />
        <CalcKey label="⌫" variant="muted" ariaLabel="backspace" onPress={backspace} />
        <CalcKey label="Ans" variant="muted" ariaLabel="last answer" onPress={() => insert("Ans")} />
        <CalcKey label="÷" variant="op" ariaLabel="divide" onPress={() => insert("/")} />

        <CalcKey label="7" onPress={() => insert("7")} />
        <CalcKey label="8" onPress={() => insert("8")} />
        <CalcKey label="9" onPress={() => insert("9")} />
        <CalcKey label="×" variant="op" ariaLabel="multiply" onPress={() => insert("*")} />

        <CalcKey label="4" onPress={() => insert("4")} />
        <CalcKey label="5" onPress={() => insert("5")} />
        <CalcKey label="6" onPress={() => insert("6")} />
        <CalcKey label="−" variant="op" ariaLabel="subtract" onPress={() => insert("-")} />

        <CalcKey label="1" onPress={() => insert("1")} />
        <CalcKey label="2" onPress={() => insert("2")} />
        <CalcKey label="3" onPress={() => insert("3")} />
        <CalcKey label="+" variant="op" ariaLabel="add" onPress={() => insert("+")} />

        <CalcKey label="0" onPress={() => insert("0")} className="col-span-2" />
        <CalcKey label="." onPress={() => insert(".")} />
        <CalcKey label="=" variant="accent" ariaLabel="equals" onPress={commit} />
      </div>

      <p className="text-[11px] text-gray-500">
        Computed live with mathjs. Type directly (Enter sets Ans, Esc clears) or
        use the keys. sin / cos / tan and inverses, ln, log (base 10), sqrt,
        powers (^), factorial (!), pi, e. Nothing here is saved.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Molarity
// ---------------------------------------------------------------------------

function MolarityTab() {
  // Solve mode: given any 3 of {MW, mass, volume, concentration}, the most
  // common bench task is "how much do I weigh out", so we compute mass from
  // concentration + volume + MW, and also surface moles + the resulting
  // concentration when a mass is entered instead.
  const [mw, setMw] = useState("");
  const [conc, setConc] = useState("");
  const [concU, setConcU] = useState<ConcUnit>("mM");
  const [vol, setVol] = useState("");
  const [volU, setVolU] = useState<VolUnit>("mL");
  const [mass, setMass] = useState("");
  const [massU, setMassU] = useState<MassUnit>("mg");

  const mwN = parseNum(mw);
  const concN = parseNum(conc);
  const volN = parseNum(vol);
  const massN = parseNum(mass);

  // Primary path: mass to weigh out for a target conc + volume.
  const weighOutG =
    mwN !== null && concN !== null && volN !== null
      ? massFromConcVolumeMw(concToBase(concN, concU), volToBase(volN, volU), mwN)
      : null;

  // Secondary path: if a mass is entered, show moles + resulting conc.
  const molesFromMassN =
    mwN !== null && massN !== null
      ? molesFromMass(massToBase(massN, massU), mwN)
      : null;
  const concFromMass =
    molesFromMassN !== null && volN !== null
      ? concFromMolesVolume(molesFromMassN, volToBase(volN, volU))
      : null;

  const hasResult = weighOutG !== null || molesFromMassN !== null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Uses n = m / MW and C = n / V. Enter molecular weight, then a target
        concentration and volume to get the mass to weigh out (or enter a mass
        to get moles and concentration).
      </p>
      <PlainNumber label="Molecular weight" value={mw} onValue={setMw} placeholder="e.g. 58.44" suffix="g/mol" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberWithUnit label="Target concentration" value={conc} onValue={setConc} unit={concU} onUnit={setConcU} units={CONC_UNITS} />
        <NumberWithUnit label="Volume" value={vol} onValue={setVol} unit={volU} onUnit={setVolU} units={VOL_UNITS} />
      </div>
      <NumberWithUnit label="Mass (optional, to go the other way)" value={mass} onValue={setMass} unit={massU} onUnit={setMassU} units={MASS_UNITS} />

      <ResultCard empty={!hasResult}>
        {weighOutG !== null && (
          <ResultRow
            label="Mass to weigh out"
            value={describeMass(weighOutG)}
          />
        )}
        {molesFromMassN !== null && (
          <ResultRow label="Amount (from mass)" value={describeMoles(molesFromMassN)} />
        )}
        {concFromMass !== null && (
          <ResultRow label="Resulting concentration" value={describeConc(concFromMass)} />
        )}
      </ResultCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Dilution C1V1 = C2V2
// ---------------------------------------------------------------------------

function DilutionTab() {
  const [c1, setC1] = useState("");
  const [c1u, setC1u] = useState<ConcUnit>("mM");
  const [c2, setC2] = useState("");
  const [c2u, setC2u] = useState<ConcUnit>("uM");
  const [v2, setV2] = useState("");
  const [v2u, setV2u] = useState<VolUnit>("mL");

  const c1n = parseNum(c1);
  const c2n = parseNum(c2);
  const v2n = parseNum(v2);

  const v1L =
    c1n !== null && c2n !== null && v2n !== null
      ? dilutionV1(concToBase(c1n, c1u), concToBase(c2n, c2u), volToBase(v2n, v2u))
      : null;

  const v2L = v2n !== null ? volToBase(v2n, v2u) : null;
  const diluentL = v1L !== null && v2L !== null ? v2L - v1L : null;
  const overflow = v1L !== null && v2L !== null && v1L > v2L;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        C1 V1 = C2 V2. Enter your stock concentration, the final concentration
        you want, and the final volume; this solves for how much stock to add.
      </p>
      <NumberWithUnit label="Stock concentration (C1)" value={c1} onValue={setC1} unit={c1u} onUnit={setC1u} units={CONC_UNITS} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberWithUnit label="Final concentration (C2)" value={c2} onValue={setC2} unit={c2u} onUnit={setC2u} units={CONC_UNITS} />
        <NumberWithUnit label="Final volume (V2)" value={v2} onValue={setV2} unit={v2u} onUnit={setV2u} units={VOL_UNITS} />
      </div>

      <ResultCard empty={v1L === null}>
        {v1L !== null && overflow && (
          <p className="text-sm text-amber-700">
            The final concentration is higher than the stock; check your inputs.
          </p>
        )}
        {v1L !== null && !overflow && (
          <>
            <ResultRow label="Stock to add (V1)" value={describeVol(v1L)} />
            {diluentL !== null && (
              <ResultRow label="Diluent to add" value={describeVol(diluentL)} />
            )}
          </>
        )}
      </ResultCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Serial dilution
// ---------------------------------------------------------------------------

function SerialTab() {
  const [start, setStart] = useState("");
  const [startU, setStartU] = useState<ConcUnit>("uM");
  const [fold, setFold] = useState("10");
  const [steps, setSteps] = useState("5");
  const [vol, setVol] = useState("");
  const [volU, setVolU] = useState<VolUnit>("uL");

  const startN = parseNum(start);
  const foldN = parseNum(fold);
  const stepsN = parseNum(steps);
  const volN = parseNum(vol);

  const rows = useMemo(() => {
    if (startN === null || foldN === null || stepsN === null || volN === null) {
      return [];
    }
    return serialDilution(startN, foldN, stepsN, volN);
  }, [startN, foldN, stepsN, volN]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Each tube takes a fixed transfer of the previous tube and tops up with
        diluent to the per-tube volume, giving an equal fold dilution per step.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberWithUnit label="Starting concentration" value={start} onValue={setStart} unit={startU} onUnit={setStartU} units={CONC_UNITS} />
        <NumberWithUnit label="Per-tube final volume" value={vol} onValue={setVol} unit={volU} onUnit={setVolU} units={VOL_UNITS} />
        <PlainNumber label="Fold factor (each step)" value={fold} onValue={setFold} placeholder="e.g. 10" suffix="x" />
        <PlainNumber label="Number of steps" value={steps} onValue={setSteps} placeholder="e.g. 5" />
      </div>

      {rows.length === 0 ? (
        <ResultCard empty />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sky-100">
          <table className="w-full text-sm">
            <thead className="bg-sky-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Tube</th>
                <th className="px-3 py-2 text-right font-semibold">Concentration</th>
                <th className="px-3 py-2 text-right font-semibold">Sample</th>
                <th className="px-3 py-2 text-right font-semibold">Diluent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.step} className="border-t border-sky-50">
                  <td className="px-3 py-1.5 text-gray-700">{r.step}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-900">
                    {formatNum(r.concentration)} {startU}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                    {formatNum(r.sampleVolume)} {volU}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                    {formatNum(r.diluentVolume)} {volU}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Primer Tm
// ---------------------------------------------------------------------------

function TmTab() {
  const [seq, setSeq] = useState("");
  const [salt, setSalt] = useState("50");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [oligo, setOligo] = useState("0.25");
  const [oligoUnit, setOligoUnit] = useState<"uM" | "nM">("uM");
  const [mg, setMg] = useState("0");
  const [dntp, setDntp] = useState("0");

  const stats = useMemo(() => sequenceStats(seq), [seq]);
  const saltN = parseNum(salt); // monovalent [Na+/K+] in mM
  const oligoN = parseNum(oligo);
  // Total oligo strand concentration in nM (IDT default 0.25 uM if blank).
  const oligoNm = oligoN !== null ? concToBase(oligoN, oligoUnit) * 1e9 : 250;
  const mgN = parseNum(mg) ?? 0;
  const dntpN = parseNum(dntp) ?? 0;

  const nn =
    saltN !== null
      ? nearestNeighborTm(seq, {
          na: saltN,
          mg: mgN,
          dntps: dntpN,
          oligoNanomolar: oligoNm,
        })
      : null;
  // Wallace 2-4 rule only earns a line for very short oligos, where the
  // nearest-neighbor model is least reliable and the rule of thumb still helps.
  const wallace = tmWallace(seq);
  const shortOligo = stats.length > 0 && stats.length < 14;

  const hasSeq = stats.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>DNA / RNA sequence</FieldLabel>
        <textarea
          value={seq}
          onChange={(e) => setSeq(e.target.value)}
          placeholder="e.g. ATGCGTACGTTAGC"
          rows={2}
          className={inputCls + " font-mono resize-y"}
        />
      </div>
      <PlainNumber label="Monovalent salt [Na+ / K+]" value={salt} onValue={setSalt} placeholder="e.g. 50" suffix="mM" />

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          aria-expanded={showAdvanced}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
            aria-hidden="true"
          >
            <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Advanced (oligo conc, Mg2+, dNTP)
        </button>
        {showAdvanced && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumberWithUnit
              label="Oligo conc"
              value={oligo}
              onValue={setOligo}
              unit={oligoUnit}
              onUnit={setOligoUnit}
              units={["uM", "nM"] as const}
              placeholder="0.25"
            />
            <PlainNumber label="Mg2+" value={mg} onValue={setMg} placeholder="0" suffix="mM" />
            <PlainNumber label="dNTPs" value={dntp} onValue={setDntp} placeholder="0" suffix="mM" />
          </div>
        )}
      </div>

      {!hasSeq ? (
        <ResultCard empty />
      ) : (
        <ResultCard>
          <ResultRow label="Length" value={`${stats.length} nt`} />
          <ResultRow
            label="GC content"
            value={stats.gcPercent !== null ? `${formatNum(stats.gcPercent, 3)} %` : "-"}
          />
          <ResultRow
            label="Tm (nearest-neighbor)"
            value={nn !== null ? `${nn.tm.toFixed(1)} °C` : stats.length < 2 ? "needs 2+ bases" : "-"}
          />
          {shortOligo && wallace !== null && (
            <ResultRow label="Tm (Wallace, short oligo)" value={`${formatNum(wallace, 4)} °C`} />
          )}
          <p className="mt-2 text-[11px] text-gray-500">
            Nearest-neighbor (SantaLucia) with salt correction, the model IDT and
            Primer3 use. Set monovalent salt, and Mg2+ / dNTP / oligo
            concentration under Advanced, to match your reaction conditions. The
            Wallace 2-4 rule is shown only for very short oligos (under ~14 nt).
          </p>
        </ResultCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. DNA / RNA conversion
// ---------------------------------------------------------------------------

const NA_KINDS: { id: NucleicAcidKind; label: string }[] = [
  { id: "dsDNA", label: "dsDNA (650 g/mol/bp)" },
  { id: "ssDNA", label: "ssDNA (330 g/mol/nt)" },
  { id: "RNA", label: "RNA (330 g/mol/nt)" },
];

function NucleicTab() {
  const [kind, setKind] = useState<NucleicAcidKind>("dsDNA");
  const [length, setLength] = useState("");
  const [mass, setMass] = useState("");
  const [massU, setMassU] = useState<MassUnit>("ug");
  const [a260, setA260] = useState("");
  const [dil, setDil] = useState("1");

  const lengthN = parseNum(length);
  const massN = parseNum(mass);
  const a260n = parseNum(a260);
  const dilN = parseNum(dil);

  const lengthLabel = kind === "dsDNA" ? "Length (bp)" : "Length (nt)";

  const moles =
    lengthN !== null && massN !== null
      ? naMolesFromMass(massToBase(massN, massU), lengthN, kind)
      : null;

  const a260Conc =
    a260n !== null && dilN !== null ? concFromA260(a260n, kind, dilN) : null;

  const hasMassResult = moles !== null;
  const hasA260Result = a260Conc !== null;

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>Nucleic acid</FieldLabel>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as NucleicAcidKind)}
          className={selectCls + " w-full"}
          aria-label="Nucleic acid type"
        >
          {NA_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-gray-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Mass to moles
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PlainNumber label={lengthLabel} value={length} onValue={setLength} placeholder="e.g. 1000" />
          <NumberWithUnit label="Mass" value={mass} onValue={setMass} unit={massU} onUnit={setMassU} units={MASS_UNITS} />
        </div>
        <ResultCard empty={!hasMassResult}>
          {moles !== null && (
            <ResultRow label="Amount" value={describeMoles(moles)} />
          )}
        </ResultCard>
      </div>

      <div className="rounded-xl border border-gray-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          A260 to concentration
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PlainNumber label="A260 reading" value={a260} onValue={setA260} placeholder="e.g. 0.85" />
          <PlainNumber label="Dilution factor" value={dil} onValue={setDil} placeholder="e.g. 100" suffix="x" />
        </div>
        <ResultCard empty={!hasA260Result}>
          {a260Conc !== null && (
            <ResultRow label="Concentration" value={`${formatNum(a260Conc, 4)} ng/uL`} />
          )}
        </ResultCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Buffer / recipe
// ---------------------------------------------------------------------------

interface BufferRow {
  id: number;
  name: string;
  conc: string;
  concU: ConcUnit;
  stock: string;
  stockU: ConcUnit;
}

let bufferRowSeq = 0;
function newRow(): BufferRow {
  bufferRowSeq += 1;
  return { id: bufferRowSeq, name: "", conc: "", concU: "mM", stock: "", stockU: "M" };
}

function BufferTab() {
  const [rows, setRows] = useState<BufferRow[]>(() => [newRow(), newRow()]);
  const [total, setTotal] = useState("");
  const [totalU, setTotalU] = useState<VolUnit>("mL");

  const totalN = parseNum(total);
  const totalL = totalN !== null ? volToBase(totalN, totalU) : null;

  const result = useMemo(() => {
    if (totalL === null) return null;
    const comps = rows.map((r) => {
      const cn = parseNum(r.conc);
      const sn = parseNum(r.stock);
      return {
        name: r.name.trim() || "Component",
        finalConcM: cn !== null ? concToBase(cn, r.concU) : 0,
        stockConcM: sn !== null ? concToBase(sn, r.stockU) : 0,
      };
    });
    return bufferRecipe(comps, totalL);
  }, [rows, totalL]);

  const update = (id: number, patch: Partial<BufferRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        For each component, volume of stock = (final concentration x total
        volume) / stock concentration. The leftover is your diluent.
      </p>

      <NumberWithUnit label="Total volume" value={total} onValue={setTotal} unit={totalU} onUnit={setTotalU} units={VOL_UNITS} />

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-gray-100 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={r.name}
                onChange={(e) => update(r.id, { name: e.target.value })}
                placeholder="Component name"
                className={inputCls}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label={`Remove ${r.name || "component"}`}
                  className="flex-shrink-0 w-9 h-9 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors"
                >
                  <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberWithUnit label="Final conc" value={r.conc} onValue={(v) => update(r.id, { conc: v })} unit={r.concU} onUnit={(u) => update(r.id, { concU: u })} units={CONC_UNITS} />
              <NumberWithUnit label="Stock conc" value={r.stock} onValue={(v) => update(r.id, { stock: v })} unit={r.stockU} onUnit={(u) => update(r.id, { stockU: u })} units={CONC_UNITS} />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, newRow()])}
        className="text-sm font-medium text-sky-700 hover:text-sky-900 inline-flex items-center gap-1.5"
      >
        <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
        </svg>
        Add component
      </button>

      {result === null ? (
        <ResultCard empty />
      ) : (
        <ResultCard>
          {result.overflows && (
            <p className="mb-2 text-sm text-amber-700">
              The stock volumes add up to more than the total volume; check your
              inputs.
            </p>
          )}
          {result.components.map((c, i) => (
            <ResultRow
              key={i}
              label={`${c.name}`}
              value={c.volumeL !== null ? describeVol(c.volumeL) : "-"}
            />
          ))}
          {result.diluentL !== null && (
            <div className="mt-2 pt-2 border-t border-sky-100">
              <ResultRow label="Diluent (top up)" value={describeVol(result.diluentL)} />
            </div>
          )}
        </ResultCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display helpers: pick a human-friendly unit for a base-unit quantity.
// ---------------------------------------------------------------------------

function describeVol(baseL: number): string {
  // Pick uL / mL / L so the number reads naturally.
  if (Math.abs(baseL) < 1e-3) return `${formatNum(volFromBase(baseL, "uL"))} uL`;
  if (Math.abs(baseL) < 1) return `${formatNum(volFromBase(baseL, "mL"))} mL`;
  return `${formatNum(volFromBase(baseL, "L"))} L`;
}

function describeMass(baseG: number): string {
  const abs = Math.abs(baseG);
  if (abs < 1e-6) return `${formatNum(baseG / 1e-9)} ng`;
  if (abs < 1e-3) return `${formatNum(baseG / 1e-6)} ug`;
  if (abs < 1) return `${formatNum(baseG / 1e-3)} mg`;
  return `${formatNum(baseG)} g`;
}

function describeMoles(baseMol: number): string {
  const abs = Math.abs(baseMol);
  if (abs < 1e-9) return `${formatNum(moleFromBase(baseMol, "pmol"))} pmol`;
  if (abs < 1e-6) return `${formatNum(moleFromBase(baseMol, "nmol"))} nmol`;
  if (abs < 1e-3) return `${formatNum(moleFromBase(baseMol, "umol"))} umol`;
  if (abs < 1) return `${formatNum(moleFromBase(baseMol, "mmol"))} mmol`;
  return `${formatNum(baseMol)} mol`;
}

function describeConc(baseM: number): string {
  const abs = Math.abs(baseM);
  if (abs < 1e-6) return `${formatNum(baseM / 1e-9)} nM`;
  if (abs < 1e-3) return `${formatNum(baseM / 1e-6)} uM`;
  if (abs < 1) return `${formatNum(baseM / 1e-3)} mM`;
  return `${formatNum(baseM)} M`;
}
