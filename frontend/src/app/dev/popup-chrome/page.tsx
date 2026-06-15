"use client";

// Dev review gallery for the popup-chrome migration (Phase 3).
//
// Phase 3 moves each object popup off the old LivingPopup chrome and onto the
// shared CalmPopupShell. This page lets Grant open the BEFORE (pre-migration
// snapshot) and the AFTER (live migrated component) of each popup with the SAME
// props, so the only difference on screen is the chrome (header, surface,
// footer). Sign off per type, then the next type's row gets added here.
//
// It starts with the Purchase row. The "before" components are the throwaway
// snapshots committed under _legacy/ (they still import LivingPopup); the
// "after" components are the live ones, now on CalmPopupShell.
//
// Folderless: providers.tsx bypasses the folder-connect gate for this route and
// supplies a query client. The popups run with a null currentUser and empty
// data, so they render their own empty states. Each popup is wrapped in a small
// error boundary so one that cannot mount without real context does not blank
// the whole gallery; the error shows inline and the other variant stays
// reviewable.
//
// Accessible at /dev/popup-chrome in any environment (undiscoverable from the
// production UI).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

import NewPurchaseModalAfter from "@/components/NewPurchaseModal";
import PurchaseHistoryPopupAfter from "@/components/PurchaseHistoryPopup";
import NewPurchaseModalBefore from "./_legacy/NewPurchaseModal.legacy";
import PurchaseHistoryPopupBefore from "./_legacy/PurchaseHistoryPopup.legacy";
import PopupErrorBoundary from "./PopupErrorBoundary";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import type { VersionHistorySource } from "@/components/history/EntityVersionHistorySidebar";
import {
  makeSeededPurchaseHistoryEngine,
  FIXTURE_OWNER,
  FIXTURE_PURCHASE_ID,
  FIXTURE_NOTE,
} from "./fixtures";

// Which variant of a given popup is currently mounted. "none" = closed.
type Variant = "none" | "before" | "after";

// Minimal, representative props. The point is the chrome, so the bodies get the
// least data that makes them render.
//
// NewPurchaseModal is a create form. It needs nothing but open + onClose; its
// react-query reads (projects, funding accounts, prior items) all run only when
// open and degrade to empty lists with no folder, so the form renders with no
// existing items, exactly the empty-state we want to review.
//
// PurchaseHistoryPopup hosts the generic version-history sidebar. In the real
// app it reads an on-disk Loro sidecar; here there is no folder, so we inject a
// pre-seeded fixture engine (fixtures.ts) holding a four-version purchase chain.
// That lets the popup render with a populated version list + real reconstructed
// diffs, so the de-banded sidebar chrome is judgeable with content. canRestore
// is true so the restore footer renders too (its de-band is part of the review);
// a restore click is a harmless no-op on this folderless route.
const HISTORY_PROPS = {
  owner: FIXTURE_OWNER,
  itemId: FIXTURE_PURCHASE_ID,
  canRestore: true,
  currentUser: "dev",
  origin: null,
} as const;

function SectionRow({
  title,
  note,
  variant,
  onOpenBefore,
  onOpenAfter,
  children,
}: {
  title: string;
  note: string;
  variant: Variant;
  onOpenBefore: () => void;
  onOpenAfter: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <p className="mt-1 text-meta text-foreground-muted">{note}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenBefore}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-body font-semibold text-foreground hover:bg-surface-sunken"
          >
            Open before
          </button>
          <button
            type="button"
            onClick={onOpenAfter}
            className="rounded-lg border border-brand-action bg-surface px-4 py-2 text-body font-semibold text-brand-action hover:bg-surface-sunken"
          >
            Open after
          </button>
        </div>
      </div>
      {variant !== "none" && (
        <p className="mt-3 text-meta text-foreground-muted">
          Showing the{" "}
          <span className="font-semibold text-foreground">
            {variant === "before" ? "before" : "after"}
          </span>{" "}
          chrome. Close it to compare the other variant.
        </p>
      )}
      {children}
    </section>
  );
}

export default function PopupChromeReviewPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // New Purchase modal: which variant is open.
  const [purchaseVariant, setPurchaseVariant] = useState<Variant>("none");
  // Purchase history popup: which variant is open.
  const [historyVariant, setHistoryVariant] = useState<Variant>("none");
  // Note detail popup: open state (single, not a migration before/after).
  const [noteOpen, setNoteOpen] = useState(false);
  // Pre-seeded fixture engine so the history popup renders with real content.
  const [historyEngine, setHistoryEngine] = useState<VersionHistorySource | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void makeSeededPurchaseHistoryEngine().then((engine) => {
      if (!cancelled) setHistoryEngine(engine);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      if (next === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      return next;
    });
  }, []);

  const closePurchase = useCallback(() => setPurchaseVariant("none"), []);
  const closeHistory = useCallback(() => setHistoryVariant("none"), []);

  return (
    <main className="min-h-screen bg-surface text-foreground">
      <header className="border-b border-border bg-surface-raised px-6 py-4">
        <div className="flex items-center justify-between gap-6">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">
              Popup chrome review
            </h1>
            <p className="mt-0.5 text-meta text-foreground-muted">
              Before = pre-CalmPopupShell. After = migrated. Compare chrome:
              header, surface, footer.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="shrink-0 rounded-lg border border-border bg-surface px-4 py-2 text-body font-semibold text-foreground hover:bg-surface-sunken"
          >
            {theme === "light" ? "Switch to dark" : "Switch to light"}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 p-8">
        <p className="rounded-lg border border-border bg-surface-raised p-4 text-meta text-foreground-muted">
          Both variants of each popup get identical props, so the only thing that
          changes between before and after is the chrome. Bodies that read from a
          folder are seeded with fixture content here (the history popup gets a
          four-version purchase chain with real diffs) so you can judge populated
          chrome, not empty states. Flip the theme above to check the calm dark
          room.
        </p>

        {/* New Purchase modal: a create form. Light mock props (empty existing
            items via the no-folder query reads, stub onClose). */}
        <SectionRow
          title="NewPurchaseModal"
          note="Create form. Renders the empty new-purchase form on the calm surface (after) vs the old LivingPopup card (before)."
          variant={purchaseVariant}
          onOpenBefore={() => setPurchaseVariant("before")}
          onOpenAfter={() => setPurchaseVariant("after")}
        >
          {purchaseVariant === "before" && (
            <PopupErrorBoundary label="NewPurchaseModal (before)" onReset={closePurchase}>
              <NewPurchaseModalBefore open onClose={closePurchase} />
            </PopupErrorBoundary>
          )}
          {purchaseVariant === "after" && (
            <PopupErrorBoundary label="NewPurchaseModal (after)" onReset={closePurchase}>
              <NewPurchaseModalAfter open onClose={closePurchase} />
            </PopupErrorBoundary>
          )}
        </SectionRow>

        {/* Purchase item history: read-style version-history surface. Empty
            history with no folder, so the body shows its empty state. */}
        <SectionRow
          title="PurchaseHistoryPopup"
          note="Version history surface, seeded with a four-version purchase chain. Pick a version to see its reconstructed diff. The de-banded sidebar should read on the calm surface (no second card, no nested close, no white footer band)."
          variant={historyVariant}
          onOpenBefore={() => setHistoryVariant("before")}
          onOpenAfter={() => setHistoryVariant("after")}
        >
          {historyVariant === "before" && (
            <PopupErrorBoundary label="PurchaseHistoryPopup (before)" onReset={closeHistory}>
              <PurchaseHistoryPopupBefore
                open
                onClose={closeHistory}
                engineOverride={historyEngine ?? undefined}
                {...HISTORY_PROPS}
              />
            </PopupErrorBoundary>
          )}
          {historyVariant === "after" && (
            <PopupErrorBoundary label="PurchaseHistoryPopup (after)" onReset={closeHistory}>
              <PurchaseHistoryPopupAfter
                open
                onClose={closeHistory}
                engineOverride={historyEngine ?? undefined}
                {...HISTORY_PROPS}
              />
            </PopupErrorBoundary>
          )}
        </SectionRow>

        {/* NoteDetailPopup: already on CalmPopupShell, so this is the kit polish
            (sky title accent + option-3 recolor + dark), not a chrome migration.
            One Open button, seeded with a running-log fixture note. */}
        <section className="rounded-xl border border-border bg-surface-raised p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground">NoteDetailPopup</h2>
              <p className="mt-1 text-meta text-foreground-muted">
                Note detail, sky family hue (option 3 recolor). Seeded running-log
                note with two entries. Verify the title accent, the selected entry
                tab + edit affordances (sky), and the dark card shadow.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="shrink-0 rounded-lg border border-brand-action bg-surface px-4 py-2 text-body font-semibold text-brand-action hover:bg-surface-sunken"
            >
              Open
            </button>
          </div>
          {noteOpen && (
            <PopupErrorBoundary label="NoteDetailPopup" onReset={() => setNoteOpen(false)}>
              <NoteDetailPopup
                note={FIXTURE_NOTE}
                onClose={() => setNoteOpen(false)}
                onUpdate={() => {}}
                onDelete={() => setNoteOpen(false)}
                currentUser="dev"
              />
            </PopupErrorBoundary>
          )}
        </section>
      </div>

      {/* Floating theme toggle, pinned above the popups (which cover the header
          toggle) so dark/light can be flipped while a popup is open. */}
      <button
        type="button"
        onClick={toggleTheme}
        className="ros-popup-card-shadow fixed bottom-5 right-5 z-[99999] rounded-full border border-border bg-surface-raised px-5 py-3 text-body font-semibold text-foreground"
      >
        {theme === "light" ? "Switch to dark" : "Switch to light"}
      </button>
    </main>
  );
}
