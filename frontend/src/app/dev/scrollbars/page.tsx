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
    name: "2 - Thin 5px",
    spec: "~5px pill, resting 20%, darker on hover. Always on.",
  },
  {
    cls: "sb-medium",
    name: "3 - Medium 7px",
    spec: "~7px pill, resting 22%, the most substantial. Always on.",
  },
  {
    cls: "sb-track",
    name: "4 - Inset groove 6px",
    spec: "~6px thumb in a faint always-visible track groove.",
  },
  {
    cls: "sb-recede",
    name: "5 - Recede + boost 5px",
    spec: "~5px pill, nearly invisible at rest (10%), jumps to 34% on hover. The auto-hide feel, but reliably painted.",
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
// NOTE: pure ::-webkit-scrollbar only. We deliberately do NOT set the standard
// scrollbar-width/scrollbar-color here: in Chrome, scrollbar-width:thin pins the
// gutter to a fixed thin size and IGNORES the ::-webkit width, so per-option
// widths collapsed and only the transparent border varied (bigger border = thinner
// thumb), making "medium" render thinner than "thin". Dropping it lets the gutter
// width below be authoritative. Constant 2.5px inset border, so visible pill =
// (bar width - 5px): 8->3, 10->5, 12->7. (The chosen standard can re-add a
// Firefox scrollbar-width fallback once picked.)
const SCROLLBAR_CSS = `
/* 1 - Hairline 3px. 8px gutter, 2.5px inset -> 3px pill. */
.sb-hairline::-webkit-scrollbar { width: 8px; height: 8px; }
.sb-hairline::-webkit-scrollbar-track { background: transparent; }
.sb-hairline::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 18%, transparent); border-radius: 9999px; border: 2.5px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-hairline::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 36%, transparent); }

/* 2 - Thin 5px. 10px gutter, 2.5px inset -> 5px pill. */
.sb-thin::-webkit-scrollbar { width: 10px; height: 10px; }
.sb-thin::-webkit-scrollbar-track { background: transparent; }
.sb-thin::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 20%, transparent); border-radius: 9999px; border: 2.5px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-thin::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 38%, transparent); }

/* 3 - Medium 7px. 12px gutter, 2.5px inset -> 7px pill. */
.sb-medium::-webkit-scrollbar { width: 12px; height: 12px; }
.sb-medium::-webkit-scrollbar-track { background: transparent; }
.sb-medium::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 22%, transparent); border-radius: 9999px; border: 2.5px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-medium::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 40%, transparent); }

/* 4 - Inset groove 6px (faint visible track). 12px gutter, 3px inset -> 6px thumb. */
.sb-track::-webkit-scrollbar { width: 12px; height: 12px; }
.sb-track::-webkit-scrollbar-track { background: color-mix(in srgb, var(--foreground) 6%, transparent); border-radius: 9999px; margin: 4px; }
.sb-track::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 28%, transparent); border-radius: 9999px; border: 3px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-track::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 42%, transparent); }

/* 5 - Recede + boost 5px. Faint at rest (always painted), boosts on region hover.
 *     10px gutter, 2.5px inset -> 5px pill. */
.sb-recede::-webkit-scrollbar { width: 10px; height: 10px; }
.sb-recede::-webkit-scrollbar-track { background: transparent; }
.sb-recede::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 10%, transparent); border-radius: 9999px; border: 2.5px solid transparent; background-clip: padding-box; transition: background-color 0.2s ease; }
.sb-recede:hover::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--foreground) 34%, transparent); }
.sb-recede::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--foreground) 46%, transparent); }
`;
