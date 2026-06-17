"use client";

/**
 * The member transparency panel, Phase 0 of the BeakerBot PI copilot (see
 * docs/proposals/2026-06-17-beakerbot-lab-head-utilities.md). The PI role grants
 * a lab head read over everything a member syncs to the lab. That is defensible
 * (the PI owns the grant and the records) but it is role-based, not opt-in, so it
 * carries a trust contract. This panel is the member's half of it, a read-only
 * window onto exactly what their lab head's lab view has read and changed about
 * them, built on the same per-member audit log (readAuditEntries, lib/lab/
 * pi-audit.ts) that the lab-scoped read and the PI edits write to.
 *
 * It shows the member their OWN log (entries whose target_user is them), so there
 * is no role gate here, every lab user may open their own. Three entry shapes:
 *   - lab-scoped-read: the PI's lab view read N of your records. A read, no diff.
 *   - method-transient-read: a shared task auto-opened one of your methods.
 *   - everything else: a field-level edit the lab head saved to your record.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons. Icons from the
 * Icon registry only (icon-guard ratchet), never new inline SVG.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { readAuditEntries, type PiAuditEntry } from "@/lib/lab/pi-audit";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";

export interface MyLabViewPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value.length === 0 ? "(empty)" : value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function recordTypeLabel(type: string): string {
  switch (type) {
    case "task":
      return "task";
    case "note":
      return "note";
    case "purchase_item":
    case "purchase":
      return "purchase";
    default:
      return type;
  }
}

type EntryKind = "lab-read" | "method-read" | "edit";

function entryKind(entry: PiAuditEntry): EntryKind {
  if (entry.record_type === "lab-scoped-read") return "lab-read";
  if (entry.record_type === "method-transient-read") return "method-read";
  return "edit";
}

export default function MyLabViewPanel({ open, onClose }: MyLabViewPanelProps) {
  const { currentUser } = useCurrentUser();
  const profiles = useLabUserProfileMap();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-lab-view", currentUser],
    queryFn: () => (currentUser ? readAuditEntries(currentUser) : Promise.resolve([])),
    enabled: open && !!currentUser,
    staleTime: 15_000,
  });

  // Newest first. The log is already chronological on disk, but a defensive sort
  // keeps the timeline honest regardless of write order.
  const entries = useMemo(() => {
    const all = data ?? [];
    return [...all].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }, [data]);

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Your lab view"
      widthClassName="max-w-2xl"
      fillHeight
      blur
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="my-lab-view-panel">
        <header className="flex items-start gap-3 border-b border-border px-6 py-4">
          <span aria-hidden="true" className="mt-0.5 text-foreground-muted">
            <Icon name="eye" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-foreground">
              What your lab view shows
            </h2>
            <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
              Your lab head can read the work you sync to the lab, since they own
              the grant and the records. This is the full record of every time
              their lab view read or changed your work. It updates on its own and
              nobody can quietly turn it off.
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <p className="text-meta text-foreground-muted">Loading your lab activity…</p>
          ) : isError ? (
            <p className="text-meta text-red-600 dark:text-red-400">
              Could not load your lab activity. Try again.
            </p>
          ) : entries.length === 0 ? (
            <p
              className="text-meta text-foreground-muted"
              data-testid="my-lab-view-empty"
            >
              Your lab head&apos;s lab view has not read or changed any of your
              work yet. When it does, every access shows up here.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="my-lab-view-entries">
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} profiles={profiles} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}

function actorLabel(
  actor: string,
  profiles: ReturnType<typeof useLabUserProfileMap>,
): string {
  if (actor === "system") return "An automatic grant";
  return profiles[actor]?.displayName?.trim() || actor;
}

function EntryRow({
  entry,
  profiles,
}: {
  entry: PiAuditEntry;
  profiles: ReturnType<typeof useLabUserProfileMap>;
}) {
  const kind = entryKind(entry);
  const who = actorLabel(entry.actor, profiles);

  return (
    <li
      className="rounded-xl border border-border bg-surface-raised px-4 py-3"
      data-testid={`my-lab-view-row-${kind}`}
    >
      <div className="flex items-start gap-3">
        {entry.actor === "system" ? (
          <span aria-hidden="true" className="mt-0.5 text-foreground-muted">
            <Icon name="shield" className="h-4 w-4" />
          </span>
        ) : (
          <UserAvatar username={entry.actor} size="sm" />
        )}
        <div className="min-w-0 flex-1">
          {kind === "lab-read" ? (
            <LabReadBody who={who} entry={entry} />
          ) : kind === "method-read" ? (
            <MethodReadBody />
          ) : (
            <EditBody who={who} entry={entry} />
          )}
          <p className="mt-1 text-meta text-foreground-muted">
            {formatTimestamp(entry.timestamp)}
          </p>
        </div>
      </div>
    </li>
  );
}

function LabReadBody({ who, entry }: { who: string; entry: PiAuditEntry }) {
  const nv = (entry.new_value ?? {}) as {
    record_count?: number;
    record_types?: string[];
  };
  const count = nv.record_count ?? Number(entry.record_id) ?? 0;
  const types = (nv.record_types ?? []).map(recordTypeLabel);
  return (
    <p className="text-body text-foreground">
      <span className="font-medium">{who}</span>
      &apos;s lab view read {count} of your{" "}
      {types.length > 0 ? `records (${types.join(", ")})` : "records"}.
    </p>
  );
}

function MethodReadBody() {
  return (
    <p className="text-body text-foreground">
      A shared task automatically opened one of your methods for someone you
      shared it with.
    </p>
  );
}

function EditBody({ who, entry }: { who: string; entry: PiAuditEntry }) {
  return (
    <div className="min-w-0">
      <p className="text-body text-foreground">
        <span className="font-medium">{who}</span> changed your{" "}
        {recordTypeLabel(entry.record_type)}{" "}
        <span className="text-foreground-muted">#{String(entry.record_id)}</span>
        {entry.field_path ? (
          <>
            {" "}
            <span className="font-mono text-meta text-foreground-muted">
              {entry.field_path}
            </span>
          </>
        ) : null}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-meta">
        <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800 line-through decoration-red-400 dark:bg-red-500/10 dark:text-red-300">
          {formatValue(entry.old_value)}
        </span>
        <span aria-hidden="true" className="text-foreground-muted">
          <Icon name="chevronRight" className="h-3.5 w-3.5" />
        </span>
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
          {formatValue(entry.new_value)}
        </span>
      </div>
    </div>
  );
}
