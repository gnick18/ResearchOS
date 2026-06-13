// Notification preferences (notification-routing build, 2026-06-12).
//
// Lets a user route each KIND of notification to any combination of CHANNELS:
// the in-app bell (always collects), laptop desktop pop-ups, the companion
// phone app, and email. The bell + laptop are local-first and work for any
// user; phone + email are account/cloud features, so a solo user (no account)
// never has them and that is their opt-out (see feedback_solo_user_feature_gating).
//
// The 14 notification discriminant types (types.ts) collapse into 5 friendly
// categories so the settings matrix is five rows, not fourteen.
//
// No emojis, no em-dashes, no mid-sentence colons.

export type NotificationChannel = "inApp" | "laptop" | "phone" | "email";

/** The five user-facing notification categories (matrix rows). */
export type NotificationCategory =
  | "shared"
  | "comments"
  | "lab"
  | "purchases"
  | "reminders";

export const NOTIFICATION_CATEGORIES: {
  id: NotificationCategory;
  title: string;
  description: string;
}[] = [
  {
    id: "shared",
    title: "Shared & assigned to me",
    description:
      "A task, method, or project shared with you, or a task assigned or flagged for your review.",
  },
  {
    id: "comments",
    title: "Comments & mentions",
    description: "Someone comments on your work or @-mentions you.",
  },
  {
    id: "lab",
    title: "Lab announcements",
    description: "Your PI posts a lab-wide announcement.",
  },
  {
    id: "purchases",
    title: "Purchases & orders",
    description:
      "An order you requested is placed or approved, or one is assigned to you.",
  },
  {
    id: "reminders",
    title: "Reminders & schedule changes",
    description: "Calendar reminders, and when a shared task's date shifts.",
  },
];

/** Channels that require an account (cloud). Solo users never see these. */
export const ACCOUNT_ONLY_CHANNELS: NotificationChannel[] = ["phone", "email"];

/** Map a notification's discriminant `type` to its category. */
export function notificationCategory(type: string): NotificationCategory {
  switch (type) {
    case "task_shared":
    case "method_shared":
    case "project_shared":
    case "lab_task_assignment":
    case "lab_flag_for_review":
      return "shared";
    case "comment_mention":
    case "comment_on_owned":
    case "comment_lab_head_feed":
      return "comments";
    case "lab_announcement":
      return "lab";
    case "lab_purchase_approval":
    case "purchase_assignment":
    case "purchase_ordered":
      return "purchases";
    case "event_reminder":
    case "shift_alert":
      return "reminders";
    default:
      // Unknown / future type, treat as "shared" so it is never silently lost.
      return "shared";
  }
}

export interface QuietHours {
  enabled: boolean;
  /** 24h "HH:MM". start may be greater than end for an overnight window. */
  start: string;
  end: string;
  /** When on, Saturday and Sunday are fully quiet (push channels silent). */
  weekendsQuiet: boolean;
}

export interface NotificationPreferences {
  /** Per-category channel routing. The bell (inApp) always collects, so its
   *  flag is stored for a future "mute this category from the bell" but does
   *  not currently suppress the store. laptop/phone/email are push channels. */
  channels: Record<NotificationCategory, Record<NotificationChannel, boolean>>;
  quietHours: QuietHours;
  /** Verified email for the email channel (account users only). */
  email?: string;
}

/** Defaults match the approved mockup table (Grant, 2026-06-12). Quiet hours
 *  ship OFF so we never silently suppress a pop-up the user expected; the
 *  feature is there to opt into. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: {
    shared: { inApp: true, laptop: true, phone: true, email: false },
    comments: { inApp: true, laptop: true, phone: false, email: false },
    lab: { inApp: true, laptop: false, phone: false, email: true },
    purchases: { inApp: true, laptop: false, phone: false, email: false },
    reminders: { inApp: true, laptop: true, phone: true, email: false },
  },
  quietHours: { enabled: false, start: "19:00", end: "08:00", weekendsQuiet: false },
};

/** Repair a partial / hand-edited preferences object to the full shape, filling
 *  any missing category or channel from the defaults. Safe to run on read. */
export function normalizeNotificationPreferences(
  raw: Partial<NotificationPreferences> | undefined,
): NotificationPreferences {
  const d = DEFAULT_NOTIFICATION_PREFERENCES;
  const channels = {} as NotificationPreferences["channels"];
  for (const cat of NOTIFICATION_CATEGORIES) {
    const rawCat: Partial<Record<NotificationChannel, boolean>> =
      raw?.channels?.[cat.id] ?? {};
    channels[cat.id] = {
      inApp: rawCat.inApp ?? d.channels[cat.id].inApp,
      laptop: rawCat.laptop ?? d.channels[cat.id].laptop,
      phone: rawCat.phone ?? d.channels[cat.id].phone,
      email: rawCat.email ?? d.channels[cat.id].email,
    };
  }
  const q = raw?.quietHours;
  return {
    channels,
    quietHours: {
      enabled: q?.enabled ?? d.quietHours.enabled,
      start: typeof q?.start === "string" ? q.start : d.quietHours.start,
      end: typeof q?.end === "string" ? q.end : d.quietHours.end,
      weekendsQuiet: q?.weekendsQuiet ?? d.quietHours.weekendsQuiet,
    },
    email: typeof raw?.email === "string" ? raw.email : undefined,
  };
}

/** True if `now` falls inside the quiet-hours window (handles overnight ranges
 *  where start > end, plus the weekends-quiet rule). */
export function isQuietNow(q: QuietHours, now: Date): boolean {
  if (!q.enabled) return false;
  const day = now.getDay(); // 0 = Sun, 6 = Sat
  if (q.weekendsQuiet && (day === 0 || day === 6)) return true;
  const toMin = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = toMin(q.start);
  const end = toMin(q.end);
  if (start === end) return false;
  // Overnight window (e.g. 19:00 -> 08:00) wraps past midnight.
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/**
 * Resolve which PUSH channels should fire for a given notification right now.
 * The in-app bell always collects (not returned here). Quiet hours silence the
 * push channels. `hasAccount` gates the account-only channels (phone/email) so
 * a solo user never gets them even if a stale pref says otherwise.
 */
export function pushChannelsForNotification(
  prefs: NotificationPreferences,
  notificationType: string,
  now: Date,
  hasAccount: boolean,
): { laptop: boolean; phone: boolean; email: boolean } {
  const cat = notificationCategory(notificationType);
  const c = prefs.channels[cat];
  const quiet = isQuietNow(prefs.quietHours, now);
  return {
    laptop: !!c.laptop && !quiet,
    phone: !!c.phone && hasAccount && !quiet,
    email: !!c.email && hasAccount && !quiet,
  };
}
