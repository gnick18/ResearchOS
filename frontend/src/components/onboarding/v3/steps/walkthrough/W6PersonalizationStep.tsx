import { useEffect, useState } from "react";
import { patchUserSettings, readUserSettings } from "@/lib/settings/user-settings";
import { ANIMATION_METADATA, type AnimationType } from "@/components/animations";
import DynamicAnimation from "@/components/DynamicAnimation";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import {
  appendArtifact,
  encodeSettingsChangeId,
} from "./lib/wizard-artifacts";

/**
 * W6: Personalize the look (universal walkthrough).
 *
 * The brief says "tour Settings: animations toggle, accent color
 * picker, theme. BeakerBot demos changing the accent color live." The
 * app's existing personalization knobs (in `settings.json`) are user
 * `color` (the gradient that flows into avatars + the header tint when
 * `coloredHeader` is on) and `animationType`. There's no separate
 * "accent color" or "theme" knob to point at; the brief's terminology
 * maps onto these two. Honoring the L7 lock (no fake fixture data,
 * no Settings-page redesign), we expose the two real knobs INSIDE the
 * wizard step and persist via `patchUserSettings` directly, so the
 * user's chrome shifts in real time without us touching the Settings
 * page surface.
 *
 * The previous color / animation values are captured before the first
 * mutation; we log them on each change via the wizard_artifacts
 * `encodeSettingsChangeId` helper (which encodes "<from>→<to>" into
 * the artifact id since the v4 sidecar's WizardArtifact shape doesn't
 * carry a `from / to` pair).
 */

interface W6Props {
  username: string;
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const COLOR_SWATCHES = [
  "#3b82f6", // sky-blue (default)
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // rose
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

export default function W6PersonalizationStep({
  username,
  sidecar: _sidecar,
  setNextDisabled,
  patchSidecar,
}: W6Props) {
  const [color, setColor] = useState<string | null>(null);
  const [animation, setAnimation] = useState<AnimationType | null>(null);
  const [originalColor, setOriginalColor] = useState<string | null>(null);
  const [originalAnimation, setOriginalAnimation] =
    useState<AnimationType | null>(null);
  const [loading, setLoading] = useState(true);
  // Preview-fire state: when the user clicks an animation theme tile, fire
  // the actual animation at the click point so they SEE what they're
  // picking rather than just an emoji. `key` increments per click so React
  // remounts DynamicAnimation even if the same type is clicked twice.
  const [preview, setPreview] = useState<{
    type: AnimationType;
    x: number;
    y: number;
    key: number;
  } | null>(null);

  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await readUserSettings(username);
        if (cancelled) return;
        setColor(settings.color);
        setAnimation(settings.animationType);
        setOriginalColor(settings.color);
        setOriginalAnimation(settings.animationType);
      } catch (err) {
        console.warn("[onboarding-v3] W6 settings read failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  const handleColor = async (next: string) => {
    if (!originalColor || next === color) return;
    setColor(next);
    try {
      await patchUserSettings(username, { color: next });
      // Only log against the ORIGINAL value so cycling through swatches
      // collapses into a single artifact for Phase 4 cleanup.
      void patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "settings_change",
          id: encodeSettingsChangeId("color", originalColor, next),
          cleanup_default: "keep",
        }),
      );
    } catch (err) {
      console.warn("[onboarding-v3] W6 color save failed", err);
      setColor(color);
    }
  };

  const handleAnimation = async (
    next: AnimationType,
    clickEvent: React.MouseEvent<HTMLButtonElement>,
  ) => {
    // Fire the actual animation as a preview at the click point so the
    // user SEES what they're picking. Even when clicking the same type
    // twice the key increments so DynamicAnimation remounts and replays.
    const rect = clickEvent.currentTarget.getBoundingClientRect();
    setPreview({
      type: next,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      key: (preview?.key ?? 0) + 1,
    });
    if (!originalAnimation || next === animation) return;
    setAnimation(next);
    try {
      await patchUserSettings(username, { animationType: next });
      void patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "settings_change",
          id: encodeSettingsChangeId(
            "animationType",
            originalAnimation,
            next,
          ),
          cleanup_default: "keep",
        }),
      );
    } catch (err) {
      console.warn("[onboarding-v3] W6 animation save failed", err);
      setAnimation(animation);
    }
  };

  return (
    <div data-step-id="W6" className="space-y-4">
      <SpeechBubble>
        Make this place feel like yours. Pick a color you actually like, and
        an animation theme for the little celebration that fires when you
        finish an experiment. You can change either of these later in
        Settings.
      </SpeechBubble>

      {loading ? (
        <p className="text-sm text-gray-500">Loading your current settings...</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-700">
              Color
            </label>
            <div className="flex flex-wrap gap-2" data-w6-color-grid>
              {COLOR_SWATCHES.map((c) => {
                const selected = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void handleColor(c)}
                    aria-label={`Pick ${c}`}
                    aria-pressed={selected}
                    className={`w-9 h-9 rounded-full border-2 transition-all ${
                      selected
                        ? "border-gray-900 scale-110 shadow"
                        : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
            </div>
            <p className="text-xs text-gray-500">
              Your avatar and the header tint shift to match. Toggle the
              header-tint in Settings later if you&apos;d rather keep the top
              bar white.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-700">
              Animation theme
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ANIMATION_METADATA) as AnimationType[]).map((k) => {
                const meta = ANIMATION_METADATA[k];
                const selected = animation === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={(e) => void handleAnimation(k, e)}
                    aria-pressed={selected}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left text-xs transition-colors ${
                      selected
                        ? "border-sky-300 bg-sky-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span className="text-base" aria-hidden>
                      {meta.icon}
                    </span>
                    <span className="font-medium text-gray-800">
                      {meta.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {preview && (
        <DynamicAnimation
          key={preview.key}
          type={preview.type}
          x={preview.x}
          y={preview.y}
          onComplete={() => setPreview(null)}
        />
      )}
    </div>
  );
}
