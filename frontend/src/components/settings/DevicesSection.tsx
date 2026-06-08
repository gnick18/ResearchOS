"use client";

// Mobile capture relay, the Settings "Devices" pairing UI (piece B).
//
// Pair a phone to send bench photos straight to your inbox. "Pair a phone"
// mints a short-lived signed grant, renders it as a QR the phone scans, and
// polls the relay every couple seconds until the phone binds. Bound phones are
// listed below with an Unpair button. See docs/proposals/MOBILE_CAPTURE_RELAY.md.
//
// House style: Tooltip for icon buttons, no emojis, no em-dashes, no
// mid-sentence colons, dark-mode tokens (bg-surface / text-foreground /
// border-border).

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import Tooltip from "@/components/Tooltip";
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

function formatBoundAt(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

interface DevicesSectionInnerProps {
  /** True when the current user's identity is unlocked here. */
  ready: boolean;
}

/**
 * The body of the Devices section. The parent gates on whether the identity is
 * unlocked (an unlocked Ed25519 key is required to sign the grant + the device
 * reads), and renders the "set up your account" hint otherwise.
 */
export default function DevicesSection({ ready }: DevicesSectionInnerProps) {
  const { currentUser } = useCurrentUser();
  const [devices, setDevices] = useState<BoundDevice[] | null>(null);
  // Manual "Check for new captures" state, the same single-poll the background
  // CaptureInboxPoller runs, surfaced as a button so a paired user can pull on
  // demand and read the result inline.
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [grant, setGrant] = useState<PairingGrant | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [paired, setPaired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Snapshot of the device pubkeys present when pairing started, so we can
  // detect the phone binding (a NEW key appears) rather than just a non-empty
  // list.
  const baselineKeysRef = useRef<Set<string>>(new Set());

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

  // Initial + on-mount device load.
  useEffect(() => {
    if (ready) void refreshDevices();
  }, [ready, refreshDevices]);

  // Render the grant payload to a QR data URL whenever a new grant is minted.
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

  // Countdown + poll for the phone binding while a grant is live.
  useEffect(() => {
    if (!grant || paired) return;
    let cancelled = false;

    const tick = () => {
      const left = secondsUntil(grant.exp);
      setCountdown(left);
      if (left <= 0) {
        // Grant expired; clear it so the user can mint a fresh one.
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

  if (!ready) {
    return (
      <p className="text-body text-foreground-muted">
        Set up your account (the sharing identity) to pair a phone. Devices are
        authorized with your identity key.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-body text-foreground-muted">
          Pair a phone to send bench photos straight to your inbox. Scan the code
          with your phone's camera, snap a photo, and it lands here.
        </p>
        {!grant && (
          <div className="flex items-center gap-2">
            <Tooltip label="Pull any captures waiting on the relay right now">
              <button
                type="button"
                onClick={() => void checkForCaptures()}
                disabled={checking}
                className="px-3 py-2 text-body border border-border text-foreground hover:bg-surface-sunken disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                {checking ? "Checking..." : "Check for new captures"}
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={() => void startPairing()}
              disabled={busy}
              className="px-3 py-2 text-body bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg whitespace-nowrap"
            >
              Pair a phone
            </button>
          </div>
        )}
      </div>

      {checkResult && (
        <p className="text-meta text-foreground-muted">{checkResult}</p>
      )}

      {error && (
        <p className="text-meta text-red-600 dark:text-red-400">{error}</p>
      )}

      {paired && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-body text-foreground">
          Phone paired. It can now send photos to your inbox.
        </div>
      )}

      {grant && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-sunken p-5">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt="Pairing QR code"
              width={240}
              height={240}
              className="rounded-lg bg-white p-2"
            />
          ) : (
            <div className="h-[240px] w-[240px] animate-pulse rounded-lg bg-surface" />
          )}
          <p className="text-meta text-foreground-muted">
            Scan with your phone. Expires in {countdown}s.
          </p>
          <button
            type="button"
            onClick={cancelPairing}
            className="text-meta text-foreground-muted underline hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      <div>
        <h3 className="text-body font-medium text-foreground mb-2">
          Paired devices
        </h3>
        {devices === null ? (
          <p className="text-meta text-foreground-muted">Loading...</p>
        ) : devices.length === 0 ? (
          <p className="text-meta text-foreground-muted">
            No phones paired yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {devices.map((d) => (
              <li
                key={d.devicePubkey}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-body text-foreground truncate">
                    {d.label || "Phone"}
                  </p>
                  <p className="text-meta text-foreground-muted">
                    Paired {formatBoundAt(d.boundAt)}
                  </p>
                </div>
                <Tooltip label="Unpair this device">
                  <button
                    type="button"
                    onClick={() => void unpair(d.devicePubkey)}
                    className="px-3 py-1.5 text-meta border border-border rounded-lg text-foreground hover:bg-surface-sunken whitespace-nowrap"
                  >
                    Unpair
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
