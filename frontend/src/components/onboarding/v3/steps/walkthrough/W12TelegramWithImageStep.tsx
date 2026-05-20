import { useEffect, useState } from "react";
import TelegramPairingModal from "@/components/TelegramPairingModal";
import { tasksApi } from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { moveImageBetweenBases } from "@/lib/attachments/move-image";
import { resolveTaskResultsBase } from "@/lib/tasks/results-paths";
import { readPairing, type TelegramPairing } from "@/lib/telegram/telegram-store";
import { imageEvents } from "@/lib/attachments/image-events";
import type { ImageSidecar } from "@/lib/attachments/image-folder";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import {
  appendArtifact,
  encodeTelegramImageId,
  findArtifact,
} from "./lib/wizard-artifacts";

/**
 * W12: Telegram pair + sample image (conditional walkthrough).
 *
 * Fires only when `feature_picks.telegram === "yes"`.
 *
 * The brief sketches two implementation paths for the image-transit
 * demo. This component takes **Path B** (mock/stub): after pairing
 * succeeds, BeakerBot writes a small sample SVG directly into
 * `users/<u>/inbox/Images/` alongside a sidecar JSON tagged with
 * `source: "telegram"` and `tutorial_test: true`. The Inbox panel
 * picks up the file on its next refresh; the `tutorial_test` flag is
 * already wired into the existing telegram tutorial-cleanup module,
 * so Phase 4 cleanup can locate and remove it later. Once the user
 * clicks "Attach to my experiment", the image moves from the inbox
 * into W3&apos;s experiment results folder via
 * `moveImageBetweenBases`, and the artifact id flips from
 * `<filename>:inbox` to `<filename>:task-<id>` to record the new
 * location.
 *
 * Path A (real-flow polling) was rejected to honor the L11 pacing lock
 * the proposal mandates — the wizard&apos;s Next button shouldn&apos;t
 * sit idle for the 10-30s it takes the real bot to deliver a photo.
 *
 * Artifacts:
 *   - `{ type: "telegram_link", id: "paired", cleanup_default: "keep" }`
 *   - `{ type: "telegram_image", id: <encoded>, cleanup_default: "keep" }`
 *
 * Next is gated until the user has paired Telegram (the image demo is
 * a bonus interaction; we don&apos;t hold them up if they want to skip
 * the attach step).
 */

interface W12Props {
  username: string;
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const SAMPLE_FILENAME = "onboarding-sample-telegram.svg";

const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" width="240" height="160">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0ea5e9" />
      <stop offset="100%" stop-color="#6366f1" />
    </linearGradient>
  </defs>
  <rect width="240" height="160" rx="14" fill="url(#g)" />
  <text x="50%" y="46%" font-family="Helvetica, Arial, sans-serif" font-size="22"
        font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
    Sample photo
  </text>
  <text x="50%" y="64%" font-family="Helvetica, Arial, sans-serif" font-size="12"
        fill="#e0f2fe" text-anchor="middle" dominant-baseline="middle">
    BeakerBot onboarding tour
  </text>
</svg>`;

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

async function injectSampleImage(username: string): Promise<void> {
  const base = inboxBase(username);
  const imagePath = `${base}/Images/${SAMPLE_FILENAME}`;
  const sidecarPathStr = `${base}/Images/${SAMPLE_FILENAME}.json`;
  const blob = new Blob([SAMPLE_SVG], { type: "image/svg+xml" });
  await fileService.writeFileFromBlob(imagePath, blob);
  const sidecar: ImageSidecar = {
    source: "telegram",
    receivedAt: new Date().toISOString(),
    tutorial_test: true,
    caption: "BeakerBot onboarding sample",
  };
  await fileService.writeJson(sidecarPathStr, sidecar);
  imageEvents.emitAttached({ basePath: base, relativePath: `Images/${SAMPLE_FILENAME}` });
}

export default function W12TelegramWithImageStep({
  username,
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W12Props) {
  const linkArtifact = findArtifact(sidecar, "telegram_link");
  const imageArtifact = findArtifact(sidecar, "telegram_image");
  const experimentArtifact = findArtifact(sidecar, "experiment");

  const [paired, setPaired] = useState<boolean>(linkArtifact !== null);
  const [pairingChecked, setPairingChecked] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState<boolean>(
    !!imageArtifact && imageArtifact.id.endsWith(`:task-${experimentArtifact?.id ?? ""}`),
  );

  // Detect an existing pairing (the user may have wired Telegram earlier
  // via Settings) so we don't double-prompt. Runs once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await readPairing(username);
        if (cancelled) return;
        if (existing) {
          setPaired(true);
          if (!linkArtifact) {
            await patchSidecar((cur) =>
              appendArtifact(cur, {
                type: "telegram_link",
                id: "paired",
                cleanup_default: "keep",
              }),
            );
          }
        }
      } catch (err) {
        console.warn("[onboarding-v3] W12 pairing probe failed", err);
      } finally {
        if (!cancelled) setPairingChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, linkArtifact, patchSidecar]);

  useEffect(() => {
    setNextDisabled(!paired);
  }, [paired, setNextDisabled]);

  // Once paired and no image artifact yet, inject the sample into the
  // user's inbox. The effect is idempotent because we gate on
  // imageArtifact, which is set the moment we record it.
  useEffect(() => {
    if (!paired || imageArtifact) return;
    let cancelled = false;
    setInjecting(true);
    setInjectError(null);
    void (async () => {
      try {
        await injectSampleImage(username);
        if (cancelled) return;
        await patchSidecar((cur) =>
          appendArtifact(cur, {
            type: "telegram_image",
            id: encodeTelegramImageId(SAMPLE_FILENAME, "inbox"),
            cleanup_default: "keep",
          }),
        );
      } catch (err) {
        console.error("[onboarding-v3] W12 image inject failed", err);
        if (!cancelled) {
          setInjectError(
            "Couldn't drop the sample image into your inbox. Real Telegram photos will still work — this is just the onboarding preview.",
          );
        }
      } finally {
        if (!cancelled) setInjecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paired, imageArtifact, username, patchSidecar]);

  // Resolve a blob URL for the preview. While the image still lives in
  // the inbox the URL points at the inbox path; after the move it
  // points at the experiment's results folder.
  useEffect(() => {
    if (!imageArtifact) {
      setImagePreviewUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const inboxPath = `${inboxBase(username)}/Images/${SAMPLE_FILENAME}`;
      let path = inboxPath;
      if (imageArtifact.id.includes(":task-") && experimentArtifact) {
        try {
          const task = await tasksApi.get(Number(experimentArtifact.id));
          if (task) {
            const taskBase = await resolveTaskResultsBase(
              { id: task.id, owner: task.owner },
              username,
            );
            path = `${taskBase}/Images/${SAMPLE_FILENAME}`;
          }
        } catch (err) {
          console.warn("[onboarding-v3] W12 resolve task base failed", err);
        }
      }
      const url = await blobUrlResolver.getBlobUrl(path);
      if (!cancelled) setImagePreviewUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [imageArtifact, experimentArtifact, username]);

  const handlePairingClose = (updated: TelegramPairing | null | undefined) => {
    setShowPairing(false);
    if (updated) {
      setPaired(true);
      void patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "telegram_link",
          id: "paired",
          cleanup_default: "keep",
        }),
      );
    } else if (updated === null) {
      // The user disconnected (rare in this flow but possible if they
      // were already paired). Don't add an artifact.
      setPaired(false);
    }
  };

  const handleAttach = async () => {
    if (!imageArtifact || !experimentArtifact || attaching || attached) return;
    setAttaching(true);
    try {
      const task = await tasksApi.get(Number(experimentArtifact.id));
      if (!task) throw new Error("Experiment not found");
      const taskBase = await resolveTaskResultsBase(
        { id: task.id, owner: task.owner },
        username,
      );
      await moveImageBetweenBases(
        inboxBase(username),
        taskBase,
        SAMPLE_FILENAME,
      );
      await patchSidecar((cur) => {
        const next = appendArtifact(cur, {
          type: "telegram_image",
          id: encodeTelegramImageId(SAMPLE_FILENAME, {
            taskId: Number(experimentArtifact.id),
          }),
          cleanup_default: "keep",
        });
        // Replace the old inbox-located telegram_image artifact with the
        // new task-located one. appendArtifact dedupes by (type,id), so
        // we manually strip the stale entry to avoid two telegram_image
        // rows in Phase 4 cleanup.
        const stripped = (next.wizard_resume_state?.artifacts_created ?? []).filter(
          (a) =>
            !(a.type === "telegram_image" &&
              a.id === encodeTelegramImageId(SAMPLE_FILENAME, "inbox")),
        );
        return {
          ...next,
          wizard_resume_state: next.wizard_resume_state
            ? { ...next.wizard_resume_state, artifacts_created: stripped }
            : next.wizard_resume_state,
        };
      });
      setAttached(true);
    } catch (err) {
      console.error("[onboarding-v3] W12 attach failed", err);
    } finally {
      setAttaching(false);
    }
  };

  return (
    <div data-step-id="W12" className="space-y-4">
      <SpeechBubble>
        Telegram is the fastest way to dump lab photos into ResearchOS.
        Pair a bot now and I&apos;ll demo the whole loop: photo in, inbox
        catches it, attach it to your experiment. One bot per user, no
        spam, you stay in control.
      </SpeechBubble>

      {!pairingChecked ? (
        <p className="text-sm text-gray-500">Checking for an existing pairing...</p>
      ) : !paired ? (
        <div className="space-y-2">
          {showPairing ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <TelegramPairingModal
                username={username}
                onClose={handlePairingClose}
                inline
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPairing(true)}
              className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
            >
              Pair Telegram now
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Telegram is paired. Photos sent to your bot will land in your
            inbox automatically.
          </div>

          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 uppercase tracking-wide">
              Sample image
            </p>
            {injecting ? (
              <p className="text-sm text-gray-500">Dropping a sample in your inbox...</p>
            ) : injectError ? (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {injectError}
              </p>
            ) : imageArtifact && imagePreviewUrl ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- blob URL of an arbitrary inbox image, matching InboxPanel's pattern; next/image can't resolve blob: URLs at build time */}
                <img
                  src={imagePreviewUrl}
                  alt="Sample Telegram image"
                  className="w-full max-w-[240px] rounded-md border border-gray-200"
                  data-w12-image
                />
                <p className="text-xs text-gray-600 leading-relaxed">
                  {attached
                    ? "Attached to your experiment. The Inbox is empty again."
                    : experimentArtifact
                      ? "Sitting in your inbox. Tap the button to file it into your experiment."
                      : "Sitting in your inbox. The Inbox tab is where you'll triage real photos."}
                </p>
                {experimentArtifact && !attached && (
                  <button
                    type="button"
                    onClick={() => void handleAttach()}
                    disabled={attaching}
                    className="w-full px-3 py-1.5 text-xs font-medium border border-sky-300 text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-md transition-colors disabled:opacity-50"
                    data-w12-attach
                  >
                    {attaching ? "Attaching..." : "Attach to my experiment"}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Preview unavailable. Open the Inbox tab to see the sample.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
