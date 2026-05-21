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

// useUserColor → useQuery; stub to a stable color so headerGradient
// doesn't throw.
vi.mock("@/hooks/useUserColor", () => ({
  useUserColor: () => "#3b82f6",
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
vi.mock("@/components/TelegramStatusBadge", () => ({ default: () => null }));
vi.mock("@/components/InboxBadge", () => ({ default: () => null }));
vi.mock("@/components/InboxToast", () => ({ default: () => null }));
vi.mock("@/components/NotificationBadge", () => ({ default: () => null }));
vi.mock("@/components/ReminderRunner", () => ({ default: () => null }));
vi.mock("@/components/DemoLabBanner", () => ({ default: () => null }));
vi.mock("@/components/TelegramRecoveryPrompt", () => ({ default: () => null }));
vi.mock("@/components/TelegramEncryptedRecoveryPrompt", () => ({ default: () => null }));
vi.mock("@/components/IdlePasswordWipe", () => ({ default: () => null }));
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("@/components/FeedbackButton", () => ({ default: () => null }));
vi.mock("@/components/BetaDonationButton", () => ({ default: () => null }));
vi.mock("@/components/DevTestNotificationButton", () => ({ default: () => null }));
vi.mock("@/components/DevForceTipButton", () => ({ default: () => null }));
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
    // Test renders at "/" so exactly one Home button reads aria-current.
    expect(activeCount).toBe(1);
    expect(inactiveCount).toBeGreaterThan(0);
    // No <Link>-rendered anchors in the nav while gated.
    expect(homeNav!.querySelectorAll("a").length).toBe(0);
  });

  it("renders nav-items as anchors during lab tour mode (gate not triggered)", () => {
    const { container } = renderShell({
      withProvider: true,
      initialStep: "lab-prompt",
    });
    const homeNav = container.querySelector("nav");
    // Lab steps mode-tag as "lab", not "in-product-walkthrough" — so
    // the gate does NOT apply.
    expect(homeNav!.getAttribute("data-tour-nav-disabled")).toBeNull();
    expect(homeNav!.querySelectorAll("a").length).toBeGreaterThan(0);
  });

  it("renders nav-items as anchors during cleanup mode (gate not triggered)", () => {
    const { container } = renderShell({
      withProvider: true,
      initialStep: "phase4-cleanup",
    });
    const homeNav = container.querySelector("nav");
    expect(homeNav!.getAttribute("data-tour-nav-disabled")).toBeNull();
    expect(homeNav!.querySelectorAll("a").length).toBeGreaterThan(0);
  });

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
});
