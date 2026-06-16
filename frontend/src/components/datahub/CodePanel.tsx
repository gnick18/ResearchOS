"use client";

// CodePanel (Data Hub Show-the-code surface). One shared panel for both code
// exports so they feel like a single feature: the analysis math (scipy /
// statsmodels, from show-code.ts) and the figure script (matplotlib, from
// plot-code.ts). It shows the code in a scrollable block with a Copy button, so
// a researcher can paste the exact open-source code into a notebook and get the
// same numbers or the same plot rather than trust a black box.
//
// The why text states the reason (reproducibility, not a black box) so the
// feature reads as the transparency differentiator it is.
//
// House style: <Icon> only, Tooltip on icon-only buttons, brand + semantic
// tokens, no emojis / em-dashes / mid-sentence colons.

import { useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

export default function CodePanel({
  code,
  caption,
  testId = "datahub-code-panel",
}: {
  /** The runnable source to show + copy. */
  code: string;
  /** The why line under the code (states the reproducibility reason). */
  caption: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-end pb-1">
        <Tooltip label="Copy the code to paste into a notebook.">
          <button
            type="button"
            onClick={onCopy}
            className="ros-btn-neutral flex items-center gap-1.5 px-2 py-1 text-meta font-medium text-foreground"
            data-testid={`${testId}-copy`}
          >
            <Icon
              name={copied ? "check" : "copy"}
              className="h-3.5 w-3.5"
            />
            {copied ? "Copied" : "Copy"}
          </button>
        </Tooltip>
      </div>
      <pre
        className="overflow-auto rounded-lg border border-border bg-surface-sunken p-3 text-meta leading-relaxed text-foreground"
        data-testid={`${testId}-code`}
      >
        <code>{code}</code>
      </pre>
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">{caption}</p>
    </div>
  );
}
