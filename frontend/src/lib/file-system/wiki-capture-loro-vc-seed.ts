/**
 * Wiki version-history screenshot seed, Loro-native edition (loro-seed bot,
 * 2026-06-10).
 *
 * Notes moved to Loro-native version history (LORO_PILOT_ENABLED), so the wiki
 * version-history page reads the timeline from a note's Loro sidecar
 * (users/<owner>/.researchos/notes/<id>.loro) via listVersions /
 * reconstructCanonicalAt, NOT the legacy _history/notes/<id>.jsonl delta store.
 * The old jsonl seed (retired with this change) populated only that dead store,
 * so the sidebar rendered "No earlier versions yet".
 *
 * This module builds a REAL multi-commit Loro document for note id 5 (alex's
 * running-log note "qPCR optimization log (fakeGFP vs ACT1)", at
 * users/alex/notes/5.json) so the sidebar shows a populated, multi-version,
 * multi-editor, multi-day timeline with selectable earlier versions, a diff,
 * the compare-against toggle, and the restore plus undo affordances.
 *
 * How the doc is built (not hand-faked): the same engine path the live editor
 * and the history engine use. seedNoteDoc produces the deterministic genesis
 * snapshot (peer 0, "seed"), then a sequence of real doc.commit() calls under
 * two distinct actor peers (alex, morgan) layers the edit history on top. Each
 * commit carries a distinct message and a distinct timestamp, so Loro keeps them
 * as separate changes and getAllChanges (which listVersions flattens by lamport)
 * reports one version per commit. The story mirrors the retired jsonl seed:
 *   index 0  genesis           [seed]   note created with the first entry
 *   index 1  refine entry1     [alex]   complete the anneal-sweep entry
 *   index 2  add entry2        [alex]   primer concentration check
 *   index 3  edit entry1 nums  [morgan] re-ran the sweep, numbers noisy
 *   index 4  add entry3 draft  [morgan] ACT1 vs PDA1 reference, draft
 *   index 5  tighten + reconfirm[alex]  shorten description, clean entry1 nums
 *   index 6  finalize entry3   [alex]   real ACT1 vs PDA1 numbers, full desc
 *   index 7  restore to v4     [alex]   revert to the draft state
 *   index 8  undo the restore  [alex]   back to HEAD (the finalized state)
 *
 * The HEAD state (index 8) reconstructs to EXACTLY the on-disk note 5 mirror
 * (every tracked field, including each entry's created_at and updated_at), so
 * openNote's classifyExternalEdit returns "none" and never ingests a spurious
 * extra commit on top of the seeded history.
 *
 * Commit timestamps are re-anchored to "now" at build time so the sidebar's
 * Today / Yesterday / dated day grouping stays fresh regardless of capture date.
 * Genesis keeps the note's real created_at (it is the seed baseline that
 * buildVersionList skips, so its day bucket never renders).
 *
 * Strictly a screenshot-fixture asset: imported only by wiki-capture-mock.ts,
 * which is itself never reachable from production (the wikiCapture flag is hard-
 * gated to dev / localhost).
 */

import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { seedNoteDoc } from "@/lib/loro/seed";
import { setEntryContent } from "@/lib/loro/note-doc";
import type { ActorsMap } from "@/lib/loro/actors";
import type { Note, NoteEntry } from "@/lib/types";

/** The note whose history is seeded. Matches users/alex/notes/5.json. */
export const VC_SEED_NOTE_OWNER = "alex";
export const VC_SEED_NOTE_ID = 5;

/** Loro sidecar path the history engine + openNote read for note 5. Mirrors
 *  sidecarPath(owner, id) in sidecar-store.ts. */
export const VC_SEED_SIDECAR_PATH = `users/${VC_SEED_NOTE_OWNER}/.researchos/notes/${VC_SEED_NOTE_ID}.loro`;

/** Actors-map path that resolves the seeded peers to usernames. Mirrors
 *  actorsPath(owner) in actors.ts. */
export const VC_SEED_ACTORS_PATH = `users/${VC_SEED_NOTE_OWNER}/.researchos/actors.json`;

/** Stable, fixture-only peer ids for the two editors. Peer 0 is reserved by
 *  seedNoteDoc for the deterministic genesis (it resolves to "seed"). These are
 *  arbitrary distinct non-zero ids; they never collide with a real device peer
 *  in a way that matters because this doc is loaded from bytes, never edited
 *  live in capture mode. */
const ALEX_PEER = BigInt(1001);
const MORGAN_PEER = BigInt(2002);

/** Peer-to-username map written alongside the sidecar so version-history
 *  attribution resolves alex and morgan (peer 0 falls back to "seed"). */
export const VC_SEED_ACTORS: ActorsMap = {
  [ALEX_PEER.toString()]: { username: "alex" },
  [MORGAN_PEER.toString()]: { username: "morgan" },
};

// ---------------------------------------------------------------------------
// Content states (lab-recipe data, mirrors the note 5 fixture and the retired
// jsonl seed). These are fixture data, not prose, so the Cq tables keep their
// own punctuation.
// ---------------------------------------------------------------------------

const DESC_FULL =
  "Optimizing the SYBR-based qPCR for fakeGFP expression. Reference: alex pcr_protocol 1.\n\nDoc tracks Cq values per primer-anneal sweep so we lock in conditions before the full triplicate run.";
const DESC_SHORT =
  "Optimizing the SYBR-based qPCR for fakeGFP expression.";

/** Entry 1 as first created (genesis): the raw sweep table before the melt-peak
 *  annotation and the locking conclusion are added. */
const E1_INITIAL =
  "fakeGFP-fwd/rev at 200 nM, cDNA 1:5. Cq means (n=2):\n- 56 °C: 22.9\n- 58 °C: 22.4\n- 60 °C: 21.7\n- 62 °C: 22.1";
/** Entry 1 completed by alex, and the final HEAD state. Matches the fixture. */
const E1_FINAL =
  "fakeGFP-fwd/rev at 200 nM, cDNA 1:5. Cq means (n=2):\n- 56 °C: 22.9\n- 58 °C: 22.4\n- 60 °C: 21.7 (sharp melt peak)\n- 62 °C: 22.1\n\nLocking in 60 °C anneal. Melt curve confirms single product.";
/** Entry 1 after morgan's re-run, with the noisier numbers. */
const E1_NOISY =
  "fakeGFP-fwd/rev at 200 nM, cDNA 1:5. Cq means (n=2):\n- 56 °C: 23.0\n- 58 °C: 22.5\n- 60 °C: 21.8\n- 62 °C: 22.2\n\nNeed to re-run, melt curve was noisy.";

const E3_DRAFT =
  "ACT1 looks tighter than PDA1 across the plate. Need to re-measure the PDA1 wells, the spread looked high. (draft - numbers TBD)";
const E3_FINAL =
  "ACT1 Cq spread across 8 wells: 21.6 to 21.9 (SD 0.10). PDA1 Cq spread: 24.1 to 24.7 (SD 0.22). ACT1 is the tighter reference, using it as the housekeeping baseline.";

/** Entry records. created_at / updated_at exactly match the note 5 fixture so
 *  the reconstructed HEAD equals the on-disk mirror across every tracked field. */
const ENTRY1: NoteEntry = {
  id: "rl-alex-5-e1",
  title: "2026-04-22: anneal temp sweep 56, 58, 60, 62 °C",
  date: "2026-04-22",
  content: E1_INITIAL,
  created_at: "2026-04-22T16:00:00Z",
  updated_at: "2026-04-22T16:00:00Z",
};
const ENTRY2: NoteEntry = {
  id: "rl-alex-5-e2",
  title: "2026-04-29: primer concentration check (100 vs 200 nM)",
  date: "2026-04-29",
  content:
    "100 nM: Cq 22.1, lower fluorescence plateau. 200 nM: Cq 21.7, plateau ~2× higher. Sticking with 200 nM for the demo runs.",
  created_at: "2026-04-29T11:00:00Z",
  updated_at: "2026-04-29T11:00:00Z",
};
const ENTRY3: NoteEntry = {
  id: "rl-alex-5-e3",
  title: "2026-05-06: reference gene comparison ACT1 vs PDA1",
  date: "2026-05-06",
  content: E3_DRAFT, // added as a draft; finalized later in the story
  created_at: "2026-05-06T10:30:00Z",
  updated_at: "2026-05-06T10:30:00Z",
};

/** The genesis note: title, full description, running-log flag, and entry 1 in
 *  its initial form. seedNoteDoc commits this under peer 0 as version 0. */
const GENESIS_NOTE: Note = {
  id: VC_SEED_NOTE_ID,
  title: "qPCR optimization log (fakeGFP vs ACT1)",
  description: DESC_FULL,
  is_running_log: true,
  is_shared: true,
  created_at: "2026-04-22T16:00:00Z",
  updated_at: "2026-04-22T16:00:00Z",
  username: "alex",
  flagged: null,
  comments: [],
  entries: [ENTRY1],
} as Note;

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Minutes-before-now for each delta commit, oldest first (index 1 through 8).
 *  The spread lands index 1 and 2 about two days back, index 3 and 4 around a
 *  day back (yesterday), and index 5 through 8 within the last few hours
 *  (today), so the sidebar shows three day groups. Within each actor the values
 *  strictly decrease, so per-peer commit timestamps strictly increase (Loro
 *  requires monotonic timestamps per peer). */
const DELTA_MINUTES_AGO = [
  49 * 60, // index 1  alex
  48 * 60, // index 2  alex
  26 * 60, // index 3  morgan
  25 * 60, // index 4  morgan
  5 * 60, // index 5  alex
  100, // index 6  alex
  12, // index 7  alex (restore)
  9, // index 8  alex (undo restore)
];

/** Append an entry to the doc's entries list, mirroring seedNoteDoc's per-entry
 *  layout (scalar fields then a nested content Text). */
function appendEntry(doc: LoroDoc, entry: NoteEntry): void {
  const list = doc.getMovableList("entries");
  const idx = (list.toArray() as unknown[]).length;
  const map = list.insertContainer(idx, new LoroMap());
  map.set("id", entry.id);
  map.set("title", entry.title ?? "");
  map.set("date", entry.date ?? "");
  map.set("created_at", entry.created_at ?? "");
  map.set("updated_at", entry.updated_at ?? "");
  const text = map.setContainer("content", new LoroText());
  if (entry.content) text.insert(0, entry.content);
}

/** Commit at a wall-clock time `minutesAgo` before `now`, as whole seconds. */
function commitAt(
  doc: LoroDoc,
  now: Date,
  message: string,
  minutesAgo: number,
): void {
  const timestamp = Math.floor((now.getTime() - minutesAgo * 60_000) / 1000);
  doc.commit({ message, timestamp });
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the multi-commit Loro snapshot for note 5, re-anchored to `now`.
 *
 * Returns the snapshot bytes ready to drop into the fixture blob store at
 * VC_SEED_SIDECAR_PATH. The "snapshot" export carries the full op log and
 * state, so listVersions sees every change and reconstructCanonicalAt can
 * time-travel to any version.
 */
export function buildSeedLoroSidecarBytes(now: Date = new Date()): Uint8Array {
  // Version 0: deterministic genesis under peer 0 (resolves to "seed").
  const doc = new LoroDoc();
  doc.import(seedNoteDoc(GENESIS_NOTE));

  const m = DELTA_MINUTES_AGO;

  // Index 1 [alex]: complete entry 1 (melt-peak annotation + locking note).
  doc.setPeerId(ALEX_PEER);
  setEntryContent(doc, 0, E1_FINAL);
  commitAt(doc, now, "Refined the anneal sweep entry", m[0]);

  // Index 2 [alex]: add entry 2 (primer concentration check).
  appendEntry(doc, ENTRY2);
  commitAt(doc, now, "Added the primer concentration entry", m[1]);

  // Index 3 [morgan]: re-ran the sweep, numbers came back noisier.
  doc.setPeerId(MORGAN_PEER);
  setEntryContent(doc, 0, E1_NOISY);
  commitAt(doc, now, "Re-ran the anneal sweep, numbers look noisy", m[2]);

  // Index 4 [morgan]: add entry 3 as a draft (ACT1 vs PDA1 reference).
  appendEntry(doc, ENTRY3);
  commitAt(doc, now, "Drafted the ACT1 vs PDA1 reference entry", m[3]);

  // Index 5 [alex]: tighten the description and re-confirm the clean numbers.
  doc.setPeerId(ALEX_PEER);
  doc.getMap("meta").set("description", DESC_SHORT);
  setEntryContent(doc, 0, E1_FINAL);
  commitAt(doc, now, "Tightened the description and re-confirmed the numbers", m[4]);

  // Index 6 [alex]: finalize entry 3 and restore the full description. This is
  // the HEAD state and must equal the on-disk note 5 mirror.
  doc.getMap("meta").set("description", DESC_FULL);
  setEntryContent(doc, 2, E3_FINAL);
  commitAt(doc, now, "Finalized the ACT1 vs PDA1 reference numbers", m[5]);

  // Index 7 [alex]: restore to the version-4 draft state (entry 1 noisy, entry
  // 3 back to its draft). A forward commit, matching restoreLoroVersion.
  setEntryContent(doc, 0, E1_NOISY);
  setEntryContent(doc, 2, E3_DRAFT);
  commitAt(doc, now, "restore-v4", m[6]);

  // Index 8 [alex]: undo the restore, back to the HEAD (version-6) state.
  setEntryContent(doc, 0, E1_FINAL);
  setEntryContent(doc, 2, E3_FINAL);
  commitAt(doc, now, "restore-v6", m[7]);

  return doc.export({ mode: "snapshot" });
}

/**
 * A fresh 24h `revert_undo_window` for note 5, matching the seeded history's
 * tail: the restore (index 7) moved the note off version 6 onto version 4, and
 * the undo (index 8) brought it back, so the live window points from_version 6
 * to to_version 4 with `reverted_by: "alex"`. `reverted_at` is a few minutes
 * ago and `expires_at` 24h out, so the window is active at capture time and the
 * "Undo restore" header button renders.
 */
export function buildSeedUndoWindow(now: Date = new Date()): {
  from_version: number;
  to_version: number;
  reverted_at: string;
  expires_at: string;
  reverted_by: string;
} {
  const revertedAt = new Date(now.getTime() - 8 * 60_000); // 8 min ago
  const expiresAt = new Date(revertedAt.getTime() + 24 * 60 * 60_000);
  return {
    from_version: 6,
    to_version: 4,
    reverted_at: revertedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    reverted_by: "alex",
  };
}
