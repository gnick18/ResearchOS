"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  getDemoMode,
  isWikiCaptureMode,
  setDemoViewAsUser,
} from "@/lib/file-system/wiki-capture-mock";
import { getCurrentUser } from "@/lib/file-system/indexeddb-store";
import { Icon } from "@/components/icons";

/**
 * Demo-only "view as lab head" toggle. Renders only inside the public
 * `/demo` fixture (and never under `?wikiCapture=1`, so it stays out of
 * wiki screenshots), invisible in every real install.
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
    setShow(getDemoMode() && !isWikiCaptureMode());
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
  const label = isLabHead ? "Demo: view as member" : "Demo: view as lab head";
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
      className="fixed bottom-36 right-4 z-50 flex items-center gap-2 rounded-full bg-violet-600 px-4 py-3 font-medium text-white shadow-xl transition-colors hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2"
      aria-label={label}
    >
      <Icon name="eye" className="h-4 w-4" />
      <span>{label}</span>
    </a>
  );
}
