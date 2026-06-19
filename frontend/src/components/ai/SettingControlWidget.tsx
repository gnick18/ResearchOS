"use client";

// BeakerBot inline setting control (inline-settings bot, 2026-06-19).
//
// When the assistant answers a settings request, the chat renders this widget
// below the reply for a lone `ros-setting:<key>` embed (see chat-embed-detect's
// loneSettingEmbedFromChatParagraph and the dispatch in BeakerBotConversation).
// The user flips the setting RIGHT HERE, no navigation, and their tap is the
// durable commit (decision 3 in docs/proposals/2026-06-19-beakerbot-inline-
// settings.md). Mirrors RecordSetWidget's structure (a calm card, live read +
// write, a graceful fallback) but renders a real control instead of a record
// browser.
//
// The tier + control type + options come from the SHARED classifier in
// settings-tools.ts (settingDescriptor), the same source of truth the tool and
// the tests use, so the widget can never offer a control the tool would refuse.
//
//   - SAFE / CAUTION boolean  the real ROS toggle (Toggle.tsx look), reads the
//     live value, writes via patchUserSettings on change, shows a "Saved"
//     confirmation. A CAUTION key adds a consequence line above the toggle.
//   - SAFE enum               a segmented select of the options, writes on pick.
//   - SENSITIVE key           a handoff CARD (no control) with a button that
//     navigates to the settings page via requestNavigation.
//   - number / color / multi / unsupported  a small "open settings" handoff for
//     now (Phase 2 adds those inline controls).
//   - unknown key             a graceful fallback (never a crash).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import {
  readUserSettings,
  patchUserSettings,
  type UserSettings,
} from "@/lib/settings/user-settings";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import {
  settingDescriptor,
  type SettingDescriptor,
} from "@/lib/ai/tools/settings-tools";

// The settings page path a handoff card sends the user to. The page tolerates an
// unknown tab, so a generic href is always safe.
const SETTINGS_HREF = "/settings";

/** The widget's injectable read/write seam, so a test can drive it without a real
 *  connected folder. Defaults to the production settings store. */
export interface SettingControlDeps {
  getCurrentUser: () => Promise<string>;
  readUserSettings: (username: string) => Promise<UserSettings>;
  patchUserSettings: (
    username: string,
    patch: Partial<UserSettings>,
  ) => Promise<UserSettings>;
}

const defaultDeps: SettingControlDeps = {
  getCurrentUser: getCurrentUserCached,
  readUserSettings,
  patchUserSettings,
};

/** The card shell every state renders inside, so the widget reads consistently. */
function CardShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid="setting-control-widget"
      className="mt-2 overflow-hidden rounded-xl border border-border bg-surface-raised"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground-muted">
          <Icon name="gauge" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-meta font-semibold text-foreground">
          {label}
        </span>
      </div>
      <div className="px-3 py-3">{children}</div>
    </div>
  );
}

/** The real ROS toggle look (mirrors Toggle.tsx) used by boolean controls. */
function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <span className="relative shrink-0">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
        aria-label="Toggle setting"
      />
      <span className="block h-6 w-11 rounded-full bg-foreground-muted/30 transition-colors peer-checked:bg-blue-600" />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface-raised transition-transform peer-checked:translate-x-5" />
    </span>
  );
}

/** A brief "Saved" confirmation that fades after a write. */
function SavedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      data-testid="setting-saved"
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
    >
      <Icon name="check" className="h-3.5 w-3.5" />
      Saved
    </span>
  );
}

/** The handoff card for a sensitive / unsupported key, with a button that
 *  navigates to the settings page through the navigation bridge. */
function HandoffCard({
  descriptor,
  reason,
}: {
  descriptor: SettingDescriptor;
  reason: string;
}) {
  return (
    <CardShell label={descriptor.label}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-foreground-muted">
          <Icon name="lock" className="h-4 w-4" />
        </span>
        <p className="text-meta leading-relaxed text-foreground-muted">{reason}</p>
      </div>
      <button
        type="button"
        data-testid="setting-handoff-open"
        onClick={() => requestNavigation(SETTINGS_HREF)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
      >
        Open settings
        <Icon name="chevronRight" className="h-3.5 w-3.5" />
      </button>
    </CardShell>
  );
}

/** The boolean control (safe or caution). Reads the live value, writes on change,
 *  shows a Saved note. A caution key shows its consequence line above the toggle. */
function BooleanControl({
  descriptor,
  deps,
}: {
  descriptor: SettingDescriptor;
  deps: SettingControlDeps;
}) {
  const [value, setValue] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const username = await deps.getCurrentUser();
        const settings = await deps.readUserSettings(username);
        const v = (settings as unknown as Record<string, unknown>)[descriptor.key];
        if (active) setValue(typeof v === "boolean" ? v : false);
      } catch {
        if (active) setValue(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [descriptor.key, deps]);

  const onToggle = async (next: boolean) => {
    setValue(next);
    setBusy(true);
    try {
      const username = await deps.getCurrentUser();
      await deps.patchUserSettings(username, {
        [descriptor.key]: next,
      } as Partial<UserSettings>);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      // Revert the optimistic flip on a failed write.
      setValue(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardShell label={descriptor.label}>
      {descriptor.tier === "caution" && descriptor.caution ? (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-2 dark:border-amber-500/30 dark:bg-amber-950/30">
          <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
            <Icon name="alert" className="h-4 w-4" />
          </span>
          <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
            {descriptor.caution}
          </p>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0 text-body font-medium text-foreground">
          {descriptor.label}
        </span>
        <span className="flex items-center gap-2">
          <SavedNote show={saved} />
          {value === null ? (
            <span className="text-[11px] text-foreground-muted">Loading</span>
          ) : (
            <ToggleSwitch checked={value} onChange={onToggle} disabled={busy} />
          )}
        </span>
      </div>
    </CardShell>
  );
}

/** The enum control (safe). A segmented select of the options, current selected,
 *  writes on pick. */
function EnumControl({
  descriptor,
  deps,
}: {
  descriptor: SettingDescriptor;
  deps: SettingControlDeps;
}) {
  const options = descriptor.options ?? [];
  const [value, setValue] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const username = await deps.getCurrentUser();
        const settings = await deps.readUserSettings(username);
        const v = (settings as unknown as Record<string, unknown>)[descriptor.key];
        if (active) setValue(typeof v === "string" ? v : options[0]?.value ?? null);
      } catch {
        if (active) setValue(options[0]?.value ?? null);
      }
    })();
    return () => {
      active = false;
    };
    // options is derived from the stable descriptor; key + deps drive the read.
  }, [descriptor.key, deps, options]);

  const onPick = async (next: string) => {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const username = await deps.getCurrentUser();
      await deps.patchUserSettings(username, {
        [descriptor.key]: next,
      } as Partial<UserSettings>);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      setValue(prev);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardShell label={descriptor.label}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-body font-medium text-foreground">{descriptor.label}</span>
        <SavedNote show={saved} />
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={descriptor.label}>
        {options.map((opt) => {
          const on = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => onPick(opt.value)}
              className={`rounded-md border px-2.5 py-1 text-meta font-semibold transition-colors ${
                on
                  ? "border-brand-action bg-brand-action/10 text-foreground"
                  : "border-border text-foreground-muted hover:border-brand-action hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </CardShell>
  );
}

/** The single entry point. Given a setting key (and optional embed-supplied
 *  options), looks up the tier + control from the shared classifier and renders
 *  the right control or a handoff. Never crashes on an unknown key. */
export default function SettingControlWidget({
  settingKey,
  options,
  deps = defaultDeps,
}: {
  settingKey: string;
  options?: { value: string; label: string }[];
  deps?: SettingControlDeps;
}) {
  const descriptor = settingDescriptor(settingKey);

  // Internal key (classifier returns null) or an empty key: graceful fallback.
  if (!descriptor) {
    return (
      <CardShell label={settingKey || "Setting"}>
        <p className="text-meta text-foreground-muted">
          This is not a setting that can be shown here.
        </p>
      </CardShell>
    );
  }

  // Prefer the embed-supplied options for an enum (they survive a deep link) but
  // fall back to the classifier's options when the embed carried none.
  const resolved: SettingDescriptor =
    descriptor.control === "enum" && options && options.length > 0
      ? { ...descriptor, options }
      : descriptor;

  if (resolved.tier === "sensitive") {
    return (
      <HandoffCard
        descriptor={resolved}
        reason={`${resolved.label} affects your account, lab membership, or billing, so it is changed on the settings page rather than from chat.`}
      />
    );
  }

  if (resolved.control === "boolean") {
    return <BooleanControl descriptor={resolved} deps={deps} />;
  }
  if (resolved.control === "enum") {
    return <EnumControl descriptor={resolved} deps={deps} />;
  }

  // number / color / multi / unsupported: Phase 1 handoff to the settings page.
  return (
    <HandoffCard
      descriptor={resolved}
      reason={`${resolved.label} is changed on the settings page for now. Open settings to adjust it.`}
    />
  );
}
