// Deterministic synthetic multiuser-folder generator for migration testing.
//
// Given a username list + a primary + a seed, writeSynthFolder() lays down a
// realistic multiuser folder that embeds EVERY on-disk user-reference type and
// EVERY structural trap the migration must survive, so the invariant checker
// can prove correctness across hundreds of generated shapes in CI. The seed
// only varies surface values (titles, ids, counts), never the set of edge
// cases, so coverage is stable while the data differs run to run.
//
// Edge cases embedded (see EDGE_CASES below for the catalog):
//   - share grants in string AND object form, plus the "*" wildcard + is_shared
//   - KEEP attribution (assignee, comment author + mentions, last_edited_by,
//     created_by) as negative controls that MUST survive untouched
//   - external_project hosting ref to a moved owner (must be cleared)
//   - the three array/sidecar files: _shared_with_me.json, _notifications.json
//     (ROOT ARRAY), projects/<id>-hosted.json (must prune moved-owner entries)
//   - a 1:1 shared notebook (title rename) and a plain shared notebook
//   - structural traps: empty dir, non-json file, MALFORMED json, a top-level
//     ARRAY json that is not a known sidecar, and a binary blob (.loro bytes)
//   - an ARCHIVED user (deleted_at) whose dir must linger untouched + invisible
//   - a self-reference (primary in its own shared_with) that must be retained
//
// This is test-support code (node:fs), never imported by the app bundle.
//
// No emojis, no em-dashes, no mid-sentence colons.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export const EDGE_CASES = [
  "share grant: object form { username, level }",
  "share grant: plain string form",
  "share grant: '*' wildcard + is_shared:true",
  "KEEP: assignee scalar",
  "KEEP: comment author + mentions",
  "KEEP: last_edited_by",
  "KEEP: created_by",
  "self-reference in shared_with (primary keeps itself)",
  "external_project ref to a moved owner (clear)",
  "_shared_with_me.json nested owners (prune entries)",
  "_notifications.json { version, notifications:[] } from_user/owner_username (prune entries)",
  "projects/<id>-hosted.json hostedTasks owner/sharedBy (prune entries)",
  "1:1 shared notebook (title rename + member strip)",
  "plain shared notebook (member strip)",
  "structural: empty directory",
  "structural: non-json file (md) byte-stable",
  "structural: MALFORMED json skipped + byte-stable",
  "structural: top-level ARRAY json (non-sidecar) untouched",
  "structural: binary blob (.loro) byte-exact across bundle",
  "archived user (deleted_at): dir lingers, invisible, untouched",
] as const;

// ---------------------------------------------------------------------------
// Seeded PRNG (deterministic; Math.random avoided for reproducibility).
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Small fs helpers (paths relative to folder root).
// ---------------------------------------------------------------------------

async function writeJson(root: string, rel: string, value: unknown): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(value, null, 2), "utf8");
}

async function writeRaw(root: string, rel: string, data: string | Buffer): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

async function mkdir(root: string, rel: string): Promise<void> {
  await fs.mkdir(path.join(root, rel), { recursive: true });
}

// ---------------------------------------------------------------------------
// writeSynthFolder
// ---------------------------------------------------------------------------

export interface SynthOptions {
  /** All person usernames in the folder (the primary plus labmates). */
  users: string[];
  /** The connecting user who keeps the folder. Must be in `users`. */
  primary: string;
  /** Deterministic seed (varies surface values only). */
  seed: number;
  /** If set, the primary's settings.json account_type is "lab_head". */
  primaryIsLabHead?: boolean;
  /** Optional username to mark archived (deleted_at). NOT in `users`. */
  archivedUser?: string;
}

export interface SynthResult {
  root: string;
  /** Every edge case this folder embedded (subset of EDGE_CASES). */
  embedded: string[];
}

/**
 * Lay down a complete multiuser folder at `root`. The primary's tree carries
 * every reference type; each labmate gets a small real single-user tree (with a
 * binary blob) so the bundle/trash byte-exact checks have teeth.
 */
export async function writeSynthFolder(root: string, opts: SynthOptions): Promise<SynthResult> {
  const { users, primary, seed } = opts;
  const rnd = mulberry32(seed);
  const rid = () => Math.floor(rnd() * 100000);
  const others = users.filter((u) => u !== primary);
  const u1 = others[0] ?? primary;
  const u2 = others[1] ?? u1;
  const embedded = [...EDGE_CASES];

  // --- Global metadata + counters ---
  const meta: Record<string, unknown> = {};
  for (const u of users) meta[u] = { color: `#${(rid() & 0xffffff).toString(16).padStart(6, "0")}`, created_at: "2026-01-01T00:00:00Z" };
  if (opts.archivedUser) meta[opts.archivedUser] = { color: "#999999", created_at: "2026-01-01T00:00:00Z", deleted_at: "2026-03-01T00:00:00Z" };
  await writeJson(root, "users/_user_metadata.json", meta);
  await writeJson(root, "_global_counters.json", { methods: rid(), pcr_protocols: rid() });
  await mkdir(root, "users/public/methods");
  await mkdir(root, "users/lab/funding_accounts");

  // --- Each labmate: a small real single-user tree (whole-folder leaves) ---
  for (const u of [...others, ...(opts.archivedUser ? [opts.archivedUser] : [])]) {
    await writeJson(root, `users/${u}/_counters.json`, { tasks: 3, notes: 2 });
    await writeJson(root, `users/${u}/settings.json`, { account_type: "member", display_name: u });
    await writeJson(root, `users/${u}/tasks/1.json`, { id: 1, owner: u, title: `${u} task`, shared_with: [{ username: primary, level: "read" }] });
    await writeJson(root, `users/${u}/notes/1.json`, { id: 1, username: u, title: `${u} note` });
    // a binary blob (fake Loro bytes) to prove byte-exact copy through bundle
    const bin = Buffer.from(Array.from({ length: 64 }, () => Math.floor(rnd() * 256)));
    await writeRaw(root, `users/${u}/.researchos/notes/1.loro`, bin);
    await writeRaw(root, `users/${u}/results/task-1/notes.md`, `# ${u}\nbench notes ${rid()}\n`);
  }

  // --- Primary records ---
  const P = `users/${primary}`;
  await writeJson(root, `${P}/_counters.json`, { tasks: 20, notes: 10, projects: 5 });
  await writeJson(root, `${P}/settings.json`, { account_type: opts.primaryIsLabHead ? "lab_head" : "member", display_name: primary });

  // shared_with object form + is_shared
  await writeJson(root, `${P}/tasks/1.json`, { id: 1, owner: primary, title: "Object-form share", body: "keep me", date: "2026-02-01", shared_with: [{ username: u1, level: "edit" }], is_shared: true });
  // shared_with string form
  await writeJson(root, `${P}/tasks/2.json`, { id: 2, owner: primary, title: "String-form share", shared_with: [u2], is_shared: true });
  // wildcard + is_shared
  await writeJson(root, `${P}/tasks/3.json`, { id: 3, owner: primary, title: "Wildcard share", shared_with: ["*"], is_shared: true });
  // KEEP assignee
  await writeJson(root, `${P}/tasks/4.json`, { id: 4, owner: primary, title: "Assigned", assignee: u1 });
  // KEEP comment author + mentions
  await writeJson(root, `${P}/tasks/5.json`, { id: 5, owner: primary, title: "Commented", comments: [{ author: u2, text: `hey @${u1}`, mentions: [u1] }] });
  // external_project to a moved owner -> cleared
  await writeJson(root, `${P}/tasks/6.json`, { id: 6, owner: primary, title: "Hosted out", external_project: { owner: u1, id: 7, sharedAt: "2026-02-02T00:00:00Z" } });
  // KEEP last_edited_by
  await writeJson(root, `${P}/tasks/7.json`, { id: 7, owner: primary, title: "Edited by other", last_edited_by: u2 });
  // mixed: moved + self in shared_with (self must remain)
  await writeJson(root, `${P}/tasks/8.json`, { id: 8, owner: primary, title: "Mixed share", shared_with: [{ username: u1, level: "read" }, { username: primary, level: "edit" }], is_shared: true });

  // project + hosted manifest (prune moved owner, keep self)
  await writeJson(root, `${P}/projects/1.json`, { id: 1, owner: primary, title: "Project one", shared_with: [u1, u2] });
  await writeJson(root, `${P}/projects/1-hosted.json`, { version: 1, hostedTasks: [
    { owner: u1, taskId: 3, sharedAt: "2026-02-03T00:00:00Z", sharedBy: u1 },
    { owner: primary, taskId: 99, sharedAt: "2026-02-03T00:00:00Z", sharedBy: primary },
  ] });

  // note with share + KEEP comment author
  await writeJson(root, `${P}/notes/1.json`, { id: 1, username: primary, title: "Shared note", shared_with: [{ username: u2, level: "edit" }], comments: [{ author: u1, text: "nice" }] });

  // 1:1 notebook (title rename + member strip) and plain shared notebook
  await writeJson(root, `${P}/shared_notebooks/nb-1on1.json`, { id: "nb-1on1", title: `1:1 with ${u1}`, members: [primary, u1], created_by: primary, owner: primary, shared_with: [{ username: primary, level: "edit" }, { username: u1, level: "edit" }] });
  await writeJson(root, `${P}/shared_notebooks/nb-team.json`, { id: "nb-team", title: "Team notebook", members: [primary, u1, u2], created_by: u1, owner: primary, shared_with: [{ username: primary, level: "edit" }, { username: u1, level: "edit" }, { username: u2, level: "edit" }] });

  // method with KEEP created_by + wildcard share
  await writeJson(root, `${P}/methods/1.json`, { id: 1, owner: primary, title: "Method one", created_by: u2, shared_with: ["*"] });

  // goal with share
  await writeJson(root, `${P}/goals/1.json`, { id: 1, owner: primary, text: "Goal", shared_with: [u1], is_shared: true });

  // sidecar: _shared_with_me.json (prune moved owners, keep self)
  await writeJson(root, `${P}/_shared_with_me.json`, { version: 1,
    tasks: [{ id: 3, owner: u1, permission: "edit" }, { id: 9, owner: u2, permission: "view" }],
    projects: [{ id: 1, owner: u2, permission: "view" }],
    methods: [{ id: 5, owner: u1, permission: "view" }],
  });

  // sidecar: _notifications.json (real shape { version, notifications: [...] };
  // prune moved-user entries by from_user / owner_username, keep primary-only)
  await writeJson(root, `${P}/_notifications.json`, { version: 1, notifications: [
    { id: "n1", type: "task_shared", from_user: u1, created_at: "2026-02-01T00:00:00Z", read: false },
    { id: "n2", type: "lab_comment", from_user: primary, owner_username: u2, created_at: "2026-02-01T00:00:00Z", read: false },
    { id: "n3", type: "system", from_user: primary, owner_username: primary, created_at: "2026-02-01T00:00:00Z", read: true },
  ] });

  // --- Structural traps under the primary ---
  await mkdir(root, `${P}/empty_dir`); // empty directory
  await writeRaw(root, `${P}/results/task-1/notes.md`, `# Bench\nprimary notes ${rid()}\n`); // non-json, byte-stable
  await writeRaw(root, `${P}/broken/oops.json`, `{ this is not valid json `); // malformed json, skipped + byte-stable
  await writeJson(root, `${P}/lists/freeform.json`, ["alpha", "beta", "gamma"]); // top-level array, non-sidecar, untouched
  const blob = Buffer.from(Array.from({ length: 128 }, () => Math.floor(rnd() * 256)));
  await writeRaw(root, `${P}/.researchos/notes/1.loro`, blob); // binary, byte-stable

  return { root, embedded };
}
