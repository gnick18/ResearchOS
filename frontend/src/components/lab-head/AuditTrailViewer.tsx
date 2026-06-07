"use client";

/**
 * PI capability revamp Phase 4 (sharing + collaboration manager, 2026-06-07):
 * the lab-head audit-trail VIEWER. A read-only window onto the per-field diffs
 * a lab head's edits produced on a member's records, built on `readAuditEntries`
 * (lib/lab/pi-audit.ts). There is NO password control and NO mutation here; the
 * old PI edit-session unlock is gone. Being a lab head and opening this popup is
 * sufficient, and everything it shows is already on disk.
 *
 * Two entry shapes:
 *   - No `targetUser`: the viewer shows a member PICKER (the lab members minus
 *     self) and loads a member's trail on selection. This is the Settings
 *     "Lab audit trail" entry point and the Lab Overview "Audit trail" tool.
 *   - With `targetUser`: the viewer loads that member's trail directly, no
 *     picker. Reserved for surfaces that already know whose record they are on.
 *
 * `recordFilter` (Pass B, the per-record "View audit trail" kebab item) narrows
 * the shown entries to a single record. It is OPTIONAL now; when set, the viewer
 * keeps only entries whose `record_type` + `record_id` match. Pass B wires a
 * kebab item that opens this viewer with both `targetUser` (the record owner)
 * and `recordFilter` ({ recordType, recordId }) so a reviewer sees just that
 * record's history.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons. Icons come from
 * the verified Icon registry (never new inline SVG, the icon-guard ratchet),
 * icon-only buttons wrap in the Tooltip component.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { readAuditEntries, type PiAuditEntry } from "@/lib/lab/pi-audit";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";

export interface AuditRecordFilter {
  /** Matches PiAuditEntry.record_type (e.g. "task", "note", "purchase_item"). */
  recordType: string;
  /** Matches PiAuditEntry.record_id (compared as String() on both sides). */
  recordId: number | string;
}

export interface AuditTrailViewerProps {
  open: boolean;
  onClose: () => void;
  /** When set, the viewer loads this member's trail directly (no picker). When
   *  omitted, the viewer shows the member picker first. */
  targetUser?: string;
  /** Optional single-record narrowing (Pass B). Keeps only the matching
   *  record's entries. */
  recordFilter?: AuditRecordFilter;
}

// System session ids that are not human lab-head edits. Labeled distinctly so a
// reviewer can tell an automatic grant / owner-clear row from a real edit.
const SYSTEM_SESSION_IDS = new Set(["owner-clear", "auto-grant"]);

function isSystemEntry(entry: PiAuditEntry): boolean {
  return SYSTEM_SESSION_IDS.has(entry.session_id) || entry.actor === "system";
}

/** Compactly render an old/new value. Strings show verbatim; everything else is
 *  JSON-stringified on one line. Empty / null reads as an em-dash-free dash. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value.length === 0 ? "(empty)" : value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** A human label for a record type. Falls back to the raw type. */
function recordTypeLabel(type: string): string {
  switch (type) {
    case "task":
      return "Task";
    case "note":
      return "Note";
    case "purchase_item":
    case "purchase":
      return "Purchase";
    case "method-transient-read":
      return "Method access";
    default:
      return type;
  }
}

interface RecordGroup {
  key: string;
  recordType: string;
  recordId: string | number;
  /** Newest entry timestamp in the group, used to sort groups newest-first. */
  latest: string;
  entries: PiAuditEntry[];
}

/** Group entries by record (record_type + record_id), each group newest-first,
 *  and the groups themselves newest-first. */
function groupEntries(entries: PiAuditEntry[]): RecordGroup[] {
  const byKey = new Map<string, RecordGroup>();
  for (const e of entries) {
    const key = `${e.record_type}::${String(e.record_id)}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        recordType: e.record_type,
        recordId: e.record_id,
        latest: e.timestamp,
        entries: [],
      };
      byKey.set(key, group);
    }
    group.entries.push(e);
    if (e.timestamp > group.latest) group.latest = e.timestamp;
  }
  const groups = Array.from(byKey.values());
  for (const g of groups) {
    g.entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }
  groups.sort((a, b) => (a.latest < b.latest ? 1 : -1));
  return groups;
}

export default function AuditTrailViewer({
  open,
  onClose,
  targetUser,
  recordFilter,
}: AuditTrailViewerProps) {
  // When no targetUser is supplied, the user picks a member here; that drives
  // which trail loads. A supplied targetUser bypasses the picker entirely.
  const [picked, setPicked] = useState<string | null>(null);
  const effectiveTarget = targetUser ?? picked;

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Lab audit trail"
      widthClassName="max-w-2xl"
      fillHeight
      blur
    >
      <div
        className="flex h-full min-h-0 flex-col"
        data-testid="audit-trail-viewer"
      >
        <header className="flex items-start gap-3 border-b border-border px-6 py-4">
          <span
            aria-hidden="true"
            className="mt-0.5 text-foreground-muted"
          >
            <Icon name="history" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-foreground">
              Lab audit trail
            </h2>
            <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
              Every change you saved to a member&apos;s record as the lab head,
              field by field. This view is read-only.
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {effectiveTarget ? (
            <AuditTrailBody
              targetUser={effectiveTarget}
              recordFilter={recordFilter}
              // Only a picker-driven trail can go "back" to the picker. A
              // supplied targetUser has no picker to return to.
              onBack={targetUser ? undefined : () => setPicked(null)}
            />
          ) : (
            <MemberPicker onPick={setPicked} />
          )}
        </div>
      </div>
    </LivingPopup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Member picker (shown when no targetUser is supplied)
// ─────────────────────────────────────────────────────────────────────────────

function MemberPicker({ onPick }: { onPick: (username: string) => void }) {
  const { currentUser } = useCurrentUser();
  const profiles = useLabUserProfileMap();

  const { data: usernames, isLoading, isError } = useQuery({
    queryKey: ["audit-trail", "members"],
    queryFn: () => discoverUsers(),
    staleTime: 30_000,
  });

  const members = useMemo(() => {
    const all = usernames ?? [];
    // Exclude the active lab head (you do not audit your own record edits).
    return all
      .filter((u) => u !== currentUser)
      .sort((a, b) => {
        const an = profiles[a]?.displayName?.trim() || a;
        const bn = profiles[b]?.displayName?.trim() || b;
        return an.localeCompare(bn);
      });
  }, [usernames, currentUser, profiles]);

  if (isLoading) {
    return (
      <p className="text-meta text-foreground-muted">Loading lab members…</p>
    );
  }
  if (isError) {
    return (
      <p className="text-meta text-red-600 dark:text-red-400">
        Could not load the lab roster. Try again.
      </p>
    );
  }
  if (members.length === 0) {
    return (
      <p className="text-meta text-foreground-muted">
        No other lab members found. The audit trail covers members whose
        records you have edited as the lab head.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-meta text-foreground-muted">
        Pick a member to see the changes you saved to their records.
      </p>
      <ul
        className="divide-y divide-border overflow-hidden rounded-lg border border-border"
        data-testid="audit-member-picker"
      >
        {members.map((username) => {
          const label = profiles[username]?.displayName?.trim() || username;
          const isLabHead = profiles[username]?.account_type === "lab_head";
          return (
            <li key={username}>
              <button
                type="button"
                onClick={() => onPick(username)}
                className="flex w-full items-center gap-3 bg-surface-raised px-3 py-2.5 text-left hover:bg-surface-sunken"
                data-testid={`audit-member-${username}`}
              >
                <UserAvatar username={username} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-body font-medium text-foreground">
                      {label}
                    </span>
                    {isLabHead && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-meta font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                        PI
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-meta text-foreground-muted">
                    @{username}
                  </span>
                </span>
                <span aria-hidden="true" className="text-foreground-muted">
                  <Icon name="chevronRight" className="h-4 w-4" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Trail body (loads + renders one member's entries)
// ─────────────────────────────────────────────────────────────────────────────

function AuditTrailBody({
  targetUser,
  recordFilter,
  onBack,
}: {
  targetUser: string;
  recordFilter?: AuditRecordFilter;
  /** When provided, a "Back to members" affordance returns to the picker. */
  onBack?: () => void;
}) {
  const profiles = useLabUserProfileMap();
  const memberLabel = profiles[targetUser]?.displayName?.trim() || targetUser;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["audit-trail", "entries", targetUser],
    queryFn: () => readAuditEntries(targetUser),
    staleTime: 15_000,
  });

  const groups = useMemo(() => {
    const entries = data ?? [];
    const filtered = recordFilter
      ? entries.filter(
          (e) =>
            e.record_type === recordFilter.recordType &&
            String(e.record_id) === String(recordFilter.recordId),
        )
      : entries;
    return groupEntries(filtered);
  }, [data, recordFilter]);

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-meta font-medium text-foreground-muted hover:text-foreground"
          data-testid="audit-back-to-members"
        >
          <span aria-hidden="true">
            <Icon name="chevronLeft" className="h-4 w-4" />
          </span>
          Back to members
        </button>
      )}

      <div className="flex items-center gap-3">
        <UserAvatar username={targetUser} size="sm" />
        <div className="min-w-0">
          <h3 className="truncate text-body font-semibold text-foreground">
            {memberLabel}
          </h3>
          <p className="text-meta text-foreground-muted">
            {recordFilter
              ? `${recordTypeLabel(recordFilter.recordType)} history`
              : "Lab-head edits to their records"}
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-meta text-foreground-muted">Loading audit trail…</p>
      ) : isError ? (
        <p className="text-meta text-red-600 dark:text-red-400">
          Could not load the audit trail for {memberLabel}. Try again.
        </p>
      ) : groups.length === 0 ? (
        <p
          className="text-meta text-foreground-muted"
          data-testid="audit-empty-state"
        >
          No lab-head edits recorded for {memberLabel}.
        </p>
      ) : (
        <ul className="space-y-4" data-testid="audit-record-groups">
          {groups.map((group) => (
            <RecordGroupCard key={group.key} group={group} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordGroupCard({ group }: { group: RecordGroup }) {
  return (
    <li
      className="overflow-hidden rounded-xl border border-border bg-surface-raised"
      data-testid={`audit-group-${group.recordType}-${String(group.recordId)}`}
    >
      <header className="flex items-center gap-2 border-b border-border bg-surface-sunken px-4 py-2.5">
        <span className="text-body font-semibold text-foreground">
          {recordTypeLabel(group.recordType)}
        </span>
        <span className="text-meta text-foreground-muted">
          #{String(group.recordId)}
        </span>
        <span className="ml-auto text-meta text-foreground-muted">
          {group.entries.length}{" "}
          {group.entries.length === 1 ? "change" : "changes"}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {group.entries.map((entry) => (
          <AuditEntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </li>
  );
}

function AuditEntryRow({ entry }: { entry: PiAuditEntry }) {
  const system = isSystemEntry(entry);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
        <span className="font-medium text-foreground">
          {system ? "System" : entry.actor}
        </span>
        {system && (
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-meta font-semibold text-foreground-muted">
            {entry.session_id === "auto-grant" ? "Auto grant" : "Owner clear"}
          </span>
        )}
        <span className="text-foreground-muted">
          {formatTimestamp(entry.timestamp)}
        </span>
        <span className="ml-auto font-mono text-meta text-foreground-muted">
          {entry.field_path}
        </span>
      </div>
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
    </li>
  );
}
