// BeakerBot inline-settings tools (inline-settings bot, 2026-06-19).
//
// Two tools that let BeakerBot read and change a single app setting from chat,
// so the user never has to open the settings page. Design of record:
// docs/proposals/2026-06-19-beakerbot-inline-settings.md.
//
//   - read_setting (READ): args { key }. Returns the current value of any
//     non-internal user setting plus its type and tier. Read is broad. An
//     internal bookkeeping key (schemaVersion, caches) returns a "not a user
//     setting" note rather than its value.
//
//   - update_setting (ACTION, consent-gated): args { key, value }. The tiering
//     below is enforced by a HARD WRITE-LIST, not by prompt text. Only a key on
//     the safe (or caution) write-list is ever written, and only after the value
//     is validated against the key's type. A sensitive key (account type, lab
//     membership, money) or any key outside UserSettings returns a handoff result
//     ({ ok:false, handoff:true, settingsHref, reason }) and is NEVER written. An
//     internal key is refused as not-a-user-setting.
//
// The commit model is render-and-user-taps (decision 3 in the spec). On a
// safe/caution write update_setting writes the value through patchUserSettings AND
// returns a setting embed reference so the conversation renders the live control
// reflecting the new value, and the user can toggle further changes from the
// widget. The user's tap on that control is the durable commit, and the inline
// control keeps them in the loop rather than the agent writing silently.
//
// The TIER CLASSIFIER (settingTier, settingDescriptor, isWritableSettingKey, the
// option lists) is the SINGLE SOURCE OF TRUTH shared by this tool, the
// SettingControlWidget, and the tests, so the write-list and the widget never
// drift apart.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { getCurrentUserCached } from "@/lib/storage/json-store";
import {
  readUserSettings,
  patchUserSettings,
  type UserSettings,
} from "@/lib/settings/user-settings";
import { buildSettingEmbedHref } from "@/lib/references";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Tier classifier (single source of truth)
// ---------------------------------------------------------------------------

/** The four safety tiers a setting key falls into.
 *   - "safe"      writable inline, no money / security / membership consequence.
 *   - "caution"   writable inline, but the control states a consequence first.
 *   - "sensitive" never written by the tool; returns a handoff card to the page.
 *   - "internal"  bookkeeping / cache; never surfaced as a user setting at all. */
export type SettingTier = "safe" | "caution" | "sensitive" | "internal";

/** The value shape a control renders for a given key. Phase 1 ships boolean and
 *  enum controls; "number", "color", and "multi" keys render an "open settings"
 *  handoff for now (Phase 2 adds those controls). "unsupported" covers any other
 *  shape (objects, arrays we do not yet edit inline). */
export type SettingControlType =
  | "boolean"
  | "enum"
  | "number"
  | "color"
  | "multi"
  | "unsupported";

/** A description of one user setting key, shared by the tool and the widget. */
export interface SettingDescriptor {
  key: string;
  tier: SettingTier;
  /** The control shape Phase 1 renders for this key. */
  control: SettingControlType;
  /** For an enum control, the legal options in display order. */
  options?: { value: string; label: string }[];
  /** A short human label for the setting (used by the widget header). */
  label: string;
  /** For a caution key, the consequence sentence the control shows above it. */
  caution?: string;
}

// The path the user is sent to from a handoff card. The settings page reads a
// ?tab= param, so a sensitive key can deep-link to the relevant tab when known.
function settingsHrefFor(key: string): string {
  // Billing / account-shaped keys land on the billing or account tab; everything
  // else opens the settings page generally. The page tolerates an unknown tab.
  if (key === "purchaseRouting") return "/settings?tab=purchasing";
  if (
    key === "account_type" ||
    key === "lab_id" ||
    key === "dept_admin_of" ||
    key === "institution_admin_of" ||
    key === "labMembershipAgreement"
  ) {
    return "/settings?tab=account";
  }
  // Keys outside UserSettings (billing, security, 2FA, sign-out, privacy) and any
  // unknown key open the settings page so the user can find the real control.
  return "/settings";
}

// Enum option lists, kept here so the widget renders the SAME options the tool
// validates against. Each mirrors the corresponding type in user-settings.ts /
// store.ts / types.ts.
const DATE_FORMAT_OPTIONS = [
  { value: "MDY", label: "MM/DD/YYYY" },
  { value: "DMY", label: "DD/MM/YYYY" },
  { value: "YMD", label: "YYYY-MM-DD" },
];
const TIME_FORMAT_OPTIONS = [
  { value: "12h", label: "12-hour" },
  { value: "24h", label: "24-hour" },
];
const GANTT_VIEW_OPTIONS = [
  { value: "1week", label: "1 week" },
  { value: "2week", label: "2 weeks" },
  { value: "3week", label: "3 weeks" },
  { value: "1month", label: "1 month" },
  { value: "3month", label: "3 months" },
  { value: "6month", label: "6 months" },
  { value: "1year", label: "1 year" },
  { value: "all", label: "All" },
];
const CALENDAR_VIEW_OPTIONS = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];
const ANIMATION_OPTIONS = [
  { value: "celebration", label: "Celebration" },
  { value: "rock", label: "Rock" },
  { value: "space", label: "Space" },
  { value: "underwater", label: "Underwater" },
  { value: "sports", label: "Sports" },
  { value: "science", label: "Science" },
  { value: "plants", label: "Plants" },
  { value: "animals", label: "Animals" },
  { value: "fungi", label: "Fungi" },
  { value: "scary", label: "Scary" },
  { value: "none", label: "None" },
];
const LAPTOP_ALARM_OPTIONS = [
  { value: "sound-visual", label: "Sound + visual" },
  { value: "visual-only", label: "Visual only" },
];
const EDITOR_WIDTH_OPTIONS = [
  { value: "narrow", label: "Narrow" },
  { value: "comfortable", label: "Comfortable" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full bleed" },
];

// The SAFE write-list. Each maps a key to its control shape (and, for an enum, its
// options + label). A key NOT in here and NOT in the caution / sensitive / internal
// sets is treated as sensitive (handoff), so the write-list is closed by default.
const SAFE_DESCRIPTORS: Record<string, Omit<SettingDescriptor, "tier" | "key">> = {
  // Boolean preferences.
  showSharedByDefault: { control: "boolean", label: "Show shared items by default" },
  coloredHeader: { control: "boolean", label: "Colored header" },
  professionalMode: { control: "boolean", label: "Professional mode" },
  beakerBotAnimations: { control: "boolean", label: "BeakerBot animations" },
  showCompanionButton: { control: "boolean", label: "Show the Companion button" },
  autoPublishSnapshotsToPhones: {
    control: "boolean",
    label: "Auto-publish snapshots to phones",
  },
  spellCheckInEditor: { control: "boolean", label: "Spell-check in the editor" },
  editorTypewriterScroll: { control: "boolean", label: "Typewriter scroll" },
  editorFocusDimming: { control: "boolean", label: "Focus dimming" },
  sidebarShowTasks: { control: "boolean", label: "Show tasks in the sidebar" },
  sidebarShowCalendarEvents: {
    control: "boolean",
    label: "Show calendar events in the sidebar",
  },
  offlineMode: { control: "boolean", label: "Offline mode" },
  hideGoalsFromLab: { control: "boolean", label: "Hide my goals from the lab" },

  // Enum preferences.
  dateFormat: { control: "enum", label: "Date format", options: DATE_FORMAT_OPTIONS },
  timeFormat: { control: "enum", label: "Time format", options: TIME_FORMAT_OPTIONS },
  defaultGanttViewMode: {
    control: "enum",
    label: "Default Gantt view",
    options: GANTT_VIEW_OPTIONS,
  },
  defaultCalendarViewMode: {
    control: "enum",
    label: "Default calendar view",
    options: CALENDAR_VIEW_OPTIONS,
  },
  animationType: {
    control: "enum",
    label: "Celebration animation",
    options: ANIMATION_OPTIONS,
  },
  laptopAlarmMode: {
    control: "enum",
    label: "Laptop alarm",
    options: LAPTOP_ALARM_OPTIONS,
  },
  editorWidthPreset: {
    control: "enum",
    label: "Editor width",
    options: EDITOR_WIDTH_OPTIONS,
  },

  // Number / color / multi-select keys are SAFE to write but Phase 1 has no inline
  // control for them, so the widget renders an "open settings" handoff. They stay
  // on the safe write-list so update_setting can still write them when the model
  // supplies a valid value (the page reads the same field).
  sidebarEventsHorizonDays: { control: "number", label: "Sidebar events horizon" },
  displayName: { control: "unsupported", label: "Display name" },
  color: { control: "color", label: "Accent color" },
  colorSecondary: { control: "color", label: "Secondary accent color" },
  enabledMethodTypes: { control: "multi", label: "Enabled method types" },

  // Structured keys on the safe list (views/layout + notifications). No inline
  // control in Phase 1, so the widget hands off to the settings page, but they are
  // still writable by the tool when the model provides a well-formed value.
  visibleTabs: { control: "unsupported", label: "Visible tabs" },
  defaultLandingTab: { control: "unsupported", label: "Default landing tab" },
  navLayout: { control: "unsupported", label: "Navigation layout" },
  dashboard_layout: { control: "unsupported", label: "Dashboard layout" },
  lab_overview_layout: { control: "unsupported", label: "Lab overview layout" },
  home_layout: { control: "unsupported", label: "Home layout" },
  notificationPreferences: {
    control: "unsupported",
    label: "Notification preferences",
  },
};

// The CAUTION write-list. Writable, but the control states the consequence first.
const CAUTION_DESCRIPTORS: Record<string, Omit<SettingDescriptor, "tier" | "key">> = {
  confirmDestructiveActions: {
    control: "boolean",
    label: "Confirm destructive actions",
    caution:
      "Turning this off removes the confirmation step before deletes and other " +
      "destructive actions, so they happen immediately.",
  },
};

// The SENSITIVE set. Never written by the tool; returns a handoff card. These are
// account / membership / money keys. Anything NOT in UserSettings (billing,
// security, 2FA, sign-out, folder disconnect, privacy) is also treated as
// sensitive at classify time.
const SENSITIVE_KEYS = new Set<string>([
  "account_type",
  "lab_id",
  "dept_admin_of",
  "institution_admin_of",
  "labMembershipAgreement",
  "purchaseRouting",
]);

// The INTERNAL set. Bookkeeping + cache, never surfaced as a user setting.
const INTERNAL_KEYS = new Set<string>([
  "schemaVersion",
  "lastSeenAnnouncementVersion",
  "lab_pending_genesis",
  "lab_envelope_cache",
]);

// Every key that IS a field of UserSettings, so an unknown key (not a real
// setting) can be told apart from a known-but-sensitive one. Kept as a literal
// set, not derived from a value, because the interface has no runtime shape.
const KNOWN_USER_SETTINGS_KEYS = new Set<string>([
  ...Object.keys(SAFE_DESCRIPTORS),
  ...Object.keys(CAUTION_DESCRIPTORS),
  ...SENSITIVE_KEYS,
  ...INTERNAL_KEYS,
  // enabledWidgets is a real UserSettings field but is curated only from the
  // widget palette, so it is neither inline-writable nor a handoff target; treat
  // it as sensitive (handoff) here so the tool never writes it blindly.
  "enabledWidgets",
]);

/** The single source of truth for a key's tier. Used by the tool, the widget, and
 *  the tests. A key off every list is sensitive (handoff) by default, which is what
 *  keeps the write-list closed. */
export function settingTier(key: string): SettingTier {
  if (INTERNAL_KEYS.has(key)) return "internal";
  if (Object.prototype.hasOwnProperty.call(SAFE_DESCRIPTORS, key)) return "safe";
  if (Object.prototype.hasOwnProperty.call(CAUTION_DESCRIPTORS, key)) {
    return "caution";
  }
  // Sensitive list, plus any key not in UserSettings at all (billing, security),
  // plus enabledWidgets. Everything else falls here, so the default is handoff.
  return "sensitive";
}

/** Whether a key may be WRITTEN by update_setting (safe or caution only). This is
 *  the hard write-list the tool enforces; sensitive and internal keys are never
 *  writable. */
export function isWritableSettingKey(key: string): boolean {
  const tier = settingTier(key);
  return tier === "safe" || tier === "caution";
}

/** Whether a key is a real field of UserSettings (vs an unknown / off-schema key
 *  the model named, e.g. "twoFactor" or "subscription"). */
export function isKnownUserSettingKey(key: string): boolean {
  return KNOWN_USER_SETTINGS_KEYS.has(key);
}

/** The full descriptor (tier + control + options + label + caution) for a key.
 *  The widget reads this to decide what control to render. Returns null for an
 *  internal key (never surfaced) and a minimal sensitive descriptor for any
 *  handoff key, so the widget always has something to render. */
export function settingDescriptor(key: string): SettingDescriptor | null {
  const tier = settingTier(key);
  if (tier === "internal") return null;
  if (tier === "safe") {
    return { key, tier, ...SAFE_DESCRIPTORS[key] };
  }
  if (tier === "caution") {
    return { key, tier, ...CAUTION_DESCRIPTORS[key] };
  }
  // Sensitive (including off-schema keys): a control-less handoff descriptor.
  return {
    key,
    tier: "sensitive",
    control: "unsupported",
    label: humanizeKey(key),
  };
}

/** A readable label fallback for a key that has no authored label (a sensitive /
 *  off-schema key). Splits camelCase / snake_case into words. */
function humanizeKey(key: string): string {
  const words = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Value validation (against the key's declared type)
// ---------------------------------------------------------------------------

/** Validate (and coerce where safe) a value for a writable key against its type.
 *  Returns the typed value to write, or an error string. A boolean key rejects a
 *  non-boolean; an enum key rejects a value off its option list; a number key
 *  rejects a non-finite number. Structured keys (arrays / objects) accept a value
 *  of the right broad shape and let normalize() in the store repair the details. */
export function validateSettingValue(
  key: string,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const desc = settingDescriptor(key);
  if (!desc) {
    return { ok: false, error: `"${key}" is not a writable user setting.` };
  }
  switch (desc.control) {
    case "boolean": {
      if (typeof value !== "boolean") {
        return {
          ok: false,
          error: `Setting "${key}" expects true or false, got ${typeofLabel(value)}.`,
        };
      }
      return { ok: true, value };
    }
    case "enum": {
      const allowed = (desc.options ?? []).map((o) => o.value);
      if (typeof value !== "string" || !allowed.includes(value)) {
        return {
          ok: false,
          error: `Setting "${key}" expects one of ${allowed.join(", ")}, got ${JSON.stringify(
            value,
          )}.`,
        };
      }
      return { ok: true, value };
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) {
        return {
          ok: false,
          error: `Setting "${key}" expects a number, got ${typeofLabel(value)}.`,
        };
      }
      return { ok: true, value: n };
    }
    case "color": {
      // displayName is "unsupported"; color keys accept a hex string or null.
      if (value === null) return { ok: true, value: null };
      if (typeof value !== "string" || !/^#?[0-9a-fA-F]{3,8}$/.test(value.trim())) {
        return {
          ok: false,
          error: `Setting "${key}" expects a hex color string, got ${JSON.stringify(value)}.`,
        };
      }
      const hex = value.trim();
      return { ok: true, value: hex.startsWith("#") ? hex : `#${hex}` };
    }
    case "multi": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        return {
          ok: false,
          error: `Setting "${key}" expects an array of strings.`,
        };
      }
      return { ok: true, value };
    }
    case "unsupported": {
      // visibleTabs / navLayout / displayName / layouts / notificationPreferences.
      // displayName accepts a string or null; the rest accept an object / array and
      // let the store's normalize() repair the shape on write. We do not block them
      // (they are on the safe write-list) but we apply the lightest sane check.
      if (key === "displayName") {
        if (value !== null && typeof value !== "string") {
          return {
            ok: false,
            error: `Setting "${key}" expects a name string or null.`,
          };
        }
        return { ok: true, value };
      }
      if (key === "defaultLandingTab") {
        if (typeof value !== "string") {
          return { ok: false, error: `Setting "${key}" expects a tab href string.` };
        }
        return { ok: true, value };
      }
      if (key === "visibleTabs") {
        if (!Array.isArray(value)) {
          return { ok: false, error: `Setting "${key}" expects an array of hrefs.` };
        }
        return { ok: true, value };
      }
      // navLayout / dashboard_layout / lab_overview_layout / home_layout /
      // notificationPreferences are objects the store normalizes.
      if (value === null || typeof value !== "object") {
        return {
          ok: false,
          error: `Setting "${key}" expects a structured object value.`,
        };
      }
      return { ok: true, value };
    }
    default:
      return { ok: false, error: `Setting "${key}" cannot be written.` };
  }
}

function typeofLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

// ---------------------------------------------------------------------------
// Injectable seam (for tests)
// ---------------------------------------------------------------------------

export type SettingsToolsDeps = {
  getCurrentUser: () => Promise<string>;
  readUserSettings: (username: string) => Promise<UserSettings>;
  patchUserSettings: (
    username: string,
    patch: Partial<UserSettings>,
  ) => Promise<UserSettings>;
};

export const settingsToolsDeps: SettingsToolsDeps = {
  getCurrentUser: getCurrentUserCached,
  readUserSettings,
  patchUserSettings,
};

/** Read a single key's live value from the user's settings. */
async function readSettingValue(key: string): Promise<unknown> {
  const username = await settingsToolsDeps.getCurrentUser();
  const settings = await settingsToolsDeps.readUserSettings(username);
  return (settings as unknown as Record<string, unknown>)[key];
}

// ---------------------------------------------------------------------------
// read_setting (READ-ONLY)
// ---------------------------------------------------------------------------

export const readSettingTool: AiTool = {
  name: "read_setting",
  description:
    "Read the current value of one of the user's app settings (their UserSettings). " +
    "Pass the setting key (for example \"dateFormat\", \"sidebarShowTasks\", \"animationType\"). " +
    "Returns the key, its current value, the value type, and its safety tier " +
    "(safe, caution, or sensitive). Use this to answer \"what is my X set to\" before " +
    "offering to change it with update_setting. An internal bookkeeping key (a schema " +
    "version or cache) returns a note that it is not a user setting. NEVER invent a value; " +
    "report exactly what the tool returns.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "The setting key to read, e.g. \"dateFormat\", \"sidebarShowTasks\", \"animationType\".",
      },
    },
    required: ["key"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const key = typeof args.key === "string" ? args.key.trim() : "";
    if (!key) {
      return { ok: false as const, error: "No setting key provided." };
    }
    const tier = settingTier(key);
    if (tier === "internal") {
      return {
        ok: true as const,
        key,
        tier,
        note:
          `"${key}" is internal bookkeeping, not a user setting, so its value is not surfaced.`,
      };
    }
    if (!isKnownUserSettingKey(key)) {
      // An off-schema key (the model named something that is not a UserSettings
      // field, e.g. a billing or security control). Tell it where that lives.
      return {
        ok: true as const,
        key,
        tier: "sensitive" as const,
        handoff: true as const,
        settingsHref: settingsHrefFor(key),
        note:
          `"${key}" is not a user setting BeakerBot can read here. It lives on the ` +
          "settings page (it may be a billing, security, or account control).",
      };
    }
    const value = await readSettingValue(key);
    const desc = settingDescriptor(key);
    return {
      ok: true as const,
      key,
      value,
      type: desc?.control ?? "unsupported",
      tier,
      ...(tier === "sensitive"
        ? { handoff: true as const, settingsHref: settingsHrefFor(key) }
        : {}),
      // The embed reference so the conversation can render the live control for a
      // safe / caution key (the user reads AND can flip it inline).
      ...(tier === "safe" || tier === "caution"
        ? { embed: buildSettingEmbedHref(key) }
        : {}),
    };
  },
};

// ---------------------------------------------------------------------------
// update_setting (ACTION)
// ---------------------------------------------------------------------------

export const updateSettingTool: AiTool = {
  name: "update_setting",
  description:
    "Change one of the user's app settings. Pass the setting key and the new value " +
    "(a boolean for a toggle, the exact option string for an enum, a number for a count). " +
    "ONLY safe user preferences can be changed (views and layout, personalization, formats, " +
    "editor, companion, notifications, mode). Account type, lab membership, purchasing, billing, " +
    "and security settings can NEVER be changed here; for those the tool returns a handoff that " +
    "links the user to the settings page. On a successful change the tool renders the live " +
    "control inline in chat so the user can confirm or flip it further; the user's tap is the " +
    "real commit. Always read_setting first if you are unsure of the current value. " +
    "NEVER invent a value the user did not ask for.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "The setting key to change, e.g. \"sidebarShowTasks\", \"dateFormat\", \"animationType\".",
      },
      value: {
        description:
          "The new value. A boolean (true/false) for a toggle, the exact option string for " +
          "an enum (e.g. \"24h\" for timeFormat), or a number for a count.",
      },
    },
    required: ["key", "value"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const key = typeof args.key === "string" ? args.key : "?";
    const desc = settingDescriptor(key);
    const label = desc?.label ?? key;
    const value = formatValueForPreview(args.value);
    if (settingTier(key) === "sensitive") {
      return { summary: `open the settings page for ${label}` };
    }
    return { summary: `set ${label} to ${value}` };
  },
  execute: async (args) => {
    const key = typeof args.key === "string" ? args.key.trim() : "";
    if (!key) {
      return { ok: false as const, error: "No setting key provided." };
    }
    const tier = settingTier(key);

    // Internal keys are refused as not-a-user-setting. No write.
    if (tier === "internal") {
      return {
        ok: false as const,
        error: `"${key}" is internal bookkeeping, not a user setting, and cannot be changed.`,
      };
    }

    // Unknown / off-schema key (billing, security, 2FA, sign-out, privacy). No write.
    if (!isKnownUserSettingKey(key)) {
      return {
        ok: false as const,
        handoff: true as const,
        settingsHref: settingsHrefFor(key),
        reason:
          `"${key}" is not a setting BeakerBot can change here. It may be a billing, ` +
          "security, or account control, which the user changes on the settings page.",
      };
    }

    // Sensitive keys are NEVER written. Return a handoff card. This is enforced by
    // the write-list (isWritableSettingKey), not by prompt text.
    if (!isWritableSettingKey(key)) {
      const desc = settingDescriptor(key);
      return {
        ok: false as const,
        handoff: true as const,
        settingsHref: settingsHrefFor(key),
        reason:
          `${desc?.label ?? key} affects your account, lab membership, or billing, so ` +
          "BeakerBot does not change it from chat. Open the settings page to change it yourself.",
      };
    }

    // Safe / caution: validate the value against the key's type, then write.
    const validated = validateSettingValue(key, args.value);
    if (!validated.ok) {
      return { ok: false as const, error: validated.error };
    }

    const username = await settingsToolsDeps.getCurrentUser();
    try {
      await settingsToolsDeps.patchUserSettings(username, {
        [key]: validated.value,
      } as Partial<UserSettings>);
    } catch {
      return {
        ok: false as const,
        error:
          `Could not change "${key}". A folder may not be connected, or the write failed.`,
      };
    }

    const desc = settingDescriptor(key);
    return {
      ok: true as const,
      key,
      value: validated.value,
      tier,
      // The setting embed reference so the conversation renders the live control
      // reflecting the new value. The user can flip it further from the widget.
      embed: buildSettingEmbedHref(key),
      ...(tier === "caution" && desc?.caution ? { caution: desc.caution } : {}),
      instruction:
        `Changed ${desc?.label ?? key}. The control is shown inline so you can confirm ` +
        "or flip it again.",
    };
  },
};

/** A short readable rendering of the value for the action preview line. */
function formatValueForPreview(value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (value === null) return "none";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}
