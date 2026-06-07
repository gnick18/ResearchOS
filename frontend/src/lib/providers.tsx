"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { appQueryClient } from "@/lib/query-client";
import { usePathname, useRouter } from "next/navigation";
import { FileSystemProvider, useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import {
  isDemoOrWikiCapture,
  isV4PreviewMode,
} from "@/lib/file-system/wiki-capture-mock";
import ResearchFolderSetupNew from "@/components/ResearchFolderSetupNew";
import BrowserNotSupported from "@/components/BrowserNotSupported";
import {
  shouldShowLanding,
  hasSeenLanding,
  hasConnectBypass,
} from "@/lib/landing/landing-gate";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import { ELN_IMPORT_PENDING_KEY } from "@/components/import-eln/PickUserBeforeImportModal";
import UserLoginScreen from "@/components/UserLoginScreen";
import StagedLoadingScreen from "@/components/StagedLoadingScreen";
import ErrorBoundary from "@/components/ErrorBoundary";
import GlobalDropGuard from "@/components/GlobalDropGuard";
import FloatingLeaveDemoButton from "@/components/FloatingLeaveDemoButton";
import WikiCaptureRefusedBanner from "@/components/WikiCaptureRefusedBanner";
import OpenDocsButton from "@/components/OpenDocsButton";
import SceneTriggerHost from "@/components/SceneTriggerHost";
import AutoErrorConfirmHost from "@/components/AutoErrorConfirmHost";
import V4MountForUser from "@/components/onboarding/v4/V4MountForUser";
import CelebrationManager from "@/components/onboarding/CelebrationManager";
import MilestoneTwirlMount from "@/components/onboarding/MilestoneTwirlMount";
import IdleAnimationManager from "@/components/onboarding/IdleAnimationManager";
import WhatsNewManager from "@/components/WhatsNewManager";
import WikiCaptureBodyClass from "@/components/WikiCaptureBodyClass";
import SharedFolderAutoRefresh from "@/components/SharedFolderAutoRefresh";
import { ContextMenuProvider } from "@/components/context-menu/ContextMenuProvider";
import { BeakerSearchProvider } from "@/components/beaker-search/BeakerSearchProvider";
import { initializeErrorHandlers } from "@/lib/error-reporting";
import { projectsApi } from "@/lib/local-api";

/**
 * One-shot orphan-project sweep on first sign-in this session.
 *
 * Reads through the current user's projects/ folder and removes any
 * record that has no integer id OR a blank name. Fires once per
 * (page-load, username) pair; a subsequent username switch (rare in
 * practice, but possible from the user picker) re-fires for the new
 * user. Lab Mode and demo / wiki-capture modes are gated out at the
 * caller in AppContent — this component only mounts when a real
 * signed-in user is selected on a real folder.
 *
 * Why this lives here rather than in a useEffect inside the home page:
 * the home page is one of several entry points (the user might land on
 * /workbench, /pcr, /settings from a bookmark), and we want the cleanup
 * regardless of where the first render happens. Mounting here also
 * means the React Query cache invalidations the home page does on
 * mount will see the post-cleanup state on the very first fetch.
 *
 * Failures are logged but never user-visible: a malformed-record sweep
 * failure cannot block the rest of the app, and the home page's
 * always-visible kebab + banner on orphan cards is the fallback
 * recovery path. (orphan v2 sub-bot, 2026-05-21)
 */
function OrphanProjectSweep({ currentUser }: { currentUser: string }) {
  const sweptForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser) return;
    if (sweptForUser.current === currentUser) return;
    sweptForUser.current = currentUser;
    void (async () => {
      try {
        const removed = await projectsApi.purgeMalformed();
        if (removed.length > 0) {
          console.warn(
            `[OrphanProjectSweep] purged ${removed.length} malformed project file(s) for user "${currentUser}":`,
            removed,
          );
        } else {
          console.log(
            `[OrphanProjectSweep] no malformed project files found for user "${currentUser}"`,
          );
        }
      } catch (err) {
        console.error(
          `[OrphanProjectSweep] sweep failed for user "${currentUser}":`,
          err,
        );
      }
    })();
  }, [currentUser]);
  return null;
}

/**
 * Sticky-intent consumer for the LabArchives import CTA on the
 * folder-setup screen.
 *
 * Why: the picker screen's "Import from LabArchives" button used to be
 * disabled until a user was signed in, which was unreachable in
 * practice — signing in unmounted the picker. The new flow opens a
 * user-picker modal, signs the user in, and sets
 * `sessionStorage[ELN_IMPORT_PENDING_KEY] = "1"` to carry the intent
 * across the unmount.
 *
 * This component reads that flag on first render of the post-sign-in
 * surface, opens ImportELNDialog, and clears the flag (single-shot).
 * It must mount at this level rather than inside ImportELNDialog
 * because the dialog only exists when something opens it; and at
 * `lib/providers.tsx` (vs AppShell) the consumer covers every
 * post-sign-in route, not just the AppShell-wrapped ones.
 */
function PendingELNImportMount() {
  const [open, setOpen] = useState(false);
  // Read once on mount: any later writes are inside the same surface
  // and would re-trigger themselves. Effect runs after first paint so
  // SSR / hydration mismatches don't fire (sessionStorage isn't
  // server-readable anyway).
  useEffect(() => {
    try {
      if (sessionStorage.getItem(ELN_IMPORT_PENDING_KEY) === "1") {
        sessionStorage.removeItem(ELN_IMPORT_PENDING_KEY);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of an external (sessionStorage) handoff flag set by the picker screen pre-unmount
        setOpen(true);
      }
    } catch {
      // private-mode Safari etc. — silently no-op.
    }
  }, []);
  if (!open) return null;
  return <ImportELNDialog isOpen={open} onClose={() => setOpen(false)} />;
}

function AppContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The wiki must render before sign-in so new users can read the setup
  // guide and the browser-requirements page on their first visit. Skip
  // every gate below — loading, browser-support, folder-connect — when
  // the user is on a /wiki/* route. Query client is still provided so
  // any future client-rendered queries inside the wiki work.
  const isWikiRoute = pathname?.startsWith("/wiki");

  // The `/welcome` route renders the video-driven welcome/sell page standalone
  // for every visitor regardless of connection state (the "revisit" path from
  // Settings, the first-visit redirect target, and the wiki-screenshot capture
  // surface). Bypasses every gate below the same way `/wiki/*` does.
  const isWelcomeRoute = pathname === "/welcome";

  // QueryClient is a module-level singleton (see `appQueryClient` below)
  // so non-React-tree consumers (e.g. the onboarding-v4 cursor scripts
  // that fire programmatic API calls outside the component tree) can
  // call `appQueryClient.refetchQueries(...)` without needing to thread
  // a ref through the orchestrator. Inside the tree this is identical
  // to the previous `useState(() => new QueryClient(...))` pattern: the
  // singleton is created once on first import and reused forever.
  const queryClient = appQueryClient;

  const {
    isConnected,
    isLoading,
    currentUser,
    loadingStage,
    availableUsers,
    lastConnectedFolder,
  } = useFileSystem();
  const router = useRouter();
  const [showSetup, setShowSetup] = useState(false);
  // Belt-and-suspenders: if the router.replace("/welcome") fires but the gate
  // is somehow re-evaluated before navigation completes, this prevents a
  // second redirect. In normal flow this stays false.
  const [landingDismissed] = useState(false);

  useEffect(() => {
    if (!isLoading && !isConnected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- state machine: setup gate flips based on external fs-connection state transitions
      setShowSetup(true);
    } else if (isConnected && currentUser) {
      setShowSetup(false);
    }
  }, [isLoading, isConnected, currentUser]);

  useEffect(() => {
    if (currentUser) {
      queryClient.invalidateQueries();
    }
  }, [currentUser, queryClient]);

  // First-visit landing redirect. Truly-new visitors are sent to /welcome.
  // This MUST run in an effect, not in render: calling router.replace during
  // render throws "Cannot update a component (Router) while rendering a
  // different component". The guards mirror the render gate below exactly
  // (wiki / welcome routes, demo / wiki-capture, and the still-loading window
  // all skip it), so this never fires for a returning or connected user.
  const wantsLandingRedirect =
    !isWikiRoute &&
    !isWelcomeRoute &&
    !isLoading &&
    !isDemoOrWikiCapture() &&
    shouldShowLanding({
      isConnected,
      currentUser,
      lastConnectedFolder,
      availableUsers,
      seen: landingDismissed || hasSeenLanding(),
      connectBypass: hasConnectBypass(),
    });
  useEffect(() => {
    if (wantsLandingRedirect) {
      router.replace("/welcome");
    }
  }, [wantsLandingRedirect, router]);

  if (isWikiRoute) {
    // Wiki-pointer multi-beat redesign 2026-05-22 (Wiki pointer manager).
    // When a signed-in real user is mid-tour and the §6.12 wiki-pointer
    // cluster navigates them to a /wiki/* page, the wiki layout's
    // dedicated provider tree would normally drop V4MountForUser and
    // kill the tour mid-walk (see WikiPointerStep R4 2026-05-22 for the
    // bug we hit before the cluster redesign). Re-mounting V4MountForUser
    // inside the wiki early-return keeps the tour controller alive
    // across the wiki visit. Gating on `isConnected && currentUser`
    // means brand-new visitors (the wiki's original target audience)
    // still get the slim wiki-only tree.
    //
    // Lab Mode retirement R5 (2026-05-23): the legacy `lab` pseudo-user
    // guard that mirrored AppContent's signed-in branch is gone. After
    // R5 nobody can sign in as the lab sentinel, so every signed-in
    // user pulls in V4 here too.
    const wikiUserHasTour = isConnected && !!currentUser;
    if (wikiUserHasTour) {
      return (
        <QueryClientProvider client={queryClient}>
          <V4MountForUser username={currentUser}>{children}</V4MountForUser>
        </QueryClientProvider>
      );
    }
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // `/welcome`: render the route's own page (the standalone landing) for
  // every visitor, skipping the loading / connect / picker gates below. A
  // connected user reaching it from the Settings "revisit" link still sees
  // the marketing page rather than being bounced back into the app.
  if (isWelcomeRoute) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // Fixture-backed modes (wiki-capture signed-in variant on localhost, or
  // the public /demo route in any environment): FileSystemProvider has
  // seeded the in-memory fixture and set state to connected. Skip every
  // gate. The wiki-capture "picker" variant leaves currentUser empty on
  // purpose, so it falls through to render UserLoginScreen below (the
  // !currentUser branch). Note (2026-05-14): this used to fall through
  // to ResearchFolderSetupNew; that gate was split so the post-exit-Lab-
  // Mode and any "folder-connected-but-no-user-picked" state renders
  // the cleaner UserLoginScreen with its proper Lab Mode CTA. Wiki
  // screenshots that captured the picker UI in this mode may need
  // recapturing — flagged in §8 for the wiki manager.
  if (isDemoOrWikiCapture() && currentUser) {
    // Demo + wiki-capture: render children only. V4MountForUser only
    // mounts when the URL explicitly opts in via `?wizard-preview=1`
    // or `?wizardSeedStep=…` (the v4 preview / screenshot pipeline).
    // The V3 sequencer carve-out is gone (V3 rip Phase B 2026-05-22).
    //
    // Plain `/demo` and bare `?wikiCapture=1` skip the orchestrator
    // entirely: fixture data, demo banner, floating Leave Demo button
    // (mounted at the `<Providers>` level), no tour overlay.
    //
    // Sticky check (live-test R3 cascade fix 2026-05-21): isV4PreviewMode
    // reads URL params AND sessionStorage so in-tab navigations whose
    // hrefs strip the query string don't drop V4MountForUser. Without
    // this, every cursor-driven router.push from a step body (project
    // card click, wiki nav, methods nav, etc.) unmounted the v4 tour
    // and re-summoned the V4ResumePrompt mid-walkthrough.
    const wantsV4Mount = isV4PreviewMode();
    return (
      <QueryClientProvider client={queryClient}>
        {wantsV4Mount ? (
          <V4MountForUser username={currentUser}>{children}</V4MountForUser>
        ) : (
          <>{children}</>
        )}
      </QueryClientProvider>
    );
  }

  if (isLoading) {
    return <StagedLoadingScreen stage={loadingStage} />;
  }

  if (!isFileSystemAccessSupported()) {
    return <BrowserNotSupported />;
  }

  // First-time-visitor landing ("sell") page. Sits between the browser-
  // support check and the connect-folder screen, and renders ONLY for a
  // genuinely-new visitor: nothing in IndexedDB (no connected folder, no
  // stored handle, no stored user, no discovered users) AND they have not
  // already dismissed it AND no `?connect=1` bypass. Any returning signal
  // makes shouldShowLanding false, so returning users fall straight through
  // to their reconnect / picker / app surfaces below with zero extra clicks.
  //
  // Placed AFTER the isLoading check above: a returning user's silent
  // reconnect keeps isLoading true until it resolves, so the landing never
  // flashes before "returning" is known. Demo / wiki-capture / wiki / welcome
  // routes already returned above, so they cannot reach this branch. The
  // landing is gated to supported browsers (the unsupported-browser screen
  // returns just above), so it never sells a tool the visitor cannot run.
  // Truly-new visitors are redirected to /welcome by the effect above
  // (wantsLandingRedirect). Render nothing here while that navigation
  // resolves so the folder picker never flashes underneath it. The actual
  // router.replace lives in the effect, never in render.
  if (wantsLandingRedirect) {
    return null;
  }

  // Folder-picker IS the entry surface (rehome 2026-05-25). The retired
  // 4-beat pre-onboarding modal that used to gate this branch is gone:
  // BeakerBot, the welcome copy, the trust / security explainer, the
  // local-vs-cloud guidance, the cloud-provider setup links, and the
  // RISE credentials stamp all live inline on `ResearchFolderSetupNew`
  // now. No more one-shot localStorage gate; the picker is always what
  // a fresh visitor sees on first paint.
  if (showSetup || !isConnected) {
    // Wrapped in QueryClientProvider because the user-picker renders
    // <UserAvatar> which calls useUserColor() → useQuery(). Without the
    // provider, the picker throws "No QueryClient set" the moment there
    // are existing users to choose from (notably in wiki-capture picker
    // mode, where the fixture exposes two users).
    //
    // Note (2026-05-14): the !currentUser branch was split out below so
    // exit-Lab-Mode (and any other "folder is connected but no user is
    // picked" state) routes to the cleaner UserLoginScreen — same user-
    // picker UI Grant sees on a fresh app open, with the Lab Mode CTA in
    // its proper place. ResearchFolderSetupNew now only fires when the
    // user genuinely needs folder setup (showSetup=true) or hasn't
    // connected a folder yet (!isConnected).
    return (
      <QueryClientProvider client={queryClient}>
        <ResearchFolderSetupNew
          onComplete={() => {
            console.log("onComplete callback called in AppContent");
            setShowSetup(false);
            queryClient.invalidateQueries();
          }}
        />
      </QueryClientProvider>
    );
  }

  // Folder is connected but no user is picked — show the clean account
  // picker (UserLoginScreen). This is the post-exit-Lab-Mode flow as well
  // as any other "need to choose an account" state on an already-connected
  // folder. UserLoginScreen has the proper Lab Mode CTA + footer affordances
  // (User & password help, shared lab setup, Report Bug, Support) that
  // ResearchFolderSetupNew's "Select Account" sub-step doesn't carry.
  // QueryClientProvider needed for the same useUserColor() useQuery() reason
  // as the ResearchFolderSetupNew branch above.
  if (!currentUser) {
    return (
      <QueryClientProvider client={queryClient}>
        <UserLoginScreen
          onLogin={() => {
            queryClient.invalidateQueries();
          }}
        />
      </QueryClientProvider>
    );
  }

  // Onboarding wrapper. After the V3 rip (V3 rip Phase B 2026-05-22),
  // OnboardingProvider / OnboardingOrchestrator / useOnboarding are gone:
  // v4 is the only walkthrough and it mounts via V4MountForUser.
  // CelebrationManager is a peer inside V4MountForUser so
  // useOptionalTourController() resolves to the live controller and the
  // manager defers firing during an active tour.
  //
  // Lab Mode retirement R5 (2026-05-23): the "lab" pseudo-user branch
  // that bypassed V4MountForUser is gone. After R5 nobody can sign in
  // as the lab sentinel, so every signed-in user is a real account and
  // gets the standard v4 mount + orphan sweep.
  return (
    <QueryClientProvider client={queryClient}>
      {/* Once-per-session orphan-project sweep. Mounted as a sibling of
          V4MountForUser so it runs whether the user lands on /home,
          /workbench, or any other route on their first paint. */}
      <OrphanProjectSweep currentUser={currentUser} />
      {/* Auto-refresh the app when the shared data folder changes on disk
          (a collaborator's new note / task / project), so other lab members
          see it without a manual refresh. Local-first equivalent of a server
          push: watches the folder via FileSystemObserver, focus-refetch
          fallback. Mounted here so it covers every signed-in route. */}
      <SharedFolderAutoRefresh />
      {/* LabArchives import sticky-intent consumer. If the user clicked
          "Import from LabArchives" on the picker screen and signed in
          (which unmounts that screen), this auto-mounts ImportELNDialog
          on the first paint of the signed-in surface. Single-shot,
          clears its own sessionStorage flag on read. */}
      <PendingELNImportMount />
      <V4MountForUser username={currentUser}>
        {children}
        {/* CelebrationManager is a peer of TourBootstrap inside
            the TourControllerProvider tree. Inside the provider so
            useOptionalTourController() returns the live controller
            value (the manager defers firing while a tour is
            active, per proposal §6.7 "don't overlap with the
            bottom-right tour BeakerBot"). */}
        <CelebrationManager username={currentUser} />
        {/* MilestoneTwirlMount (twirl-milestones bot): peer of
            CelebrationManager. Fires the celebratory BeakerBot twirl once
            on the first occurrence of three rare checkpoint moments (tour
            complete, first experiment complete, first project fully
            done), deduped per-user in localStorage and gated by the same
            BeakerBot-animations opt-out. The 7-day-streak twirl is owned
            by CelebrationManager so it never double-celebrates. */}
        <MilestoneTwirlMount username={currentUser} />
        {/* IdleAnimationManager: peer of CelebrationManager. Fires a
            random BeakerBot scene from IDLE_POOL after the user has
            been idle for IDLE_THRESHOLD_MS. One per session, gated by
            sessionStorage. Independent of the streak/milestone path
            CelebrationManager owns. */}
        <IdleAnimationManager />
        {/* WhatsNewManager: developer-announcement / "What's New" popup
            (whats-new bot). Peer of CelebrationManager so it lives inside
            the TourControllerProvider tree and defers while a tour is
            active. Fires only on a genuine APP_VERSION upgrade; a
            brand-new account silently records the version and stays
            quiet. Gated to the logged-in/connected surface by virtue of
            mounting under V4MountForUser. */}
        <WhatsNewManager username={currentUser} />
      </V4MountForUser>
    </QueryClientProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // Wire global error handlers on client mount. The module-level flag
  // pattern this replaced ran during render — fine in practice but a side
  // effect during render. Returning the cleanup lets React strict-mode
  // double-mounts unwind correctly so we never end up with chained
  // handlers.
  useEffect(() => initializeErrorHandlers(), []);

  return (
    <ErrorBoundary>
      <FileSystemProvider>
        <GlobalDropGuard />
        {/* Privacy guard: when `?wikiCapture=…` is refused because a real
            folder is already connected, warn the person (visibly, not just
            in the console) that their real data is on screen. Reads the
            `captureRefused` flag off FileSystemProvider, so it must sit
            inside it. No-op in normal use / true fixtures / demo. */}
        <WikiCaptureRefusedBanner />
        <FloatingLeaveDemoButton />
        <OpenDocsButton />
        {/* Global host for fire-and-forget easter-egg scenes (BugStomp,
            etc.). Mounted at this level — above AppContent — so the
            scene can fire from pre-login surfaces (UserLoginScreen has
            its own Report Bug button) as well as the full AppShell.
            Bug-splat-manager wire (2026-05-23). */}
        <SceneTriggerHost />
        {/* Global host for the auto-error confirm dialog (and its
            hand-off FeedbackModal). Mounted at the providers level
            for the same pre-login reason as SceneTriggerHost: an
            auto-error captured on UserLoginScreen / DataSetupScreen /
            ResearchFolderSetupNew needs the confirm dialog to render
            before AppShell is in the tree. (feedback polish R1) */}
        <AutoErrorConfirmHost />
        {/* Wiki-screenshot fixture body-class + edit-session synth.
            No-op outside `?wikiCapture=…` mode. Mounted inside the
            FileSystemProvider so it can read `currentUser` for the
            unlockSession path. */}
        <WikiCaptureBodyClass />
        {/* Website-wide smart right-click framework (sequence editor master).
            Mounted here, above AppContent, so the single shared menu + the
            no-menu glyph + the one document-level contextmenu listener cover
            every route (app, wiki, welcome, demo) and every pre-login surface.
            Components opt in with useContextMenu(); a bare right-click elsewhere
            gets the glyph, and editable text keeps the native menu. */}
        {/* Website-wide BeakerSearch palette (sequence editor master).
            Mounted here, inside ContextMenuProvider and above AppContent, so the
            one shared Cmd-K command surface and its global keyboard listener
            cover every route (app, wiki, welcome, demo) and every pre-login
            surface, the same way the right-click framework does. Pages opt in
            with useBeakerSearchSource() to add their own context and tools; an
            always-present global layer (cross-page nav + app commands) means
            Cmd-K and the front-door pill open the palette on every page. */}
        <ContextMenuProvider>
          <BeakerSearchProvider>
            <AppContent>{children}</AppContent>
          </BeakerSearchProvider>
        </ContextMenuProvider>
      </FileSystemProvider>
    </ErrorBoundary>
  );
}
