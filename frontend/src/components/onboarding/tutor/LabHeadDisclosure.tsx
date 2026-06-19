"use client";

// Onboarding tutor, the lab-head disclosure popup.
//
// Shown when the user picks the lab-head ("pi") role in the interest picker. It
// explains plainly what a lab account is before they commit, so the choice is
// informed rather than a surprise. There is NO billing or pricing promise here
// (the trial and payment flow is not built, and the "free during beta" framing
// is being retired), so this copy never mentions price, trial, or beta.
//
// No soft-lock. The two buttons are the escape (confirm keeps the lab-head role,
// "I work solo" flips to solo), and pressing Escape declines to solo as well, so
// the user is never trapped. No emojis, no em-dashes, no mid-sentence colons.

import { useEffect } from "react";
import { Icon } from "@/components/icons/Icon";

export interface LabHeadDisclosureProps {
  /** User confirmed, keep the lab-head role and dismiss. */
  onConfirm: () => void;
  /** User chose solo instead, flip the role to solo and dismiss. */
  onSolo: () => void;
}

export default function LabHeadDisclosure({ onConfirm, onSolo }: LabHeadDisclosureProps) {
  // Escape always declines to solo, so this blocking surface has a visible AND a
  // keyboard escape (no soft-lock).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSolo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSolo]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(0,0,0,0.32)] px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lab-head-disclosure-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--line,#e3e5e0)] bg-[var(--surface,#fff)] p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[var(--violet-soft,#efe7fb)] text-[var(--violet,#7c4dca)]">
            <Icon name="users" className="h-5 w-5" />
          </span>
          <h2
            id="lab-head-disclosure-title"
            className="text-lg font-bold text-[var(--fg,#1f2421)]"
          >
            Setting up as a lab head
          </h2>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-[var(--muted,#6b716a)]">
          A lab account makes you the lab head. You create the lab, invite your
          people, and everyone works in one shared space with the relay features
          like send, live co-edit, and phone capture.
        </p>

        {/* The lab-head product page (built by the Popup Unifier lane, on main). */}
        <a
          href="/labs"
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--violet,#7c4dca)] hover:underline"
        >
          What a lab account does
          <Icon name="share" className="h-3.5 w-3.5" />
        </a>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            onClick={onConfirm}
            className="rounded-lg bg-[var(--violet,#7c4dca)] px-4 py-2 text-sm font-bold text-white hover:brightness-105"
          >
            Set me up as a lab head
          </button>
          <button
            onClick={onSolo}
            className="rounded-lg border border-[var(--line2,#d2d5cd)] bg-[var(--surface,#fff)] px-4 py-2 text-sm font-bold text-[var(--muted,#6b716a)] hover:bg-[var(--sunken,#f1f2ef)]"
          >
            I work solo
          </button>
        </div>
      </div>
    </div>
  );
}
