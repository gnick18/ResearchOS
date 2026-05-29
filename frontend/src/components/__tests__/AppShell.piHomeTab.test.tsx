/**
 * AppShell — unified dashboard top-nav tab.
 *
 * Dashboard unification (dashboard-unification build, 2026-05-29). Home
 * and Lab Overview collapsed into ONE dashboard at "/". Contract:
 *   - There is a SINGLE nav entry for the dashboard ("/"), shown for every
 *     account type. `/lab-overview` is no longer a separate nav entry (it
 *     redirects to "/").
 *   - The entry's LABEL is account-aware: "Lab Overview" for a lab_head
 *     (PI), "Home" for solo + member. Mirrors the "Links" vs "Lab Links"
 *     account-aware label pattern.
 *   - account_type === undefined (settings read in flight): treated as
 *     "not lab_head" so the label resolves to "Home" until the read
 *     settles; the tab itself never disappears.
 *
 * The "Show Home page" toggle and the showHomeForLabHead store field were
 * removed by this build — there is no separate Home tab to hide/restore.
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
// (the dashboard + every NAV_ITEM). This isolates the account-type gate
// from the feature-picks gate.
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

function renderShell(opts: { accountType: AccountType | null | undefined }) {
  currentAccountType = opts.accountType;
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

function dashboardLabel(container: HTMLElement): string | null {
  const el = container.querySelector('nav a[href="/"]');
  return el ? (el.textContent ?? "").trim() : null;
}

afterEach(() => {
  currentAccountType = "member";
});

describe("AppShell — unified dashboard nav entry", () => {
  it("lab_head: single '/' entry labeled 'Lab Overview'; no separate /lab-overview tab", () => {
    const { container } = renderShell({ accountType: "lab_head" });
    const hrefs = navHrefs(container);
    expect(hrefs).toContain("/");
    expect(hrefs).not.toContain("/lab-overview");
    expect(dashboardLabel(container)).toBe("Lab Overview");
    // Other non-PI-suppressed tabs still render.
    expect(hrefs).toContain("/workbench");
  });

  it("member: single '/' entry labeled 'Home'", () => {
    const { container } = renderShell({ accountType: "member" });
    const hrefs = navHrefs(container);
    expect(hrefs).toContain("/");
    expect(hrefs).not.toContain("/lab-overview");
    expect(dashboardLabel(container)).toBe("Home");
  });

  it("accountType undefined (read in flight): '/' shown, label falls back to 'Home'", () => {
    const { container } = renderShell({ accountType: undefined });
    expect(navHrefs(container)).toContain("/");
    expect(dashboardLabel(container)).toBe("Home");
  });
});
