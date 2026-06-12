// One-off: relocate over-stuffed note `description` bodies into a single note
// entry (verbatim) and replace the description with a short one-line summary.
// Demo/fixture data only. See HR dispatch 2026-06-11.
import { readFileSync, writeFileSync } from "node:fs";

const BASE = new URL("../public/demo-data/users/", import.meta.url);

// path (relative to BASE) -> { desc: short summary, label: entry title suffix }
const FIXES = {
  "alex/notes/1.json": {
    desc: "Transformed FakeYeast-001 with pYES-GAL1::flbA using the LiAc protocol.",
    label: "transformation run",
  },
  "alex/notes/3.json": {
    desc: "Bench card for the column mini-prep.",
    label: "mini-prep recipe",
  },
  "alex/notes/4.json": {
    desc: "Lab meeting on strain design, covering flbA integration data and the 96-well screen plan.",
    label: "lab meeting notes",
  },
  "alex/notes/6.json": {
    desc: "Reorganizing -80 freezer 3, shelf 2 (what was kept and what was discarded).",
    label: "freezer cleanout",
  },
  "alex/notes/7.json": {
    desc: "Prep card for the 1:1 calendar event.",
    label: "1:1 prep",
  },
  "mira/notes/1.json": {
    desc: "Check-in covering the chapter 2 figure plan, fakeGFP data, and conference travel.",
    label: "check-in notes",
  },
  "morgan/notes/2.json": {
    desc: "Bench card for setting up the 96-well fluorescence screen.",
    label: "screen prep checklist",
  },
  "morgan/notes/3.json": {
    desc: "Lab meeting recap, taken from my seat.",
    label: "meeting notes",
  },
  "morgan/notes/4.json": {
    desc: "Whiteboard session to design a GFP heat-stress survival assay for the FY-Δgal80 library.",
    label: "brainstorm notes",
  },
  "morgan/notes/5.json": {
    desc: "Tracking the reagents I'm responsible for on shelf 2.",
    label: "reagent tracker",
  },
  "morgan/notes/7.json": {
    desc: "First proper screen of the FY-Δgal80 candidate library off the H1 reader.",
    label: "reader run",
  },
};

for (const [rel, { desc, label }] of Object.entries(FIXES)) {
  const url = new URL(rel, BASE);
  const note = JSON.parse(readFileSync(url, "utf8"));
  if (note.entries.length !== 0) {
    throw new Error(`${rel}: expected empty entries, got ${note.entries.length}`);
  }
  const ymd = note.created_at.slice(0, 10); // YYYY-MM-DD from ISO created_at
  const entry = {
    id: `${note.username}-note${note.id}-e1`,
    title: `${ymd}: ${label}`,
    date: ymd,
    content: note.description, // verbatim relocation, no rewrite
    created_at: note.created_at,
    updated_at: note.updated_at,
  };
  note.description = desc;
  note.entries = [entry];
  writeFileSync(url, JSON.stringify(note, null, 2) + "\n");
  console.log(`fixed ${rel} (desc ${desc.length} chars, entry ${entry.content.length} chars)`);
}
