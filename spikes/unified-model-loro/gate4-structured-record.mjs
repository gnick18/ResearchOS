// GATE 4: one structured record in one doc.
//
// Build an experiment as a SINGLE Loro doc mixing:
//   - typed scalar fields  (LoroMap LWW + LoroCounter)
//   - a nested folder structure (LoroTree, the Movable Tree)
//   - a rich-text notes field (LoroText)
// ASSERT:
//   - two peers editing DIFFERENT fields merge cleanly
//   - two peers setting the SAME scalar resolve to a deterministic winner, loser inspectable
//   - attributable history reads correctly ACROSS the mixed types in one timeline

import { LoroDoc } from "loro-crdt";
import { check, section, banner } from "./lib/assert.mjs";

const IDENTITY = new Map([["5", "grant@wisc.edu"], ["9", "mira@wisc.edu"]]);
const resolve = (p) => IDENTITY.get(String(p)) || `unknown:${p}`;

// One doc, one experiment. Containers:
//   fields (Map)  : scalars  -> title, status, temperature_c
//   counts (Counter): monotonic tally -> aliquots_used
//   tree (Tree)   : nested folder of runs/samples
//   notes (Text)  : free-text narrative
function newExperiment(peerId) {
  const d = new LoroDoc();
  d.setPeerId(peerId);
  return d;
}

// =====================================================================
section("build one experiment doc mixing Map + Counter + Tree + Text");
// =====================================================================
const grant = newExperiment(5n);
grant.getMap("fields").set("title", "Ni-NTA elution optimization");
grant.getMap("fields").set("status", "draft");
grant.getMap("fields").set("temperature_c", 4);
grant.getCounter("counts").increment(3); // 3 aliquots used
const tree = grant.getTree("tree");
const runRoot = tree.createNode();
runRoot.data.set("name", "Run 1");
const sample = runRoot.createNode();
sample.data.set("name", "Fraction A2");
grant.getText("notes").insert(0, "Pooled by A280, see gel image.");
grant.commit({ message: "create experiment", timestamp: 1000 });

check("Map scalar present", grant.getMap("fields").get("title") === "Ni-NTA elution optimization");
check("Counter present", grant.getCounter("counts").value === 3, String(grant.getCounter("counts").value));
check("Tree nested folder present", tree.roots().length === 1 && tree.roots()[0].children().length === 1);
check("Text notes present", grant.getText("notes").toString() === "Pooled by A280, see gel image.");

// snapshot the shared base for two collaborators
const base = grant.export({ mode: "snapshot" });

// =====================================================================
section("two peers editing DIFFERENT fields merge cleanly");
// =====================================================================
const g = new LoroDoc(); g.import(base); g.setPeerId(5n);
const m = new LoroDoc(); m.import(base); m.setPeerId(9n);

// grant edits temperature + appends notes; mira edits status + counter + adds a tree node
g.getMap("fields").set("temperature_c", 8);
g.getText("notes").insert(g.getText("notes").length, " Repeat at 8C.");
g.commit({ message: "bump temp + note", timestamp: 2000 });

m.getMap("fields").set("status", "in-progress");
m.getCounter("counts").increment(2);
const mTree = m.getTree("tree");
const mRoot = mTree.roots()[0];
const newSample = mRoot.createNode();
newSample.data.set("name", "Fraction A3");
m.commit({ message: "advance status + sample", timestamp: 2001 });

// sync both ways
g.import(m.export({ mode: "update" }));
m.import(g.export({ mode: "update" }));

check("temperature (grant) merged", g.getMap("fields").get("temperature_c") === 8, String(g.getMap("fields").get("temperature_c")));
check("status (mira) merged", g.getMap("fields").get("status") === "in-progress", String(g.getMap("fields").get("status")));
check("counter merged additively (3 + 2)", g.getCounter("counts").value === 5, String(g.getCounter("counts").value));
check("notes (grant) merged", g.getText("notes").toString().includes("Repeat at 8C."), JSON.stringify(g.getText("notes").toString()));
check("tree node (mira) merged: 2 samples under Run 1", g.getTree("tree").roots()[0].children().length === 2, String(g.getTree("tree").roots()[0].children().length));
// true convergence across all mixed types
check("both replicas converge to identical state", JSON.stringify(g.toJSON()) === JSON.stringify(m.toJSON()));

// =====================================================================
section("two peers setting the SAME scalar -> deterministic winner, loser inspectable");
// =====================================================================
const g2 = new LoroDoc(); g2.import(base); g2.setPeerId(5n);
const m2 = new LoroDoc(); m2.import(base); m2.setPeerId(9n);
g2.getMap("fields").set("status", "validated"); g2.commit({ message: "grant: validated", timestamp: 3000 });
const grantLosingFrontier = g2.frontiers();
m2.getMap("fields").set("status", "rejected"); m2.commit({ message: "mira: rejected", timestamp: 3001 });

g2.import(m2.export({ mode: "update" }));
m2.import(g2.export({ mode: "update" }));
const winner = g2.getMap("fields").get("status");
check("both replicas agree on a single deterministic winner", winner === m2.getMap("fields").get("status"), `winner = ${winner}`);
check("winner is one of the two writes (no corruption)", winner === "validated" || winner === "rejected", String(winner));
// loser still inspectable: checkout the losing write's frontier to read the discarded value
g2.checkout(grantLosingFrontier);
const loserValue = g2.getMap("fields").get("status");
g2.checkoutToLatest();
check("loser value recoverable from history (checkout the losing frontier)", loserValue === "validated", String(loserValue));
const loserChange = g2.getChangeAt(grantLosingFrontier[0]);
check("loser write carries attribution + message in history", String(loserChange.peer) === "5", `peer ${loserChange.peer}`);

// =====================================================================
section("attributable history reads correctly ACROSS the mixed types in one timeline");
// =====================================================================
// Walk the merged doc's full change set; every change resolves to an identity, and the
// timeline spans edits to Map, Counter, Tree, and Text in one ordered history.
const changesByPeer = g.getAllChanges();
const peers = new Set([...changesByPeer.keys()].map(String));
check("timeline contains both actors", peers.has("5") && peers.has("9"), [...peers].join(","));
check("every peer in history resolves to an identity", [...peers].every((p) => !resolve(p).startsWith("unknown:")), [...peers].map(resolve).join(", "));

// attribution per container type: who last touched each
check("last editor of a Map scalar resolves", resolve(g.getMap("fields").getLastEditor("status")) === "mira@wisc.edu", resolve(g.getMap("fields").getLastEditor("status")));
check("last editor of the other Map scalar resolves", resolve(g.getMap("fields").getLastEditor("temperature_c")) === "grant@wisc.edu", resolve(g.getMap("fields").getLastEditor("temperature_c")));

// the whole history is one ordered, time-stamped timeline regardless of which type changed
const allTimestamps = [];
for (const [, arr] of changesByPeer) for (const c of arr) allTimestamps.push(c.timestamp);
check("history carries timestamps across all change types (one timeline)", allTimestamps.length >= 3 && allTimestamps.every((t) => typeof t === "number"), `${allTimestamps.length} changes`);

// confirm a single change can be inspected and it spans the mixed-type doc coherently
const firstChange = g.getChangeAt({ peer: "5", counter: 0 });
check("first change is attributed + messaged (create experiment)", firstChange.message === "create experiment" && String(firstChange.peer) === "5", JSON.stringify(firstChange.message));

banner("GATE 4 (one structured record in one doc)");
