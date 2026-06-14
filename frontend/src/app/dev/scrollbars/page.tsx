"use client";

// Dev scratch page: scrollbar option picker.
//
// Grant is choosing the app-wide thin-scrollbar standard (the one that will roll
// out across every calm surface). This page shows 5 distinct treatments side by
// side, each in a scroll box on the SAND backdrop (.ros-calm-surface, the warm
// calm paper), with a light/dark toggle so the dark-room version is visible too.
// The thumb tints ride on --foreground, so each option works in both modes.
//
// Throwaway: delete /dev/scrollbars once the standard is picked. Folderless via
// the providers bypass (mirrors /dev/popup-chrome).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";

const OPTIONS: { cls: string; name: string; spec: string }[] = [
  {
    cls: "sb-reveal",
    name: "1 - Reveal pill (current)",
    spec: "~4px pill, transparent track, hidden until hover / scroll, then fades in.",
  },
  {
    cls: "sb-hairline",
    name: "2 - Always-on hairline",
    spec: "~3px pill, always faintly visible, darkens on hover. No reveal.",
  },
  {
    cls: "sb-track",
    name: "3 - Inset groove",
    spec: "~5px thumb in a faint always-visible track groove.",
  },
  {
    cls: "sb-ultra",
    name: "4 - Ultra-thin",
    spec: "~3px pill, very subtle always-on, stronger on hover.",
  },
  {
    cls: "sb-floating",
    name: "5 - Floating fat pill",
    spec: "~6px rounded thumb with padding, reveal on hover, most pronounced.",
  },
];

const FILLER = Array.from({ length: 40 }, (_, i) => i + 1);

export default function ScrollbarPickerPage() {
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
      <style>{SCROLLBAR_CSS}</style>

      <div className="mx-auto max-w-6xl px-8 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Scrollbar options
            </h1>
            <p className="mt-1 text-meta text-foreground-muted">
              Pick the app-wide thin-scrollbar standard. Each box scrolls. Hover
              a box to see reveal behavior. Tell me the number you like.
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

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {OPTIONS.map((opt) => (
            <section key={opt.cls} className="min-w-0">
              <h2 className="text-body font-bold">{opt.name}</h2>
              <p className="mb-2 mt-0.5 text-meta text-foreground-muted">
                {opt.spec}
              </p>
              <div
                tabIndex={0}
                className={`${opt.cls} h-72 overflow-y-auto rounded-xl border border-border/60 p-4 focus:outline-none`}
              >
                {FILLER.map((n) => (
                  <p key={n} className="py-1 text-body">
                    Row {n} - a line of sample content to force vertical overflow
                    so the scrollbar is visible against the sand surface.
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

// All five treatments. The thumb tints use --foreground so each reads correctly
// on both the warm paper (dark foreground) and the dark room (light foreground).
const SCROLLBAR_CSS = `
/* 1 - Reveal pill (the current .ros-thin-scroll). */
.sb-reveal { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--foreground) 24%, transparent) transparent; }
.sb-reveal::-webkit-scrollbar { width: 10px; height: 10px; }
.sb-reveal::-webkit-scrollbar-track { background: transparent; }
.sb-reveal::-webkit-scrollbar-thumb { background-color: transparent; border-radius: 9999px; border: 3px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-reveal:hover::-webkit-scrollbar-thumb, .sb-reveal:focus-within::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 22%, transparent); }
.sb-reveal::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 38%, transparent); }

/* 2 - Always-on hairline. */
.sb-hairline { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--foreground) 20%, transparent) transparent; }
.sb-hairline::-webkit-scrollbar { width: 8px; height: 8px; }
.sb-hairline::-webkit-scrollbar-track { background: transparent; }
.sb-hairline::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 16%, transparent); border-radius: 9999px; border: 2.5px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-hairline::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 34%, transparent); }

/* 3 - Inset groove (faint visible track). */
.sb-track::-webkit-scrollbar { width: 12px; height: 12px; }
.sb-track::-webkit-scrollbar-track { background: color-mix(in srgb, var(--foreground) 6%, transparent); border-radius: 9999px; margin: 4px; }
.sb-track::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 28%, transparent); border-radius: 9999px; border: 3px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-track::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 42%, transparent); }

/* 4 - Ultra-thin. */
.sb-ultra { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--foreground) 18%, transparent) transparent; }
.sb-ultra::-webkit-scrollbar { width: 6px; height: 6px; }
.sb-ultra::-webkit-scrollbar-track { background: transparent; }
.sb-ultra::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 14%, transparent); border-radius: 9999px; border: 1.5px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-ultra:hover::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 32%, transparent); }

/* 5 - Floating fat pill. */
.sb-floating::-webkit-scrollbar { width: 14px; height: 14px; }
.sb-floating::-webkit-scrollbar-track { background: transparent; }
.sb-floating::-webkit-scrollbar-thumb { background-color: transparent; border-radius: 9999px; border: 4px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-floating:hover::-webkit-scrollbar-thumb, .sb-floating:focus-within::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 25%, transparent); }
.sb-floating::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 40%, transparent); }
`;
