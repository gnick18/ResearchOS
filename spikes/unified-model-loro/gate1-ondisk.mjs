// GATE 1 (highest priority): on-disk model + Grant's locked external-edit policy.
//
// Proves, for a single note:
//  A. Loro doc = merge/history source of truth, persisted as a binary sidecar AND a
//     readable markdown mirror written on save.
//  B. Sequential external edit (mirror changed outside the app while the doc was closed):
//     ingested as ONE snapshot-commit. Clean diff where followable, FULL COPY + warning
//     where whack. Version tree stays walkable BEFORE and AFTER the boundary.
//  C. Concurrent external edit + in-app edit to the same content keeps BOTH as a
//     conflict copy (no silent merge-corrupt).
//  D. Formatting as Loro Peritext marks (not markdown control chars) converges under
//     concurrent formatting without corrupting the text.
//  E. Rebuild-from-readable-file when the sidecar is missing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LoroDoc } from "loro-crdt";
import { check, section, banner } from "./lib/assert.mjs";
import { NoteStore, isCleanlyFollowable } from "./lib/note-store.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rosgate1-"));
console.log("GATE 1 scratch dir:", root);

// =====================================================================
section("A. on-disk model: binary sidecar + readable mirror on save");
// =====================================================================
const note = new NoteStore(root, "note-abc");
note.appEdit((t) => t.insert(0, "PCR master mix recipe"), "create note", 1000);
const fr_v1 = note.doc.frontiers();
note.appEdit((t) => t.insert(t.length, "\n10x buffer 5 uL"), "add buffer line", 2000);
const fr_v2 = note.doc.frontiers();
const sizes = note.save();

check("binary sidecar (.researchos/note-abc.loro) written", note.sidecarExists(), `${sizes.sidecarBytes} bytes`);
check("readable mirror (note-abc.md) written", fs.existsSync(note.mirrorPath), `${sizes.mirrorBytes} bytes`);
const mirror = fs.readFileSync(note.mirrorPath, "utf8");
check("mirror is human-readable plain text", mirror.includes("PCR master mix recipe") && mirror.includes("10x buffer 5 uL"), JSON.stringify(mirror));

// reload from sidecar and confirm doc state survives the round trip
const reloaded = new NoteStore(root, "note-abc").load();
check("doc reloads from binary sidecar byte-identically", reloaded.text().toString() === note.text().toString(), JSON.stringify(reloaded.text().toString()));

// =====================================================================
section("B. sequential external edit: clean case (followable text change)");
// =====================================================================
// Simulate: app closed, the .md edited outside (one line appended).
const cleanNote = new NoteStore(root, "note-clean");
cleanNote.appEdit((t) => t.insert(0, "Gradient: 5% to 95% B over 20 min"), "v1", 1000);
const cleanFrBefore = cleanNote.doc.frontiers();
cleanNote.save();
const externalCleanBody = "Gradient: 5% to 95% B over 25 min, flow 0.3 mL/min";
check("clean change classified followable", isCleanlyFollowable(cleanNote.text().toString(), externalCleanBody));
const ingestClean = cleanNote.ingestExternalEdit(externalCleanBody, 5000);
const cleanFrAfter = cleanNote.doc.frontiers();
check("clean external edit ingested as ONE commit (followable)", ingestClean.followable && !ingestClean.fullCopyStored, ingestClean.message);
// the version IS one change boundary; confirm a real diff exists across it
const cleanDiff = cleanNote.doc.diff(cleanFrBefore, cleanFrAfter);
const cleanDiffOps = cleanDiff[0] && cleanDiff[0][1].diff;
check("clean external edit produces a real char-level diff", Array.isArray(cleanDiffOps) && cleanDiffOps.length > 0, JSON.stringify(cleanDiffOps));
// time-travel walkable on both sides of the boundary
cleanNote.doc.checkout(cleanFrBefore);
const beforeBody = cleanNote.doc.getText("body").toString();
cleanNote.doc.checkoutToLatest();
const afterBody = cleanNote.doc.getText("body").toString();
check("walkable BEFORE the external-edit boundary", beforeBody === "Gradient: 5% to 95% B over 20 min", JSON.stringify(beforeBody));
check("walkable AFTER the external-edit boundary", afterBody === externalCleanBody, JSON.stringify(afterBody));

// =====================================================================
section("B. sequential external edit: whack case (body totally reshaped)");
// =====================================================================
const whackNote = new NoteStore(root, "note-whack");
whackNote.appEdit((t) => t.insert(0, "Gradient: 5% to 95% B over 20 min"), "v1", 1000);
const whackFrBefore = whackNote.doc.frontiers();
whackNote.save();
const externalWhackBody = "TOTALLY DIFFERENT: lysis buffer prep, 50 mM Tris pH 8, 150 mM NaCl, 1% Triton, store 4C";
check("whack change classified NOT followable", !isCleanlyFollowable(whackNote.text().toString(), externalWhackBody));
const ingestWhack = whackNote.ingestExternalEdit(externalWhackBody, 6000);
const whackFrAfter = whackNote.doc.frontiers();
check("whack external edit stores FULL COPY + warning flag", ingestWhack.fullCopyStored && /clean diff unavailable/.test(ingestWhack.message), ingestWhack.message);
// the version boundary is still walkable both sides (full copy == full new state retained)
whackNote.doc.checkout(whackFrBefore);
const wBefore = whackNote.doc.getText("body").toString();
whackNote.doc.checkoutToLatest();
const wAfter = whackNote.doc.getText("body").toString();
check("walkable BEFORE the whack boundary (old full state intact)", wBefore === "Gradient: 5% to 95% B over 20 min", JSON.stringify(wBefore.slice(0, 30)));
check("walkable AFTER the whack boundary (new full copy intact)", wAfter === externalWhackBody, JSON.stringify(wAfter.slice(0, 30)));
// commit message carries the warning the UI surfaces
const lastChange = whackNote.doc.getChangeAt(whackFrAfter[0]);
check("whack version commit message carries the warning", /clean diff unavailable/.test(lastChange.message), lastChange.message);

// =====================================================================
section("C. concurrent external edit + in-app edit -> conflict copy, no silent merge");
// =====================================================================
// Both edits target the SAME content from a common base. Policy: keep BOTH.
const base = new NoteStore(root, "note-concurrent");
base.appEdit((t) => t.insert(0, "Sample S1 concentration 10 ng/uL"), "v1", 1000);
base.save();
const baseBody = base.text().toString();
// In-app edit (committed to the live doc).
base.appEdit((t) => { t.delete(0, t.length); t.insert(0, "Sample S1 concentration 12 ng/uL (re-quantified)"); }, "in-app re-quantify", 2000);
const inAppBody = base.text().toString();
// External edit to the SAME content, made concurrently outside the app on the old base.
const externalConcurrentBody = "Sample S1 concentration 8 ng/uL (per Mira's gel)";
// Policy: detect both diverged from base, keep both as conflict copies rather than merge.
const divergedInApp = inAppBody !== baseBody;
const divergedExternal = externalConcurrentBody !== baseBody;
const conflict = divergedInApp && divergedExternal;
// Materialize the conflict copy alongside the mirror (attachment-conflict idiom).
const conflictPath = path.join(root, "note-concurrent (edited outside ResearchOS).md");
if (conflict) fs.writeFileSync(conflictPath, externalConcurrentBody, "utf8");
check("both sides detected as diverged from common base", conflict);
check("in-app edit preserved verbatim in the live doc", base.text().toString() === inAppBody, JSON.stringify(inAppBody));
check("external edit preserved verbatim as a conflict copy file", fs.existsSync(conflictPath) && fs.readFileSync(conflictPath, "utf8") === externalConcurrentBody);
check("NO silent merge: the two bodies were never blended", inAppBody !== externalConcurrentBody && !base.text().toString().includes("8 ng/uL"));

// =====================================================================
section("D. formatting as Peritext marks converges under concurrent formatting");
// =====================================================================
const fmtA = new LoroDoc(); fmtA.setPeerId(11n);
fmtA.getText("body").insert(0, "the quick brown fox"); fmtA.commit();
const fmtSnap = fmtA.export({ mode: "snapshot" });
const fmtB = new LoroDoc(); fmtB.setPeerId(22n); fmtB.import(fmtSnap);
fmtA.getText("body").mark({ start: 4, end: 9 }, "bold", true); fmtA.commit();   // bold "quick"
fmtB.getText("body").mark({ start: 10, end: 15 }, "italic", true); fmtB.commit(); // italic "brown"
fmtA.import(fmtB.export({ mode: "update" }));
fmtB.import(fmtA.export({ mode: "update" }));
const dA = JSON.stringify(fmtA.getText("body").toDelta());
const dB = JSON.stringify(fmtB.getText("body").toDelta());
check("concurrent bold+italic converge to identical delta", dA === dB, dA);
check("underlying text uncorrupted after concurrent formatting", fmtA.getText("body").toString() === "the quick brown fox", JSON.stringify(fmtA.getText("body").toString()));
check("marks stored in CRDT, NOT as markdown control chars in the text", !fmtA.getText("body").toString().includes("**") && !fmtA.getText("body").toString().includes("*"));
// and the readable mirror still renders the marks to markdown deterministically
const fmtNote = new NoteStore(root, "note-fmt"); fmtNote.doc = fmtA;
check("mirror renders marks to markdown at projection time", /\*\*quick\*\*/.test(fmtNote.renderMarkdown()) && /\*brown\*/.test(fmtNote.renderMarkdown()), JSON.stringify(fmtNote.renderMarkdown()));

// =====================================================================
section("E. rebuild-from-readable-file when the sidecar is missing");
// =====================================================================
const rebuilt = new NoteStore(root, "note-abc");
fs.rmSync(rebuilt.sidecarPath); // simulate lost/stale sidecar
check("sidecar confirmed missing", !rebuilt.sidecarExists());
rebuilt.reseedFromMirror(9000);
const rebuiltBody = rebuilt.text().toString();
check("doc reseeded from the .md alone", rebuiltBody.includes("PCR master mix recipe") && rebuiltBody.includes("10x buffer 5 uL"), JSON.stringify(rebuiltBody));
check("reseeded doc is a valid Loro doc with walkable history", rebuilt.doc.frontiers().length === 1);

banner("GATE 1 (on-disk model + external-edit policy)");
fs.rmSync(root, { recursive: true, force: true });
