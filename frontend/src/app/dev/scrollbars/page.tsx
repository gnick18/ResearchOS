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

// All always-on with a resting tint (Chrome won't reliably reveal a transparent
// thumb on container :hover, so a pure hover-reveal renders blank). They vary by
// thickness + resting strength; #5 recedes to nearly nothing at rest and boosts
// on hover, approximating auto-hide while still always painting.
const OPTIONS: { cls: string; name: string; spec: string }[] = [
  {
    cls: "sb-hairline",
    name: "1 - Hairline 3px",
    spec: "~3px pill, faint at rest (18%), darkens on direct hover. Always on.",
  },
  {
    cls: "sb-thin",
    name: "2 - Thin 4px",
    spec: "~4px pill, resting 20%, darker on hover. Always on.",
  },
  {
    cls: "sb-medium",
    name: "3 - Medium 6px",
    spec: "~6px pill, resting 22%, the most substantial. Always on.",
  },
  {
    cls: "sb-track",
    name: "4 - Inset groove",
    spec: "~5px thumb in a faint always-visible track groove.",
  },
  {
    cls: "sb-recede",
    name: "5 - Recede + boost",
    spec: "~4px pill, nearly invisible at rest (10%), jumps to 34% on hover. The auto-hide feel, but reliably painted.",
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
/* 1 - Hairline 3px (always-on). 7px bar, 2px transparent border -> ~3px pill. */
.sb-hairline { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--foreground) 18%, transparent) transparent; }
.sb-hairline::-webkit-scrollbar { width: 7px; height: 7px; }
.sb-hairline::-webkit-scrollbar-track { background: transparent; }
.sb-hairline::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 18%, transparent); border-radius: 9999px; border: 2px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-hairline::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 36%, transparent); }

/* 2 - Thin 4px. 9px bar, 2.5px border -> ~4px pill. */
.sb-thin { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--foreground) 20%, transparent) transparent; }
.sb-thin::-webkit-scrollbar { width: 9px; height: 9px; }
.sb-thin::-webkit-scrollbar-track { background: transparent; }
.sb-thin::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 20%, transparent); border-radius: 9999px; border: 2.5px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-thin::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 38%, transparent); }

/* 3 - Medium 6px. 12px bar, 3px border -> ~6px pill. */
.sb-medium { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--foreground) 22%, transparent) transparent; }
.sb-medium::-webkit-scrollbar { width: 12px; height: 12px; }
.sb-medium::-webkit-scrollbar-track { background: transparent; }
.sb-medium::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 22%, transparent); border-radius: 9999px; border: 3px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-medium::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 40%, transparent); }

/* 4 - Inset groove (faint visible track). */
.sb-track::-webkit-scrollbar { width: 12px; height: 12px; }
.sb-track::-webkit-scrollbar-track { background: color-mix(in srgb, var(--foreground) 6%, transparent); border-radius: 9999px; margin: 4px; }
.sb-track::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 28%, transparent); border-radius: 9999px; border: 3px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-track::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 42%, transparent); }

/* 5 - Recede + boost. Faint at rest (always painted, so reliable), boosts when
 *     the region is hovered. 9px bar, 2.5px border -> ~4px pill. */
.sb-recede { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--foreground) 12%, transparent) transparent; }
.sb-recede::-webkit-scrollbar { width: 9px; height: 9px; }
.sb-recede::-webkit-scrollbar-track { background: transparent; }
.sb-recede::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 10%, transparent); border-radius: 9999px; border: 2.5px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-recede:hover::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 34%, transparent); }
.sb-recede::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 46%, transparent); }
`;
