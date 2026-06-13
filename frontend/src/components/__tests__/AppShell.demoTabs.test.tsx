/**
 * AppShell — Data Hub + Chemistry nav tabs in demo mode.
 *
 * Both modules are pre-launch and flag-gated (CHEMISTRY_ENABLED / DATAHUB_ENABLED,
 * default off). The public demo (and local demo mode) should still showcase them,
 * so the nav filter reveals their tabs when a demo / wiki-capture session is
 * detected, while real production users (flag off, not demo) never see them.
 *
 * Pins:
 *   - flag off + not demo  -> both tabs hidden (prod default, unchanged);
 *   - demo active          -> both tabs visible even with the flags off;
 *   - flag on              -> both tabs visible (dogfooding path, unchanged).
 *
 * The flags are mocked behind getters reading a hoisted holder so each test can
 * flip them, and the demo signal (isDemoOrWikiCapture) is mocked the same way.
 * Every heavy AppShell child is stubbed inert (mirrors AppShell.piHomeTab.test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const holder = vi.hoisted(() => ({
  chemistry: false,
  datahub: false,
  demo: false,
}));

vi.mock("@/lib/chemistry/config", () => ({
  get CHEMISTRY_ENABLED() {
    return holder.chemistry;
  },
}));
vi.mock("@/lib/datahub/config", () => ({
  get DATAHUB_ENABLED() {
    return holder.datahub;
  },
}));
vi.mock("@/lib/file-system/wiki-capture-mock", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/file-system/wiki-capture-mock")
    >();
  return {
    ...actual,
    isDemoOrWikiCapture: () => holder.demo,
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/workbench",
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

// Stable null picks → nav filter resolves to the default visibleTabs, so the
// only thing gating /chemistry + /datahub is the flag-or-demo rule under test.
vi.mock("@/hooks/useFeaturePicks", () => ({
  useFeaturePicks: () => null,
}));

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

// Inert stubs for every heavy AppShell child.
vi.mock("@/components/DailyTasksSidebar", () => ({ default: () => null }));
vi.mock("@/components/CalendarSidebar", () => ({ default: () => null }));
vi.mock("@/components/InboxBadge", () => ({ default: () => null }));
vi.mock("@/components/InboxToast", () => ({ default: () => null }));
vi.mock("@/components/NoteDeleteUndoToast", () => ({ default: () => null }));
vi.mock("@/components/NotificationBadge", () => ({ default: () => null }));
vi.mock("@/components/ReminderRunner", () => ({ default: () => null }));
vi.mock("@/components/IdlePasswordWipe", () => ({ default: () => null }));
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("@/components/FeedbackButton", () => ({ default: () => null }));
vi.mock("@/components/beaker-search/BeakerSearchPill", () => ({
  default: () => null,
}));
vi.mock("@/components/beaker-search/BeakerSearchBottomBar", () => ({ default: () => null }));
vi.mock("@/components/BetaDonationButton", () => ({ default: () => null }));
vi.mock("@/components/DevTestNotificationButton", () => ({
  default: () => null,
}));
vi.mock("@/components/DevDemoToggleButton", () => ({ default: () => null }));
vi.mock("@/components/DevBeakerBotGalleryButton", () => ({
  default: () => null,
}));
vi.mock("@/components/BeakerBot", () => ({ default: () => null }));
vi.mock("@/components/StreakBadge", () => ({ default: () => null }));
vi.mock("@/components/DataSetupScreen", () => ({ default: () => null }));
vi.mock("@/components/UserLoginScreen", () => ({ default: () => null }));
vi.mock("@/components/FeedbackModal", () => ({ default: () => null }));

import AppShell from "@/components/AppShell";

function renderShell() {
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
  // Zone-agnostic: the slim AppNavBar parks lower-priority tabs (e.g.
  // /chemistry) behind a More overflow menu, so open it first to bring its
  // items into the DOM. A tab counts as visible if it is reachable at all.
  const moreBtn = container.querySelector<HTMLButtonElement>(
    'nav button[aria-haspopup="menu"]',
  );
  if (moreBtn) act(() => moreBtn.click());
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

beforeEach(() => {
  holder.chemistry = false;
  holder.datahub = false;
  holder.demo = false;
});

afterEach(() => {
  holder.chemistry = false;
  holder.datahub = false;
  holder.demo = false;
});

describe("AppShell — Data Hub + Chemistry tabs vs demo mode", () => {
  it("hides both tabs when the flags are off and it is not a demo (prod default)", () => {
    const { container } = renderShell();
    const hrefs = navHrefs(container);
    expect(hrefs).not.toContain("/chemistry");
    expect(hrefs).not.toContain("/datahub");
    // A normal tab is still present, so the nav itself rendered.
    expect(hrefs).toContain("/workbench");
  });

  it("shows both tabs in demo mode even with the flags off", () => {
    holder.demo = true;
    const { container } = renderShell();
    const hrefs = navHrefs(container);
    expect(hrefs).toContain("/chemistry");
    expect(hrefs).toContain("/datahub");
  });

  it("shows both tabs when the flags are on (dogfooding path, no demo)", () => {
    holder.chemistry = true;
    holder.datahub = true;
    const { container } = renderShell();
    const hrefs = navHrefs(container);
    expect(hrefs).toContain("/chemistry");
    expect(hrefs).toContain("/datahub");
  });
});
