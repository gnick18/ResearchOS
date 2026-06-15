"use client";

// Dev exploration: per-popup title accent across ALL object types, in two
// palette schemes, so Grant can pick the hue taxonomy.
//
// Scheme "family" = related objects share a hue (procurement / writing /
// experiments / molecular / work-data). Scheme "distinct" = every type its own
// hue. Toggle the scheme + dark mode. Title font is unchanged; only the marker
// background changes. Light = crisp pastel behind dark text; dark = opaque
// saturated fill of the SAME hue (deeper shade) behind light text.
//
// Throwaway, folderless via the providers bypass. House style, no em-dashes,
// no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";

// Each object type carries its hue under both schemes.
const TYPES: { title: string; meta: string; family: string; distinct: string }[] = [
  { title: "New Purchase", meta: "Procurement", family: "amber", distinct: "amber" },
  { title: "Supply", meta: "Procurement", family: "amber", distinct: "yellow" },
  { title: "Lab notebook entry", meta: "Writing", family: "sky", distinct: "sky" },
  { title: "Notebook", meta: "Writing", family: "sky", distinct: "blue" },
  { title: "Experiment", meta: "Experiments", family: "emerald", distinct: "emerald" },
  { title: "Method", meta: "Experiments", family: "emerald", distinct: "lime" },
  { title: "Sequence", meta: "Molecular", family: "rose", distinct: "rose" },
  { title: "Molecule", meta: "Molecular", family: "rose", distinct: "pink" },
  { title: "Project", meta: "Work + data", family: "violet", distinct: "indigo" },
  { title: "Task", meta: "Work + data", family: "violet", distinct: "orange" },
  { title: "Data Hub analysis", meta: "Work + data", family: "violet", distinct: "violet" },
  { title: "Purchase item history", meta: "Work + data", family: "violet", distinct: "fuchsia" },
];

export default function PopupTitlesPage() {
  const [dark, setDark] = useState(false);
  const [scheme, setScheme] = useState<"family" | "distinct">("family");

  const toggleDark = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      if (next) document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      return next;
    });
  }, []);

  return (
    <div className="ros-calm-surface min-h-screen text-foreground">
      <style>{ACCENT_CSS}</style>

      <div className="mx-auto max-w-6xl px-8 py-10">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Popup title accents, all object types
            </h1>
            <p className="mt-1 text-meta text-foreground-muted">
              {scheme === "family"
                ? "Scheme: domain family. Related objects share a hue; utility dialogs would stay plain."
                : "Scheme: distinct per type. Every object type its own hue."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setScheme((s) => (s === "family" ? "distinct" : "family"))}
              className="rounded-lg border border-border bg-surface-raised px-4 py-2 text-body font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06)] transition-all hover:shadow-[0_2px_4px_rgba(15,23,42,0.10),0_4px_10px_rgba(15,23,42,0.10)]"
            >
              {scheme === "family" ? "Scheme: family" : "Scheme: distinct"}
            </button>
            <button
              type="button"
              onClick={toggleDark}
              className="rounded-lg border border-border bg-surface-raised px-4 py-2 text-body font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06)] transition-all hover:shadow-[0_2px_4px_rgba(15,23,42,0.10),0_4px_10px_rgba(15,23,42,0.10)]"
            >
              {dark ? "Switch to light" : "Switch to dark"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {TYPES.map((t) => {
            const hue = scheme === "family" ? t.family : t.distinct;
            return (
              <div
                key={t.title}
                className="popup-card-shadow rounded-2xl px-6 py-5"
                style={{
                  background:
                    "radial-gradient(130% 70% at 50% -6%, var(--editor-room-top), var(--editor-room-bot))",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xl font-extrabold leading-tight">
                      <span className={`acc acc-${hue}`}>{t.title}</span>
                    </div>
                    <div className="mt-2 text-meta text-foreground-muted">
                      {t.meta}
                    </div>
                  </div>
                  <span className="mt-0.5 text-foreground-muted" aria-hidden>
                    X
                  </span>
                </div>
                <div className="mt-5 space-y-2">
                  <div className="h-2.5 w-3/4 rounded bg-foreground/10" />
                  <div className="h-2.5 w-2/3 rounded bg-foreground/10" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Light = tailwind ~200 pastel behind dark text; dark = ~700 saturated opaque
// fill behind light text (same hue, deeper shade). Block longer than text via
// horizontal padding, snug height (Grant's pick).
const ACCENT_CSS = `
.popup-card-shadow {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 20px 50px -10px rgba(0, 0, 0, 0.18);
}
[data-theme="dark"] .popup-card-shadow {
  box-shadow:
    0 0 0 1px rgba(190, 205, 235, 0.08),
    0 1px 3px rgba(150, 180, 225, 0.06),
    0 20px 50px -12px rgba(120, 150, 210, 0.3);
}

.acc {
  display: inline-block;
  border-radius: 8px;
  padding: 0.02em 0.55em;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.acc-amber   { background: #fde68a; }
.acc-yellow  { background: #fef08a; }
.acc-sky     { background: #bae6fd; }
.acc-blue    { background: #bfdbfe; }
.acc-emerald { background: #a7f3d0; }
.acc-lime    { background: #d9f99d; }
.acc-rose    { background: #fecdd3; }
.acc-pink    { background: #fbcfe8; }
.acc-indigo  { background: #c7d2fe; }
.acc-orange  { background: #fed7aa; }
.acc-violet  { background: #ddd6fe; }
.acc-fuchsia { background: #f5d0fe; }

[data-theme="dark"] .acc-amber   { background: #b45309; }
[data-theme="dark"] .acc-yellow  { background: #a16207; }
[data-theme="dark"] .acc-sky     { background: #0369a1; }
[data-theme="dark"] .acc-blue    { background: #1d4ed8; }
[data-theme="dark"] .acc-emerald { background: #047857; }
[data-theme="dark"] .acc-lime    { background: #4d7c0f; }
[data-theme="dark"] .acc-rose    { background: #be123c; }
[data-theme="dark"] .acc-pink    { background: #9d174d; }
[data-theme="dark"] .acc-indigo  { background: #4338ca; }
[data-theme="dark"] .acc-orange  { background: #9a3412; }
[data-theme="dark"] .acc-violet  { background: #6d28d9; }
[data-theme="dark"] .acc-fuchsia { background: #a21caf; }
`;
