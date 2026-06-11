/**
 * AppShell — BeakerBot app-wide dock mount (ai docking bot, 2026-06-11).
 *
 * BeakerBot must be mounted ONCE at the AppShell level so its conversation state
 * (in useAiChat, inside BeakerBotPanel) survives client-side route changes. That
 * persistence is what lets guide_to_element navigate the user to another page
 * without tearing down the chat. AppShell does not unmount on navigation, so a
 * dock mounted here is the right home.
 *
 * Pins:
 *   - flag off  -> the dock is NOT mounted (prod default, unchanged);
 *   - flag on   -> the dock IS mounted, at the shell level (alongside the other
 *                  global popups), so it persists across route changes;
 *   - /sequences -> the dock is suppressed even with the flag on, matching the
 *                  Calculators / Report-bug FAB convention on that dense surface.
 *
 * The AI flag is mocked behind a getter reading a hoisted holder so each test can
 * flip it. Every heavy AppShell child is stubbed inert (mirrors
 * AppShell.demoTabs.test). The real BeakerBotDock is rendered so we assert the
 * actual mount, but its panel children are mocked next/navigation-safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const holder = vi.hoisted(() => ({
  ai: false,
  pathname: "/workbench",
}));

vi.mock("@/lib/ai/config", () => ({
  get AI_ASSISTANT_ENABLED() {
    return holder.ai;
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => holder.pathname,
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

// Note, local-api is intentionally NOT mocked here. The real module is pulled in
// transitively by the tour step-registry, and the dock's panel only constructs
// useAiChat at render (it never sends, so no read tool runs). Mocking local-api
// narrowly broke that transitive import, so we leave it real (mirrors
// AppShell.demoTabs.test, which also does not mock local-api).

// Inert stubs for every heavy AppShell child (mirrors AppShell.demoTabs.test).
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

beforeEach(() => {
  holder.ai = false;
  holder.pathname = "/workbench";
});

afterEach(() => {
  holder.ai = false;
  holder.pathname = "/workbench";
});

describe("AppShell — BeakerBot app-wide dock", () => {
  it("does not mount the dock when the AI flag is off (prod default)", () => {
    const { queryByTestId } = renderShell();
    expect(queryByTestId("beakerbot-dock")).toBeNull();
    expect(queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("mounts the dock at the shell level when the AI flag is on", () => {
    holder.ai = true;
    const { getByTestId } = renderShell();
    // The dock (and its persistent panel) is present in the shell, so its
    // conversation survives route changes.
    expect(getByTestId("beakerbot-dock")).toBeInTheDocument();
    expect(getByTestId("beakerbot-panel")).toBeInTheDocument();
    // The summon button is the toggle.
    expect(getByTestId("beakerbot-summon")).toBeInTheDocument();
  });

  it("suppresses the dock on /sequences even with the flag on", () => {
    holder.ai = true;
    holder.pathname = "/sequences";
    const { queryByTestId } = renderShell();
    expect(queryByTestId("beakerbot-dock")).toBeNull();
  });
});
