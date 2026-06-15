"use client";

// Make phone-friendly, the laptop trigger (method phone projection reformatter,
// Phase 2, 2026-06-14).
//
// One explicit button on a body-type method (markdown / pdf / kit / etc). On
// click it asks BeakerBot to restructure the method's source body into clean,
// bench-readable markdown (numbered steps, phase headings, reagent lists) and
// caches the result next to the source, so the next "view on phone" ships the
// tidied version. The phone already renders any body as steps via the free
// deterministic parser; this is the opt-in, metered-AI upgrade for messy
// free-form protocols.
//
// The hard guardrail lives server-side: the endpoint validates that the reformat
// changed no value and returns ok:false otherwise. So a rejected reformat is not
// an error to the user, the phone simply keeps showing the plain deterministic
// steps. We surface that as a calm "kept the plain steps", never a failure.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { filesApi } from "@/lib/local-api";
import { writePhoneReformat } from "@/lib/methods/phone-reformat-cache";
import type { Method } from "@/lib/types";

type State = "idle" | "working" | "ready" | "plain" | "no-credits" | "error";

export default function MakePhoneFriendlyButton({ method }: { method: Method }) {
  const [state, setState] = useState<State>("idle");

  const settle = () => setTimeout(() => setState("idle"), 3000);

  const onClick = useCallback(async () => {
    const sourcePath = method.source_path;
    // Only body-file methods have a markdown source to reformat; scheme paths
    // (pcr://, etc) are structured and already render as steps.
    if (!sourcePath || sourcePath.includes("://")) return;
    setState("working");
    try {
      const file = await filesApi.readFile(sourcePath);
      const res = await fetch("/api/ai/reformat-method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: file.content }),
      });
      if (res.status === 402) {
        setState("no-credits");
        settle();
        return;
      }
      if (!res.ok) {
        setState("error");
        settle();
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        reformatted?: string;
      };
      if (data?.ok && typeof data.reformatted === "string") {
        // Cache against the body SHA so buildBody serves it until the method is
        // edited. A cache-write miss is non-fatal (the reformat just is not
        // persisted), so we still report success of the reformat itself.
        await writePhoneReformat(sourcePath, file.sha, data.reformatted);
        setState("ready");
      } else {
        // ok:false (the guardrail refused the reformat) or no usable text. The
        // phone still shows the deterministic steps, so this is a soft outcome.
        setState("plain");
      }
      settle();
    } catch {
      setState("error");
      settle();
    }
  }, [method.source_path]);

  const label =
    state === "working"
      ? "Making phone steps..."
      : state === "ready"
        ? "Phone version ready"
        : state === "plain"
          ? "Kept the plain steps"
          : state === "no-credits"
            ? "Out of AI credits"
            : state === "error"
              ? "Could not reformat"
              : "Make phone-friendly";

  return (
    <Tooltip label="Have BeakerBot restructure this protocol into clean, bench-readable steps for the phone. Every number and reagent stays exactly as you wrote it.">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={state === "working"}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-meta font-medium text-foreground-muted bg-surface-sunken hover:bg-surface-raised transition-colors disabled:opacity-60"
      >
        <span className={state === "ready" ? "inline-flex text-green-600 dark:text-green-400" : "inline-flex"}>
          <Icon name={state === "ready" ? "check" : "list"} className="w-3.5 h-3.5" />
        </span>
        {label}
      </button>
    </Tooltip>
  );
}
