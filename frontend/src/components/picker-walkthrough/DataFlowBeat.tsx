"use client";

import DataFlowExplainer from "@/components/data-flow/DataFlowExplainer";

/**
 * Walkthrough Beat 3: the animated data-flow explainer.
 *
 * This beat hands the screen to the reusable DataFlowExplainer, a clickable
 * four-step (Local / Share / Collab / Cost) that shows the laptop holding
 * the folder with only a thin stream to the cloud for specific actions. It
 * is the visual heart of the walkthrough and the one place a user really
 * sees "local-first, optional and selective cloud" instead of reading it.
 *
 * The beat itself is thin: a one-line framing, the explainer, and the Next
 * button. The explainer owns its own honesty-vetted copy and motion.
 *
 * No em-dashes, no mid-sentence colons, no emojis.
 */
export interface DataFlowBeatProps {
  onNext: () => void;
}

export default function DataFlowBeat({ onNext }: DataFlowBeatProps) {
  return (
    <div data-testid="picker-walkthrough-beat-data-flow">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">
        Local by default, cloud only when you ask.
      </h2>
      <p className="mb-4 text-title leading-relaxed text-slate-700">
        Almost everything you do never leaves your laptop. The cloud is a thin
        stream you open only for three things. Send something to another
        researcher, co-edit live with your lab, or ask the AI a question. The
        rest stays home. Click through the four steps.
      </p>

      <DataFlowExplainer testId="picker-walkthrough-data-flow-explainer" />

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center rounded-lg bg-sky-500 px-5 py-2.5 text-body font-semibold text-white shadow-sm transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          data-testid="picker-walkthrough-data-flow-next"
        >
          Makes sense, next
        </button>
      </div>
    </div>
  );
}
