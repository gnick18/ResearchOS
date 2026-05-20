import { useCallback, useEffect, useState } from "react";
import type { FeaturePicks, OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";

/**
 * W14: AI Helper tour (conditional walkthrough).
 *
 * Fires only when `feature_picks.ai_helper` is `"full" | "medium" |
 * "minimal"` (the state machine&apos;s `isStepSkippedByGate` already
 * filters out `"no"` and `"maybe"` so we can assume one of the three
 * sizes when this step renders).
 *
 * BeakerBot fetches the user&apos;s chosen prompt from
 * `/ai-helper/<size>.md`, copies it to the clipboard with one click,
 * and offers three "Open in Claude / ChatGPT / Gemini" shortcuts that
 * mirror the Settings &gt; AI Helper section. The prompt isn&apos;t
 * persisted — the clipboard write is transient and the chosen size
 * already lives in `feature_picks.ai_helper`, so there&apos;s no
 * `WizardArtifact` to record.
 *
 * Schema-vs-filesystem mapping: the sidecar schema uses
 * `"medium"` while the prompt files are named `lean.md`. The mapping
 * lives here rather than in the schema so the user-facing copy stays
 * "Medium" everywhere.
 *
 * Next is enabled from mount; the copy action is encouraged but not
 * required (the user can grab the prompt later from Settings).
 */

interface W14Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
}

type PromptSize = "full" | "lean" | "minimal";

const PROVIDERS: ReadonlyArray<{
  key: "claude" | "chatgpt" | "gemini";
  label: string;
  url: string;
}> = [
  { key: "claude", label: "Claude", url: "https://claude.ai/new" },
  { key: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { key: "gemini", label: "Gemini", url: "https://gemini.google.com/app" },
];

function picksToPromptSize(
  picks: FeaturePicks["ai_helper"] | undefined,
): PromptSize {
  if (picks === "medium") return "lean";
  if (picks === "full" || picks === "minimal") return picks;
  // Fallback — the state machine shouldn't render us with "no" /
  // "maybe" / undefined, but if it does, default to the recommended
  // "lean" size so the copy still works.
  return "lean";
}

function sizeLabel(size: PromptSize): string {
  if (size === "full") return "Full";
  if (size === "lean") return "Medium";
  return "Minimal";
}

async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path
    }
  }
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export default function W14AiHelperStep({
  sidecar,
  setNextDisabled,
}: W14Props) {
  const picks = sidecar?.feature_picks ?? null;
  const size = picksToPromptSize(picks?.ai_helper);

  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    (async () => {
      try {
        const res = await fetch(`/ai-helper/${size}.md`, { cache: "no-store" });
        if (!res.ok) throw new Error(`prompt fetch failed (${res.status})`);
        const text = await res.text();
        if (cancelled) return;
        setPrompt(text);
      } catch (err) {
        if (cancelled) return;
        setFetchError(
          err instanceof Error
            ? err.message
            : "Couldn't load the prompt. Try again from Settings later.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [size]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((current) => (current === msg ? null : current));
    }, 4000);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!prompt) return;
    const ok = await writeToClipboard(prompt);
    if (ok) showToast(`Copied! (${sizeLabel(size)} prompt)`);
    else showToast("Couldn't access the clipboard. Try again in a moment.");
  }, [prompt, size, showToast]);

  const handleOpenIn = useCallback(
    (provider: (typeof PROVIDERS)[number]) => {
      if (!prompt) return;
      window.open(provider.url, "_blank", "noopener");
      void (async () => {
        const ok = await writeToClipboard(prompt);
        if (ok) {
          showToast(
            `Copied! Paste into ${provider.label} as your first message.`,
          );
        } else {
          showToast(
            `Opened ${provider.label}. Hit Copy and paste it as your first message.`,
          );
        }
      })();
    },
    [prompt, showToast],
  );

  return (
    <div data-step-id="W14" className="space-y-4">
      <SpeechBubble>
        You picked the {sizeLabel(size).toLowerCase()} AI Helper prompt
        earlier, so let me hand it to you. One click copies it to your
        clipboard. Paste it as the first message in Claude, ChatGPT, or
        Gemini and that chatbot suddenly knows how to talk ResearchOS.
      </SpeechBubble>

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-3">
        {loading ? (
          <p className="text-sm text-gray-500">Loading the {sizeLabel(size).toLowerCase()} prompt...</p>
        ) : fetchError ? (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {fetchError}
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!prompt}
              className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
              data-w14-copy
            >
              Copy {sizeLabel(size)} prompt to clipboard
            </button>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.key}
                  type="button"
                  onClick={() => handleOpenIn(provider)}
                  disabled={!prompt}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md transition-colors disabled:opacity-50"
                >
                  Open in {provider.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              You can grab a different size or recopy this one anytime from
              Settings &gt; AI Helper.
            </p>
          </>
        )}
        {toast && (
          <div
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
            data-w14-toast
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
