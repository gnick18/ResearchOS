"use client";

/**
 * LabWideSearch — the PI's whole-lab search, the visible front of the hybrid
 * mirror index (docs/proposals/2026-06-17-hybrid-lab-mirror-index.md).
 *
 * A lab head types a query and sees matching records from EVERY member, read
 * from the per-member index (no content blobs pulled). Each hit shows the owner,
 * the type, a preview, and whether the full content is already in the cloud
 * (eager) or is heavy and fetched on demand (a future Phase C request). Mounted
 * on the search page, gated to lab heads by the caller.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons. Icons from the
 * Icon registry only.
 */

import { useState } from "react";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { useLabIndexSearch } from "@/hooks/useLabIndexSearch";
import type { LabSearchHit } from "@/lib/lab/lab-index-search";
import { requestLabContent } from "@/lib/lab/lab-request-actions";

/** A human label for a record type. */
function typeLabel(recordType: string): string {
  switch (recordType) {
    case "task":
      return "Task";
    case "experiment":
      return "Experiment";
    case "note":
      return "Note";
    case "method":
      return "Method";
    case "purchase":
      return "Purchase";
    case "inventory":
      return "Inventory";
    case "inventory_stock":
      return "Stock";
    case "sequence":
      return "Sequence";
    case "phylo":
      return "Tree";
    case "molecule":
      return "Molecule";
    case "datahub":
      return "Data table";
    case "result_sheet":
      return "Results";
    case "notes_sheet":
      return "Lab notes";
    default:
      return recordType;
  }
}

export default function LabWideSearch() {
  const [query, setQuery] = useState("");
  const { hits, loading, ok, error, total } = useLabIndexSearch(query);

  return (
    <div className="space-y-4">
      <div className="bg-surface-raised border border-border rounded-xl p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-2 text-foreground-muted">
            <Icon name="search" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">
              Search the whole lab
            </h2>
            <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
              Every member&apos;s synced work, indexed. Heavy items (large data
              tables) show here and are fetched on request.
            </p>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search across every member's work..."
              data-testid="lab-wide-search-input"
              className="mt-3 w-full px-3 py-2 border border-border rounded-lg text-body bg-surface focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-meta text-foreground-muted px-1">
          Loading the lab index...
        </p>
      ) : !ok ? (
        <p
          className="text-meta text-foreground-muted px-1"
          data-testid="lab-wide-search-unavailable"
        >
          {error
            ? `Lab-wide search is not available: ${error}.`
            : "Lab-wide search is not available."}
        </p>
      ) : (
        <>
          <p className="text-meta text-foreground-muted px-1">
            {query.trim()
              ? `${hits.length} of ${total} records match`
              : `${total} records across the lab`}
          </p>
          {hits.length === 0 ? (
            <div
              className="text-center py-12 bg-surface-raised rounded-lg border border-border"
              data-testid="lab-wide-search-empty"
            >
              <p className="text-body text-foreground-muted">
                No records match that search.
              </p>
            </div>
          ) : (
            <ul
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
              data-testid="lab-wide-search-results"
            >
              {hits.map((hit) => (
                <LabSearchResultCard
                  key={`${hit.owner}-${hit.recordType}-${hit.recordId}`}
                  hit={hit}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

type RequestStatus = "idle" | "requesting" | "requested" | "error";

function LabSearchResultCard({ hit }: { hit: LabSearchHit }) {
  const [status, setStatus] = useState<RequestStatus>("idle");
  const [error, setError] = useState<string | undefined>();

  async function onRequest() {
    setStatus("requesting");
    setError(undefined);
    const res = await requestLabContent({
      owner: hit.owner,
      recordType: hit.recordType,
      recordId: hit.recordId,
    });
    if (res.ok) {
      setStatus("requested");
    } else {
      setStatus("error");
      setError(res.error);
    }
  }

  return (
    <li
      className="bg-surface-raised border border-border rounded-lg p-4"
      data-testid={`lab-wide-result-${hit.recordType}-${hit.recordId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-body font-medium text-foreground line-clamp-2">
          {hit.title}
        </h3>
        {hit.eager ? (
          <InCloudBadge />
        ) : (
          <RequestControl status={status} onRequest={onRequest} />
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <UserAvatar username={hit.owner} size="sm" />
        <span className="truncate text-meta text-foreground-muted">
          {hit.owner}
        </span>
        <span className="ml-auto rounded-full bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted">
          {typeLabel(hit.recordType)}
        </span>
      </div>

      {hit.preview ? (
        <p className="mt-2 text-meta text-foreground-muted line-clamp-2">
          {hit.preview}
        </p>
      ) : null}

      {status === "error" && error ? (
        <p className="mt-2 text-meta text-red-600 dark:text-red-400">
          Request failed: {error}
        </p>
      ) : null}
    </li>
  );
}

function InCloudBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-meta text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
      <Icon name="cloud" className="h-3.5 w-3.5" />
      In cloud
    </span>
  );
}

/**
 * For a heavy (on-request) item: a button that sends the request, then shows a
 * "Requested" state. The owner approves it on their next session, after which it
 * appears in the cloud.
 */
function RequestControl({
  status,
  onRequest,
}: {
  status: RequestStatus;
  onRequest: () => void;
}) {
  if (status === "requested") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted"
        data-testid="lab-wide-requested"
      >
        <Icon name="cloud" className="h-3.5 w-3.5" />
        Requested
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onRequest}
      disabled={status === "requesting"}
      data-testid="lab-wide-request-btn"
      className="ros-btn-neutral inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta text-amber-700 disabled:opacity-50 dark:text-amber-300"
    >
      <Icon name="download" className="h-3.5 w-3.5" />
      {status === "requesting" ? "Requesting..." : status === "error" ? "Retry" : "Request"}
    </button>
  );
}
