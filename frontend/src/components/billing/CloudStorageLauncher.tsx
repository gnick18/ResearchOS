"use client";

// The slim Profile-page entry into the consolidated billing popup. Shows a glance
// of current usage and a button that opens the full Cloud storage & billing
// surface. Self-hides for local-only users (no sharing identity).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

import BillingPopup from "@/components/billing/BillingPopup";
import { useBillingModal } from "@/lib/billing/billing-modal-store";
import { humanBytes } from "@/lib/billing/format";
import {
  type BillingStatus,
  type LabStatus,
  fetchBillingStatus,
  fetchLabStatus,
} from "@/lib/billing/client";

export default function CloudStorageLauncher() {
  const modal = useBillingModal();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [lab, setLab] = useState<LabStatus | null>(null);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([fetchBillingStatus(), fetchLabStatus()]);
    if (s?.signedIn) setStatus(s);
    setLab(l && l.enabled ? l : null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; setState fires only after the awaited fetch, no sync cascade.
    void load();
  }, [load]);

  // Refresh the glance whenever the popup closes (the user may have changed
  // their cap or accepted a lab invite inside it).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async refetch when the popup closes; setState fires only after the awaited fetch.
    if (!modal.isOpen) void load();
  }, [modal.isOpen, load]);

  if (!status) return null; // hidden until signed in with sharing on

  const used = Math.max(0, status.usedBytes);
  const quota = Math.max(1, status.quotaBytes);
  const pct = Math.min(100, (used / quota) * 100);
  const coveredByLab = !!lab?.sponsoredByLab;
  const planLabel = coveredByLab
    ? "Covered by your lab"
    : status.active
      ? "Individual plan"
      : "Free plan";

  const open = (e: React.MouseEvent) => {
    modal.open({ x: e.clientX, y: e.clientY });
  };

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-foreground">Cloud storage</h2>
          <p className="mt-0.5 text-meta text-foreground-muted">{planLabel}</p>
        </div>
        <button
          type="button"
          onClick={open}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-meta font-semibold text-foreground hover:bg-surface-sunken"
        >
          Manage storage and billing
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between gap-3">
          <p className="text-body font-semibold text-foreground">
            {humanBytes(used)}{" "}
            <span className="font-normal text-foreground-muted">
              of {humanBytes(quota)} used
            </span>
          </p>
          <span className="text-meta text-foreground-muted">
            {pct < 0.1 && used > 0 ? "<0.1" : pct.toFixed(pct < 10 ? 1 : 0)}%
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border">
          <div
            className="h-full rounded-full bg-sky-500 transition-all"
            style={{ width: `${Math.max(pct, used > 0 ? 1.5 : 0)}%` }}
          />
        </div>
      </div>

      <BillingPopup />
    </section>
  );
}
