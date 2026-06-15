"use client";

// Dev exploration: how deep should a popup's family hue go?
//
// Three options for the note popup (family hue = sky), each shown as a mock note
// header + its functional accents (focus ring, selected chip, primary button,
// entry edit border):
//   1. Title marker only — functional stays semantic green.
//   2. Full recolor — everything sky.
//   3. Hue except primary actions — sky everywhere but the primary button stays
//      green (confirm semantics).
// Dark toggle. Throwaway, folderless via the providers bypass.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";

type Variant = {
  n: string;
  label: string;
  // hue for each functional element
  focus: string; // border hue for focus ring + edit borders
  chip: string; // selected chip hue
  button: string; // primary action button hue
};

const VARIANTS: Variant[] = [
  { n: "1", label: "Title marker only", focus: "emerald", chip: "emerald", button: "emerald" },
  { n: "2", label: "Full recolor", focus: "sky", chip: "sky", button: "sky" },
  { n: "3", label: "Hue except primary", focus: "sky", chip: "sky", button: "emerald" },
];

export default function RecolorDepthPage() {
  const [dark, setDark] = useState(false);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      if (next) document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      return next;
    });
  }, []);

  return (
    <div className="ros-calm-surface min-h-screen text-foreground">
      <div className="mx-auto max-w-6xl px-8 py-10">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Recolor depth, note popup (sky)
            </h1>
            <p className="mt-1 text-meta text-foreground-muted">
              How far the family hue reaches. Title marker is sky in all three;
              the difference is the functional accents. Flip dark mode.
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="shrink-0 rounded-lg border border-border bg-surface-raised px-4 py-2 text-body font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06)] transition-all hover:shadow-[0_2px_4px_rgba(15,23,42,0.10),0_4px_10px_rgba(15,23,42,0.10)]"
          >
            {dark ? "Switch to light" : "Switch to dark"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {VARIANTS.map((v) => (
            <div
              key={v.n}
              className="ros-popup-card-shadow rounded-2xl px-6 py-5"
              style={{
                background:
                  "radial-gradient(130% 70% at 50% -6%, var(--editor-room-top), var(--editor-room-bot))",
              }}
            >
              <p className="mb-3 text-meta font-semibold text-foreground-muted">
                Option {v.n} - {v.label}
              </p>

              {/* Title marker (sky in all) */}
              <div className="text-2xl font-extrabold leading-tight">
                <span className="ros-title-accent ros-accent-sky">Lab notebook entry</span>
              </div>
              <div className="mt-2 text-meta text-foreground-muted">
                Edited 2h ago by mira
              </div>

              {/* Focused input (focus ring hue) */}
              <input
                readOnly
                value="Buffer prep notes"
                className={`mt-5 w-full rounded-lg border-2 bg-surface-raised px-3 py-2 text-body focus:outline-none ${BORDER[v.focus]}`}
              />

              {/* Selected chip */}
              <div className="mt-3 flex gap-2">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-meta font-medium ${CHIP[v.chip]}`}>
                  Selected tag
                </span>
                <span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-meta text-foreground-muted">
                  Other tag
                </span>
              </div>

              {/* Entry edit border */}
              <input
                readOnly
                value="Entry title (editing)"
                className={`mt-4 w-full border-b-2 bg-transparent px-1 py-1 text-body font-medium focus:outline-none ${BORDER[v.button === v.focus ? v.focus : v.focus]}`}
              />

              {/* Primary action button (button hue) */}
              <button
                type="button"
                className={`mt-5 w-full rounded-lg px-4 py-2 text-body font-semibold text-white transition-colors ${BTN[v.button]}`}
              >
                Save entry
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const BORDER: Record<string, string> = {
  emerald: "border-emerald-500",
  sky: "border-sky-500",
};
const BTN: Record<string, string> = {
  emerald: "bg-emerald-600 hover:bg-emerald-700",
  sky: "bg-sky-600 hover:bg-sky-700",
};
const CHIP: Record<string, string> = {
  emerald:
    "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40",
  sky: "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-500/40",
};
