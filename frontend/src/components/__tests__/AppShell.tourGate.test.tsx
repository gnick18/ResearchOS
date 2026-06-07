/**
 * AppShell top-nav gate under Onboarding v4 tour modes (L23).
 *
 * Behavior contract:
 *  - Without the `<TourControllerProvider>` mounted (the P1 production
 *    state), AppShell renders top-nav as <Link> elements — exactly as
 *    pre-v4.
 *  - With the provider mounted but `tourMode === null`, same as above.
 *  - With `tourMode === "in-product-walkthrough"`, every NAV_ITEMS entry
 *    renders as a `<button disabled>` with opacity-50 + cursor-not-allowed.
 *  - With `tourMode === "modal-setup"` or `"lab"` or `"cleanup"`, the nav
 *    is NOT gated — only the in-product walkthrough mode gates it per
 *    the brief's "user in 'in-product-walkthrough' mode specifically"
 *    language.
 *  - With `paused === true`, the gate is lifted (paused tours hide
 *    BeakerBot's overlay so the user can take a breath; locking nav
 *    while paused would be hostile).
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TourControllerProvider } from "@/components/onboarding/v4/TourController";
import type { TourStepId } from "@/components/onboarding/v4/step-types";

// next/navigation hooks live outside React-DOM's reach in jsdom; mock
// usePathname + useSearchParams as constant returns so AppShell mounts.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// FixtureLink wraps next/link; render as a plain anchor for the test.
vi.mock("@/components/FixtureLink", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.HTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// FileSystemProvider context isn't relevant to the nav gate — stub it.
vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ currentUser: "alex", isLoading: false }),
}));

// useFeaturePicks reads from the file system; stub a stable null so the
// nav filter resolves to the default visibleTabs.
vi.mock("@/hooks/useFeaturePicks", () => ({
  useFeaturePicks: () => null,
}));

// useUserColor + useUserColors → useQuery; stub stable values so
// headerGradient doesn't throw. AppShell calls `useUserColors` (plural)
// to read both primary and optional secondary; older modules may still
// pull `useUserColor` (singular) too.
vi.mock("@/hooks/useUserColor", () => ({
  useUserColor: () => "#3b82f6",
  useUserColors: () => ({ primary: "#3b82f6", secondary: null }),
}));

vi.mock("@/hooks/useErrorReporting", () => ({
  useErrorReporting: () => ({
    showBugReport: false,
    showErrorToast: false,
    currentError: null,
    openBugReport: () => {},
    closeBugReport: () => {},
    reportCurrentError: () => {},
    dismissErrorToast: () => {},
  }),
}));

// Heavy children that AppShell renders unconditionally — stub as inert.
vi.mock("@/components/DailyTasksSidebar", () => ({ default: () => null }));
vi.mock("@/components/CalendarSidebar", () => ({ default: () => null }));
vi.mock("@/components/telegram/TelegramHeaderButton", () => ({ default: () => null }));
vi.mock("@/components/InboxBadge", () => ({ default: () => null }));
vi.mock("@/components/InboxToast", () => ({ default: () => null }));
vi.mock("@/components/NotificationBadge", () => ({ default: () => null }));
vi.mock("@/components/ReminderRunner", () => ({ default: () => null }));
vi.mock("@/components/telegram/TelegramPopup", () => ({ default: () => null }));
vi.mock("@/components/TelegramEncryptedRecoveryPrompt", () => ({ default: () => null }));
vi.mock("@/components/IdlePasswordWipe", () => ({ default: () => null }));
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("@/components/FeedbackButton", () => ({ default: () => null }));
vi.mock("@/components/BetaDonationButton", () => ({ default: () => null }));
vi.mock("@/components/DevTestNotificationButton", () => ({ default: () => null }));
vi.mock("@/components/DevDemoToggleButton", () => ({ default: () => null }));
vi.mock("@/components/DataSetupScreen", () => ({ default: () => null }));
vi.mock("@/components/UserLoginScreen", () => ({ default: () => null }));
vi.mock("@/components/FeedbackModal", () => ({ default: () => null }));

// AppShell is imported AFTER the mocks so its module graph resolves
// through the stubs. Vitest hoists vi.mock to the top automatically;
// the explicit late import here is just for readability.
import AppShell from "@/components/AppShell";

function renderShell(opts: {
  withProvider?: boolean;
  initialStep?: TourStepId | null;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const inner = (
    <AppShell>
      <div data-testid="content">content</div>
    </AppShell>
  );
  const node = opts.withProvider ? (
    <TourControllerProvider initialStep={opts.initialStep ?? null}>
      {inner}
    </TourControllerProvider>
  ) : (
    inner
  );
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("AppShell — top-nav gate", () => {
  it("renders nav-items as anchors when no TourControllerProvider is mounted", () => {
    const { container } = renderShell({ withProvider: false });
    const homeNav = container.querySelector("nav");
    expect(homeNav).toBeTruthy();
    // Anchors (FixtureLink → <a>) when no tour is active.
    const anchors = homeNav!.querySelectorAll("a");
    expect(anchors.length).toBeGreaterThan(0);
    // No disabled buttons in the nav.
    expect(homeNav!.querySelectorAll("button[disabled]").length).toBe(0);
    // No data-tour-nav-disabled marker.
    expect(homeNav!.getAttribute("data-tour-nav-disabled")).toBeNull();
  });

  it("renders nav-items as anchors when provider mounted but no tour active", () => {
    const { container } = renderShell({ withProvider: true });
    const homeNav = container.querySelector("nav");
    expect(homeNav!.querySelectorAll("a").length).toBeGreaterThan(0);
    expect(homeNav!.querySelectorAll("button[disabled]").length).toBe(0);
  });

  it("renders nav-items as anchors during modal-setup mode (gate not triggered)", () => {
    const { container } = renderShell({
      withProvider: true,
      initialStep: "setup-q1",
    });
    const homeNav = container.querySelector("nav");
    // Setup mode does NOT gate the nav per L23 — only in-product
    // walkthrough mode does.
    expect(homeNav!.querySelectorAll("a").length).toBeGreaterThan(0);
    expect(homeNav!.querySelectorAll("button[disabled]").length).toBe(0);
  });

  it("disables nav-items during in-product-walkthrough mode", () => {
    const { container } = renderShell({
      withProvider: true,
      initialStep: "home-create-project",
    });
    const homeNav = container.querySelector("nav");
    expect(homeNav!.getAttribute("data-tour-nav-disabled")).toBe("true");
    // Every nav-item now renders as a <button disabled>.
    const buttons = homeNav!.querySelectorAll("button[disabled]");
    expect(buttons.length).toBeGreaterThan(0);
    // Each disabled button is non-clickable; INACTIVE tabs are also
    // opacity-50, the ACTIVE tab keeps full opacity so the user can
    // still see which page they're on (Grant 2026-05-21 follow-up).
    let activeCount = 0;
    let inactiveCount = 0;
    buttons.forEach((b) => {
      expect(b.className).toMatch(/cursor-not-allowed/);
      if (b.getAttribute("aria-current") === "page") {
        activeCount += 1;
        expect(b.className).not.toMatch(/opacity-50/);
      } else {
        inactiveCount += 1;
        expect(b.className).toMatch(/opacity-50/);
      }
    });
    // Post widget-framework teardown (2026-06-02): "/" is a pure redirect
    // and a non-PI account (this test does not mock useAccountType, so it
    // resolves to the non-PI path) has NO dashboard nav entry. The test
    // renders at "/", which now matches no nav-item href, so no button
    // reads aria-current and every gated nav-item is inactive (opacity-50).
    expect(activeCount).toBe(0);
    expect(inactiveCount).toBeGreaterThan(0);
    // No <Link>-rendered anchors in the nav while gated.
    expect(homeNav!.querySelectorAll("a").length).toBe(0);
  });

  it("renders nav-items as anchors during lab tour mode (gate not triggered)", () => {
    // Gantt manager 2026-05-22: lab-prompt retired. lab-cleanup is the
    // only surviving lab-phase step (modeForStep maps it to "lab").
    const { container } = renderShell({
      withProvider: true,
      initialStep: "lab-cleanup",
    });
    const homeNav = container.querySelector("nav");
    // Lab steps mode-tag as "lab", not "in-product-walkthrough" — so
    // the gate does NOT apply.
    expect(homeNav!.getAttribute("data-tour-nav-disabled")).toBeNull();
    expect(homeNav!.querySelectorAll("a").length).toBeGreaterThan(0);
  });

  // R2 chip E bonus cleanup (2026-05-22): retired the "cleanup mode"
  // case. The `cleanup` tour mode and `phase4-cleanup` step were
  // retired by commits 5a12d0ba (Phase 4 cleanup grid → tour-goodbye)
  // and 94885cd5. The lab-mode + modal-setup cases above still cover
  // the "non-walkthrough modes don't gate" half of the L23 invariant.

  it("disabled nav-item button does not navigate on click", () => {
    const { container } = renderShell({
      withProvider: true,
      initialStep: "home-create-project",
    });
    const homeNav = container.querySelector("nav");
    const firstDisabledBtn = homeNav!.querySelector(
      "button[disabled]",
    ) as HTMLButtonElement;
    expect(firstDisabledBtn).toBeTruthy();
    // Clicking is a no-op (the button is disabled at the DOM level).
    const before = window.location.pathname;
    firstDisabledBtn.click();
    expect(window.location.pathname).toBe(before);
  });

  // Break-bot B P1-2 (Wave 1 gear icon gating): the account/settings entry
  // point sits outside <nav>, so it was missed by the original L23 gate. A
  // mid-walkthrough click did a soft-nav, the spotlight went dark, and the
  // tour parked. The profile-page-split (2026-06-06) replaced the standalone
  // settings gear with UserAvatarMenu — the avatar button is now the account
  // entry point and carries the same gate (it renders a disabled,
  // non-interactive button when `navDisabledByTour` is true, opening
  // Settings/profile via an in-app popup rather than a /settings nav). The
  // Help/`?` icon next to it stays a Link because the wiki-pointer cluster
  // step 3 needs the user to click it.
  //
  // The file-system mock above resolves currentUser to "alex", so the
  // interactive avatar carries aria-label "alex — account menu" and the gated
  // form carries "Account (disabled during walkthrough)".
  describe("Account avatar (UserAvatarMenu) gate", () => {
    it("renders the avatar as an interactive button when no tour is active", () => {
      const { container } = renderShell({ withProvider: false });
      const avatarBtn = container.querySelector(
        `button[aria-label="alex — account menu"]`,
      ) as HTMLButtonElement | null;
      expect(avatarBtn).toBeTruthy();
      expect(avatarBtn!.disabled).toBe(false);
      // No disabled (tour-gated) avatar button.
      expect(
        container.querySelector(
          `button[aria-label="Account (disabled during walkthrough)"]`,
        ),
      ).toBeNull();
      // Settings now opens via an in-app popup, not a /settings nav, so the
      // old gear Link no longer exists in either state.
      expect(container.querySelector(`a[href="/settings"]`)).toBeNull();
    });

    it("renders the avatar as a disabled button during in-product walkthrough", () => {
      const { container } = renderShell({
        withProvider: true,
        initialStep: "home-create-project",
      });
      const avatarBtn = container.querySelector(
        `button[aria-label="Account (disabled during walkthrough)"]`,
      ) as HTMLButtonElement | null;
      expect(avatarBtn).toBeTruthy();
      expect(avatarBtn!.disabled).toBe(true);
      expect(avatarBtn!.getAttribute("aria-disabled")).toBe("true");
      expect(avatarBtn!.className).toMatch(/cursor-not-allowed/);
      expect(avatarBtn!.className).toMatch(/opacity-50/);
      // The interactive menu button must NOT also be in the DOM.
      expect(
        container.querySelector(`button[aria-label="alex — account menu"]`),
      ).toBeNull();
    });

    it("Help / `?` icon stays a Link during walkthrough (intentionally not gated)", () => {
      const { container } = renderShell({
        withProvider: true,
        initialStep: "home-create-project",
      });
      // The wiki entry-point href starts with /wiki; it should remain
      // a clickable anchor so the wiki-pointer cluster step 3 works.
      const helpAnchors = Array.from(container.querySelectorAll("a")).filter(
        (a) => a.getAttribute("aria-label") === "Open the ResearchOS wiki",
      );
      expect(helpAnchors.length).toBe(1);
    });
  });
});
