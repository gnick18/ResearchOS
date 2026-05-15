"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import type { OnboardingMode } from "@/lib/onboarding/sidecar";

/**
 * One-shot welcome modal shown the first time a user opens ResearchOS
 * after the onboarding system landed. The user picks one of three
 * modes — tutorial, suggestions, or silenced — and the orchestrator
 * persists the choice to the sidecar's `mode` field. The user can
 * change her mind later from Settings → Tips.
 *
 * Visual: BeakerBot (waving) on the left, copy + three buttons stacked
 * on the right. "Show me as I go" is the visual default (filled
 * sky-500), the other two are subtle outlined buttons.
 *
 * Renders via portal so it floats above any AppShell chrome and
 * always sits dead-center over a backdrop blur.
 */

interface OnboardingWelcomeModalProps {
  /** Called when the user picks a mode. Parent (orchestrator) is
   *  responsible for persisting to the sidecar and unmounting this
   *  component. */
  onPick: (mode: Exclude<OnboardingMode, null>) => void;
}

export default function OnboardingWelcomeModal({
  onPick,
}: OnboardingWelcomeModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target is client-only; flip mounted after the first client render.
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-welcome-title"
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-lg w-[500px] mx-4 overflow-hidden">
        <div className="p-7 flex items-start gap-5">
          {/* Mascot — waving pose, ~96px on the left. */}
          <div
            aria-hidden
            className="flex-shrink-0"
            style={{ width: 96, height: 96 }}
          >
            <BeakerBot
              pose="waving"
              direction="right"
              className="w-full h-full text-sky-500"
            />
          </div>

          {/* Title + body + button stack on the right. */}
          <div className="flex-1 min-w-0">
            <h2
              id="onboarding-welcome-title"
              className="text-xl font-semibold text-gray-900"
            >
              Hi! I&apos;m here to help.
            </h2>
            <p className="mt-2 text-base text-gray-700 leading-relaxed">
              I can show you around ResearchOS as you go, or stay quiet.
              Your call.
            </p>

            <div className="mt-5 flex flex-col gap-2.5">
              {/* Tutorial — secondary outlined button. */}
              <button
                type="button"
                onClick={() => onPick("tutorial")}
                className="w-full px-4 py-2.5 text-base font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Walk me through it
              </button>

              {/* Suggestions — visual default, filled sky-500. */}
              <button
                type="button"
                onClick={() => onPick("suggestions")}
                className="w-full px-4 py-2.5 text-base font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
              >
                Show me as I go
              </button>

              {/* Silenced — quiet outlined button. */}
              <button
                type="button"
                onClick={() => onPick("silenced")}
                className="w-full px-4 py-2.5 text-base font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Stay quiet, thanks
              </button>
            </div>

            <p className="mt-4 text-xs text-gray-500">
              You can change this any time in Settings → Tips.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
