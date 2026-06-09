"use client";

// Mobile notebook integrations, Phase 1 focus-context publisher (laptop side).
//
// When an experiment popup is open, this publishes a sealed FocusContext to
// each paired phone on a ~10-second interval so the phone knows which
// experiment (and which tab) is currently visible on the laptop. The relay
// never sees plaintext; each phone's copy is sealed to its own X25519 key.
//
// When the popup closes (activeTask goes null) this publishes one final
// { kind: "none" } context so the phone knows the laptop is idle. That
// transition publish happens once; this component does NOT spam none-contexts
// every tick while nothing is open.
//
// Headless. Mounted once in the signed-in tree (providers.tsx). No-op when no
// identity is on hand (keys == null) or no devices are paired.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef } from "react";

import { useAppStore } from "@/lib/store";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import {
  listDevices,
  publishFocusContext,
  type FocusContext,
} from "@/lib/mobile-relay/client";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { bytesToHex } from "@noble/hashes/utils.js";

const PUBLISH_INTERVAL_MS = 10_000;
const LOG_PREFIX = "[focus-publisher]";

export default function FocusContextPublisher() {
  const activeTask = useAppStore((s) => s.activeTask);
  const activeTaskTab = useAppStore((s) => s.activeTaskTab);
  const activeNote = useAppStore((s) => s.activeNote);

  // Track whether the previous publish had an open context so we can send
  // exactly one { kind: "none" } transition when both popups close.
  const wasOpenRef = useRef(false);

  // A run-lock so overlapping triggers (interval + tab change) don't double-publish.
  const runningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const publish = async (ctx: FocusContext) => {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;
      try {
        const keys = await loadUserCaptureKeys();
        // No unlocked identity (needs-restore state): stay dark.
        if (!keys || cancelled) return;

        let devices;
        try {
          devices = await listDevices(keys);
        } catch (err) {
          console.warn(`${LOG_PREFIX} listDevices failed`, err instanceof Error ? err.message : String(err));
          return;
        }

        const plaintext = new TextEncoder().encode(JSON.stringify(ctx));
        let published = 0;

        for (const device of devices) {
          if (!device.x25519Pubkey) continue;
          try {
            const sealed = sealToRecipient(plaintext, decodePublicKey(device.x25519Pubkey));
            const sealedHex = bytesToHex(sealed);
            await publishFocusContext(keys, device.devicePubkey, sealedHex);
            published += 1;
          } catch (err) {
            console.warn(
              `${LOG_PREFIX} failed for device ${device.devicePubkey.slice(0, 12)}...`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }

        if (published > 0) {
          console.info(
            `${LOG_PREFIX} published ${ctx.kind} context to ${published} device(s)`,
          );
        }
      } finally {
        runningRef.current = false;
      }
    };

    // Precedence: note wins over experiment when both are open (note popup is
    // the top-most surface). The kind:"none" transition fires only when both
    // are null.
    if (activeNote !== null) {
      wasOpenRef.current = true;

      const buildCtx = (): FocusContext => ({
        kind: "note",
        noteId: activeNote.id,
        owner: activeNote.owner,
        title: activeNote.title,
        isRunningLog: activeNote.isRunningLog,
        entries: activeNote.entries,
        openEntryId: activeNote.openEntryId,
        lastEditedEntryId: activeNote.lastEditedEntryId,
        at: new Date().toISOString(),
      });

      void publish(buildCtx());
      const timer = setInterval(() => void publish(buildCtx()), PUBLISH_INTERVAL_MS);

      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    } else if (activeTask !== null) {
      // An experiment is open (no note overlay). Publish on interval and immediately.
      wasOpenRef.current = true;

      const buildCtx = (): FocusContext => ({
        kind: "experiment",
        taskId: activeTask.id,
        owner: activeTask.owner,
        name: activeTask.name,
        activeTab: activeTaskTab ?? "other",
        at: new Date().toISOString(),
      });

      // Immediate publish so the phone sees the context without waiting a full
      // interval after the popup opens.
      void publish(buildCtx());

      const timer = setInterval(() => void publish(buildCtx()), PUBLISH_INTERVAL_MS);

      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    } else {
      // Nothing is open. If we just transitioned from open -> closed,
      // send one none-context and reset the flag.
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const noneCtx: FocusContext = { kind: "none", at: new Date().toISOString() };
        void publish(noneCtx);
      }
      // No interval needed while idle.
      return () => {
        cancelled = true;
      };
    }
    // Re-run whenever the note, task, or visible task-tab changes so a tab switch
    // cancels the old interval and starts a fresh one that encodes the new state.
  }, [activeNote, activeTask, activeTaskTab]);

  return null;
}
