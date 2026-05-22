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
import { OnboardingProvider } from "@/lib/onboarding/orchestrator";
import LabTourResumePrompt from "@/components/onboarding/v3/LabTourResumePrompt";
import V4MountForUser from "@/components/onboarding/v4/V4MountForUser";
import CelebrationManager from "@/components/onboarding/CelebrationManager";
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
    // still get the slim wiki-only tree. Lab Mode users skip the v4
    // tour entirely (matches AppContent's signed-in branch); guard the
    // same way here so the lab pseudo-user doesn't pull in V4 either.
    const wikiUserHasTour =
      isConnected &&
      !!currentUser &&
      currentUser.toLowerCase() !== "lab";
    if (wikiUserHasTour) {
      return (
        <QueryClientProvider client={queryClient}>
          <OnboardingProvider currentUser={currentUser}>
            <V4MountForUser username={currentUser}>{children}</V4MountForUser>
          </OnboardingProvider>
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
    // Wrap in OnboardingProvider even in demo mode so the
    // tutorial-tab carve-out (`isTutorialMode()` → mount the
    // sequencer) can fire. Without this wrapper, /demo?tutorial=1
    // short-circuits straight to children and the guided tour never
    // appears. For non-tutorial demo (the public /demo route +
    // ?wikiCapture=1 screenshots), OnboardingProvider's own logic
    // pass-throughs the children unchanged — no behavior change in
    // those modes.
    //
    // V4 mount carve-out (live-test sub-bot 2026-05-21): when
    // ?wizard-preview=1 OR ?wizardSeedStep=… is on the URL, we ALSO
    // wrap children in V4MountForUser so automated tests + wiki
    // captures can drive the v4 onboarding tour against the fixture
    // store. Without this carve-out, the v4 tour controller never
    // mounts in wikiCapture mode and the seed plumbing in
    // wiki-capture-mock.ts has no consumer. Plain /demo and bare
    // ?wikiCapture=1 stay unchanged — v4 only activates when the URL
    // explicitly opts in.
    // Sticky check (live-test R3 cascade fix 2026-05-21): isV4PreviewMode
    // reads URL params AND sessionStorage so in-tab navigations whose
    // hrefs strip the query string don't drop V4MountForUser. Without
    // this, every cursor-driven router.push from a step body (project
    // card click, wiki nav, methods nav, etc.) unmounted the v4 tour
    // and re-summoned the V4ResumePrompt mid-walkthrough.
    const wantsV4Mount = isV4PreviewMode();
    return (
      <QueryClientProvider client={queryClient}>
        <OnboardingProvider currentUser={currentUser}>
          {wantsV4Mount ? (
            <V4MountForUser username={currentUser}>{children}</V4MountForUser>
          ) : (
            children
          )}
        </OnboardingProvider>
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
  // Onboarding tips orchestrator. Wrapped inside the QueryClientProvider
  // and only on the non-demo, signed-in code path. Demo + wiki-capture
  // are exempt by design (they short-circuit the previous branch); the
  // provider itself also asserts the exemption via isDemoOrWikiCapture()
  // so a stray mount can't fire tips during a screenshot run.
  //
  // LabTourResumePrompt is a sibling — P3b's deferred lab-tour trigger.
  // Lives outside OnboardingProvider so it doesn't depend on the wizard
  // context, but inside the same demo / wiki-capture exemption (the outer
  // conditional in this file peels those modes off before reaching here).
  //
  // V4MountForUser (P11) mounts INSIDE OnboardingProvider so both the
  // v3 orchestrator context and the v4 TourController context coexist
  // during the cutover window. v3's auto-fire is gated off (see
  // WizardMount.tsx), so the two do not conflict at runtime. v3's
  // remaining surface (the orchestrator context + LabTourResumePrompt)
  // stays available for in-flight users until P9 deletes v3. Lab Mode
  // users skip v4 because OnboardingProvider already returns
  // children-only for them; this also matches v3's behavior for Lab
  // Mode (no welcome tour on a read-only cross-user view).
  const isLabUser = currentUser.toLowerCase() === "lab";
  return (
    <QueryClientProvider client={queryClient}>
      {/* Once-per-session orphan-project sweep. Mounted as a sibling of
          OnboardingProvider so it runs whether the user lands on /home,
          /workbench, or any other route on their first paint. Skipped
          for the lab pseudo-user since the lab namespace doesn't host
          per-user projects in the same shape. (orphan v2 sub-bot) */}
      {!isLabUser && <OrphanProjectSweep currentUser={currentUser} />}
      <OnboardingProvider currentUser={currentUser}>
        {isLabUser ? (
          <>
            {children}
            {/* Lab Mode bypasses the v4 tour entirely, so no
                TourControllerProvider is in the tree. CelebrationManager
                still mounts here so streak milestones earned by a lab
                user (rare but possible, since they can write to their data
                folder) fire as expected. useOptionalTourController()
                will return null in this branch, which the manager
                treats as "no tour active" → fires normally. */}
            <CelebrationManager username={currentUser} />
          </>
        ) : (
          <V4MountForUser username={currentUser}>
            {children}
            {/* CelebrationManager is a peer of TourBootstrap inside
                the TourControllerProvider tree. Inside the provider so
                useOptionalTourController() returns the live controller
                value (the manager defers firing while a tour is
                active, per proposal §6.7 "don't overlap with the
                bottom-right tour BeakerBot"). */}
            <CelebrationManager username={currentUser} />
          </V4MountForUser>
        )}
      </OnboardingProvider>
      <LabTourResumePrompt username={currentUser} />
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
        <AppContent>{children}</AppContent>
      </FileSystemProvider>
    </ErrorBoundary>
  );
}
