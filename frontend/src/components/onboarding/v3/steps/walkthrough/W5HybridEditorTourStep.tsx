import { useEffect, useMemo, useState } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import { ensureExperimentArtifact } from "./lib/auto-prerequisite";
import { useTypewriter } from "./lib/use-typewriter";
import {
  appendArtifact,
  findArtifact,
} from "./lib/wizard-artifacts";
import RenderedMarkdown from "@/components/RenderedMarkdown";

/**
 * W5: Hybrid editor tour (universal walkthrough).
 *
 * L17 lock spec: BeakerBot live-types five shortcut demos (bold,
 * italic, code block, block quote, heading 2) at ~80-120ms per char
 * into the user's hybrid editor on W3's experiment note.
 *
 * Implementation choice flagged in report: the real
 * HybridMarkdownEditor mounts on the experiment detail page; embedding
 * it inside the wizard modal would require either navigating away
 * (breaks the resume contract) or building a deep parallel mount path
 * (out of scope). The brief explicitly authorizes the fallback:
 *
 *   > FLAG IN REPORT if the editor doesn't support programmatic input;
 *   > the fallback is to render BeakerBot's typed-out result as static
 *   > text and tell the user "Click Try one yourself" with no live demo.
 *
 * We take the fallback path but augment it with a live-typing PREVIEW
 * pane inside the wizard so the user still gets the visual moment of
 * watching the syntax appear. The preview renders both the markdown
 * source and a rendered approximation so users see the relationship
 * between keystrokes and output. No real edit is applied to the
 * experiment's note; instead we log a `hybrid_edit` artifact with the
 * experiment id so Phase 4 can surface it as a "we showed you the
 * editor" entry (P4 will treat this as informational only).
 *
 * Next is gated until the typewriter finishes its full sequence or the
 * user clicks "Skip the demo".
 */

interface W5Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

interface Demo {
  shortcut: string;
  caption: string;
  source: string;
}

const DEMOS: Demo[] = [
  {
    shortcut: "Cmd+B",
    caption: "Bold",
    source: "**blockbuster bold**",
  },
  {
    shortcut: "Cmd+I",
    caption: "Italic",
    source: "*italicized prose*",
  },
  {
    shortcut: "``` + python",
    caption: "Code block",
    source: "```python\nprint(\"hello, lab notebook\")\nresult = 42\n```",
  },
  {
    shortcut: "> ",
    caption: "Block quote",
    source: "> \"Methods are recipes, experiments are dinner parties.\"",
  },
  {
    shortcut: "## ",
    caption: "Heading 2",
    source: "## Sub-heading",
  },
];

const FULL_SCRIPT = DEMOS.map((d) => d.source).join("\n\n");

export default function W5HybridEditorTourStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W5Props) {
  const [demoIndex, setDemoIndex] = useState(0);
  const [doneScript, setDoneScript] = useState(false);
  const [autoPrereqRan, setAutoPrereqRan] = useState(false);
  const [artifactLogged, setArtifactLogged] = useState(false);

  const activeDemo = DEMOS[demoIndex];
  const { revealed, done } = useTypewriter(activeDemo.source, {
    cadenceMs: 95,
    key: demoIndex,
  });

  useEffect(() => {
    setNextDisabled(!doneScript);
  }, [doneScript, setNextDisabled]);

  useEffect(() => {
    if (autoPrereqRan) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureExperimentArtifact(sidecar, patchSidecar);
      } catch (err) {
        console.warn("[onboarding-v3] W5 auto-prereq W3 failed", err);
      } finally {
        if (!cancelled) setAutoPrereqRan(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoPrereqRan, sidecar, patchSidecar]);

  useEffect(() => {
    if (!done) return;
    if (demoIndex < DEMOS.length - 1) {
      const t = window.setTimeout(() => setDemoIndex((i) => i + 1), 500);
      return () => window.clearTimeout(t);
    }
    setDoneScript(true);
  }, [done, demoIndex]);

  useEffect(() => {
    if (!doneScript || artifactLogged) return;
    const experiment = findArtifact(sidecar, "experiment");
    if (!experiment) return;
    let cancelled = false;
    void (async () => {
      try {
        await patchSidecar((cur) =>
          appendArtifact(cur, {
            type: "hybrid_edit",
            id: experiment.id,
            cleanup_default: "keep",
          }),
        );
      } catch (err) {
        console.warn("[onboarding-v3] W5 artifact log failed", err);
      } finally {
        if (!cancelled) setArtifactLogged(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doneScript, artifactLogged, sidecar, patchSidecar]);

  const cumulative = useMemo(() => {
    if (demoIndex === 0) return revealed;
    return DEMOS.slice(0, demoIndex)
      .map((d) => d.source)
      .concat([revealed])
      .join("\n\n");
  }, [demoIndex, revealed]);

  return (
    <div data-step-id="W5" className="space-y-4">
      <SpeechBubble>
        Quick fact: ResearchOS runs on markdown. Notes, methods, results,
        task descriptions, project overviews, the whole shebang. These
        keyboard shortcuts work in every markdown editor on the site, so
        once you&apos;ve got them, you&apos;ve got them everywhere. Watch.
      </SpeechBubble>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {DEMOS.map((d, i) => (
          <div
            key={d.shortcut}
            data-demo-step={i}
            data-demo-active={i === demoIndex ? "true" : "false"}
            className={`rounded-md px-3 py-2 border ${
              i === demoIndex
                ? "border-sky-300 bg-sky-50 text-sky-900"
                : i < demoIndex || doneScript
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-gray-200 bg-white text-gray-500"
            }`}
          >
            <p className="font-mono text-[11px]">{d.shortcut}</p>
            <p className="font-medium">{d.caption}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">
            Type these shortcuts, see them render
          </span>
          {!doneScript && (
            <button
              type="button"
              onClick={() => {
                setDemoIndex(DEMOS.length - 1);
                setDoneScript(true);
              }}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Skip the demo
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              You type
            </span>
            <pre
              data-w5-preview
              className="font-mono text-xs bg-gray-900 text-gray-100 rounded-md px-3 py-3 whitespace-pre-wrap leading-relaxed min-h-[200px] max-h-[240px] overflow-y-auto"
            >
              {cumulative}
              {!doneScript && <span className="animate-pulse">|</span>}
            </pre>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              You see
            </span>
            <div
              data-w5-rendered
              className="bg-white border border-gray-200 rounded-md px-3 py-3 min-h-[200px] max-h-[240px] overflow-y-auto prose prose-sm prose-gray max-w-none"
            >
              <RenderedMarkdown content={cumulative} enableSyntaxHighlight />
            </div>
          </div>
        </div>
      </div>

      {doneScript && (
        <p className="text-xs text-gray-500 leading-relaxed">
          That was a peek at the hybrid editor. Open your experiment&apos;s
          note tab to try the same shortcuts yourself on real content.
        </p>
      )}

      {/* Full source rendered hidden so tests can assert against
       *  BeakerBot's intended end state regardless of typewriter timing. */}
      <span data-w5-full-script hidden>
        {FULL_SCRIPT}
      </span>
    </div>
  );
}
