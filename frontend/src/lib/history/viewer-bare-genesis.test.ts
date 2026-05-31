// Version Control P0 regression: the viewer reconstruction flow for a
// BARE-GENESIS history (the "create a note, then make a first tracked save"
// case). This is the test gap that let the P0 ship: the existing
// reconstructState tests either backfill genesis_state OR anchor genesis at the
// EMPTY doc (seedHistory always uses canonicalize({}) as the pre-image), so the
// engine resolves the anchor WITHOUT headCanonical and the bug never surfaces.
//
// The real pilot flow is different: a note already exists on disk (non-empty)
// when history tracking turns on, so the FIRST tracked save anchors genesis at a
// NON-EMPTY pre-image. Then emptyHash !== genesis.post_hash and reconstructState
// REQUIRES headCanonical to reverse-walk from HEAD and lazily backfill the
// anchor (R4-prep 2c). These tests reproduce the VIEWER call pattern (pass
// headCanonical = canonicalize(liveHeadRecord)), not the engine-with-perfect-
// args pattern, and assert the reconstruction is non-empty + correct.

import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize";
import { isGenesisRow } from "./types";
import { ENTITY, ID, OWNER, makeEngine, readRows } from "./test-utils";

/**
 * Build the bare-genesis history the way the app does: a note that already
 * exists (non-empty pre-state) gets its FIRST tracked save, then a couple more
 * edits. Genesis is anchored at the non-empty pre-image, so its post_hash does
 * NOT match the empty-doc hash and the engine cannot resolve the anchor without
 * the live HEAD canonical. Returns the live HEAD record (what the popup holds)
 * plus the canonical states for each version index.
 */
async function buildCreateThenEditHistory() {
  const { engine, storage } = makeEngine();

  // The note as it existed on disk BEFORE the first tracked save (non-empty).
  const created = {
    id: ID,
    title: "PCR master mix",
    description: "",
    entries: [{ id: "e0", title: "Recipe", content: "10x buffer" }],
    username: OWNER,
  };
  // First tracked save: add a reagent line.
  const editedOnce = {
    ...created,
    entries: [
      { id: "e0", title: "Recipe", content: "10x buffer\n25 mM MgCl2" },
    ],
  };
  // Second tracked save: change the title too.
  const editedTwice = {
    ...editedOnce,
    title: "PCR master mix (v2)",
  };

  // prevState = the ALREADY-CREATED non-empty record -> bare non-empty genesis.
  await engine.appendEdit({
    type: "update",
    entityType: ENTITY,
    id: ID,
    owner: OWNER,
    actor: OWNER,
    prevState: created,
    nextState: editedOnce,
  });
  await engine.appendEdit({
    type: "update",
    entityType: ENTITY,
    id: ID,
    owner: OWNER,
    actor: OWNER,
    prevState: editedOnce,
    nextState: editedTwice,
  });

  const rows = readRows(storage);
  // Canonical state at each version index: 0 = genesis (the created pre-image),
  // 1 = after first save, 2 = after second save (= live HEAD).
  const canonicalByIndex = [
    canonicalize(created),
    canonicalize(editedOnce),
    canonicalize(editedTwice),
  ];
  return { engine, storage, rows, canonicalByIndex, liveHead: editedTwice };
}

describe("viewer reconstruction: bare non-empty genesis (create-then-edit P0)", () => {
  it("seeds a bare genesis whose pre-image is non-empty (no genesis_state)", async () => {
    const { rows } = await buildCreateThenEditHistory();
    expect(rows.length).toBe(3); // genesis + 2 deltas
    expect(isGenesisRow(rows[0])).toBe(true);
    // No backfilled genesis_state, and the anchor is NOT the empty doc.
    const genesis = rows[0];
    if (!isGenesisRow(genesis)) throw new Error("row 0 should be genesis");
    expect(genesis.genesis_state).toBeUndefined();
  });

  it("WITHOUT headCanonical the engine cannot resolve the anchor (the bug)", async () => {
    // This is exactly what the viewer used to do: reconstructState without the
    // 5th arg. The engine is correct to refuse; the viewer must supply HEAD.
    const { engine, rows } = await buildCreateThenEditHistory();
    await expect(
      engine.reconstructState(ENTITY, OWNER, ID, rows.length - 1),
    ).rejects.toThrow(/cannot resolve anchor/);
  });

  it("WITH headCanonical (the viewer fix) every version reconstructs non-empty + correct", async () => {
    const { engine, rows, canonicalByIndex, liveHead } =
      await buildCreateThenEditHistory();
    // The viewer passes headCanonical = canonicalize(liveHeadRecord).
    const headCanonical = canonicalize(liveHead);

    for (let i = 0; i < rows.length; i++) {
      const reconstructed = await engine.reconstructState(
        ENTITY,
        OWNER,
        ID,
        i,
        headCanonical,
      );
      // Non-empty (the P0 symptom was every state coming back as "").
      expect(reconstructed.length).toBeGreaterThan(0);
      // Byte-for-byte correct against the known state at that version.
      expect(reconstructed).toEqual(canonicalByIndex[i]);
    }
  });

  it("the genesis anchor backfills to the non-empty created pre-image", async () => {
    // reconstructState(0) with headCanonical must recover the ORIGINAL created
    // state by reverse-walking from HEAD (R4-prep 2c lazy backfill), proving the
    // anchor is derived, not assumed empty.
    const { engine, canonicalByIndex, liveHead } =
      await buildCreateThenEditHistory();
    const headCanonical = canonicalize(liveHead);
    const anchor = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      0,
      headCanonical,
    );
    expect(anchor).toEqual(canonicalByIndex[0]);
    // And it is genuinely non-empty (the created note), not canonicalize({}).
    expect(anchor).not.toEqual(canonicalize({}));
    expect(anchor).toContain("PCR master mix");
  });

  it("the predecessor diff for each non-genesis version is a real, non-empty change", async () => {
    // Mirrors how the sidebar derives a diff: before = reconstruct(i-1),
    // after = reconstruct(i). With the fix both are non-empty and differ.
    const { engine, rows, liveHead } = await buildCreateThenEditHistory();
    const headCanonical = canonicalize(liveHead);
    for (let i = 1; i < rows.length; i++) {
      const before = await engine.reconstructState(
        ENTITY,
        OWNER,
        ID,
        i - 1,
        headCanonical,
      );
      const after = await engine.reconstructState(
        ENTITY,
        OWNER,
        ID,
        i,
        headCanonical,
      );
      expect(before.length).toBeGreaterThan(0);
      expect(after.length).toBeGreaterThan(0);
      expect(after).not.toEqual(before); // a real, visible change
    }
  });
});
