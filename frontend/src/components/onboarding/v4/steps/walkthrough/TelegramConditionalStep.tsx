"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TelegramPairingModal from "@/components/TelegramPairingModal";
import { fileService } from "@/lib/file-system/file-service";
import { imageEvents } from "@/lib/attachments/image-events";
import { readPairing, type TelegramPairing } from "@/lib/telegram/telegram-store";
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import type { ImageSidecar } from "@/lib/attachments/image-folder";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";
import { appendArtifact } from "./lib/artifacts";

/**
 * §6.13 Telegram (conditional Q5 = yes), with branching.
 *
 * Per the proposal §6.13: BeakerBot asks whether the user has Telegram
 * installed on their phone. Three branches:
 *
 *   A. Yes + want to set up now:
 *       Open the pairing modal inline. After pair success, BeakerBot
 *       says "send me a photo from Telegram now" and waits for the
 *       photo to land in the inbox via the existing telegram-store
 *       polling. The cursor primitives handed in by the proposal would
 *       drag the image into the experiment's notes editor; until P5
 *       wires the editor target a `data-tour-target` shape, the step
 *       confirms the photo landed and advances.
 *
 *   B. Yes + later:
 *       Speech "No problem, I'll let you set it up later. Skipping for
 *       now." The step records no artifact and advances.
 *
 *   C. No Telegram on phone (synthetic):
 *       BeakerBot says "let me show you what it WOULD look like" and
 *       injects a synthetic image into the inbox programmatically. The
 *       synthetic image is the parallel-asset PNG referenced in §7
 *       (`public/onboarding/beakerbot-telegram-silly.png`, ~100-200px;
 *       a different funny BeakerBot pose than the §6.7 selfie). Phase
 *       4 cleanup gets a `telegram_image` artifact with
 *       cleanup_default: "discard" per §6.13. (Type renamed from
 *       `telegram_synthetic_image` to `telegram_image` per the v4
 *       Phase 4 cleanup-completeness sweep 2026-05-21 so it matches
 *       the Phase 4 grid + cleanup-execution.ts routing.)
 *
 * **Asset gap (FLAGGED):** `public/onboarding/beakerbot-telegram-silly.png`
 * doesn't exist yet. P6 wires the step to expect it at that path; the
 * runtime fetch + Blob conversion happens at Branch C entry. If the
 * asset is missing at runtime, the step falls back to an inline SVG
 * (matching v3's W12 synthetic-image fallback) so the demo flow
 * doesn't block on a missing PNG. Master should schedule the asset
 * commit as a parallel chip.
 *
 * **Speech copy rule (Grant standing):** NO EM-DASHES. The speech
 * uses commas, colons, period splits.
 *
 * Classification (per Grant's design correction 2026-05-21): MIXED.
 * Branch A (yes-now) is USER ACTION: the user picks the branch, the
 * user pairs through the modal, the user sends a real photo from
 * their phone. No cursor performs any of these on the user's behalf.
 * Branches B (yes-later) and C (synthetic) are BEAKERBOT DEMO: the
 * synthetic photo inject is BeakerBot-led ("let me show you what it
 * WOULD look like"). No cursorScript is wired into this step body at
 * all (the inline React component drives the flow), so there's nothing
 * to strip; the classification is documented for future maintainers.
 */

// ---------------------------------------------------------------------------
// Artifact tags + on-disk paths
// ---------------------------------------------------------------------------

/** Branch C synthetic-image filename. Distinct from W12's
 *  `onboarding-sample-telegram.svg` so Phase 4 can route v3 vs v4
 *  artifacts to the right cleanup handler. */
const SYNTHETIC_FILENAME = "v4-onboarding-telegram-silly.png";

/** Public asset path the step fetches at Branch C entry. Asset itself
 *  is committed by a parallel chip per the brief (see top-of-file
 *  "Asset gap" note). */
const SYNTHETIC_ASSET_URL = "/onboarding/beakerbot-telegram-silly.png";

/** SVG fallback rendered when the PNG asset isn't on disk yet. Matches
 *  the v3 W12 SVG pattern but tagged for v4 so Phase 4 can tell them
 *  apart. */
const SYNTHETIC_FALLBACK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" width="240" height="160">
  <rect width="240" height="160" rx="14" fill="#38bdf8" />
  <text x="50%" y="46%" font-family="Helvetica, Arial, sans-serif" font-size="20"
        font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
    BeakerBot silly pose
  </text>
  <text x="50%" y="64%" font-family="Helvetica, Arial, sans-serif" font-size="12"
        fill="#e0f2fe" text-anchor="middle" dominant-baseline="middle">
    (asset pending, v4 fallback)
  </text>
</svg>`;

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

/** Try to fetch the parallel-asset PNG and write it into the user's
 *  inbox. Falls back to the embedded SVG when the PNG 404s (the asset
 *  hasn't been committed yet) so the demo flow keeps moving. Records
 *  which form actually landed so the artifact id can carry that
 *  signal. */
async function injectSyntheticImage(
  username: string,
): Promise<{ landed: "png" | "svg-fallback" }> {
  const base = inboxBase(username);
  // PNG first.
  try {
    const res = await fetch(SYNTHETIC_ASSET_URL);
    if (res.ok) {
      const blob = await res.blob();
      const imagePath = `${base}/Images/${SYNTHETIC_FILENAME}`;
      await fileService.writeFileFromBlob(imagePath, blob);
      const sidecar: ImageSidecar = {
        source: "telegram",
        receivedAt: new Date().toISOString(),
        tutorial_test: true,
        caption: "BeakerBot tour: synthetic Telegram photo",
      };
      await fileService.writeJson(
        `${base}/Images/${SYNTHETIC_FILENAME}.json`,
        sidecar,
      );
      imageEvents.emitAttached({
        basePath: base,
        relativePath: `Images/${SYNTHETIC_FILENAME}`,
      });
      return { landed: "png" };
    }
  } catch (err) {
    console.warn(
      "[onboarding-v4] Telegram synthetic PNG fetch failed, falling back to SVG:",
      err,
    );
  }
  // SVG fallback.
  const svgFilename = SYNTHETIC_FILENAME.replace(/\.png$/, ".svg");
  const imagePath = `${base}/Images/${svgFilename}`;
  const blob = new Blob([SYNTHETIC_FALLBACK_SVG], { type: "image/svg+xml" });
  await fileService.writeFileFromBlob(imagePath, blob);
  const sidecar: ImageSidecar = {
    source: "telegram",
    receivedAt: new Date().toISOString(),
    tutorial_test: true,
    caption: "BeakerBot tour: synthetic Telegram photo (SVG fallback)",
  };
  await fileService.writeJson(
    `${base}/Images/${svgFilename}.json`,
    sidecar,
  );
  imageEvents.emitAttached({
    basePath: base,
    relativePath: `Images/${svgFilename}`,
  });
  return { landed: "svg-fallback" };
}

// ---------------------------------------------------------------------------
// Inner React component rendered inside the speech bubble
// ---------------------------------------------------------------------------

type Branch = "ask" | "yes-now" | "yes-later" | "synthetic";

/**
 * Renders the branched Telegram flow inside BeakerBot's speech bubble.
 *
 * State machine:
 *   ask        → user picks Yes-now / Yes-later / No
 *   yes-now    → pairing modal inline; on pair success → polling +
 *                advance once the photo lands
 *   yes-later  → 1.5s grace then advance (gives the speech time to land)
 *   synthetic  → inject + show + advance
 */
function TelegramBranchPicker() {
  const { currentUser } = useCurrentUser();
  const { advance, noteEventFired } = useTourController();
  const username = currentUser ?? "";

  const [branch, setBranch] = useState<Branch>("ask");
  const [paired, setPaired] = useState(false);
  const [photoLanded, setPhotoLanded] = useState(false);
  const [syntheticLanded, setSyntheticLanded] = useState<
    null | "png" | "svg-fallback"
  >(null);
  const [syntheticError, setSyntheticError] = useState<string | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };
  }, []);

  // Probe an existing pairing once. The user may have wired Telegram
  // via Settings earlier in the session. We don't force the modal in
  // that case; we just say "you're paired, send me a photo now."
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    void (async () => {
      try {
        const existing = await readPairing(username);
        if (!cancelled && existing) setPaired(true);
      } catch (err) {
        console.warn(
          "[onboarding-v4] Telegram pairing probe failed:",
          err,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Branch A: photo polling. Listen for inbox image-attached events;
  // any photo arrival counts (matches v3's W12 trust model: the user
  // controls what they send). The tour advances on first photo.
  useEffect(() => {
    if (branch !== "yes-now" || !paired) return;
    const unsubscribe = imageEvents.onAttached(() => {
      setPhotoLanded(true);
      noteEventFired();
      // Give the user a beat to see the photo land, then advance.
      advanceTimerRef.current = setTimeout(() => advance(), 1500);
    });
    return () => unsubscribe();
  }, [branch, paired, advance, noteEventFired]);

  const persistArtifact = useCallback(
    async (artifactType: string, artifactId: string, isLater: boolean) => {
      if (!username) return;
      try {
        await patchOnboarding(username, (cur) =>
          appendArtifact(cur, {
            type: artifactType,
            id: artifactId,
            // §6.13 fate: both telegram_link + telegram_image are
            // cleanup_default: "discard" per spec. The Branch B path
            // has no artifact at all. (Type strings reconciled with
            // Phase4CleanupStep + cleanup-execution.ts per the v4
            // Phase 4 cleanup-completeness sweep 2026-05-21.)
            cleanup_default: isLater ? "keep" : "discard",
          }),
        );
      } catch (err) {
        console.error(
          "[onboarding-v4] Telegram artifact persist failed:",
          err,
        );
      }
    },
    [username],
  );

  const handleBranchSelect = useCallback(
    (next: Branch) => {
      setBranch(next);
      if (next === "yes-later") {
        // Branch B: 1.5s grace then advance. No artifact recorded;
        // the user explicitly opted to defer.
        advanceTimerRef.current = setTimeout(() => {
          noteEventFired();
          advance();
        }, 1500);
      } else if (next === "synthetic") {
        // Branch C: inject the synthetic image then advance after a
        // beat so the user can see the inbox light up.
        void (async () => {
          try {
            const { landed } = await injectSyntheticImage(username);
            setSyntheticLanded(landed);
            // Encode as `<filename>:inbox` so cleanup-execution.ts's
            // `telegram_image` case (which decodes via
            // decodeTelegramImageLocation) finds the file in
            // `users/<u>/inbox/Images/<filename>`. The PNG-vs-SVG
            // distinction is captured by writing the SVG with a `.svg`
            // suffix above; the id stores the on-disk filename so the
            // cleanup delete hits the right file regardless of which
            // fallback ran.
            const onDiskFilename =
              landed === "svg-fallback"
                ? SYNTHETIC_FILENAME.replace(/\.png$/, ".svg")
                : SYNTHETIC_FILENAME;
            await persistArtifact(
              "telegram_image",
              `${onDiskFilename}:inbox`,
              false,
            );
            advanceTimerRef.current = setTimeout(() => {
              noteEventFired();
              advance();
            }, 2000);
          } catch (err) {
            console.error(
              "[onboarding-v4] Telegram synthetic inject failed:",
              err,
            );
            setSyntheticError(
              "Couldn't drop the synthetic photo into your inbox. The real Telegram bot still works, this is just the preview.",
            );
          }
        })();
      }
    },
    [advance, noteEventFired, persistArtifact, username],
  );

  const handlePairingClose = useCallback(
    (updated: TelegramPairing | null | undefined) => {
      if (updated) {
        setPaired(true);
        void persistArtifact("telegram_link", "paired", false);
      }
    },
    [persistArtifact],
  );

  // Speech content per branch. Splits on commas / colons / periods.
  // no em-dashes anywhere (Grant standing rule).
  if (branch === "ask") {
    return (
      <div className="space-y-3" data-testid="telegram-branch-ask">
        <p>
          I see you wanted the Telegram bot. Quick question first: do you
          have Telegram installed on your phone right now?
        </p>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => handleBranchSelect("yes-now")}
            className="text-left text-xs px-3 py-1.5 rounded-md border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-800"
            data-testid="telegram-branch-yes-now"
          >
            Yes, let&apos;s set it up now
          </button>
          <button
            type="button"
            onClick={() => handleBranchSelect("yes-later")}
            className="text-left text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
            data-testid="telegram-branch-yes-later"
          >
            Yes, but I&apos;ll set it up later
          </button>
          <button
            type="button"
            onClick={() => handleBranchSelect("synthetic")}
            className="text-left text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
            data-testid="telegram-branch-synthetic"
          >
            No Telegram on my phone
          </button>
        </div>
      </div>
    );
  }

  if (branch === "yes-later") {
    return (
      <div className="space-y-2" data-testid="telegram-branch-later-body">
        <p>
          No problem, I&apos;ll let you set it up later. Skipping for now.
        </p>
      </div>
    );
  }

  if (branch === "synthetic") {
    return (
      <div className="space-y-2" data-testid="telegram-branch-synthetic-body">
        <p>
          No problem, let me show you what it WOULD look like. I&apos;ll
          drop a synthetic photo into your inbox, walk you through the
          caption and metadata flow, then drag it into your experiment&apos;s
          notes.
        </p>
        {syntheticError ? (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
            {syntheticError}
          </p>
        ) : syntheticLanded ? (
          <p className="text-xs text-emerald-700">
            Synthetic photo landed in your inbox{" "}
            {syntheticLanded === "svg-fallback"
              ? "(SVG fallback, PNG asset pending)"
              : ""}
            . Watch BeakerBot file it into your experiment.
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            Dropping the synthetic photo into your inbox...
          </p>
        )}
      </div>
    );
  }

  // Branch A: yes-now
  return (
    <div className="space-y-2" data-testid="telegram-branch-now-body">
      {!paired ? (
        <>
          <p>
            Great. Pair the bot below, then send me any photo from
            Telegram. I&apos;ll file it straight into your inbox.
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <TelegramPairingModal
              username={username}
              onClose={handlePairingClose}
              inline
            />
          </div>
        </>
      ) : !photoLanded ? (
        <>
          <p>
            Paired. Now send me a photo from Telegram, anything works.
            I&apos;ll catch it in your inbox.
          </p>
          <p className="text-xs text-gray-500">
            Waiting for your photo to land...
          </p>
        </>
      ) : (
        <p className="text-xs text-emerald-700">
          Got it. Filing the photo into your experiment&apos;s notes now.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step body export
// ---------------------------------------------------------------------------

/**
 * §6.13 conditional walkthrough step. Speech ReactNode is the branch
 * picker, completion is event-driven (the inner component calls
 * `noteEventFired()` once a branch lands its terminal state).
 *
 * Conditional gate (telegram === "yes") is already enforced by
 * step-machine.ts `isStepGatedOut`. The body's `conditionalOn`
 * mirrors that predicate so the registry stays self-describing.
 */
export const telegramConditionalStep: TourStep = {
  id: "telegram",
  pose: "thinking",
  // Speech is a render-time component so it can use hooks + drive
  // the controller imperatively from inside the bubble. The bubble's
  // own "Got it, next" button is suppressed via `event` completion.
  speech: () => <TelegramBranchPicker />,
  completion: {
    type: "event",
    // The inner component drives advance via noteEventFired() + advance()
    // directly from a hook. The event-listener contract is a no-op
    // subscription; the inner UI doesn't need an external bus.
    eventListener: () => () => {},
  },
  // Gentle-redirect target: when paired, point at the inbox tab so a
  // wrong-target click can be re-routed there. The inbox-tab selector
  // is the same product-surface marker InboxPanel uses; if it isn't
  // present on the current route, TourSpotlight silently no-ops.
  targetSelector: "[data-testid='inbox-tab']",
  conditionalOn: (picks) => picks?.telegram === "yes",
};

// Re-export the synthetic-image path constants so P8 (cleanup grid) +
// any future Telegram-tour follow-up can match artifacts without
// re-deriving the encoding.
export {
  SYNTHETIC_FILENAME,
  SYNTHETIC_ASSET_URL,
  injectSyntheticImage,
};
