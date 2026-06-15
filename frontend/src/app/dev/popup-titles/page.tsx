"use client";

// Dev exploration: a per-popup accent "marker" block behind the title.
//
// Grant is weighing giving each popup title its own accent background color (a
// colored rectangle behind the heading, longer than the text, each popup a
// uniform hue, dark/light sharing the hue but not the shade). This page mocks
// the popup header anatomy on the real calm surface (real fonts) across a few
// hues, with a snug-vs-peek height toggle and a dark toggle so the whole idea
// is judgeable before it touches CalmPopupShell.
//
// Throwaway, folderless via the providers bypass. House style, no em-dashes,
// no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";

const POPUPS: { hue: string; title: string; meta: string }[] = [
  { hue: "amber", title: "New Purchase", meta: "Create a purchase request" },
  { hue: "violet", title: "Purchase item history", meta: "4 versions" },
  { hue: "sky", title: "Lab notebook entry", meta: "Edited 2h ago by mira" },
  { hue: "emerald", title: "Experiment", meta: "Buffer prep, cohort 2" },
  { hue: "rose", title: "Sequence", meta: "pET28a insert, 1411 bp" },
];

export default function PopupTitlesPage() {
  const [dark, setDark] = useState(false);
  const [peek, setPeek] = useState(false);

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

      <div className="mx-auto max-w-5xl px-8 py-10">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Popup title accent blocks
            </h1>
            <p className="mt-1 text-meta text-foreground-muted">
              Each popup gets its own hue behind the title, always longer than
              the text. Toggle the height treatment and dark mode.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPeek((p) => !p)}
              className="rounded-lg border border-border bg-surface-raised px-4 py-2 text-body font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06)] transition-all hover:shadow-[0_2px_4px_rgba(15,23,42,0.10),0_4px_10px_rgba(15,23,42,0.10)]"
            >
              {peek ? "Height: peek" : "Height: snug"}
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {POPUPS.map((p) => (
            <div
              key={p.hue}
              className="rounded-2xl px-7 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_20px_50px_-10px_rgba(0,0,0,0.18)]"
              style={{
                background:
                  "radial-gradient(130% 70% at 50% -6%, var(--editor-room-top), var(--editor-room-bot))",
              }}
            >
              {/* Mock popup header anatomy: accent title + meta + close glyph. */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-2xl font-extrabold leading-tight">
                    <span className={`acc acc-${p.hue} ${peek ? "acc-peek" : "acc-snug"}`}>
                      {p.title}
                    </span>
                  </div>
                  <div className="mt-2 text-meta text-foreground-muted">
                    {p.meta}
                  </div>
                </div>
                <span className="mt-1 text-foreground-muted" aria-hidden>
                  X
                </span>
              </div>

              <div className="mt-6 space-y-2">
                <div className="h-3 w-3/4 rounded bg-foreground/10" />
                <div className="h-3 w-2/3 rounded bg-foreground/10" />
                <div className="h-3 w-1/2 rounded bg-foreground/10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Accent blocks. Text stays the theme foreground (the unified title font Grant
// likes) — only the background hue changes. Light = a pastel fill behind dark
// text; dark = a translucent tint of the SAME hue behind light text (same hue,
// different shade per the brief). The block is wider than the text via the
// horizontal padding, so it always reads longer than the title.
const ACCENT_CSS = `
.acc {
  display: inline-block;
  border-radius: 8px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.acc-snug { padding: 0.02em 0.55em; }
.acc-peek { padding: 0.18em 0.6em; }

.acc-amber   { background: #fde68a; }
.acc-violet  { background: #ddd6fe; }
.acc-sky     { background: #bae6fd; }
.acc-emerald { background: #a7f3d0; }
.acc-rose    { background: #fecdd3; }

/* Dark mode: OPAQUE saturated fills of the same hue (a deeper shade), not
 * translucent tints — a low-alpha tint lets the navy room bleed through and
 * turns the color to mud. Light title text rides on top. */
[data-theme="dark"] .acc-amber   { background: #b45309; }
[data-theme="dark"] .acc-violet  { background: #6d28d9; }
[data-theme="dark"] .acc-sky     { background: #0369a1; }
[data-theme="dark"] .acc-emerald { background: #047857; }
[data-theme="dark"] .acc-rose    { background: #be123c; }
`;
