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

  // Cheap pairing check on mount: load keys, list devices. If the identity is
  // locked (keys null) or no phone is paired, the button is disabled with a
  // reason. Best-effort, never throws into the popup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = await loadUserCaptureKeys();
        if (!keys) {
          if (!cancelled) setHasDevice(false);
          return;
        }
        const devices = await listDevices(keys);
        if (!cancelled) setHasDevice(devices.length > 0);
      } catch {
        if (!cancelled) setHasDevice(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onClick = useCallback(async () => {
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

  // Hide entirely until the pairing check resolves AND a device exists. A
  // researcher with no paired phone never sees a button that cannot do anything.
  if (hasDevice !== true) return null;

  const label =
    state === "publishing"
      ? "Sending..."
      : state === "sent"
        ? "Sent to phone"
        : state === "no-device"
          ? "No phone paired"
          : state === "error"
            ? "Could not send"
            : "View method on phone";

  return (
    <Tooltip label="Open this experiment's method on your paired phone to follow it at the bench">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "publishing"}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-meta font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-brand-action/10 hover:bg-blue-100 dark:hover:bg-brand-action/20 transition-colors disabled:opacity-60"
      >
        {/* Phone glyph from the verified icon registry (icon-guard requires
            <Icon>, never a raw inline svg, for new product UI). */}
        <Icon name="phone" className="w-3.5 h-3.5" />
        {label}
      </button>
    </Tooltip>
  );
}
