"use client";

// Settings "Companion" section — pair a phone to capture at the bench.
//
// Approved redesign 2026-06-08 (see docs/mockups/2026-06-08-settings-devices-redesign.html).
// Three states: not paired -> pair CTA + feature chips; pairing -> QR card with countdown;
// paired -> device list + auto-sync status + collapsed Advanced disclosure.
//
// All existing wiring is preserved: makePairingGrant / listDevices / revokeDevice /
// runCaptureInboxPoll from @/lib/mobile-relay/client; poll + loadUserCaptureKeys from
// @/lib/mobile-relay/keys; QRCode.toDataURL; the device-binding poll-to-detect-pairing;
// the `ready` prop (= sharing.isReady).
//
// House style: Tooltip for icon-only buttons, no emojis, no em-dashes, no
// mid-sentence colons, dark-mode tokens (bg-surface / text-foreground /
// border-border). All glyphs render through the verified icon registry via
// <Icon name="..."> (companion / phone / lock / camera / sun added 2026-06-08).

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import BeakerBot from "@/components/BeakerBot";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  listDevices,
  makePairingGrant,
  revokeDevice,
  type BoundDevice,
  type PairingGrant,
} from "@/lib/mobile-relay/client";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import { runCaptureInboxPoll } from "@/lib/mobile-relay/poll";
import { publishTodayToAllDevices } from "@/lib/mobile-relay/today-snapshot";
import { publishInventoryToAllDevices } from "@/lib/mobile-relay/inventory-snapshot";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBoundAt(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  // Short date like "Jun 7"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 2) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── BeakerBot companion tile ───────────────────────────────────────────────────

/** BeakerBot tile: sky-to-purple gradient rounded square with the real mascot.
 *  The inner glyph is the canonical BeakerBot (white, static, no liquid), not an
 *  invented bot shape — the mascot IS BeakerBot. */
function BotTile() {
  return (
    <span
      aria-hidden="true"
      className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-[9px]"
      style={{ background: "linear-gradient(135deg,#1AA0E6,#5B47D6)" }}
    >
      <BeakerBot
        pose="idle"
        noLiquid
        animated={false}
        easterEgg="none"
        className="w-5 h-5 text-white"
      />
    </span>
  );
}

// ── Feature chips (shown only when not yet paired) ────────────────────────────

const FEATURE_CHIPS = [
  {
    label: "Bench photos",
    icon: <Icon name="camera" className="w-[13px] h-[13px]" />,
  },
  {
    label: "Quick notes",
    icon: <Icon name="file" className="w-[13px] h-[13px]" />,
  },
  {
    label: "Scan to reorder",
    icon: <Icon name="scan" className="w-[13px] h-[13px]" />,
  },
  {
    label: "Today glance",
    icon: <Icon name="sun" className="w-[13px] h-[13px]" />,
  },
] as const;

// ── Props / component ─────────────────────────────────────────────────────────

interface DevicesSectionProps {
  /** True when the current user's identity is unlocked (Ed25519 key available). */
  ready: boolean;
}

export default function DevicesSection({ ready }: DevicesSectionProps) {
  const { currentUser } = useCurrentUser();
  const [devices, setDevices] = useState<BoundDevice[] | null>(null);

  // Pairing state
  const [grant, setGrant] = useState<PairingGrant | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [paired, setPaired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Advanced: manual check-for-captures
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  // Advanced: re-publish snapshots
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);

  // Snapshot of device pubkeys when pairing started — used to detect the new binding.
  const baselineKeysRef = useRef<Set<string>>(new Set());

  // ── Device list ────────────────────────────────────────────────────────────

  const refreshDevices = useCallback(async () => {
    if (!ready) return;
    const keys = await loadUserCaptureKeys();
    if (!keys) return;
    try {
      const list = await listDevices(keys);
      setDevices(list);
      return list;
    } catch {
      setError("Could not reach the relay. Check your connection.");
      return undefined;
    }
  }, [ready]);

  useEffect(() => {
    if (ready) void refreshDevices();
  }, [ready, refreshDevices]);

  // ── QR render ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!grant) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(grant.qrPayload, { width: 240, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("Could not render the pairing code.");
      });
    return () => {
      cancelled = true;
    };
  }, [grant]);

  // ── Countdown + poll for phone binding ────────────────────────────────────

  useEffect(() => {
    if (!grant || paired) return;
    let cancelled = false;

    const tick = () => {
      const left = secondsUntil(grant.exp);
      setCountdown(left);
      if (left <= 0) {
        setGrant(null);
      }
    };
    tick();
    const countdownTimer = setInterval(tick, 1000);

    const pollTimer = setInterval(async () => {
      const list = await refreshDevices();
      if (cancelled || !list) return;
      const fresh = list.some((d) => !baselineKeysRef.current.has(d.devicePubkey));
      if (fresh) {
        setPaired(true);
        setGrant(null);
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(countdownTimer);
      clearInterval(pollTimer);
    };
  }, [grant, paired, refreshDevices]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const startPairing = useCallback(async () => {
    setError(null);
    setPaired(false);
    setBusy(true);
    try {
      const keys = await loadUserCaptureKeys();
      if (!keys) {
        setError("Your identity is locked. Set up or restore your account first.");
        return;
      }
      const list = (await refreshDevices()) ?? [];
      baselineKeysRef.current = new Set(list.map((d) => d.devicePubkey));
      setGrant(makePairingGrant(keys));
    } finally {
      setBusy(false);
    }
  }, [refreshDevices]);

  const cancelPairing = useCallback(() => {
    setGrant(null);
    setPaired(false);
  }, []);

  const unpair = useCallback(
    async (devicePubkey: string) => {
      setError(null);
      const keys = await loadUserCaptureKeys();
      if (!keys) {
        setError("Your identity is locked. Set up or restore your account first.");
        return;
      }
      try {
        await revokeDevice(keys, devicePubkey);
        await refreshDevices();
      } catch {
        setError("Could not unpair that device. Try again.");
      }
    },
    [refreshDevices],
  );

  const checkForCaptures = useCallback(async () => {
    setCheckResult(null);
    setChecking(true);
    try {
      const keys = await loadUserCaptureKeys();
      if (!keys) {
        setCheckResult("Your identity is locked. Set up or restore your account first.");
        return;
      }
      if (!currentUser) {
        setCheckResult("Connect your data folder first.");
        return;
      }
      const { pulled, errors } = await runCaptureInboxPoll(keys, currentUser);
      if (pulled === 0 && errors === 0) {
        setCheckResult("Nothing pending.");
      } else if (errors > 0) {
        setCheckResult(`Pulled ${pulled}. ${errors} could not be imported, will retry.`);
      } else {
        setCheckResult(`Pulled ${pulled}.`);
      }
    } catch {
      setCheckResult("Could not reach the relay. Check your connection.");
    } finally {
      setChecking(false);
    }
  }, [currentUser]);

  const republishSnapshots = useCallback(async () => {
    setPublishResult(null);
    setPublishing(true);
    try {
      const keys = await loadUserCaptureKeys();
      if (!keys) {
        setPublishResult("Your identity is locked. Set up or restore your account first.");
        return;
      }
      const [today, inventory] = await Promise.all([
        publishTodayToAllDevices(keys),
        publishInventoryToAllDevices(keys),
      ]);
      const total = today.published + inventory.published;
      if (total === 0) {
        setPublishResult("No devices with a seal key — pair a fresh device to receive snapshots.");
      } else {
        setPublishResult(`Published to ${total} device${total === 1 ? "" : "s"}.`);
      }
    } catch {
      setPublishResult("Could not publish snapshots. Check your connection.");
    } finally {
      setPublishing(false);
    }
  }, []);

  // ── Identity locked gate ───────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="flex gap-3 items-start rounded-xl border border-dashed border-border bg-surface-sunken p-4 text-body text-foreground-muted leading-relaxed">
        <Icon name="lock" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>
          Your account keypair is what authorizes a phone. It now stays unlocked across refreshes. If it
          ever locks, you will see &ldquo;Unlock with your recovery code or passkey&rdquo; right here instead of
          the pair button.
        </span>
      </div>
    );
  }

  // ── Pairing state (QR shown) ───────────────────────────────────────────────

  if (grant) {
    return (
      <div className="space-y-4">
        <div className="scard-head flex items-center gap-3">
          <BotTile />
          <div>
            <h3 className="text-title font-semibold text-foreground">Pair a phone</h3>
            <p className="text-meta text-foreground-muted mt-0.5">
              Open ResearchOS on your phone and scan this.
            </p>
          </div>
        </div>

        <div className="flex gap-5 items-center flex-wrap rounded-xl border border-border bg-surface-sunken p-4">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt="Pairing QR code"
              width={150}
              height={150}
              className="rounded-lg bg-white p-2 flex-shrink-0"
            />
          ) : (
            <div className="w-[150px] h-[150px] animate-pulse rounded-lg bg-surface flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-body font-semibold text-foreground">Scan with the companion app</p>
            <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
              On your phone, open ResearchOS, tap Pair, and point the camera here.
            </p>
            <div className="flex items-center gap-2 text-meta text-foreground-muted mt-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse flex-shrink-0" />
              Waiting for your phone &middot; expires in {formatCountdown(countdown)}
            </div>
            <button
              type="button"
              onClick={cancelPairing}
              className="mt-3 px-3 py-1.5 text-meta border border-border rounded-lg text-foreground hover:bg-surface-sunken"
            >
              Cancel
            </button>
          </div>
        </div>

        {error && (
          <p className="text-meta text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  // ── Paired state ───────────────────────────────────────────────────────────

  const hasPairedDevices = devices !== null && devices.length > 0;

  if (hasPairedDevices) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <BotTile />
          <div>
            <h3 className="text-title font-semibold text-foreground">ResearchOS Companion</h3>
            <p className="text-meta text-foreground-muted mt-0.5">
              {devices.length} {devices.length === 1 ? "phone" : "phones"} paired.
            </p>
          </div>
        </div>

        {paired && (
          <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-body text-foreground">
            Phone paired. It can now send photos to your inbox.
          </div>
        )}

        {error && (
          <p className="text-meta text-red-600 dark:text-red-400">{error}</p>
        )}

        <div>
          <p className="text-meta font-bold text-foreground-muted uppercase tracking-wide mb-2">
            Paired phones
          </p>
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.devicePubkey}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3"
              >
                <span className="w-8 h-8 rounded-lg bg-surface-sunken flex items-center justify-center text-foreground-muted flex-shrink-0">
                  <Icon name="phone" className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-body font-semibold text-foreground truncate">
                    {d.label ?? "Phone"}
                  </p>
                  <p className="text-meta text-foreground-muted mt-0.5">
                    Paired {formatBoundAt(d.boundAt)} &middot; last active {formatRelative(d.boundAt)}
                  </p>
                </div>
                {/* Active/Idle pill: treat devices bound within the last 30m as Active */}
                {d.boundAt && Date.now() - new Date(d.boundAt).getTime() < 30 * 60 * 1000 ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                    Active
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-foreground-muted">
                    Idle
                  </span>
                )}
                <Tooltip label="Unpair this device">
                  <button
                    type="button"
                    onClick={() => void unpair(d.devicePubkey)}
                    className="px-3 py-1.5 text-meta border rounded-lg text-red-600 dark:text-red-400 border-red-300/60 dark:border-red-700/50 hover:bg-red-50 dark:hover:bg-red-900/20 whitespace-nowrap"
                  >
                    Unpair
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void startPairing()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-body border border-border rounded-lg text-foreground hover:bg-surface-sunken disabled:opacity-50"
          >
            <Icon name="plus" className="w-3.5 h-3.5" />
            Pair another phone
          </button>
          <span className="flex items-center gap-1.5 text-meta text-foreground-muted">
            <Icon name="refresh" className="w-[13px] h-[13px] flex-shrink-0" />
            Auto-syncing &middot; captures land in your inbox on their own
          </span>
        </div>

        <details className="group">
          <summary className="cursor-pointer text-meta text-foreground-muted select-none list-none flex items-center gap-1">
            <Icon name="chevronRight" className="w-3 h-3 transition-transform group-open:rotate-90" />
            Advanced
          </summary>
          <div className="mt-3 flex flex-wrap gap-2 items-start">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void checkForCaptures()}
                disabled={checking}
                className="px-3 py-2 text-body border border-border rounded-lg text-foreground hover:bg-surface-sunken disabled:opacity-50"
              >
                {checking ? "Checking..." : "Check for new captures now"}
              </button>
              {checkResult && (
                <p className="text-meta text-foreground-muted">{checkResult}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void republishSnapshots()}
                disabled={publishing}
                className="px-3 py-2 text-body border border-border rounded-lg text-foreground hover:bg-surface-sunken disabled:opacity-50"
              >
                {publishing ? "Publishing..." : "Re-publish snapshots"}
              </button>
              {publishResult && (
                <p className="text-meta text-foreground-muted">{publishResult}</p>
              )}
            </div>
          </div>
        </details>
      </div>
    );
  }

  // ── Not-paired state (default CTA) ────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BotTile />
        <div>
          <h3 className="text-title font-semibold text-foreground">ResearchOS Companion</h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            Pair your phone to capture at the bench and glance at today.
          </p>
        </div>
      </div>

      <p className="text-body text-foreground-muted leading-relaxed">
        Snap bench photos, jot quick notes, scan to reorder, and see today&apos;s tasks, all synced to your
        folder through an encrypted relay that only ever holds data in transit. Your phone is authorized
        with your identity key.
      </p>

      <div className="flex flex-wrap gap-2">
        {FEATURE_CHIPS.map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center gap-1.5 text-[11.5px] border border-border rounded-full px-2.5 py-1 text-foreground-muted bg-surface-sunken"
          >
            {chip.icon}
            {chip.label}
          </span>
        ))}
      </div>

      {paired && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-body text-foreground">
          Phone paired. It can now send photos to your inbox.
        </div>
      )}

      {error && (
        <p className="text-meta text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          type="button"
          onClick={() => void startPairing()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-body font-semibold text-white rounded-xl disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#1AA0E6,#5B47D6)" }}
        >
          <Icon name="phone" className="w-4 h-4" />
          Pair a phone
        </button>
        {/* TODO: link to the companion app store listing once published */}
        <button
          type="button"
          disabled
          className="px-3 py-2 text-body border border-border rounded-lg text-foreground opacity-60 cursor-not-allowed"
        >
          Get the app
        </button>
      </div>
    </div>
  );
}
