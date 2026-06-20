"use client";

// The persistent "My work" toggle (NAV-2). A lab head flips between the lab-wide
// lens (the PI default) and their personal researcher view. Switching navigates
// to that mode's home so the swap is immediate (lab -> /lab-overview, my-work ->
// /workbench); the nav lineup adapts via usePiViewMode in AppShell.
//
// Rendered only for a lab head (the caller gates on isLabHead). Text-only
// segmented control, no icons, so it never collides with a glyph meaning.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useRouter } from "next/navigation";
import { usePiViewMode, type PiViewMode } from "@/hooks/usePiViewMode";

const HOME_FOR: Record<PiViewMode, string> = {
  lab: "/lab-overview",
  "my-work": "/workbench",
};

export default function PiViewModeToggle({
  // CM-P2B: the "lab" segment label. Defaults to "Lab" (research PI), so the
  // existing callers are byte-identical. A class instructor passes "Class" so
  // the lens reads "Class" / "My work". Pure relabel, no behavior change; the
  // underlying mode value stays "lab".
  labLabel = "Lab",
}: {
  labLabel?: string;
} = {}) {
  const router = useRouter();
  const { mode, setMode } = usePiViewMode();

  const select = (next: PiViewMode) => {
    if (next === mode) return;
    setMode(next);
    router.push(HOME_FOR[next]);
  };

  const seg = (value: PiViewMode, label: string) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => select(value)}
        aria-pressed={active}
        data-testid={`pi-view-mode-${value}`}
        className={`rounded-full px-2.5 py-1 text-meta font-medium transition ${
          active
            ? "bg-brand-action text-white"
            : "text-foreground-muted hover:text-foreground"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-border bg-surface px-0.5 py-0.5"
      role="group"
      aria-label={`${labLabel} or personal view`}
      data-testid="pi-view-mode-toggle"
    >
      {seg("lab", labLabel)}
      {seg("my-work", "My work")}
    </div>
  );
}
