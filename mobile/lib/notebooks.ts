// Mobile notebook chooser, phone-side snapshot fetch (chooser bot, 2026-06-09).
//
// Fetches the "notebooks" snapshot the laptop published and returns the typed
// list of NotebookSummary items the chooser UI uses. Mirrors the pattern in
// inventory.tsx (fetchSnapshot + tolerant reader).
//
// Crypto note: fetchSnapshot uses unsealSnapshot which relies on @noble +
// expo-crypto (no Web Crypto / TextEncoder/TextDecoder dependency). This file
// only parses the already-decoded JSON, so there is nothing to crypto here.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fetchSnapshot } from '@/lib/snapshots';
import type { Pairing } from '@/lib/pairing';

// ── Types ─────────────────────────────────────────────────────────────────────

/** One entry stub as published by the laptop. */
export interface NotebookEntryStub {
  id: string;
  title: string;
  /** ISO YYYY-MM-DD. */
  date: string;
}

/**
 * One notebook summary as it appears in the chooser.
 *
 * kind:
 *   "own"      — owned by the current user
 *   "shared"   — owned by someone else, shared with edit access
 *   "oneOnOne" — scoped to a 1:1 lab-head <-> member relationship
 *
 * All fields are optional-tolerant: the phone must not crash when the laptop
 * publishes a slightly older shape. Readers should guard every access.
 */
export interface NotebookSummary {
  noteId: number;
  owner: string;
  title: string;
  isRunningLog: boolean;
  kind: 'own' | 'shared' | 'oneOnOne';
  entries: NotebookEntryStub[];
  lastEditedEntryId: string | null;
  /**
   * For shared notes: the owner's username.
   * For 1:1 notebooks: the other participant's username (shown as "1:1 with X").
   * Null for own notebooks.
   */
  partnerUsername: string | null;
  /**
   * For 1:1 notebooks: true when the current user is the lab head.
   * Used to decide whether to show the "PI" or "student" tag.
   * Null for own/shared notebooks.
   */
  isLabHead: boolean | null;
}

/** The shape the laptop seals and the phone unseals. */
interface NotebooksSnapshot {
  generatedAt?: string;
  notebooks?: unknown[];
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

/**
 * Fetch and decode the notebooks snapshot from the relay.
 * Returns an empty array when the laptop has not published yet (404),
 * or when any field is missing / malformed (tolerant reader).
 * Throws on relay errors so the caller can surface them.
 */
export async function fetchNotebooks(
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<NotebookSummary[]> {
  const raw = (await fetchSnapshot(
    'notebooks',
    pairing,
    deviceSign,
  )) as NotebooksSnapshot | null;

  if (!raw) return [];

  const rawList = Array.isArray(raw.notebooks) ? raw.notebooks : [];

  const result: NotebookSummary[] = [];
  for (const item of rawList) {
    const nb = item as Record<string, unknown>;
    // Tolerate missing / wrong-typed fields.
    const noteId =
      typeof nb.noteId === 'number' ? nb.noteId : null;
    const owner =
      typeof nb.owner === 'string' ? nb.owner : null;
    if (noteId == null || !owner) continue;

    const entries: NotebookEntryStub[] = [];
    if (Array.isArray(nb.entries)) {
      for (const e of nb.entries as unknown[]) {
        const row = e as Record<string, unknown>;
        if (typeof row.id === 'string' && typeof row.date === 'string') {
          entries.push({
            id: row.id,
            title: typeof row.title === 'string' ? row.title : 'Untitled entry',
            date: row.date,
          });
        }
      }
    }

    const kind: NotebookSummary['kind'] =
      nb.kind === 'shared'
        ? 'shared'
        : nb.kind === 'oneOnOne'
          ? 'oneOnOne'
          : 'own';

    result.push({
      noteId,
      owner,
      title: typeof nb.title === 'string' ? nb.title : 'Untitled notebook',
      isRunningLog: nb.isRunningLog === true,
      kind,
      entries,
      lastEditedEntryId:
        typeof nb.lastEditedEntryId === 'string'
          ? nb.lastEditedEntryId
          : null,
      partnerUsername:
        typeof nb.partnerUsername === 'string' ? nb.partnerUsername : null,
      isLabHead:
        typeof nb.isLabHead === 'boolean' ? nb.isLabHead : null,
    });
  }
  return result;
}
