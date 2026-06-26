/**
 * Regression tests for two P2 notification bugs found in stress testing
 * (2026-06-17):
 *
 * BUG 1 — Rapid bell clicks permanently remove the unread-count badge:
 *   Root cause: the popup's mousedown click-outside handler fired on every
 *   bell click (bell is outside popupRef), calling onClose() then the bell
 *   onClick reading the stale closure set showPopup the same direction —
 *   so rapid clicks kept the popup open and notification rows could be hit
 *   accidentally. Fix: stopPropagation on button mousedown so the popup's
 *   outside listener never sees bell clicks; functional setShowPopup(prev =>
 *   !prev) for a deterministic toggle; badge refresh on popup close.
 *
 * BUG 2 — "Mark all read" does not update the unread count badge:
 *   Root cause: handleMarkAllRead optimistically updated popup state and
 *   called onNotificationRead(), but did NOT dispatch the
 *   "ros-notifications-changed" CustomEvent that all other mutating actions
 *   (dismiss, clearAll, clearRead) dispatch. Fix: dispatch the event so the
 *   badge's listener reliably triggers loadUnreadCount().
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useLabPendingRequests", () => ({
  useLabPendingRequests: () => ({ count: 0 }),
}));

vi.mock("@/hooks/usePendingApprovalsCount", () => ({
  usePendingApprovalsCount: () => ({ count: 0 }),
}));

vi.mock("@/lib/calendar/calendar-nav-store", () => ({
  useCalendarNavStore: () => vi.fn(),
}));

vi.mock("@/hooks/useEscapeToClose", () => ({
  useEscapeToClose: () => {},
}));

// sharingApi mock — disk state is reset in beforeEach
const makeNotifications = () => [
  {
    id: "n1",
    type: "task_shared",
    item_type: "task",
    item_name: "Task A",
    from_user: "alice",
    permission: "view",
    created_at: new Date().toISOString(),
    read: false,
  },
  {
    id: "n2",
    type: "task_shared",
    item_type: "task",
    item_name: "Task B",
    from_user: "bob",
    permission: "edit",
    created_at: new Date().toISOString(),
    read: false,
  },
];

// Mutable disk state shared by all api stubs
let disk: ReturnType<typeof makeNotifications> = [];

vi.mock("@/lib/local-api", () => ({
  sharingApi: {
    getNotifications: vi.fn(async () => ({
      notifications: disk.map((n) => ({ ...n })),
      unread_count: disk.filter((n) => !n.read).length,
    })),
    markNotificationRead: vi.fn(async (id: string) => {
      disk = disk.map((n) => (n.id === id ? { ...n, read: true } : n));
      return { status: "ok", notification_id: id };
    }),
    markAllNotificationsRead: vi.fn(async () => {
      disk = disk.map((n) => ({ ...n, read: true }));
      return { status: "ok", dismissed_count: disk.length };
    }),
    dismissNotification: vi.fn(async (id: string) => {
      disk = disk.filter((n) => n.id !== id);
      return { status: "ok", notification_id: id };
    }),
    dismissAllNotifications: vi.fn(async () => ({
      status: "ok",
      dismissed_count: 0,
    })),
    dismissReadNotifications: vi.fn(async () => ({ status: "ok" })),
    dismissShiftAlert: vi.fn(async () => ({ status: "ok" })),
    scanShiftAlerts: vi.fn(async () => {}),
  },
}));

import NotificationBadge from "../NotificationBadge";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  disk = makeNotifications();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// BUG 1 — badge count survives rapid bell toggles
// ---------------------------------------------------------------------------

describe("BUG 1: rapid bell clicks", () => {
  it("no notification-read API calls fire from rapid bell clicks alone", async () => {
    const { sharingApi } = await import("@/lib/local-api");

    render(<NotificationBadge />);

    // Badge initialises from getNotifications: 2 unread
    await waitFor(() =>
      expect(screen.getByText("2")).toBeInTheDocument()
    );

    const bell = screen.getByRole("button", { name: /notifications/i });

    // Rapid open → close → open → close
    await act(async () => {
      fireEvent.click(bell);
      fireEvent.click(bell);
      fireEvent.click(bell);
      fireEvent.click(bell);
    });

    // No notifications were marked read — only getNotifications may have
    // been called (for the badge refresh on popup close).
    expect(sharingApi.markNotificationRead).not.toHaveBeenCalled();
    expect(sharingApi.markAllNotificationsRead).not.toHaveBeenCalled();

    // Badge still shows 2
    await waitFor(() =>
      expect(screen.getByText("2")).toBeInTheDocument()
    );
  });

  it("bell mousedown does not propagate to the document", async () => {
    render(<NotificationBadge />);

    // Wait for mount
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument()
    );

    const bell = screen.getByRole("button", { name: /notifications/i });
    const docSpy = vi.fn();
    document.addEventListener("mousedown", docSpy);
    fireEvent.mouseDown(bell);
    document.removeEventListener("mousedown", docSpy);

    // stopPropagation prevents the document listener from firing
    expect(docSpy).not.toHaveBeenCalled();
  });

  it("badge re-syncs from server when popup closes via bell", async () => {
    const { sharingApi } = await import("@/lib/local-api");

    render(<NotificationBadge />);

    await waitFor(() =>
      expect(screen.getByText("2")).toBeInTheDocument()
    );

    const bell = screen.getByRole("button", { name: /notifications/i });

    // Open popup
    await act(async () => {
      fireEvent.click(bell);
    });

    // Simulate external mark-all-read that updates disk state
    await sharingApi.markAllNotificationsRead();

    // Close popup via bell — triggers badge refresh
    await act(async () => {
      fireEvent.click(bell);
    });

    // Badge should now show 0 (span hidden)
    await waitFor(() =>
      expect(screen.queryByText("2")).not.toBeInTheDocument()
    );
  });
});

// ---------------------------------------------------------------------------
// BUG 2 — "Mark all read" updates the badge
// ---------------------------------------------------------------------------

describe("BUG 2: mark all read badge update", () => {
  it("dispatches ros-notifications-changed after mark-all-read", async () => {
    const events: string[] = [];
    const handler = () => events.push("ros-notifications-changed");
    window.addEventListener("ros-notifications-changed", handler);

    render(<NotificationBadge />);

    await waitFor(() =>
      expect(screen.getByText("2")).toBeInTheDocument()
    );

    const bell = screen.getByRole("button", { name: /notifications/i });
    await act(async () => {
      fireEvent.click(bell);
    });

    const markAllBtn = await screen.findByText(/mark all read/i);
    await act(async () => {
      fireEvent.click(markAllBtn);
    });

    window.removeEventListener("ros-notifications-changed", handler);

    expect(events).toContain("ros-notifications-changed");
  });

  it("badge unread count goes to zero after mark-all-read", async () => {
    render(<NotificationBadge />);

    await waitFor(() =>
      expect(screen.getByText("2")).toBeInTheDocument()
    );

    const bell = screen.getByRole("button", { name: /notifications/i });
    await act(async () => {
      fireEvent.click(bell);
    });

    const markAllBtn = await screen.findByText(/mark all read/i);
    await act(async () => {
      fireEvent.click(markAllBtn);
    });

    // Badge span disappears when badgeCount === 0
    await waitFor(() =>
      expect(screen.queryByText("2")).not.toBeInTheDocument()
    );
  });
});
