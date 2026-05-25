"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { appQueryClient } from "@/lib/query-client";
import { usePathname } from "next/navigation";
import { FileSystemProvider, useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import {
  isDemoOrWikiCapture,
  isV4PreviewMode,
} from "@/lib/file-system/wiki-capture-mock";
import ResearchFolderSetupNew from "@/components/ResearchFolderSetupNew";
import UserLoginScreen from "@/components/UserLoginScreen";
import PreOnboardingScreen from "@/components/PreOnboardingScreen";
import { hasSeenPreOnboarding } from "@/lib/pre-onboarding/pre-onboarding-storage";
import StagedLoadingScreen from "@/components/StagedLoadingScreen";
import ErrorBoundary from "@/components/ErrorBoundary";
import GlobalDropGuard from "@/components/GlobalDropGuard";
import FloatingLeaveDemoButton from "@/components/FloatingLeaveDemoButton";
import OpenDocsButton from "@/components/OpenDocsButton";
import SceneTriggerHost from "@/components/SceneTriggerHost";
import AutoErrorConfirmHost from "@/components/AutoErrorConfirmHost";
import V4MountForUser from "@/components/onboarding/v4/V4MountForUser";
import CelebrationManager from "@/components/onboarding/CelebrationManager";
import IdleAnimationManager from "@/components/onboarding/IdleAnimationManager";
import WikiCaptureBodyClass from "@/components/WikiCaptureBodyClass";
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

function AppContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The wiki must render before sign-in so new users can read the setup
  // guide and the browser-requirements page on their first visit. Skip
  // every gate below — loading, browser-support, folder-connect — when
  // the user is on a /wiki/* route. Query client is still provided so
  // any future client-rendered queries inside the wiki work.
  const isWikiRoute = pathname?.startsWith("/wiki");

  // QueryClient is a module-level singleton (see `appQueryClient` below)
  // so non-React-tree consumers (e.g. the onboarding-v4 cursor scripts
  // that fire programmatic API calls outside the component tree) can
  // call `appQueryClient.refetchQueries(...)` without needing to thread
  // a ref through the orchestrator. Inside the tree this is identical
  // to the previous `useState(() => new QueryClient(...))` pattern: the
  // singleton is created once on first import and reused forever.
  const queryClient = appQueryClient;

  const { isConnected, isLoading, currentUser, loadingStage } = useFileSystem();
  const [showSetup, setShowSetup] = useState(false);

  // Pre-onboarding gate state. Initialized lazily from localStorage so
  // SSR + first client paint match: `hasSeenPreOnboarding()` is SSR-safe
  // (returns false when window is absent) and reads the same key the
  // screen writes on dismiss. The setter is wired into
  // PreOnboardingScreen's `onComplete` so the gate flips synchronously
  // when the user finishes (or skips) the intro and ResearchFolderSetupNew
  // takes over without a remount round-trip through localStorage.
  // (pre-onboarding P0 sub-bot R2 2026-05-22)
  const [preOnboardingSeen, setPreOnboardingSeen] = useState<boolean>(() =>
    hasSeenPreOnboarding(),
  );

  console.log("AppContent render:", { isConnected, isLoading, currentUser, showSetup });

  useEffect(() => {
    console.log("AppContent useEffect:", { isLoading, isConnected, currentUser });
    if (!isLoading && !isConnected) {
      console.log("AppContent: showing setup (not connected)");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- state machine: setup gate flips based on external fs-connection state transitions
      setShowSetup(true);
    } else if (isConnected && currentUser) {
      console.log("AppContent: hiding setup (connected with user)");
      setShowSetup(false);
    }
  }, [isLoading, isConnected, currentUser]);

  useEffect(() => {
    if (currentUser) {
      queryClient.invalidateQueries();
    }
  }, [currentUser, queryClient]);

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
    console.log("AppContent: rendering loading screen");
    return <StagedLoadingScreen stage={loadingStage} />;
  }

  if (!isFileSystemAccessSupported()) {
    console.log("AppContent: rendering browser not supported");
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-lg mx-4 p-6 bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20">
          <h2 className="text-xl font-bold text-white mb-4">Browser Not Supported</h2>
          <p className="text-slate-300 mb-4">
            ResearchOS requires the File System Access API, which is only supported in
            Chromium-based browsers (Chrome, Edge, Brave). Please switch to a supported browser.
          </p>
          <a
            href="/wiki/getting-started/browser-requirements"
            className="inline-block text-sm font-medium text-blue-300 hover:text-blue-200 underline"
          >
            Read the browser requirements guide →
          </a>
        </div>
      </div>
    );
  }

  // Pre-onboarding gate (P0). Fires BEFORE ResearchFolderSetupNew so a
  // fresh visitor sees the BeakerBot-led intro + data-security panel
  // before being asked to pick a folder. Predicate:
  //
  //   not connected AND not seen AND not in any fixture / preview mode.
  //
  // The fixture / preview modes are already short-circuited above (the
  // `isDemoOrWikiCapture() && currentUser` branch handles signed-in
  // demo + wiki-capture; isWikiRoute handles /wiki/*). The remaining
  // case to guard here is the bare ?wikiCapture=1 picker variant
  // (currentUser empty) and ?wizard-preview=1 / ?wizardSeedStep=… —
  // those routes must reach ResearchFolderSetupNew / UserLoginScreen
  // without the pre-onboarding interstitial so the wiki-capture and
  // v4-preview pipelines keep working unchanged.
  //
  // Existing-user heuristic (proposal §9): if isConnected is true, we
  // never reach this branch because the `showSetup || !isConnected`
  // gate below either renders the app shell or routes to the user
  // picker. Returning users with a linked folder therefore skip
  // pre-onboarding by virtue of the gate ordering, not an explicit
  // check — matches L8 "folder-already-connected = no pre-onboarding".
  // (pre-onboarding P0 sub-bot R2 2026-05-22)
  if (
    !isConnected &&
    !preOnboardingSeen &&
    !isDemoOrWikiCapture() &&
    !isV4PreviewMode()
  ) {
    console.log("AppContent: rendering PreOnboardingScreen (first touch)");
    return (
      <PreOnboardingScreen
        onComplete={() => setPreOnboardingSeen(true)}
      />
    );
  }

  if (showSetup || !isConnected) {
    console.log("AppContent: rendering ResearchFolderSetupNew because:", { showSetup, isConnected, currentUser });
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
    console.log("AppContent: rendering UserLoginScreen (connected, no user)");
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

  console.log("AppContent: rendering main app with QueryClientProvider");
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
      <V4MountForUser username={currentUser}>
        {children}
        {/* CelebrationManager is a peer of TourBootstrap inside
            the TourControllerProvider tree. Inside the provider so
            useOptionalTourController() returns the live controller
            value (the manager defers firing while a tour is
            active, per proposal §6.7 "don't overlap with the
            bottom-right tour BeakerBot"). */}
        <CelebrationManager username={currentUser} />
        {/* IdleAnimationManager: peer of CelebrationManager. Fires a
            random BeakerBot scene from IDLE_POOL after the user has
            been idle for IDLE_THRESHOLD_MS. One per session, gated by
            sessionStorage. Independent of the streak/milestone path
            CelebrationManager owns. */}
        <IdleAnimationManager />
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
        <AppContent>{children}</AppContent>
      </FileSystemProvider>
    </ErrorBoundary>
  );
}
