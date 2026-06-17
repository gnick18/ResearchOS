"use client";

/**
 * The member's "Requests from your lab head" panel (Phase C of the hybrid lab
 * mirror, docs/proposals/2026-06-17-hybrid-lab-mirror-index.md). The PI can see
 * a heavy item exists but its full content is fetched on demand. When the PI
 * requests it, the request shows here. Approving records a TTL grant so the
 * member's next sync uploads that one record, and it stays in the cloud for the
 * window, then reverts to on-demand.
 *
 * Approve-only by design (the role grants the PI read over all lab data); the
 * member controls WHEN and that it is deliberate, not WHETHER.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons. Icons from the
 * Icon registry only.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icons";
import {
  loadMyContentRequests,
  approveMyContentRequest,
} from "@/lib/lab/lab-request-actions";
import type { LabContentRequest } from "@/lib/lab/lab-requests";

function typeLabel(recordType: string): string {
  switch (recordType) {
    case "datahub":
      return "data table";
    case "sequence":
      return "sequence";
    case "phylo":
      return "tree";
    case "molecule":
      return "molecule";
    case "result_sheet":
      return "results sheet";
    case "notes_sheet":
      return "lab notes";
    default:
      return recordType;
  }
}

export default function MyLabRequestsPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["my-lab-requests"],
    queryFn: () => loadMyContentRequests(),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const requests = data?.requests ?? [];
  const ok = data?.ok ?? false;

  if (isLoading) {
    return (
      <p className="text-meta text-foreground-muted">Loading requests...</p>
    );
  }
  // Not in a lab (or no identity): the section is hidden by its own copy, so a
  // quiet empty render is fine here.
  if (!ok) return null;
  if (requests.length === 0) {
    return (
      <p
        className="text-meta text-foreground-muted"
        data-testid="my-lab-requests-empty"
      >
        Your lab head has not requested any of your heavy items. When they do, the
        request shows here for you to approve.
      </p>
    );
  }

  return (
    <ul className="space-y-2" data-testid="my-lab-requests">
      {requests.map((r) => (
        <RequestRow key={r.id} request={r} onApproved={() => void refetch()} />
      ))}
    </ul>
  );
}

function RequestRow({
  request,
  onApproved,
}: {
  request: LabContentRequest;
  onApproved: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "approving" | "error">("idle");
  const [error, setError] = useState<string | undefined>();

  async function onApprove() {
    setStatus("approving");
    setError(undefined);
    const res = await approveMyContentRequest(request);
    if (res.ok) {
      onApproved();
    } else {
      setStatus("error");
      setError(res.error);
    }
  }

  return (
    <li className="rounded-xl border border-border bg-surface-raised px-4 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-foreground-muted">
          <Icon name="download" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body text-foreground">
            <span className="font-medium">{request.requester}</span> requested
            your {typeLabel(request.recordType)}.
          </p>
          <p className="text-meta text-foreground-muted">
            Approving uploads it and keeps it shared for 30 days, then it reverts
            to on-request.
          </p>
        </div>
        <button
          type="button"
          onClick={onApprove}
          disabled={status === "approving"}
          data-testid={`approve-request-${request.id}`}
          className="ros-btn-raise shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-meta font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {status === "approving" ? "Approving..." : status === "error" ? "Retry" : "Approve"}
        </button>
      </div>
      {status === "error" && error ? (
        <p className="mt-2 text-meta text-red-600 dark:text-red-400">
          Could not approve: {error}
        </p>
      ) : null}
    </li>
  );
}
