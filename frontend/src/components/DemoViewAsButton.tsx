"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  getDemoMode,
  isRecordingMode,
  isWikiCaptureMode,
  setDemoViewAsUser,
} from "@/lib/file-system/wiki-capture-mock";
import { getCurrentUser } from "@/lib/file-system/indexeddb-store";
import { Icon } from "@/components/icons";

/**
 * Demo-only "view as lab head" toggle. Renders only inside the public
 * `/demo` fixture (and never under `?wikiCapture=1`, so it stays out of
 * wiki screenshots, nor under `?record=1`, so a marketing-video surface
 * stays pristine), invisible in every real install. Styled as a small
 * muted pill stacked above the Leave-demo pill in the bottom-right so it
 * reads as a quiet control rather than dominating the screen.
 *
 * The demo signs you in as Alex, a lab member, so the lab-head surfaces
 * (the `/lab-overview` PI dashboard) are gated off. This flips the demo
 * fixture identity between Alex (member) and Mira (the fixture's lab head)
 * by hard-navigating through the `/demo` route with the internal
 * `?demoViewAs=` param, which makes FileSystemProvider reinstall the
 * fixture pinned to the target user (a plain storeCurrentUser write would
 * be clobbered, because a full reload re-seeds the demo and defaults back
 * to alex). The `/demo` route installs as the target user, then
 * client-redirects to the destination (Mira lands on the PI dashboard she
 * just unlocked, Alex on the member workbench), preserving the freshly
 * seeded identity across the redirect. It exists so the welcome-page PI
 * dashboard clip can be recorded against the fixture without hand-editing
 * storage. See docs/marketing/welcome-demo-shot-list-2026-06-10.md.
 *
 * Rendered as a plain anchor (not a button + window.location), so the
 * navigation is a native link the browser always honors, the same robust
 * pattern OpenDocsButton uses for its hard-nav to the wiki.
 *
 * Mounted at providers level alongside FloatingLeaveDemoButton.
 */
const LAB_HEAD = "mira";

export default function DemoViewAsButton() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [viewingAs, setViewingAs] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local React state with the external sessionStorage demo flag on every route change
    setShow(getDemoMode() && !isWikiCaptureMode() && !isRecordingMode());
    void getCurrentUser().then((u) => {
      if (alive) setViewingAs(u);
    });
    return () => {
      alive = false;
    };
  }, [pathname]);

  if (!show) return null;

  const isLabHead = viewingAs === LAB_HEAD;
  const target = isLabHead ? "alex" : LAB_HEAD;
  const label = isLabHead ? "View as member" : "View as lab head";
  const destination = isLabHead
    ? "/demo/workbench?demoViewAs=alex"
    : "/demo/lab-overview?demoViewAs=mira";

  // Persist the choice to the sticky key on click, BEFORE the browser
  // navigates. The reinstall then resolves the target user from the sticky
  // value even when the URL param never reaches install (the App Router can
  // intercept a plain anchor and soft-nav, dropping the query). We do not
  // preventDefault, so the href still drives the hard navigation.
  const onClick = () => setDemoViewAsUser(target);

  return (
    <a
      href={destination}
      onClick={onClick}
      className="fixed bottom-14 right-4 z-50 flex items-center gap-1.5 rounded-full border border-border bg-surface-raised/90 px-3 py-1.5 text-meta font-medium text-foreground-muted shadow-sm backdrop-blur transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:ring-2 focus-visible:ring-border focus-visible:ring-offset-2"
      aria-label={label}
    >
      <Icon name="eye" className="h-3.5 w-3.5" />
      <span>{label}</span>
    </a>
  );
}
