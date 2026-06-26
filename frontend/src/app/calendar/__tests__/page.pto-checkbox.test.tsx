// Page-level integration test for the Phase S5 "Mark as PTO day"
// checkbox in the Calendar event create modal. Covers two
// STREAK_AND_MILESTONES_PROPOSAL.md §6.5 deliverables:
//
//   - The checkbox renders in the event create form with the brief's
//     exact label + subtext.
//   - Submitting the create form with the box checked passes
//     `is_pto: true` through to eventsApi.create and triggers the
//     syncEventPtoChange helper for the active user.
//
// Heavy child surfaces (AppShell, DayDetailDrawer, calendar feeds
// button, the calendar grid views) are mocked as inert no-ops since
// they're out of scope; the test focuses on the modal contract.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Event } from "@/lib/types";

const {
  eventsApi,
  syncEventPtoChangeMock,
  expandDateRangeMock,
} = vi.hoisted(() => ({
  eventsApi: {
    list: vi.fn(async () => [] as Event[]),
    get: vi.fn(),
    create: vi.fn(async (data: Partial<Event>) => ({
      id: 42,
      title: "",
      event_type: "other",
      start_date: "",
      end_date: null,
      start_time: null,
      end_time: null,
      location: null,
      url: null,
      notes: null,
      color: null,
      ...data,
    })),
    update: vi.fn(),
    delete: vi.fn(),
  },
  syncEventPtoChangeMock: vi.fn(
    async (
      _username: string,
      _prev: { isPto: boolean; dates: readonly string[] } | null,
      _next: { isPto: boolean; dates: readonly string[] } | null,
    ) => {},
  ),
  expandDateRangeMock: vi.fn((start: string, end: string | null | undefined) => {
    if (!end || end === start) return [start];
    return [start, end];
  }),
}));

// The calendar page reads useRouter + useSearchParams; without a mock the real
// hooks throw "expected app router to be mounted" under jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/calendar",
}));

// The page registers a BeakerSearch source (fetches tasks, reads the search
// provider context). Not under test here, so stub it to a no-op like the
// purchases page test stubs usePurchasesBeakerSource.
vi.mock("../useCalendarBeakerSource", () => ({
  useCalendarBeakerSource: () => {},
}));

vi.mock("@/lib/local-api", () => ({
  eventsApi,
}));

vi.mock("@/lib/streak/calendar-pto-sync", () => ({
  syncEventPtoChange: syncEventPtoChangeMock,
  expandDateRange: expandDateRangeMock,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    currentUser: "alex",
    setCurrentUser: vi.fn(),
    mainUser: "alex",
    availableUsers: ["alex"],
    createUser: vi.fn(),
    isLoggedIn: true,
  }),
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: {
    calendarViewMode: "month" | "week" | "day";
    setCalendarViewMode: (v: string) => void;
  }) => unknown) =>
    selector({
      calendarViewMode: "month",
      setCalendarViewMode: vi.fn(),
    }),
}));

vi.mock("@/lib/calendar/use-external-events", () => ({
  useCalendarFeeds: () => ({ data: [] }),
  useExternalEvents: () => ({
    events: [],
    errorsByFeedId: new Map(),
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/calendar/calendar-nav-store", () => ({
  useCalendarNavStore: Object.assign(
    () => ({ pendingJump: null, clearJump: vi.fn() }),
    {
      getState: () => ({ pendingJump: null, clearJump: vi.fn() }),
      subscribe: () => () => {},
    },
  ),
}));

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/CalendarFeedsButton", () => ({
  default: () => null,
}));

vi.mock("@/components/DayDetailDrawer", () => ({
  default: () => null,
}));

vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Render the heavy grid views as inert; this test scope is the modal
// only, not the calendar grid (MonthView has its own PTO-indicator
// test next door).
vi.mock("@/components/calendar/MonthView", () => ({
  default: () => <div data-testid="month-view-stub" />,
}));
vi.mock("@/components/calendar/WeekView", () => ({
  default: () => null,
}));
vi.mock("@/components/calendar/DayView", () => ({
  default: () => null,
}));

import CalendarPage from "../page";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CalendarPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  eventsApi.create.mockClear();
  eventsApi.update.mockClear();
  eventsApi.delete.mockClear();
  syncEventPtoChangeMock.mockClear();
  expandDateRangeMock.mockClear();
});

describe("Calendar page, Mark as PTO day checkbox", () => {
  it("keeps PTO behind its own explicit time-off action, not a plain field", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ New Event/ }));

    // Safety re-surface: the PTO checkbox is NOT sitting inline in the plain
    // event form. It lives behind a distinct, clearly-labeled "time off"
    // action that's collapsed by default, so an ordinary event can't trip it
    // by accident.
    const timeOffToggle = await screen.findByRole("button", {
      name: /Mark this as time off/i,
    });
    expect(timeOffToggle).toBeInTheDocument();
    expect(screen.queryByLabelText(/Count this as a PTO day/)).toBeNull();

    // Expanding the section reveals the checkbox plus the explicit warning
    // that flipping it affects streaks + schedules.
    fireEvent.click(timeOffToggle);
    const checkbox = screen.getByLabelText(/Count this as a PTO day/);
    expect(checkbox).toHaveAttribute("type", "checkbox");
    expect(checkbox).not.toBeChecked();
    expect(
      screen.getByText(/Affects your streaks and project schedules/i),
    ).toBeInTheDocument();
  });

  it("submitting with the box checked passes is_pto=true to eventsApi.create and syncs pto_dates", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ New Event/ }));

    // Fill required title field.
    const titleInput = await screen.findByPlaceholderText(
      /e\.g\. ACS National Meeting/,
    );
    fireEvent.change(titleInput, { target: { value: "Lab spring break" } });

    // Set start date to a known value.
    const startDateInputs = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    fireEvent.change(startDateInputs[0], { target: { value: "2026-06-15" } });

    // Open the time-off section, then check the PTO box.
    fireEvent.click(
      screen.getByRole("button", { name: /Mark this as time off/i }),
    );
    const checkbox = screen.getByLabelText(/Count this as a PTO day/);
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Submit.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create Event/ }));
    });

    await waitFor(() => {
      expect(eventsApi.create).toHaveBeenCalledTimes(1);
    });

    const createArg = eventsApi.create.mock.calls[0][0] as Partial<Event>;
    expect(createArg.is_pto).toBe(true);
    expect(createArg.start_date).toBe("2026-06-15");

    // syncEventPtoChange was called for the active user with the
    // expanded date list. prev=null (it's a create), next={isPto:true, dates}.
    await waitFor(() => {
      expect(syncEventPtoChangeMock).toHaveBeenCalledTimes(1);
    });
    const syncCall = syncEventPtoChangeMock.mock.calls[0];
    expect(syncCall[0]).toBe("alex");
    expect(syncCall[1]).toBeNull();
    expect(syncCall[2]).toEqual({
      isPto: true,
      dates: ["2026-06-15"],
    });
  });

  it("submitting with the box UNchecked does not call syncEventPtoChange", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ New Event/ }));

    const titleInput = await screen.findByPlaceholderText(
      /e\.g\. ACS National Meeting/,
    );
    fireEvent.change(titleInput, { target: { value: "Regular meeting" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create Event/ }));
    });

    await waitFor(() => {
      expect(eventsApi.create).toHaveBeenCalledTimes(1);
    });

    const createArg = eventsApi.create.mock.calls[0][0] as Partial<Event>;
    expect(createArg.is_pto).toBe(false);

    // No PTO sync fired since the flag never turned on.
    expect(syncEventPtoChangeMock).not.toHaveBeenCalled();
  });
});
