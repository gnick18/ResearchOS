"use client";

import { useState } from "react";

import PickerWalkthroughModal from "@/components/picker-walkthrough/PickerWalkthroughModal";

/**
 * Dev-only preview of the rewritten 3-minute walkthrough modal.
 *
 * The real entry point is the "Take the 3-minute walkthrough" CTA on the
 * folder-connect gate, which lives behind sign-in. This route force-opens the
 * modal so the 5 beats can be reviewed without the auth/gate flow. The whole
 * /dev/* tree is hard-404'd in deployed builds by proxy.ts, so this never
 * ships. Reopen with the button after you close or finish it.
 */
export default function DevPickerWalkthroughPage() {
  const [open, setOpen] = useState(true);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
      <p className="text-sm text-slate-500">
        Dev preview of the rewritten walkthrough. Reopen below after you close
        or finish it.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-400"
      >
        Open the walkthrough
      </button>
      <PickerWalkthroughModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
