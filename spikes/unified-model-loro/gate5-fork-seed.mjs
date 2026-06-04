// GATE 5: the fork pitfall + deterministic seed.
//
//  - Two independent "clients" build a Loro doc from the SAME legacy markdown via a
//    deterministic seed (fixed peer, fixed timestamp, canonical ordering).
//    ASSERT they CONVERGE on merge: identical state, no duplication.
//  - Then ASSERT a NON-deterministic seed (different peer ids) DOES fork/duplicate,
//    proving the seed function is what fixes it.

import { LoroDoc } from "loro-crdt";
import { check, section, banner } from "./lib/assert.mjs";
import { deterministicSeed, nonDeterministicSeed } from "./lib/seed.mjs";

const ENTITY_ID = "exp-2026-06-04-elute";
const LEGACY = "Elution: 500 mM imidazole, 3 x 1 mL fractions, pool by A280.";

// =====================================================================
section("deterministic seed: two independent clients converge, no duplication");
// =====================================================================
// Client 1 and client 2 each import the same legacy file on their own machine,
// with NO knowledge of each other, then later sync.
const seed1 = deterministicSeed(ENTITY_ID, LEGACY);
const seed2 = deterministicSeed(ENTITY_ID, LEGACY);

check("the two seed snapshots are byte-identical", Buffer.compare(Buffer.from(seed1), Buffer.from(seed2)) === 0, `${seed1.length} vs ${seed2.length} bytes`);

const c1 = new LoroDoc(); c1.import(seed1);
const c2 = new LoroDoc(); c2.import(seed2);

// They sync to each other (each imports the other's update log).
c1.import(c2.export({ mode: "update" }));
c2.import(c1.export({ mode: "update" }));

const b1 = c1.getText("body").toString();
const b2 = c2.getText("body").toString();
check("client 1 body == legacy (no duplication)", b1 === LEGACY, JSON.stringify(b1));
check("client 2 body == legacy (no duplication)", b2 === LEGACY, JSON.stringify(b2));
check("the bodies converged identically", b1 === b2);
// converged at the byte level too (same canonical state)
const s1 = c1.export({ mode: "snapshot" });
const s2 = c2.export({ mode: "snapshot" });
check("post-merge snapshots are byte-identical (true convergence)", Buffer.compare(Buffer.from(s1), Buffer.from(s2)) === 0);
// exactly one body's worth of content, not two concatenated
check("no doubled content: length == one legacy body", c1.getText("body").length === LEGACY.length, `${c1.getText("body").length} vs ${LEGACY.length}`);

// And now a real concurrent edit on top of the shared seed merges cleanly
c1.getText("body").insert(c1.getText("body").length, " (lot A)"); c1.commit();
c2.getText("body").insert(0, "[QC] "); c2.commit();
c1.import(c2.export({ mode: "update" }));
c2.import(c1.export({ mode: "update" }));
check("post-seed concurrent edits merge cleanly on both clients", c1.getText("body").toString() === c2.getText("body").toString(), JSON.stringify(c1.getText("body").toString()));

// =====================================================================
section("non-deterministic seed: different peer ids FORK / duplicate (the pitfall)");
// =====================================================================
const badSeedA = nonDeterministicSeed(ENTITY_ID, LEGACY, 101n);
const badSeedB = nonDeterministicSeed(ENTITY_ID, LEGACY, 202n);
check("non-deterministic seed snapshots are NOT byte-identical", Buffer.compare(Buffer.from(badSeedA), Buffer.from(badSeedB)) !== 0, `${badSeedA.length} vs ${badSeedB.length} bytes`);

const bad1 = new LoroDoc(); bad1.import(badSeedA);
const bad2 = new LoroDoc(); bad2.import(badSeedB);
bad1.import(bad2.export({ mode: "update" }));
bad2.import(bad1.export({ mode: "update" }));

const badBody = bad1.getText("body").toString();
// Two independent inserts of the same text at pos 0 from different actors = the body
// is duplicated/interleaved (the fork). It is NOT equal to a single clean legacy body.
check("merged body is NOT the clean single legacy body (it forked)", badBody !== LEGACY, JSON.stringify(badBody.slice(0, 60) + "..."));
check("merged body length is roughly doubled (duplicated content)", bad1.getText("body").length > LEGACY.length * 1.5, `${bad1.getText("body").length} vs ${LEGACY.length}`);
check("both copies of the legacy substring are present (duplication proven)", (badBody.match(/imidazole/g) || []).length === 2, `imidazole count: ${(badBody.match(/imidazole/g) || []).length}`);

console.log("\n  CONCLUSION: identical content is NOT enough; the deterministic seed (fixed peer +");
console.log("  fixed timestamp + canonical ordering) is precisely what turns an independent");
console.log("  re-import into the SAME operations, so two clients converge instead of forking.");

banner("GATE 5 (fork pitfall + deterministic seed)");
