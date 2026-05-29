/**
 * AppShell — Home top-nav tab visibility for lab_head (PI) accounts.
 *
 * PI Home migration (pi-home-migration, 2026-05-29). Contract:
 *   - account_type === "lab_head" + showHomeForLabHead === false (the
 *     default post-migration): the Home tab ("/") is HIDDEN from the
 *     top nav. Lab Overview takes the leftmost slot.
 *   - account_type === "lab_head" + showHomeForLabHead === true (PI opted
 *     back in via Settings): the Home tab is SHOWN again.
 *   - account_type === "member": the Home tab is ALWAYS shown, regardless
 *     of showHomeForLabHead — members are unaffected.
 *   - account_type === undefined (settings read in flight): treated as
 *     "not lab_head" so Home stays shown and never flickers OUT for a
 *     member on first paint.
 *
 * The Home ROUTE is never removed — this suite only asserts the nav-tab
 * VISIBILITY, which is the only thing the migration changes. Direct
 * navigation to "/" (incl. the v4 tour's router pushes) is covered by
 * the route staying live, not by a tab.
 *
 * Harness mirrors AppShell.featurePicksTabs.test.tsx; the differences are
 * (a) a per-test `useAccountType` holder and (b) driving the real Zustand
 * store's `showHomeForLabHead` before each render.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountType } from "@/lib/settings/user-settings";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

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

vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ currentUser: "mira", isLoading: false }),
}));

// Stable null picks → nav filter resolves to the default visibleTabs
// (Home + every NAV_ITEM). This isolates the account-type gate from the
// feature-picks gate.
vi.mock("@/hooks/useFeaturePicks", () => ({
  useFeaturePicks: () => null,
}));

vi.mock("@/hooks/useUserColor", () => ({
  useUserColor: () => "#3b82f6",
  useUserColors: () => ({ primary: "#3b82f6", secondary: null }),
}));

// Per-test account-type override via a module-level holder. Each test
// sets `currentAccountType` before render to drive the gate.
let currentAccountType: AccountType | null | undefined = "member";
vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => currentAccountType,
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

// Inert stubs for every heavy AppShell child. The lab_head branch renders
// CustomizableSidebar in place of DailyTasksSidebar, so it gets stubbed
// too; the edit-session banner + chip subscribe to a module-scoped
// session and are likewise stubbed.
vi.mock("@/components/DailyTasksSidebar", () => ({ default: () => null }));
vi.mock("@/components/CalendarSidebar", () => ({ default: () => null }));
vi.mock("@/components/lab-overview/CustomizableSidebar", () => ({
  default: () => null,
}));
vi.mock("@/components/TelegramStatusBadge", () => ({ default: () => null }));
vi.mock("@/components/InboxBadge", () => ({ default: () => null }));
vi.mock("@/components/InboxToast", () => ({ default: () => null }));
vi.mock("@/components/NoteDeleteUndoToast", () => ({ default: () => null }));
vi.mock("@/components/NotificationBadge", () => ({ default: () => null }));
vi.mock("@/components/ReminderRunner", () => ({ default: () => null }));
vi.mock("@/components/TelegramRecoveryPrompt", () => ({ default: () => null }));
vi.mock("@/components/TelegramEncryptedRecoveryPrompt", () => ({
  default: () => null,
}));
vi.mock("@/components/IdlePasswordWipe", () => ({ default: () => null }));
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("@/components/FeedbackButton", () => ({ default: () => null }));
vi.mock("@/components/BetaDonationButton", () => ({ default: () => null }));
vi.mock("@/components/DevTestNotificationButton", () => ({
  default: () => null,
}));
vi.mock("@/components/DevDemoToggleButton", () => ({ default: () => null }));
vi.mock("@/components/DevBeakerBotGalleryButton", () => ({
  default: () => null,
}));
vi.mock("@/components/DevForceWalkthroughButton", () => ({
  default: () => null,
}));
vi.mock("@/components/BeakerBot", () => ({ default: () => null }));
vi.mock("@/components/StreakBadge", () => ({ default: () => null }));
vi.mock("@/components/EditSessionBanner", () => ({ default: () => null }));
vi.mock("@/components/EditSessionTopNavChip", () => ({ default: () => null }));
vi.mock("@/components/DataSetupScreen", () => ({ default: () => null }));
vi.mock("@/components/UserLoginScreen", () => ({ default: () => null }));
vi.mock("@/components/FeedbackModal", () => ({ default: () => null }));

import AppShell from "@/components/AppShell";
import { useAppStore } from "@/lib/store";

function renderShell(opts: {
  accountType: AccountType | null | undefined;
  showHomeForLabHead: boolean;
}) {
  currentAccountType = opts.accountType;
  // Drive the real store the same way FileSystemProvider.hydrateSettings
  // would after reading settings.json on login.
  useAppStore.getState().setShowHomeForLabHead(opts.showHomeForLabHead);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppShell>
        <div data-testid="content">content</div>
      </AppShell>
    </QueryClientProvider>,
  );
}

function navHrefs(container: HTMLElement): string[] {
  const items: string[] = [];
  container.querySelectorAll("nav a[href]").forEach((el) => {
    const href = (el as HTMLAnchorElement).getAttribute("href");
    if (href) items.push(href);
  });
  container
    .querySelectorAll("nav button[data-tour-nav-item]")
    .forEach((el) => {
      const href = el.getAttribute("data-tour-nav-item");
      if (href) items.push(href);
    });
  return items;
}

afterEach(() => {
  // Reset the store flag so a leaked value doesn't bleed into the next
  // test (the store module is shared across the suite).
  useAppStore.getState().setShowHomeForLabHead(false);
  currentAccountType = "member";
});

describe("AppShell — Home tab visibility for lab_head (PI Home migration)", () => {
  it("lab_head + showHomeForLabHead=false HIDES the Home tab (the default)", () => {
    const { container } = renderShell({
      accountType: "lab_head",
      showHomeForLabHead: false,
    });
    const hrefs = navHrefs(container);
    expect(hrefs).not.toContain("/");
    // Lab Overview is shown (and takes the leftmost slot) for the PI.
    expect(hrefs).toContain("/lab-overview");
    // Other non-PI-suppressed tabs still render.
    expect(hrefs).toContain("/workbench");
  });

  it("lab_head + showHomeForLabHead=true SHOWS the Home tab (PI opted back in)", () => {
    const { container } = renderShell({
      accountType: "lab_head",
      showHomeForLabHead: true,
    });
    const hrefs = navHrefs(container);
    expect(hrefs).toContain("/");
    // Lab Overview is still present alongside Home.
    expect(hrefs).toContain("/lab-overview");
  });

  it("member ALWAYS shows the Home tab — showHomeForLabHead=false has no effect", () => {
    const { container } = renderShell({
      accountType: "member",
      showHomeForLabHead: false,
    });
    expect(navHrefs(container)).toContain("/");
  });

  it("member shows the Home tab even when showHomeForLabHead=true", () => {
    const { container } = renderShell({
      accountType: "member",
      showHomeForLabHead: true,
    });
    expect(navHrefs(container)).toContain("/");
  });

  it("accountType undefined (read in flight) keeps the Home tab shown — never flickers OUT for a member", () => {
    const { container } = renderShell({
      accountType: undefined,
      showHomeForLabHead: false,
    });
    expect(navHrefs(container)).toContain("/");
  });
});
