"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
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
import { Splash } from "@/components/onboarding/Splash";
import { EntrySnapSurface } from "@/components/onboarding/EntrySnapSurface";
import { SuccessTransition } from "@/components/onboarding/SuccessTransition";
import SyncPausedIndicator from "@/components/SyncPausedIndicator";
import {
  AccountTierChooser,
  type AccountTier,
} from "@/components/onboarding/AccountTierChooser";
import CelebrationManager from "@/components/onboarding/CelebrationManager";
import MilestoneTwirlMount from "@/components/onboarding/MilestoneTwirlMount";
import IdleAnimationManager from "@/components/onboarding/IdleAnimationManager";
import WhatsNewManager from "@/components/WhatsNewManager";
import WikiCaptureBodyClass from "@/components/WikiCaptureBodyClass";
import SharedFolderAutoRefresh from "@/components/SharedFolderAutoRefresh";
import CaptureInboxPoller from "@/components/CaptureInboxPoller";
import FocusContextPublisher from "@/components/FocusContextPublisher";
import DevEphemeralSessionButton from "@/components/DevEphemeralSessionButton";
import DevRestartServerButton from "@/components/DevRestartServerButton";
import IdentitySessionRestorer from "@/components/IdentitySessionRestorer";
import TodaySnapshotPublisher from "@/components/TodaySnapshotPublisher";
import DataMigrationRunner from "@/components/DataMigrationRunner";
import MigrationToast from "@/components/MigrationToast";
import { ContextMenuProvider } from "@/components/context-menu/ContextMenuProvider";
import { BeakerSearchProvider } from "@/components/beaker-search/BeakerSearchProvider";
import { initializeErrorHandlers } from "@/lib/error-reporting";
import { projectsApi } from "@/lib/local-api";

// Patch the History API once (module scope, idempotent) so a reactive query-param
// read can observe next/navigation router.push/replace, which call pushState /
// replaceState. We do this instead of next/navigation's useSearchParams because
// this root provider wraps EVERY page; useSearchParams there forces a Suspense
// boundary during static export and, with none above the root, fails the
// production build outright (and would otherwise de-static every wiki/marketing
// page into client-side rendering). Wrapping is non-destructive (the original is
// always called) and never restored, which is fine for the app's lifetime.
if (
  typeof window !== "undefined" &&
  !(window as unknown as { __rosLocationPatched?: boolean }).__rosLocationPatched
) {
  (window as unknown as { __rosLocationPatched?: boolean }).__rosLocationPatched =
    true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function (
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event("researchos:locationchange"));
      return result;
    };
  }
}

/**
 * Reactive, Suspense-safe read of whether a `?signIn=` intent is in the URL.
 * Reads window.location.search (so static export never bails to CSR) and
 * re-renders on popstate plus the patched-history event above, so an in-session
 * router.push("/?...&signIn=<provider>") from the start screen / tier chooser
 * still hides the entry gate exactly as the old useSearchParams subscription did.
 */
function useSignInIntent(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("popstate", onChange);
    window.addEventListener("researchos:locationchange", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("researchos:locationchange", onChange);
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("signIn"),
    () => false,
  );
}

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

const SPLASH_SEEN_KEY = "researchos:splash-seen";
// Set when a visitor actively enters via the start screen (open folder / create
// account); consumed once when they first reach the app to play the celebratory
// SuccessTransition. sessionStorage so it survives the OAuth full-page redirect
// on the Free / Lab paths. Returning users who reconnect silently never set it,
// so they do not get the celebration on every open.
const ENTERED_KEY = "researchos:entered";
let successShownThisLoad = false;

// The account-tier choice for a fresh visitor, recorded for this page load so a
// remount of AppContent during setup does not re-show the chooser. Phase B2
// reads `researchos:account-tier` (sessionStorage) to drive the Free / Lab
// branches; Local needs no extra wiring (absent account_type normalizes to solo).
let chosenTierThisLoad: AccountTier | null = null;

// The start-screen action a not-auto-reconnected visitor picked this load:
// "open" -> connect/reconnect a folder (ResearchFolderSetupNew); "create" ->
// the new-account chooser. Module-scoped so a remount during setup does not
// bounce the user back to the start screen. null = show the start screen.
let entryActionThisLoad: "open" | "create" | null = null;

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
    disconnect,
  } = useFileSystem();
  const router = useRouter();
  const signInInFlight = useSignInIntent();
  // Splash plays once per tab session (survives reloads, so dev reloads and
  // returning users do not replay it; a brand-new tab plays it). Skippable.
  const [splashSeen, setSplashSeen] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      sessionStorage.getItem(SPLASH_SEEN_KEY) === "1",
  );
  const [entryAction, setEntryAction] = useState<"open" | "create" | null>(
    entryActionThisLoad,
  );
  const [successShown, setSuccessShown] = useState(successShownThisLoad);
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

  // When the rainbow loading screen plays (a real connect / reconnect), treat
  // IT as the branded opening moment and consume the one-shot BeakerBot Splash,
  // so a returning user does not see a rainbow-loading then BeakerBot-splash
  // then home double-flash (Grant 2026-06-09). A fast load with no loading
  // screen still gets the Splash as the opening brand moment.
  useEffect(() => {
    if (isLoading && !splashSeen) {
      try {
        sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
      } catch {
        // sessionStorage unavailable (private mode edge); harmless.
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- consumes the one-shot splash gate when the loading screen takes over as the brand moment
      setSplashSeen(true);
    }
  }, [isLoading, splashSeen]);

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
    // Escape hatch (2026-06-07): a stuck cloud folder (OneDrive / Box files-on-
    // demand) can leave this screen spinning for a long time. disconnect()
    // clears the handle + resets to the connect screen so the user can pick a
    // different (ideally local) folder. The in-flight finishConnect bails on its
    // next file op once the handle is cleared. Surfaced only after a delay inside
    // StagedLoadingScreen so fast loads never show it.
    return (
      <StagedLoadingScreen
        stage={loadingStage}
        onPickDifferentFolder={() => void disconnect()}
      />
    );
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

  // Branded opening splash, once per full page load. The wiki / welcome / demo
  // and wiki-capture surfaces already returned above; this only precedes the
  // real app entry (setup / login / app). It plays over the brief gate
  // resolution, then proceeds underneath. Skipped in fixture modes.
  if (!splashSeen && !isDemoOrWikiCapture()) {
    return (
      <Splash
        onComplete={() => {
          try {
            sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
          } catch {
            // sessionStorage unavailable (private mode edge); the splash just
            // plays again next render, harmless.
          }
          setSplashSeen(true);
        }}
      />
    );
  }

  // Start screen, the top-level front door (account-setup revamp). Shown to a
  // visitor who is NOT auto-reconnected (no live session: not connected, no
  // current user) and has not yet picked an entry action this load. It routes
  // intent: Sign in (provider OAuth, handled internally via ?signIn), Open a
  // folder (connect/reconnect, "open"), or Create a new account ("create" ->
  // the chooser). It adapts copy for a returning visitor (a known folder or
  // discovered users), so a returning user is never dropped onto the generic
  // picker as if nothing is saved. Yields when a signIn intent is already in
  // flight (the ?signIn param), so the OAuth callback lands on the setup screen.
  // Skipped in fixture modes. Same-device returning users with a live handle
  // never reach here; they reconnect silently above (isLoading branch).
  if (
    !isConnected &&
    !currentUser &&
    entryAction === null &&
    !isDemoOrWikiCapture() &&
    !signInInFlight
  ) {
    return (
      <QueryClientProvider client={queryClient}>
        <EntrySnapSurface
          returning={!!lastConnectedFolder || availableUsers.length > 0}
          onOpenFolder={() => {
            entryActionThisLoad = "open";
            try {
              sessionStorage.setItem(ENTERED_KEY, "1");
            } catch {
              // best-effort; the celebration is non-essential
            }
            setEntryAction("open");
          }}
          onCreateAccount={() => {
            entryActionThisLoad = "create";
            try {
              sessionStorage.setItem(ENTERED_KEY, "1");
            } catch {
              // best-effort
            }
            setEntryAction("create");
          }}
        />
      </QueryClientProvider>
    );
  }

  // Account-tier chooser, reached via the start screen's "Create a new account".
  // Local falls through to the normal folder-connect + create-user flow below
  // (absent account_type normalizes to solo); Free / Lab drive their OAuth
  // redirect internally (router.push to ?signIn, which yields the gate above).
  // Skipped in fixture modes and once a signIn intent is in flight.
  if (
    entryAction === "create" &&
    (showSetup || !isConnected) &&
    !isDemoOrWikiCapture() &&
    !signInInFlight
  ) {
    return (
      <QueryClientProvider client={queryClient}>
        <AccountTierChooser
          onLocal={() => {
            // Local: record the solo tier + proceed to folder setup.
            chosenTierThisLoad = "local";
            try {
              sessionStorage.setItem("researchos:account-tier", "local");
            } catch {
              // sessionStorage unavailable (private mode edge); the in-memory
              // chosenTierThisLoad still carries the choice for this load.
            }
            entryActionThisLoad = "open";
            setEntryAction("open");
          }}
        />
      </QueryClientProvider>
    );
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

  // Celebratory hand-off: when a visitor who actively entered this session
  // (start screen -> setup/sign-in) first reaches the app, play the
  // SuccessTransition once, then render the app underneath. Returning users who
  // reconnect silently never set ENTERED_KEY, so they skip straight to the app.
  // Skipped in fixture modes (which returned above anyway).
  if (
    !successShown &&
    typeof window !== "undefined" &&
    sessionStorage.getItem(ENTERED_KEY) === "1"
  ) {
    return (
      <SuccessTransition
        onComplete={() => {
          try {
            sessionStorage.removeItem(ENTERED_KEY);
          } catch {
            // best-effort
          }
          successShownThisLoad = true;
          setSuccessShown(true);
        }}
      />
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
      {/* Quiet "sync paused" pill when the collab relay reports durable
          persistence is paused (cost breaker / write throttle / doc cap). */}
      <SyncPausedIndicator />
      {/* Auto-refresh the app when the shared data folder changes on disk
          (a collaborator's new note / task / project), so other lab members
          see it without a manual refresh. Local-first equivalent of a server
          push: watches the folder via FileSystemObserver, focus-refetch
          fallback. Mounted here so it covers every signed-in route. */}
      <SharedFolderAutoRefresh />
      {/* Boot-time identity restore: repopulate the in-memory session from the
          persisted key on reload so the user does not have to re-unlock their
          profile every refresh, and so every reader sees one consistent
          identity. Mounted before the relay components that depend on it. */}
      <IdentitySessionRestorer />
      {/* Mobile capture relay poller (docs/proposals/MOBILE_CAPTURE_RELAY.md,
          piece D): when a folder is connected and the identity is unlocked,
          pulls phone-sent bench photos from the relay into the inbox, then
          acks them. Headless, no-op when no identity is on hand. */}
      <CaptureInboxPoller />
      {/* Mobile DOWNLOAD path (docs/proposals/MOBILE_DOWNLOAD_PATH.md, piece C):
          when a folder is connected and the identity is unlocked, seals a small
          "today" task snapshot to each paired phone and publishes it to the
          relay. Headless, no-op when no identity is on hand. */}
      <TodaySnapshotPublisher />
      {/* Mobile notebook integrations, Phase 1 (focus context): publishes the
          open experiment + active tab to paired phones on a ~10-second interval
          so the phone can route a bench photo directly to the open experiment's
          Notes or Results tab instead of the inbox. Headless, no-op when no
          identity is on hand or no experiment popup is open. */}
      <FocusContextPublisher />
      {/* Auto on-disk data migrations (docs/proposals/AUTO_DATA_MIGRATIONS.md):
          runs pending idempotent format upgrades once per connected user folder,
          in the background, and shows a quiet "Updated N files" toast on change.
          Replaces the manual "Run repair" buttons. */}
      <DataMigrationRunner />
      <MigrationToast />
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
        {/* Dev-only one-click clean-slate session. Mounted here (Providers
            level, above AppContent) like FloatingLeaveDemoButton so it shows on
            the pre-login connect / picker / login surfaces, not just the
            signed-in app. Spins up a throwaway in-browser (OPFS) folder, mints
            an identity, and signs in with no folder picker. Renders nothing in
            production or once a user is signed in. (mobile manager) */}
        <DevEphemeralSessionButton />
        {/* Dev-only: rerun ./start.sh to restart the dev server without the
            terminal. Mounted here so it floats on every surface in dev. */}
        <DevRestartServerButton />
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
          {/* BeakerSearchProvider calls useQueryClient (via useGlobalObjectIndex)
              while mounted above AppContent, but AppContent owns the per-branch
              QueryClientProviders, so without a client here the global Cmd-K
              provider crashes the whole app ("No QueryClient set"). Provide the
              shared appQueryClient singleton up here; AppContent's inner
              providers reuse the same instance, so nothing double-fetches. */}
          <QueryClientProvider client={appQueryClient}>
            <BeakerSearchProvider>
              <AppContent>{children}</AppContent>
            </BeakerSearchProvider>
          </QueryClientProvider>
        </ContextMenuProvider>
      </FileSystemProvider>
    </ErrorBoundary>
  );
}
