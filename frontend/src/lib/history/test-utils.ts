// Version Control Phase 0: test-only helpers (in-memory storage, deterministic
// clock, history-file seeding). Imported by the *.test.ts suites; not a test
// file itself. Kept out of the public index barrel.

import { canonicalize } from "./canonicalize";
import { computeDelta } from "./diff";
import { sha256Hex } from "./hash";
import {
  HistoryEngine,
  type EngineClock,
} from "./engine";
import {
  historyFilePath,
  jsonlToRows,
  rowsToJsonl,
  type HistoryStorage,
} from "./storage";
import type { DeltaRow, GenesisRow, HistoryRow } from "./types";

/** In-memory HistoryStorage. Mirrors the read-modify-write + atomic-rewrite
 *  semantics of the fileService binding without touching disk. */
export class MemoryStorage implements HistoryStorage {
  files = new Map<string, string>();

  async readRaw(path: string): Promise<string | null> {
    return this.files.has(path) ? this.files.get(path)! : null;
  }

  async appendLine(path: string, line: string): Promise<void> {
    const existing = this.files.get(path) ?? "";
    const needsNewline = existing.length > 0 && !existing.endsWith("\n");
    this.files.set(path, existing + (needsNewline ? "\n" : "") + line + "\n");
  }

  async rewrite(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

/** Deterministic clock: ids are `r0`, `r1`, ...; ts is a fixed-epoch counter. */
export function makeClock(): EngineClock {
  let counter = 0;
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  return {
    newId(): string {
      return `r${counter++}`;
    },
    now(): string {
      // Monotonic, unique per call, deterministic.
      return new Date(base + counter * 1000).toISOString();
    },
  };
}

/** A fresh engine wired to a fresh in-memory store + deterministic clock. */
export function makeEngine(): { engine: HistoryEngine; storage: MemoryStorage } {
  const storage = new MemoryStorage();
  const engine = new HistoryEngine({ storage, clock: makeClock() });
  return { engine, storage };
}

export const ENTITY = "notes";
export const OWNER = "mira";
export const ID = 47;

export function pathFor(
  entityType = ENTITY,
  owner = OWNER,
  id: string | number = ID,
): string {
  return historyFilePath(owner, entityType, id);
}

/** Read parsed rows straight out of the in-memory store. */
export function readRows(storage: MemoryStorage, path = pathFor()): HistoryRow[] {
  return jsonlToRows<HistoryRow>(storage.files.get(path) ?? null);
}

/**
 * Seed a history file DIRECTLY into the store with a genesis row + `count`
 * synthetic delta rows, each editing a single counter field. Returns the
 * sequence of canonical states (index 0 = genesis pre-image, index k = state
 * AFTER delta k) so tests can assert reconstruction.
 *
 * `withGenesisState` controls whether the genesis row carries a backfilled
 * `genesis_state` (false exercises the bare-genesis lazy-backfill path).
 */
export async function seedHistory(
  storage: MemoryStorage,
  count: number,
  opts: { withGenesisState?: boolean; path?: string; owner?: string } = {},
): Promise<{ canonicals: string[]; rows: HistoryRow[]; headCanonical: string }> {
  const path = opts.path ?? pathFor();
  const owner = opts.owner ?? OWNER;
  const canonicals: string[] = [];
  const rows: HistoryRow[] = [];

  // Genesis anchored at the empty doc (how appendEdit anchors a fresh record).
  const genesisPre = canonicalize({});
  canonicals.push(genesisPre);
  const genesis: GenesisRow = {
    id: "g0",
    ts: new Date(Date.parse("2026-01-01T00:00:00Z")).toISOString(),
    v: 1,
    actor: "mira",
    owner,
    kind: "genesis",
    post_hash: await sha256Hex(genesisPre),
    ...(opts.withGenesisState ? { genesis_state: genesisPre } : {}),
  };
  rows.push(genesis);

  let prev = genesisPre;
  let prevRecord: Record<string, unknown> = {};
  for (let k = 1; k <= count; k++) {
    const record = { ...prevRecord, id: ID, n: k };
    const next = canonicalize(record);
    const delta = computeDelta(prev, next);
    const row: DeltaRow = {
      id: `r${k}`,
      ts: new Date(Date.parse("2026-01-01T00:00:00Z") + k * 1000).toISOString(),
      v: 1,
      actor: "mira",
      owner,
      kind: "update",
      delta,
      post_hash: await sha256Hex(next),
    };
    rows.push(row);
    canonicals.push(next);
    prev = next;
    prevRecord = record;
  }

  storage.files.set(path, rowsToJsonl(rows));
  return { canonicals, rows, headCanonical: prev };
}
