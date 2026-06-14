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
import { usePathname } from "next/navigation";
import { FileSystemProvider, useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import {
  isDemoOrWikiCapture,
} from "@/lib/file-system/wiki-capture-mock";
import FolderConnectGate from "@/components/onboarding/FolderConnectGate";
import AccountFirstRedirect, {
  useHasCloudSession,
} from "@/components/account/AccountFirstRedirect";
import { isAccountFirstEnabled } from "@/lib/account/account-first";
import WelcomePage from "@/components/welcome/WelcomePage";
import { signIn } from "next-auth/react";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import { ELN_IMPORT_PENDING_KEY } from "@/components/import-eln/PickUserBeforeImportModal";
import UserLoginScreen from "@/components/UserLoginScreen";
import StagedLoadingScreen from "@/components/StagedLoadingScreen";
import ErrorBoundary from "@/components/ErrorBoundary";
import GlobalDropGuard from "@/components/GlobalDropGuard";
import FloatingLeaveDemoButton from "@/components/FloatingLeaveDemoButton";
import DemoEntryCue from "@/components/DemoEntryCue";
import DemoViewAsButton from "@/components/DemoViewAsButton";
import WikiCaptureRefusedBanner from "@/components/WikiCaptureRefusedBanner";
import SceneTriggerHost from "@/components/SceneTriggerHost";
import AutoErrorConfirmHost from "@/components/AutoErrorConfirmHost";
import { Splash } from "@/components/onboarding/Splash";
import { EntrySnapSurface } from "@/components/onboarding/EntrySnapSurface";
import { OAuthFirstLanding } from "@/components/onboarding/oauth-first/OAuthFirstLanding";
import { WelcomeBackSignIn } from "@/components/onboarding/oauth-first/WelcomeBackSignIn";
import { isOAuthFirstLoginEnabled } from "@/lib/sharing/oauth-first-login";
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
import RecordingModeBodyClass from "@/components/RecordingModeBodyClass";
import DemoVideoAutoplay from "@/components/DemoVideoAutoplay";
import SharedFolderAutoRefresh from "@/components/SharedFolderAutoRefresh";
import SpellcheckAutoSeed from "@/components/SpellcheckAutoSeed";
import CaptureInboxPoller from "@/components/CaptureInboxPoller";
import FocusContextPublisher from "@/components/FocusContextPublisher";
import DevEphemeralSessionButton from "@/components/DevEphemeralSessionButton";
import DevRestartServerButton from "@/components/DevRestartServerButton";
import IdentitySessionRestorer from "@/components/IdentitySessionRestorer";
import TodaySnapshotPublisher from "@/components/TodaySnapshotPublisher";
import DataMigrationRunner from "@/components/DataMigrationRunner";
import MigrationToast from "@/components/MigrationToast";
import MigrationGate from "@/components/lab/MigrationGate";
import { isOperatorSurface } from "@/lib/routes/operator-surface";
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
 * Reactive, Suspense-safe read of the `?signIn=<provider>` intent in the URL.
 * Returns the provider string (orcid / google / github / linkedin / email) or
 * null. Reads window.location.search (so static export never bails to CSR) and
 * re-renders on popstate plus the patched-history event above, so an in-session
 * router.push("/?...&signIn=<provider>") from the start screen / tier chooser
 * still hides the entry gate exactly as the old useSearchParams subscription did.
 *
 * The provider value (not just a boolean) is needed because, after the folder
 * connect + account selection that this intent drives, lib/providers triggers
 * the actual OAuth redirect for the sharing-identity claim. That used to live in
 * ResearchFolderSetupNew.handleComplete; it was rehomed here when that screen
 * was retired (onboarding redundancy removal, 2026-06-10).
 */
function useSignInProvider(): string | null {
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
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("signIn")
        : null,
    () => null,
  );
}

/**
 * Reactive, Suspense-safe read of the `?sharingClaim=1` return flag, set by the
 * OAuth-first sign-in (startOAuthFirstSignIn). Subscribes the same way as
 * useSignInProvider. When true and no folder is connected yet, the OAuth round
 * trip has completed (verified email in the session) and the visitor still needs
 * to pick a folder, so the folder gate reads as "Save your account on your disk"
 * (the post-sign-in framing) rather than a cold connect. The actual identity
 * claim is completed by the global SharingClaimResume mount once a folder-local
 * user is connected. Only consulted when the OAuth-first flag is on, so the
 * legacy flow is untouched.
 */
function useSharingClaimReturn(): boolean {
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
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).has("sharingClaim")
        : false,
    () => false,
  );
}

// Guards the provider OAuth redirect so it fires exactly once per page load even
// under a React strict-mode double-mount. signIn() / location.assign() navigate
// away, so in practice the screen unloads, but the flag keeps a dev double-mount
// from racing two redirects.
let providerSignInFired = false;

/**
 * OAuth sharing-claim resume. Mounted only once the visitor who started a
 * "Sign in with <provider>" flow (the `?signIn=` intent) has connected a folder
 * AND selected an account, the prerequisites for minting a real sharing
 * identity. It fires the provider redirect (or, for email, reloads into the
 * email-OTP step of the global sharing mount) and shows a brief "Signing you
 * in" screen so the full app does not flash before navigation.
 *
 * This is the rehomed tail of ResearchFolderSetupNew.handleComplete: the
 * callbackUrl carries ?sharingClaim=1 so the user returns into the global
 * SharingClaimResume mount (now with their freshly selected user connected) and
 * a real sharing identity gets created, not just an OAuth session.
 */
function ProviderSignInRedirect({ provider }: { provider: string }) {
  useEffect(() => {
    if (providerSignInFired) return;
    providerSignInFired = true;
    if (provider === "email") {
      // Email skips OAuth. The folder + user are already connected, so reload
      // into the global mount which opens the wizard at its email step.
      window.location.assign("/?sharingEmail=1");
      return;
    }
    void signIn(provider, { callbackUrl: "/?sharingClaim=1" });
  }, [provider]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-surface-sunken via-surface to-surface-sunken">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-action" />
      <p className="text-body text-foreground-muted">Signing you in...</p>
    </div>
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

// The branded BeakerBot splash plays as the launch-into-app moment the FIRST
// time the workbench loads each day (Grant 2026-06-12: the splash IS the pretty
// loading screen that launches users into the app on their first session each
// day). Gated by a per-day stamp in localStorage so it is a once-a-day delight,
// not every load. Stored as a local YYYY-MM-DD date string.
const SPLASH_DAY_KEY = "researchos:splash-day";
const localDayStamp = () => {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

// The account-tier choice for a fresh visitor, recorded for this page load so a
// remount of AppContent during setup does not re-show the chooser. Phase B2
// reads `researchos:account-tier` (sessionStorage) to drive the Free / Lab
// branches; Local needs no extra wiring (absent account_type normalizes to solo).
let chosenTierThisLoad: AccountTier | null = null;

// The start-screen action a not-auto-reconnected visitor picked this load:
// "open" -> connect/reconnect a folder (FolderConnectGate); "create" ->
// the new-account chooser; "signin" -> the OAuth-first Welcome-back re-login
// screen (only reachable when NEXT_PUBLIC_OAUTH_FIRST_LOGIN is on). Module-scoped
// so a remount during setup does not bounce the user back to the start screen.
// null = show the landing.
type EntryAction = "open" | "create" | "signin";
let entryActionThisLoad: EntryAction | null = null;

function AppContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The wiki must render before sign-in so new users can read the setup
  // guide and the browser-requirements page on their first visit. Skip
  // every gate below — loading, browser-support, folder-connect — when
  // the user is on a /wiki/* route. Query client is still provided so
  // any future client-rendered queries inside the wiki work.
  const isWikiRoute = pathname?.startsWith("/wiki");

  // The standalone `/welcome` route was retired 2026-06-11 (Grant). The marketing
  // content lives only as the slide-down of the entry surface now (EntrySnapSurface
  // / the OAuth-first landing both embed `<WelcomePage>`); there is one front door.

  // Operator surfaces (/admin, /business and anything beneath) are standalone
  // operator tools served from the Neon API and gated by their OWN third-party
  // (OAuth) operator sign-in, not by the local folder. They must render directly
  // and skip every user-facing gate below (folder connect, account picker,
  // splash, loading) and every app-wide nudge or popup (migration gate, tours,
  // what's new), so the only thing an operator ever sees here is the page and its
  // OAuth sign-in if it needs one (Grant 2026-06-10, after the migration gate and
  // the connect flow kept trapping the business page).
  const isOperatorRoute = isOperatorSurface(pathname);

  // Public marketing / legal pages (pricing, about, and the trust pages) must
  // render for ANYONE, including a logged-out visitor with no folder. They carry
  // their own MarketingNav + footer and need no folder. Without this bypass they
  // fell through to the folder-connect gate below, so a "See exactly how it is
  // priced" link from the landing just bounced back to the top of the landing.
  const isPublicMarketingRoute =
    pathname === "/pricing" ||
    pathname === "/ai" ||
    pathname === "/about" ||
    pathname === "/transparency" ||
    pathname === "/open-source" ||
    pathname === "/thanks" ||
    pathname === "/sponsors" ||
    pathname === "/privacy" ||
    pathname === "/terms";

  // Folderless, session-authenticated routes: the org admin portals + their
  // accept pages, the account home, and public @handle profiles. These run off
  // the NextAuth session and Neon, need NO data folder, and must render in any
  // browser, so they bypass the File System Access + folder-connect gate exactly
  // like the operator and marketing routes do (cloud-accounts Phase 1: data is
  // local, the account is cloud).
  const isFolderlessAccountRoute =
    pathname === "/account" ||
    pathname?.startsWith("/department") ||
    pathname?.startsWith("/institution") ||
    pathname?.startsWith("/dept/") ||
    pathname?.startsWith("/u/");

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
    connect,
    reconnectWithStoredHandle,
    disconnect,
    needsInitialization,
  } = useFileSystem();
  const pendingSignInProvider = useSignInProvider();
  const signInInFlight = pendingSignInProvider !== null;
  // OAuth-first: did we just return from a provider with ?sharingClaim=1 and no
  // folder yet? Drives the "Save your account on your disk" folder framing.
  const sharingClaimReturn = useSharingClaimReturn();
  const accountSaveFraming = isOAuthFirstLoginEnabled() && sharingClaimReturn;
  // Splash plays once per tab session (survives reloads, so dev reloads and
  // returning users do not replay it; a brand-new tab plays it). Skippable.
  // True once today's launch splash has played. Read from the per-day stamp so
  // the splash fires only on the first workbench load of the day.
  const [splashSeen, setSplashSeen] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem(SPLASH_DAY_KEY) === localDayStamp(),
  );
  const [entryAction, setEntryAction] = useState<EntryAction | null>(
    entryActionThisLoad,
  );

  // Client-mounted flag, only used to gate the dev login preview below so it
  // does not cause a hydration mismatch. The preview reads window/sessionStorage,
  // which the server cannot, so the first client render must match the server
  // (preview off) and only swap in after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Account-first (cloud-accounts Phase 1, Chunk C): read the cloud (NextAuth)
  // session once so a signed-in, folderless visitor can be routed to /account
  // instead of the folder wall. Only consulted when the flag is on; the hook runs
  // unconditionally (rules of hooks) but is cheap and inert otherwise.
  const hasCloudSession = useHasCloudSession();

  useEffect(() => {
    if (currentUser) {
      queryClient.invalidateQueries();
    }
  }, [currentUser, queryClient]);

  // No forced first-visit redirect to /welcome (removed 2026-06-10, Grant). A
  // fresh visitor now lands on the connect chooser (EntrySnapSurface) directly,
  // which already embeds the full welcome/sell page one scroll down, so the old
  // bounce through /welcome was a redundant detour. /welcome stays reachable as
  // a standalone marketing page (Settings revisit link, dev button, direct
  // URL); it just is not the forced default anymore.

  // Dev-only login preview. The OAuth-first entry screens (the new landing and
  // the Welcome-back sign-in) are normally double-gated, the flag has to be on
  // AND there can be no live session, so a logged-in developer cannot reach them
  // by typing a URL. This escape renders them on demand without signing out or
  // flipping NEXT_PUBLIC_OAUTH_FIRST_LOGIN. Type `?previewLogin=1` for the
  // landing or `?previewLogin=signin` for the sign-in screen, on any page;
  // `?previewLogin=off` (or the Exit button) leaves it.
  //
  // The intent is stashed in sessionStorage because "/" is a pure router that
  // bounces a lab head to /lab-overview, which strips the query string before
  // the preview can render. Persisting it means the preview survives that
  // bounce. It is scoped to the entry routes only ("/" and the two role-landing
  // bounce targets), so a real content route the landing links to (/transparency,
  // /demo, /pricing, /wiki) renders normally instead of being hijacked by the
  // persisted flag. The NODE_ENV literal is inlined at build time so the whole
  // block tree-shakes out of production.
  if (
    process.env.NODE_ENV === "development" &&
    mounted &&
    typeof window !== "undefined" &&
    (pathname === "/" ||
      pathname === "/workbench" ||
      pathname === "/lab-overview")
  ) {
    const PREVIEW_KEY = "ros_preview_login";
    const previewParam = new URLSearchParams(window.location.search).get(
      "previewLogin",
    );
    if (previewParam === "off") {
      try {
        sessionStorage.removeItem(PREVIEW_KEY);
      } catch {
        // sessionStorage unavailable, nothing to clear.
      }
    } else if (previewParam) {
      try {
        sessionStorage.setItem(PREVIEW_KEY, previewParam);
      } catch {
        // sessionStorage unavailable; the URL param still drives this load.
      }
    }
    let previewMode = previewParam && previewParam !== "off" ? previewParam : null;
    if (!previewMode) {
      try {
        previewMode = sessionStorage.getItem(PREVIEW_KEY);
      } catch {
        previewMode = null;
      }
    }
    if (previewMode) {
      const exitPreview = () => {
        try {
          sessionStorage.removeItem(PREVIEW_KEY);
        } catch {
          // best-effort
        }
        window.location.assign("/?previewLogin=off");
      };
      return (
        <QueryClientProvider client={queryClient}>
          {previewMode === "signin" ? (
            <WelcomeBackSignIn
              onBack={() => window.location.assign("/?previewLogin=1")}
              onOpenFolder={() => {}}
            />
          ) : (
            <OAuthFirstLanding
              onCreateAccount={() => {}}
              onSignIn={() => window.location.assign("/?previewLogin=signin")}
            />
          )}
          <button
            type="button"
            onClick={exitPreview}
            className="fixed bottom-4 left-4 z-[100] rounded-full bg-slate-900/85 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-slate-900"
          >
            Exit login preview
          </button>
        </QueryClientProvider>
      );
    }
  }

  if (isWikiRoute) {
    // Wiki route for a signed-in real user: render children inside the
    // query client. The v4 tour wrapper is gone; no tour to keep alive here.
    if (isConnected && currentUser) {
      return (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
    }
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // Operator surfaces render their own page (which carries its OAuth operator
  // sign-in) and nothing else, bypassing every gate and popup below.
  if (isOperatorRoute) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // Public marketing / legal pages render directly for anyone, no folder gate,
  // so links to them from the landing actually open the page (the /pricing bounce
  // bug). They bring their own chrome and need nothing from the app shell.
  if (isPublicMarketingRoute) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // Folderless, session-authenticated routes (org portals, accept pages, account
  // home, @handle profiles) render directly off the session in any browser, no
  // folder gate. FileSystemProvider context is still inherited from Providers
  // (currentUser is simply null when no folder is connected).
  if (isFolderlessAccountRoute) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // The Splash redesign review page is a folderless dev harness: it mounts the
  // launch-splash variants over a mock workbench with no real data. It must
  // render without the File System Access gate so the variants can be reviewed
  // in any browser without connecting a folder. The variants are pure
  // presentational components, so a query client is all the context it needs.
  if (pathname === "/dev/splash") {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // The demo-video studio launcher is a folderless dev console of clip links. It
  // must render in ANY browser (notably Safari, so recordings dodge Chrome's
  // "Claude is debugging" automation banner) without the File System Access gate.
  // The clips it links to (/demo?record=1) already bypass the gate via the demo
  // branch below, so the whole record flow works in Safari from this page.
  if (pathname === "/dev/demo-videos") {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // The BeakerBot dev play page works without a connected folder (it uses a
  // mock model caller). Bypass the folder gate and provide the minimum context
  // it needs: a query client (so BeakerSearchProvider's useQueryClient call
  // does not crash) and BeakerSearchProvider (so openBeakerBot is available).
  // The page itself installs the mock caller and opens the palette on mount.
  if (pathname === "/dev/beakerbot") {
    return (
      <QueryClientProvider client={queryClient}>
        <BeakerSearchProvider>
          {children}
        </BeakerSearchProvider>
      </QueryClientProvider>
    );
  }

  // The popup-chrome before/after review gallery is a folderless dev harness.
  // It mounts the OLD (pre-CalmPopupShell) and NEW (migrated) object popups side
  // by side so the migrated chrome can be signed off per type, with no real data.
  // It must render without the File System Access gate, so bypass the folder
  // wall and supply just a query client (the popups call useQueryClient /
  // useQuery; the always-mounted FileSystemProvider above already gives them a
  // null currentUser cleanly). The popups read empty / missing data and show
  // their own empty states, which is exactly what we want for a chrome review.
  if (pathname === "/dev/popup-chrome") {
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
    // Demo + wiki-capture: render children directly. The v4 tour preview
    // pipeline (wizard-preview / wizardSeedStep) no longer needs a special
    // mount now that the tour engine is gone.
    //
    // The mobile-relay headless components mount here too so a demo session can
    // pair a phone and sync to the relay (companion device-testing). They are
    // inert without an unlocked identity (loadUserCaptureKeys returns null), so
    // a normal demo visitor never touches the relay; they activate only once a
    // dev identity is created and a phone is paired. IdentitySessionRestorer
    // repopulates the unlocked key from IndexedDB on reload so the publisher
    // keeps publishing across a refresh.
    return (
      <QueryClientProvider client={queryClient}>
        <IdentitySessionRestorer />
        <CaptureInboxPoller />
        <TodaySnapshotPublisher />
        <FocusContextPublisher />
        <>{children}</>
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

  // Unsupported device or browser (no File System Access API: any phone, plus
  // Safari / Firefox / Brave on desktop). The tool itself cannot run here, but
  // the marketing front door must still be readable on any device (Grant,
  // 2026-06-12). Render the full welcome/sell page in read-only mode: every
  // section shows and the other public pages stay reachable, only the "start the
  // app" entry is swapped for a desktop-required notice. The actual entry
  // surfaces (folder picker, OAuth, account chooser) stay gated below.
  if (!isFileSystemAccessSupported()) {
    return (
      <QueryClientProvider client={queryClient}>
        <WelcomePage unsupported />
      </QueryClientProvider>
    );
  }

  // Account-first (cloud-accounts Phase 1, Chunk C). When NEXT_PUBLIC_ACCOUNT_FIRST
  // is on, a SIGNED-IN visitor with no folder belongs on the folderless /account
  // home, not the folder-connect wall (this is the break in the OAuth->folder
  // fusion: today a fresh OAuth sign-in falls through to FolderConnectGate). A
  // logged-out visitor falls through to the normal front door below. Default-off,
  // so this whole branch is inert and the current flow is untouched unless the
  // flag is set. While the session check is in flight we hold briefly so a
  // signed-in user does not flash the front door before the redirect.
  if (
    isAccountFirstEnabled() &&
    hasCloudSession === true &&
    !isConnected &&
    !currentUser &&
    // A brand-new empty folder is attached but not yet validated: finishConnect
    // flipped needsInitialization. Do NOT bounce to /account here (that loops the
    // first-folder onboarding path) — fall through to FolderConnectGate's
    // "Initialize New Folder" prompt below.
    !needsInitialization &&
    !isDemoOrWikiCapture() &&
    !signInInFlight
  ) {
    // Signed in with no folder: route to the folderless account home. A null
    // (still-checking) or false (logged out) session falls through to the normal
    // front door below, so a fresh visitor sees the landing with no delay.
    return (
      <QueryClientProvider client={queryClient}>
        <AccountFirstRedirect />
      </QueryClientProvider>
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
  // OAuth-first re-login screen (entry-flow redesign change 5). Reached only
  // when the flag is on and the visitor clicked "Sign in" on the new landing.
  // Shows the provider logins with the last-used provider floated to the top,
  // plus an "Open a folder, no account" escape that triggers the OS picker
  // directly (the same direct connect the landing's Create -> Local path uses).
  if (
    isOAuthFirstLoginEnabled() &&
    entryAction === "signin" &&
    !isConnected &&
    !currentUser &&
    !isDemoOrWikiCapture() &&
    !signInInFlight
  ) {
    return (
      <QueryClientProvider client={queryClient}>
        <WelcomeBackSignIn
          onBack={() => {
            entryActionThisLoad = null;
            setEntryAction(null);
          }}
          onOpenFolder={() => {
            entryActionThisLoad = "open";
            setEntryAction("open");
            if (lastConnectedFolder) {
              void reconnectWithStoredHandle();
            } else {
              void connect();
            }
          }}
        />
      </QueryClientProvider>
    );
  }

  if (
    !isConnected &&
    !currentUser &&
    entryAction === null &&
    !isDemoOrWikiCapture() &&
    !signInInFlight &&
    // A provider return (OAuth-first sign-in / free / lab-create) comes back to
    // ?sharingClaim=1 with NO ?signIn param and a module that has reset
    // entryAction on the full-page redirect, so without this guard the landing
    // gate bounces the just-signed-in user straight back to the landing. Yield so
    // the flow falls through to FolderConnectGate (the "save your account" step),
    // where connecting a folder lets SharingClaimResume / LabCreateResume finish.
    !sharingClaimReturn
  ) {
    // OAuth-first landing (entry-flow redesign change 1). One light deck-style
    // intro replaces the start-chooser. Create account opens the existing
    // three-tier chooser; Sign in opens the Welcome-back screen. Gated on the
    // flag so the OFF path renders the unchanged EntrySnapSurface below.
    if (isOAuthFirstLoginEnabled()) {
      return (
        <QueryClientProvider client={queryClient}>
          <OAuthFirstLanding
            onCreateAccount={() => {
              entryActionThisLoad = "create";
              setEntryAction("create");
            }}
            onSignIn={() => {
              entryActionThisLoad = "signin";
              setEntryAction("signin");
            }}
          />
        </QueryClientProvider>
      );
    }
    return (
      <QueryClientProvider client={queryClient}>
        <EntrySnapSurface
          returning={!!lastConnectedFolder || availableUsers.length > 0}
          onOpenFolder={() => {
            entryActionThisLoad = "open";
            setEntryAction("open");
            // Trigger the folder connect straight from this click. The click is
            // a live user gesture, so the OS picker opens immediately, no
            // redundant intermediate "Link a folder" page (onboarding
            // redundancy removal, 2026-06-10). connect() flips into the loading
            // screen, so the FolderConnectGate connect surface only shows if the
            // user cancels (a retry / recovery surface). For a returning visitor
            // with a remembered folder, re-attach via the stored handle (no OS
            // picker needed); if that fails the gate is the fallback.
            if (lastConnectedFolder) {
              void reconnectWithStoredHandle();
            } else {
              void connect();
            }
          }}
          onCreateAccount={() => {
            entryActionThisLoad = "create";
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
    !isConnected &&
    !isDemoOrWikiCapture() &&
    !signInInFlight
  ) {
    return (
      <QueryClientProvider client={queryClient}>
        <AccountTierChooser
          onLocal={() => {
            // Local: record the solo tier + open the OS picker straight from
            // this click (the tile click is a live user gesture), the same
            // direct connect the start screen's "Open a folder" does. If the
            // user cancels, the FolderConnectGate connect surface is the retry
            // fallback (absent account_type normalizes to solo).
            chosenTierThisLoad = "local";
            try {
              sessionStorage.setItem("researchos:account-tier", "local");
            } catch {
              // sessionStorage unavailable (private mode edge); the in-memory
              // chosenTierThisLoad still carries the choice for this load.
            }
            entryActionThisLoad = "open";
            setEntryAction("open");
            void connect();
          }}
        />
      </QueryClientProvider>
    );
  }

  // Folder-connect gate (onboarding redundancy removal, 2026-06-10). Replaces
  // the retired ResearchFolderSetupNew landing card, whose own "Link Folder"
  // button was a redundant second click. The start screen / tier chooser now
  // call connect() directly from the click, so on the happy path this gate is
  // skipped (connect() flips straight into the loading screen). It renders when
  // no folder is attached: after a cancelled picker (retry + Chrome-blocked
  // recovery modal), on the sign-in-with-provider resume path (the provider
  // button did a router.push, so a folder still needs picking before the OAuth
  // claim), or to initialize an empty folder. Once a folder is connected the
  // flow falls through to UserLoginScreen for account selection.
  if (!isConnected) {
    // Wrapped in QueryClientProvider because BeakerBot / avatars inside may
    // call useUserColor() → useQuery().
    return (
      <QueryClientProvider client={queryClient}>
        <FolderConnectGate
          pendingSignInProvider={pendingSignInProvider}
          accountSaveFraming={accountSaveFraming}
          onBack={() => {
            entryActionThisLoad = null;
            setEntryAction(null);
            // If we got here via an OAuth-first claim return, abandon it on Back
            // by stripping ?sharingClaim, otherwise sharingClaimReturn stays true
            // and this same gate re-renders (a Back loop). Stripping it lets the
            // landing show again.
            if (
              typeof window !== "undefined" &&
              new URLSearchParams(window.location.search).has("sharingClaim")
            ) {
              const url = new URL(window.location.href);
              url.searchParams.delete("sharingClaim");
              window.history.replaceState(
                null,
                "",
                url.pathname + url.search + url.hash,
              );
              window.dispatchEvent(new Event("researchos:locationchange"));
            }
          }}
        />
      </QueryClientProvider>
    );
  }

  // OAuth sharing-claim resume. A visitor who started a "Sign in with
  // <provider>" flow (the `?signIn=` intent) has now connected a folder and
  // selected an account, so fire the provider redirect (rehomed from the
  // retired ResearchFolderSetupNew.handleComplete). Sits above the app render so
  // the full app never flashes before navigation.
  if (signInInFlight && currentUser && pendingSignInProvider) {
    return <ProviderSignInRedirect provider={pendingSignInProvider} />;
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
      {/* Quiet "sync paused" pill when the collab relay reports durable
          persistence is paused (cost breaker / write throttle / doc cap). */}
      <SyncPausedIndicator />
      {/* Auto-refresh the app when the shared data folder changes on disk
          (a collaborator's new note / task / project), so other lab members
          see it without a manual refresh. Local-first equivalent of a server
          push: watches the folder via FileSystemObserver, focus-refetch
          fallback. Mounted here so it covers every signed-in route. */}
      <SharedFolderAutoRefresh />
      {/* Tune the spell-checker to this lab's own vocabulary (inventory,
          methods, note titles), so the checker never flags a term the lab
          always writes. Reuses the warm search-index caches, so no extra
          fetches; inert until the user turns spell-check on. */}
      <SpellcheckAutoSeed />
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
      {/* Role-aware blocking on-connect migration gate: a multi-user folder
          greets the owner with "convert to single-user" and a labmate with
          "take your data to your own folder". Buried-in-Settings was a
          discoverability gap (Grant 2026-06-10). Dismissible per session. */}
      <MigrationGate />
      {/* LabArchives import sticky-intent consumer. If the user clicked
          "Import from LabArchives" on the picker screen and signed in
          (which unmounts that screen), this auto-mounts ImportELNDialog
          on the first paint of the signed-in surface. Single-shot,
          clears its own sessionStorage flag on read. */}
      <PendingELNImportMount />
      <>
        {children}
        {/* CelebrationManager: fires milestone BeakerBot celebrations (streak
            badges etc.) based on the streak sidecar. useOptionalTourController
            returns null when no provider is in the tree, so the manager
            runs normally now that the tour engine is gone. */}
        <CelebrationManager username={currentUser} />
        {/* MilestoneTwirlMount: fires the BeakerBot twirl on rare checkpoint
            moments (first experiment complete, first project done), deduped
            per-user in localStorage. */}
        <MilestoneTwirlMount username={currentUser} />
        {/* IdleAnimationManager: fires a random BeakerBot scene after the user
            has been idle for IDLE_THRESHOLD_MS. One per session. */}
        <IdleAnimationManager />
        {/* WhatsNewManager: developer-announcement popup. Fires only on a
            genuine APP_VERSION upgrade; new accounts silently record the
            version. */}
        <WhatsNewManager username={currentUser} />
        {/* Branded launch-into-app splash, once per day (Grant 2026-06-12: the
            splash IS the pretty loading screen that launches users into the app
            on their first session each day). Rendered as a fixed overlay ON TOP
            of the real workbench (mounted underneath), so its rainbow exit flood
            recedes to reveal the actual workspace, not a second BeakerBot. It
            also covers the initial app data load. Replaced the old per-login
            SuccessTransition. Skipped in fixture modes (returned above anyway). */}
        {!splashSeen && !isDemoOrWikiCapture() && (
          <Splash
            userName={currentUser ?? undefined}
            onComplete={() => {
              try {
                localStorage.setItem(SPLASH_DAY_KEY, localDayStamp());
              } catch {
                // storage unavailable (private mode edge); the splash may replay
                // on the next load, harmless.
              }
              setSplashSeen(true);
            }}
          />
        )}
      </>
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
        {/* Soft one-line demo cue at the top of /demo (dismissible, once per
            tab). Replaces the old loud always-on banner so the demo reads
            like a real lab; suppressed in wiki-capture and recording modes. */}
        <DemoEntryCue />
        {/* Demo-mode floating affordances, grouped as ONE right-aligned column
            anchored ABOVE the bottom-right FAB dock (AppShell mounts the
            calculator / feedback circles at `bottom-6 right-6`) so the pills
            never overlap those buttons. Each pill is position-agnostic now;
            this wrapper owns the placement. `pb-14` lifts the column clear of
            the 48px-tall dock, and the pointer-events pair keeps the empty
            wrapper from eating clicks when no pill is shown. DemoViewAsButton
            renders only inside /demo; Leave also shows pre-login, where there
            is no dock and the column simply floats a touch higher. */}
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2 pb-14 pointer-events-none [&>*]:pointer-events-auto">
          {/* Demo-only: flip the fixture identity between Alex (member) and
              Mira (lab head) so the PI-dashboard welcome clip can be recorded.
              Renders only inside /demo, never in real use or wiki capture. */}
          <DemoViewAsButton />
          <FloatingLeaveDemoButton />
        </div>
        {/* Dev-only floating tools, grouped as ONE bottom-LEFT column so they
            never overlap each other or the right-side demo cluster. These are
            gated on NODE_ENV === "development", so they never reach the deployed
            /demo, which is why they keep their own dev-signal colors (sky /
            purple) instead of the production pill aesthetic. Each tool is
            position-agnostic now; this wrapper owns the placement.
            DevEphemeralSessionButton, a one-click clean-slate OPFS session that
            shows on the pre-login surfaces too; DevRestartServerButton, reruns
            ./start.sh. The pointer-events pair keeps the empty wrapper inert. */}
        <div className="fixed bottom-6 left-6 z-[500] flex flex-col-reverse items-start gap-3 pointer-events-none [&>*]:pointer-events-auto">
          <DevEphemeralSessionButton />
          <DevRestartServerButton />
        </div>
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
            FolderConnectGate needs the confirm dialog to render
            before AppShell is in the tree. (feedback polish R1) */}
        <AutoErrorConfirmHost />
        {/* Wiki-screenshot fixture body-class + edit-session synth.
            No-op outside `?wikiCapture=…` mode. Mounted inside the
            FileSystemProvider so it can read `currentUser` for the
            unlockSession path. */}
        <WikiCaptureBodyClass />
        {/* Recording-mode (`?record=1`) body class. Hides non-product floating
            chrome (Next dev indicator, floating dock, BeakerBot flask) so a
            marketing-video capture surface is pristine. No-op outside record
            mode. */}
        <RecordingModeBodyClass />
        {/* Auto-plays a welcome-video clip (`?demo=<clipId>`) with the demo
            engine's animated cursor. Demo/wiki-capture-gated; no-op otherwise. */}
        <DemoVideoAutoplay />
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
