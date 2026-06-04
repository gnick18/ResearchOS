// GATE 2: Loro native history + version control.
//
// Asserts Loro gives, natively:
//  - a commit per change carrying time + actor/peer + a commit message
//  - an exact diff between two versions (frontiers / checkout)
//  - restore = re-apply an old version as a NEW change (non-destructive, not a rewind)
//  - attribution: a peer id resolvable to an identity
// Then MEASURES + REPORTS encoded size + load time:
//  - full history vs a shallow snapshot
//  - for a note with several thousand small edits
// and states whether "VC derives from native history" stays cheap or needs compaction.

import { LoroDoc } from "loro-crdt";
import { check, section, banner } from "./lib/assert.mjs";

// A small identity directory, mapping CRDT peer ids to ResearchOS identities
// (the sharing feature's existing directory idea). Persisted before compaction.
const IDENTITY = new Map([
  ["7", "grant@wisc.edu"],
  ["8", "mira@wisc.edu"],
]);
const resolve = (peer) => IDENTITY.get(String(peer)) || `unknown:${peer}`;

// =====================================================================
section("commit per change carries time + peer + message");
// =====================================================================
const d = new LoroDoc();
d.setPeerId(7n);
const t = d.getText("body");
t.insert(0, "Result table draft"); d.commit({ message: "draft results", timestamp: 1700000000 });
const frDraft = d.frontiers();
t.insert(t.length, "\nyield 42 mg"); d.commit({ message: "record yield", timestamp: 1700000100 });
const frYield = d.frontiers();

const c0 = d.getChangeAt({ peer: "7", counter: 0 });
check("change carries a timestamp", typeof c0.timestamp === "number" && c0.timestamp === 1700000000, String(c0.timestamp));
check("change carries an actor/peer id", String(c0.peer) === "7", String(c0.peer));
check("change carries a commit message", c0.message === "draft results", JSON.stringify(c0.message));

// =====================================================================
section("exact diff between two versions (frontiers / checkout)");
// =====================================================================
const diff = d.diff(frDraft, frYield);
const ops = diff[0] && diff[0][1].diff;
check("diff between two frontiers is exact char-level", Array.isArray(ops) && ops.some((o) => o.insert === "\nyield 42 mg"), JSON.stringify(ops));
// checkout time-travel both directions
d.checkout(frDraft);
const atDraft = d.getText("body").toString();
d.checkoutToLatest();
const atLatest = d.getText("body").toString();
check("checkout time-travels to an earlier version", atDraft === "Result table draft", JSON.stringify(atDraft));
check("checkoutToLatest returns to head", atLatest === "Result table draft\nyield 42 mg", JSON.stringify(atLatest));

// =====================================================================
section("restore = re-apply old version as a NEW change, not a destructive rewind");
// =====================================================================
const opsBefore = d.opCount();
d.revertTo(frDraft);
d.commit({ message: "restore to draft", timestamp: 1700000200 });
const opsAfter = d.opCount();
check("restore advances history (new change appended)", opsAfter > opsBefore, `ops ${opsBefore} -> ${opsAfter}`);
check("restore reproduces the old content", d.getText("body").toString() === "Result table draft", JSON.stringify(d.getText("body").toString()));
// the reverted-away version is STILL reachable (history not destroyed)
d.checkout(frYield);
check("the superseded version is still reachable by checkout", d.getText("body").toString() === "Result table draft\nyield 42 mg");
d.checkoutToLatest();
const restoreChange = d.getChangeAt(d.frontiers()[0]);
check("restore is itself an attributed history entry with a message", restoreChange.message === "restore to draft" && String(restoreChange.peer) === "7", JSON.stringify(restoreChange.message));

// =====================================================================
section("attribution: peer id resolvable to a ResearchOS identity");
// =====================================================================
// add a change from a second peer to prove multi-actor attribution
const other = new LoroDoc(); other.setPeerId(8n);
other.import(d.export({ mode: "snapshot" }));
other.getText("body").insert(0, "[reviewed] "); other.commit({ message: "reviewer note", timestamp: 1700000300 });
d.import(other.export({ mode: "update" }));
const peers = new Set();
for (const [peer] of d.getAllChanges()) peers.add(String(peer));
check("history contains both actors", peers.has("7") && peers.has("8"), [...peers].join(","));
check("peer 7 resolves to an identity", resolve(7) === "grant@wisc.edu", resolve(7));
check("peer 8 resolves to an identity", resolve(8) === "mira@wisc.edu", resolve(8));

// =====================================================================
section("MEASURE: history weight, full vs shallow, several thousand small edits");
// =====================================================================
const N = 5000;
const big = new LoroDoc();
big.setPeerId(7n);
const bt = big.getText("body");
// Several thousand small edits, each its own commit (worst case for history weight:
// one change per keystroke-ish edit, the editor-commit-per-idle pattern from section 7).
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  bt.insert(bt.length, (i % 10).toString());
  big.commit({ message: `edit ${i}`, timestamp: 1700000000 + i });
}
const buildMs = performance.now() - t0;

// Full-history export (every change retained).
const fullBytes = big.export({ mode: "snapshot" });
// Shallow snapshot at current head (compaction: drop fine-grained history below the boundary).
const shallowBytes = big.export({ mode: "shallow-snapshot", frontiers: big.frontiers() });
// Update-log-only size (what a relay would store incrementally).
const updateBytes = big.export({ mode: "update" });

// Load time: full vs shallow (the editor-open cost the doc cares about).
function timeLoad(bytes, iters = 20) {
  let best = Infinity;
  for (let i = 0; i < iters; i++) {
    const s = performance.now();
    const r = new LoroDoc();
    r.import(bytes);
    void r.getText("body").length;
    const e = performance.now() - s;
    if (e < best) best = e;
  }
  return best;
}
const fullLoadMs = timeLoad(fullBytes);
const shallowLoadMs = timeLoad(shallowBytes);

// Confirm correctness survives both.
const fullReload = new LoroDoc(); fullReload.import(fullBytes);
const shallowReload = new LoroDoc(); shallowReload.import(shallowBytes);
check(`${N} edits build into one doc`, big.opCount() >= N, `opCount ${big.opCount()}`);
check("full-history reload preserves head state", fullReload.getText("body").length === N);
check("shallow reload preserves head state", shallowReload.getText("body").length === N);
check("shallow reload reports isShallow", shallowReload.isShallow());
check("full reload retains full granular history (still checkoutable mid-stream)", (() => {
  const changes = [...fullReload.getAllChanges().values()][0];
  return changes.length >= N;
})(), `${[...fullReload.getAllChanges().values()][0].length} changes`);

console.log(`\n  MEASURED (note with ${N} small commits):`);
console.log(`    full-history snapshot : ${fullBytes.length} bytes  (${(fullBytes.length / N).toFixed(1)} B/edit)`);
console.log(`    shallow snapshot      : ${shallowBytes.length} bytes`);
console.log(`    update-log only       : ${updateBytes.length} bytes`);
console.log(`    full / shallow ratio  : ${(fullBytes.length / shallowBytes.length).toFixed(1)}x`);
console.log(`    build ${N} commits     : ${buildMs.toFixed(1)} ms`);
console.log(`    load full (best of 20): ${fullLoadMs.toFixed(2)} ms`);
console.log(`    load shallow (best 20): ${shallowLoadMs.toFixed(2)} ms`);

// Verdict heuristic for the report: is native-history load cheap enough for an editor-open?
const cheapBudgetMs = 50; // an editor open should be well under this
check(`full-history load under ${cheapBudgetMs}ms editor-open budget`, fullLoadMs < cheapBudgetMs, `${fullLoadMs.toFixed(2)} ms`);
console.log(`\n  NOTE: shallow snapshot is the compaction knob. Full history is cheap to load here,`);
console.log(`  so VC-from-native-history stays cheap at this scale; compaction is a size/retention`);
console.log(`  knob (and a granularity-below-the-boundary tradeoff), not a load-time necessity.`);

banner("GATE 2 (native history + version control)");
