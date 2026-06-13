/**
 * AppShell — BeakerBot dock is NOT mounted here (ai persist bot, 2026-06-11).
 *
 * The dock moved OUT of AppShell and INTO the root layout (app/layout.tsx),
 * because AppShell is re-rendered fresh by each of the 22 pages, so a dock mounted
 * here reset the conversation and the pending Allow/Skip prompt on a navigate-
 * then-click. These tests pin that AppShell no longer renders the dock under any
 * flag value, so the persistent mount can only be the root-layout one (covered by
 * BeakerBotDock.test).
 *
 * The AI flag is mocked behind a getter reading a hoisted holder so each test can
 * flip it. Every heavy AppShell child is stubbed inert (mirrors
 * AppShell.demoTabs.test).
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

beforeEach(() => {
  holder.ai = false;
  holder.pathname = "/workbench";
});

afterEach(() => {
  holder.ai = false;
  holder.pathname = "/workbench";
});

describe("AppShell — BeakerBot dock is not mounted here", () => {
  it("does not mount the dock when the AI flag is off", () => {
    const { queryByTestId } = renderShell();
    expect(queryByTestId("beakerbot-dock")).toBeNull();
    expect(queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("does not mount the dock even when the AI flag is on (moved to root layout)", () => {
    holder.ai = true;
    const { queryByTestId } = renderShell();
    // The dock now lives in the persistent root layout, not in AppShell, so the
    // shell must not render it (otherwise it would mount twice).
    expect(queryByTestId("beakerbot-dock")).toBeNull();
    expect(queryByTestId("beakerbot-panel")).toBeNull();
    expect(queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("does not mount the dock on /sequences either", () => {
    holder.ai = true;
    holder.pathname = "/sequences";
    const { queryByTestId } = renderShell();
    expect(queryByTestId("beakerbot-dock")).toBeNull();
  });
});
