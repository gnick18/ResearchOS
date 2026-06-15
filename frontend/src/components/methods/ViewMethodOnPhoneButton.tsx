"use client";

// View method on phone, the laptop entry point (method-on-phone bot, 2026-06-10).
//
// An explicit button on the focused experiment's Method tab. On click it
// publishes the experiment's method as a sealed read-mode snapshot to every
// paired phone (method-snapshot.ts), so the researcher can pull the protocol up
// at the bench and follow it away from the laptop. The method itself is not
// editable on the phone, only variations are added back.
//
// The button is intentionally explicit (Grant's locked v1 decision), not
// automatic: the researcher publishes the recipe when they want it on the
// phone, which is predictable and avoids spamming the phone every time a popup
// opens. It is a no-op (disabled with a reason) when no phone is paired or the
// identity is locked.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import { listDevices } from "@/lib/mobile-relay/client";
import { publishMethodToAllDevices } from "@/lib/mobile-relay/method-snapshot";
import { useCompanionHub } from "@/lib/ui/companion-hub-store";

interface ViewMethodOnPhoneButtonProps {
  taskId: number;
  /** The experiment owner, so the snapshot reads from the right namespace. */
  taskOwner: string;
}

type PublishState = "idle" | "publishing" | "sent" | "no-device" | "error";

export default function ViewMethodOnPhoneButton({
  taskId,
  taskOwner,
}: ViewMethodOnPhoneButtonProps) {
  // Whether at least one phone is paired. Null while we check (button stays
  // mounted but disabled), so we never flash an enabled button that no-ops.
  const [hasDevice, setHasDevice] = useState<boolean | null>(null);
  const [state, setState] = useState<PublishState>("idle");
  const openCompanion = useCompanionHub((s) => s.open);

  // Cheap pairing check on mount: load keys, list devices. If the identity is
  // locked (keys null) or no phone is paired, the button is disabled with a
  // reason. Best-effort, never throws into the popup.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The identity keys load asynchronously (the unlock ceremony) and
    // listDevices is a relay round-trip, so a single check on mount can
    // transiently miss a genuinely paired phone and then hide the button
    // forever. Retry a few times until we either confirm a device or exhaust
    // attempts, so the button reliably appears once pairing is known.
    const check = async () => {
      attempts += 1;
      try {
        const keys = await loadUserCaptureKeys();
        if (keys) {
          const devices = await listDevices(keys);
          if (cancelled) return;
          if (devices.length > 0) {
            setHasDevice(true);
            return;
          }
        }
      } catch {
        // transient (identity not ready yet, relay hiccup) - fall through to retry
      }
      if (cancelled) return;
      if (attempts >= 5) {
        setHasDevice(false);
        return;
      }
      timer = setTimeout(check, 1500);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const onPublish = useCallback(async () => {
    setState("publishing");
    try {
      const keys = await loadUserCaptureKeys();
      if (!keys) {
        setState("error");
        return;
      }
      const { published } = await publishMethodToAllDevices(keys, taskId, taskOwner);
      if (published > 0) {
        setState("sent");
        // Settle back to idle so a second publish (after editing the recipe) is
        // obviously available again.
        setTimeout(() => setState("idle"), 2500);
      } else {
        setState("no-device");
        setTimeout(() => setState("idle"), 2500);
      }
    } catch (err) {
      console.error("Failed to publish method to phone:", err);
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }, [taskId, taskOwner]);

  // Never hidden now. Three states:
  //   checking  - pairing not resolved yet (neutral, disabled)
  //   connected - a phone is paired; green phone glyph, publishes on click
  //   offline   - no phone; grey button that opens the Companion popup so the
  //               user can pair in place without closing the experiment.
  const connected = hasDevice === true;

  const connectedLabel =
    state === "publishing"
      ? "Sending..."
      : state === "sent"
        ? "Sent to phone"
        : state === "no-device"
          ? "No phone paired"
          : state === "error"
            ? "Could not send"
            : "View on phone";
  const label =
    hasDevice === null
      ? "Checking phone..."
      : connected
        ? connectedLabel
        : "Connect a phone";

  return (
    <Tooltip
      label={
        connected
          ? "Open this experiment's method on your paired phone to follow it at the bench"
          : hasDevice === false
            ? "No phone connected. Click to open the Companion and pair one."
            : "Checking for a paired phone..."
      }
    >
      <button
        type="button"
        onClick={(e) => {
          if (connected) {
            void onPublish();
          } else if (hasDevice === false) {
            // Open the Companion hub at the click so the user can pair a phone
            // in place, without closing the experiment. Second entry point to
            // pairing besides the header Companion button.
            openCompanion({ x: e.clientX, y: e.clientY });
          }
        }}
        disabled={state === "publishing" || hasDevice === null}
        className={
          connected
            ? "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-meta font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-brand-action/10 hover:bg-blue-100 dark:hover:bg-brand-action/20 transition-colors disabled:opacity-60"
            : "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-meta font-medium text-foreground-muted bg-surface-sunken hover:bg-surface-raised transition-colors disabled:opacity-60"
        }
      >
        {/* Phone glyph from the verified icon registry (icon-guard requires
            <Icon>, never a raw inline svg). Green when a phone is live. */}
        <span className={connected ? "inline-flex text-green-600 dark:text-green-400" : "inline-flex"}>
          <Icon name="phone" className="w-3.5 h-3.5" />
        </span>
        {label}
      </button>
    </Tooltip>
  );
}
