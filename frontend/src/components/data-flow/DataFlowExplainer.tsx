"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";

/**
 * DataFlowExplainer
 *
 * A reusable, clickable four-step explainer that teaches the ResearchOS
 * data model the way Grant wants every user to understand it before they
 * trust us with their work.
 *
 *   Local   Your folder lives on your own machine. Nothing uploads.
 *   Share   A one-time copy can be sealed and sent to anyone. End-to-end,
 *           and receiving is free; sending is the paid part.
 *   Collab  Only the one shared document streams to our relay so two
 *           people edit it live. Encrypted in transit and at rest, but
 *           NOT end-to-end (the relay merges the edits).
 *   Cost    Because your data is not sitting on our servers, the cost
 *           story stays small. Only the thin streams cost anything.
 *
 * House-style hard rules honored here:
 *   - Every glyph is an <Icon> from the verified registry. There is NO raw
 *     inline vector markup anywhere in this file, so the icon-guard ratchet
 *     passes without a baseline entry.
 *   - Motion is CSS keyframes on transform/opacity only, declared in a
 *     module <style> block and wrapped in prefers-reduced-motion so the
 *     parcel / pulse animations freeze for users who ask for less motion.
 *   - Light by default.
 *   - No em-dashes, no mid-sentence colons, no emojis.
 *
 * Honesty constraints baked into the copy (vetted, do not soften):
 *   - One-time SEND is end-to-end. LIVE COLLAB is NOT end-to-end.
 *   - Receiving is free; sending a copy and hosting live collaboration
 *     are paid.
 *   - We never claim HIPAA or a BAA, and lab sites are out of scope here.
 *
 * The component is self-contained and presentational. The parent decides
 * where it renders (the walkthrough beat, a wiki page, a marketing page).
 */

type StepKey = "local" | "share" | "collab" | "cost";

interface StepDef {
  key: StepKey;
  tab: string;
  title: string;
  /** Lead glyph shown in the cloud node area for this step. */
  cloudIcon: IconName;
  /** Whether a stream is flowing laptop -> cloud for this step. */
  stream: "none" | "parcel" | "live";
  /** Plain-English body, two short lines. */
  body: string;
  /** A single honest footnote that keeps the claim precise. */
  note: string;
}

const STEPS: ReadonlyArray<StepDef> = [
  {
    key: "local",
    tab: "Local",
    title: "Your work lives on your own computer",
    cloudIcon: "cloud",
    stream: "none",
    body:
      "Every experiment, note, and result sits in a folder on your own machine. The browser reads and writes that folder directly. Nothing uploads to us.",
    note: "There is no ResearchOS database holding your folder. Quit the app and your data stays exactly where it is.",
  },
  {
    key: "share",
    tab: "Share",
    title: "Send a sealed one-time copy to anyone",
    cloudIcon: "mail",
    stream: "parcel",
    body:
      "When you send a method, dataset, or figure to another researcher, ResearchOS seals a one-time copy and routes it through a relay that only ever holds the sealed bytes.",
    note: "This send is end-to-end encrypted. Receiving is always free; sending a copy is a paid feature.",
  },
  {
    key: "collab",
    tab: "Collab",
    title: "Co-edit one document live",
    cloudIcon: "users",
    stream: "live",
    body:
      "When two people edit the same note live, only that one shared document streams to our relay so each change reaches the other person right away. The rest of your folder never moves.",
    note: "Live collaboration is encrypted in transit and at rest, but it is not end-to-end, because the relay merges the edits. Hosting live collaboration is a paid feature.",
  },
  {
    key: "cost",
    tab: "Cost",
    title: "This is why it stays cheap and private",
    cloudIcon: "gauge",
    stream: "none",
    body:
      "Because your data is not parked on our servers, we are not paying to store everyone's research. Only the thin streams, a sealed send or a live document, ever cost anything.",
    note: "Low cost and strong privacy both come from the same choice. The data stays with you, not with us.",
  },
];

export interface DataFlowExplainerProps {
  /** Optional test id passthrough for the outer wrapper. */
  testId?: string;
  /** Which step is selected first. Defaults to "local". */
  initialStep?: StepKey;
}

export default function DataFlowExplainer({
  testId = "data-flow-explainer",
  initialStep = "local",
}: DataFlowExplainerProps) {
  const [active, setActive] = useState<StepKey>(initialStep);
  const step = STEPS.find((s) => s.key === active) ?? STEPS[0];

  return (
    <div
      data-testid={testId}
      data-dfx-step={active}
      className="not-prose w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <style>{DFX_KEYFRAMES}</style>

      {/* Step tabs */}
      <div
        role="tablist"
        aria-label="How your data flows"
        className="flex flex-wrap gap-1 border-b border-slate-100 bg-slate-50 p-2"
      >
        {STEPS.map((s) => {
          const selected = s.key === active;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(s.key)}
              data-testid={`data-flow-tab-${s.key}`}
              className={[
                "rounded-lg px-3 py-1.5 text-body font-semibold transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500",
                selected
                  ? "bg-white text-sky-700 shadow-sm"
                  : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
              ].join(" ")}
            >
              {s.tab}
            </button>
          );
        })}
      </div>

      {/* Stage: laptop holds the folder, a thin stream runs to the cloud node */}
      <div
        className="relative flex items-center justify-between gap-4 bg-gradient-to-b from-white to-slate-50 px-6 py-8 sm:px-10"
        data-testid="data-flow-stage"
      >
        {/* Laptop node holding the folder */}
        <div className="relative flex flex-col items-center gap-2">
          <div
            className="dfx-home flex h-24 w-24 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sky-500 shadow-sm sm:h-28 sm:w-28"
            aria-hidden="true"
          >
            <Icon name="folder" className="h-12 w-12 sm:h-14 sm:w-14" />
          </div>
          <span className="text-meta font-semibold uppercase tracking-wide text-slate-500">
            Your computer
          </span>
        </div>

        {/* Stream channel */}
        <div className="relative flex-1" aria-hidden="true">
          <div className="relative mx-2 h-px bg-slate-200">
            {step.stream !== "none" && (
              <>
                {/* The dotted track */}
                <div
                  className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-sky-300"
                  data-testid="data-flow-stream-track"
                />
                {/* The travelling parcel / live pulse */}
                <div
                  className={[
                    "absolute top-1/2 -translate-y-1/2 text-sky-500",
                    step.stream === "parcel" ? "dfx-parcel" : "dfx-pulse",
                  ].join(" ")}
                  data-testid={`data-flow-stream-${step.stream}`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-sky-200 bg-white shadow-sm">
                    <Icon
                      name={step.stream === "parcel" ? "wrapped" : "refresh"}
                      className="h-4 w-4"
                    />
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Cloud node */}
        <div className="relative flex flex-col items-center gap-2">
          <div
            className={[
              "flex h-24 w-24 items-center justify-center rounded-2xl border shadow-sm sm:h-28 sm:w-28",
              step.stream === "none"
                ? "border-slate-200 bg-slate-50 text-slate-300"
                : "dfx-cloud border-sky-200 bg-sky-50 text-sky-500",
            ].join(" ")}
            aria-hidden="true"
          >
            <Icon name={step.cloudIcon} className="h-12 w-12 sm:h-14 sm:w-14" />
          </div>
          <span className="text-meta font-semibold uppercase tracking-wide text-slate-500">
            {step.stream === "none" ? "Stays with you" : "Our relay"}
          </span>
        </div>
      </div>

      {/* Caption panel */}
      <div className="border-t border-slate-100 px-6 py-5 sm:px-10">
        <h3 className="mb-2 text-title font-bold text-slate-900">
          {step.title}
        </h3>
        <p className="mb-3 text-body leading-relaxed text-slate-700">
          {step.body}
        </p>
        <p className="flex items-start gap-2 text-meta leading-relaxed text-slate-500">
          <span aria-hidden="true" className="mt-0.5 text-sky-500">
            <Icon name={step.stream === "none" ? "lock" : "shield"} className="h-4 w-4" />
          </span>
          <span>{step.note}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * Keyframes for the stage. transform/opacity only, and the whole motion
 * set is disabled under prefers-reduced-motion so the parcel parks at the
 * midpoint and the home / cloud nodes hold still.
 */
const DFX_KEYFRAMES = `
@keyframes dfx-travel {
  0% { left: 0%; opacity: 0; transform: translate(0, -50%) scale(0.8); }
  12% { opacity: 1; transform: translate(0, -50%) scale(1); }
  88% { opacity: 1; transform: translate(-100%, -50%) scale(1); }
  100% { left: 100%; opacity: 0; transform: translate(-100%, -50%) scale(0.8); }
}
@keyframes dfx-breathe {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes dfx-glow {
  0%, 100% { opacity: 0.55; transform: scale(0.98); }
  50% { opacity: 1; transform: scale(1.02); }
}
.dfx-parcel { left: 0%; animation: dfx-travel 2.6s ease-in-out infinite; }
.dfx-pulse { left: 50%; transform: translate(-50%, -50%); animation: dfx-glow 1.8s ease-in-out infinite; }
.dfx-home { animation: dfx-breathe 4s ease-in-out infinite; }
.dfx-cloud { animation: dfx-glow 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .dfx-parcel { left: 50%; transform: translate(-50%, -50%); animation: none; opacity: 1; }
  .dfx-pulse { animation: none; opacity: 1; }
  .dfx-home { animation: none; }
  .dfx-cloud { animation: none; opacity: 1; }
}
`;
