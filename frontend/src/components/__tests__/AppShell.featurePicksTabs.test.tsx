/**
 * AppShell top-nav visibility under feature_picks.
 *
 * Grant's 2026-05-27 report flagged that purchases=no didn't hide the
 * Purchases tab the same way calendar=no (post the top-nav reactivity
 * fix in ae455c6b) now hides the Calendar tab. The hook + helper
 * tests cover the contract in isolation; this file pins the contract
 * at the boundary AppShell actually renders, for EVERY pick the gate
 * consumes (purchases, calendar, links), so a future regression on any
 * one of them is caught by the test harness — not by Grant noticing in
 * the UI.
 *
 * Pattern mirrors AppShell.tourGate.test.tsx (same mocks, same render
 * harness); the only difference is the useFeaturePicks stub returns a
 * populated picks object per test instead of the constant null.
 *
 * setup-q feature-gating audit manager, 2026-05-27.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

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
  useFileSystem: () => ({ currentUser: "alex", isLoading: false }),
}));

// Per-test picks override via the module-level holder. Mock keeps the
// hook reference stable but each test mutates `currentPicks` before
// render to control the gate.
let currentPicks: FeaturePicks | null = null;
vi.mock("@/hooks/useFeaturePicks", () => ({
  useFeaturePicks: () => currentPicks,
}));

vi.mock("@/hooks/useUserColor", () => ({
  useUserColor: () => "#3b82f6",
  useUserColors: () => ({ primary: "#3b82f6", secondary: null }),
}));

// _user_settings.account_type mock; default "member" so the lab-head
// /purchases carve-out doesn't fire (we want to verify the picks gate
// in isolation, not the lab-head removal pass).
vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => "member",
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

vi.mock("@/components/DailyTasksSidebar", () => ({ default: () => null }));
vi.mock("@/components/CalendarSidebar", () => ({ default: () => null }));
vi.mock("@/components/InboxBadge", () => ({ default: () => null }));
vi.mock("@/components/InboxToast", () => ({ default: () => null }));
vi.mock("@/components/NotificationBadge", () => ({ default: () => null }));
vi.mock("@/components/ReminderRunner", () => ({ default: () => null }));
vi.mock("@/components/IdlePasswordWipe", () => ({ default: () => null }));
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("@/components/FeedbackButton", () => ({ default: () => null }));
// BeakerSearch pill calls useBeakerSearch (needs BeakerSearchProvider); not under
// test here, stub it to null like the other app-chrome buttons.
vi.mock("@/components/beaker-search/BeakerSearchPill", () => ({ default: () => null }));
vi.mock("@/components/beaker-search/BeakerSearchBottomBar", () => ({ default: () => null }));
vi.mock("@/components/BetaDonationButton", () => ({ default: () => null }));
vi.mock("@/components/DevTestNotificationButton", () => ({
  default: () => null,
}));
vi.mock("@/components/DevDemoToggleButton", () => ({ default: () => null }));
vi.mock("@/components/DataSetupScreen", () => ({ default: () => null }));
vi.mock("@/components/UserLoginScreen", () => ({ default: () => null }));
vi.mock("@/components/FeedbackModal", () => ({ default: () => null }));

import AppShell from "@/components/AppShell";

function renderShellWithPicks(picks: FeaturePicks | null) {
  currentPicks = picks;
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
  // Collect every nav-item href (anchors when not gated; data-tour-nav-item
  // when buttons). The visibility check is href-set-based.
  const items: string[] = [];
  container.querySelectorAll("nav a[href]").forEach((el) => {
    const href = (el as HTMLAnchorElement).getAttribute("href");
    if (href) items.push(href);
  });
  container.querySelectorAll("nav button[data-tour-nav-item]").forEach((el) => {
    const href = el.getAttribute("data-tour-nav-item");
    if (href) items.push(href);
  });
  return items;
}

describe("AppShell — top-nav visibility under feature_picks", () => {
  it("solo + purchases=no HIDES /purchases (Grant's flagged case)", () => {
    const { container } = renderShellWithPicks({
      account_type: "solo",
      purchases: "no",
      calendar: "yes",
      links: "yes",
    });
    const hrefs = navHrefs(container);
    expect(hrefs).not.toContain("/purchases");
    // Sanity: calendar=yes + links=yes still show.
    expect(hrefs).toContain("/calendar");
    expect(hrefs).toContain("/links");
    // Always-on tabs survive. Post widget-framework teardown (2026-06-02)
    // a "member" account has NO dashboard entry — the "/" tab was dropped
    // (Workbench is the landing), so it is no longer in the nav.
    expect(hrefs).not.toContain("/");
    expect(hrefs).toContain("/workbench");
    expect(hrefs).toContain("/gantt");
    expect(hrefs).toContain("/methods");
    // Search moved off the top nav into the Cmd-K palette (nav audit 2026-06-07).
    expect(hrefs).not.toContain("/search");
  });

  it("solo + purchases=maybe HIDES /purchases (the 'maybe later' path)", () => {
    const { container } = renderShellWithPicks({
      account_type: "solo",
      purchases: "maybe",
    });
    expect(navHrefs(container)).not.toContain("/purchases");
  });

  it("solo + purchases=yes SHOWS /purchases", () => {
    const { container } = renderShellWithPicks({
      account_type: "solo",
      purchases: "yes",
    });
    expect(navHrefs(container)).toContain("/purchases");
  });

  it("solo + calendar=no HIDES /calendar (regression coverage for ae455c6b)", () => {
    const { container } = renderShellWithPicks({
      account_type: "solo",
      calendar: "no",
    });
    expect(navHrefs(container)).not.toContain("/calendar");
  });

  it("solo + links=no HIDES /links", () => {
    const { container } = renderShellWithPicks({
      account_type: "solo",
      links: "no",
    });
    expect(navHrefs(container)).not.toContain("/links");
  });

  it("solo + all opt-outs HIDES /purchases, /calendar, /links together", () => {
    const { container } = renderShellWithPicks({
      account_type: "solo",
      purchases: "no",
      calendar: "no",
      links: "no",
    });
    const hrefs = navHrefs(container);
    expect(hrefs).not.toContain("/purchases");
    expect(hrefs).not.toContain("/calendar");
    expect(hrefs).not.toContain("/links");
  });

  it("lab + purchases=no HIDES /purchases for lab MEMBERS (not just solo)", () => {
    // Lab members (account_type === "lab", lab_head !== true) hit the
    // same gate as solo for the picks-derived hides. The lab_head
    // /purchases carve-out only fires for PIs, not members.
    const { container } = renderShellWithPicks({
      account_type: "lab",
      lab_head: false,
      purchases: "no",
    });
    expect(navHrefs(container)).not.toContain("/purchases");
  });

  it("picks === null falls through to default visibleTabs (existing-user invariant L1/L22)", () => {
    const { container } = renderShellWithPicks(null);
    const hrefs = navHrefs(container);
    // Default visibleTabs include everything; nothing is filtered.
    expect(hrefs).toContain("/purchases");
    expect(hrefs).toContain("/calendar");
    expect(hrefs).toContain("/links");
  });
});
