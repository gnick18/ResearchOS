/**
 * Drift + determinism guard for the phone-note content-anchor helpers
 * (P2, 2026-06-15).
 *
 * note-anchor.ts is DUPLICATED on the laptop side
 * (frontend/src/lib/mobile-relay/note-anchor.ts) because the two packages
 * cannot import across the workspace boundary. This test pins the round-trip
 * contract the placement relies on:
 *   1. splitBlocks splits on blank-line boundaries, trims, drops empties.
 *   2. The same input always produces the same anchors (deterministic).
 *   3. Changing a block's content changes its anchor.
 *   4. The anchors match the laptop copy for a shared fixture (the same
 *      assertions live in the vitest mirror; the hex values are pinned here so
 *      either side drifting is caught).
 *
 * No mobile test runner is installed (mobile/package.json has no jest/vitest),
 * so this is a self-contained node test run with native TypeScript stripping:
 *
 *   cd mobile && node --experimental-strip-types lib/note-anchor.test.ts
 *
 * It prints one line per assertion and exits non-zero on the first failure.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { splitBlocks, blockAnchor } from './note-anchor.ts';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T): void {
  ok(`${label} (got ${JSON.stringify(actual)})`, actual === expected);
}

// ── splitBlocks ───────────────────────────────────────────────────────────────

const doc = '# Title\n\nFirst paragraph.\n\n- a\n- b\n\n\n  \n\nLast block.\n';
const blocks = splitBlocks(doc);
eq('splitBlocks count', blocks.length, 4);
eq('splitBlocks[0]', blocks[0], '# Title');
eq('splitBlocks[1]', blocks[1], 'First paragraph.');
eq('splitBlocks[2]', blocks[2], '- a\n- b');
eq('splitBlocks[3]', blocks[3], 'Last block.');

eq('splitBlocks empty doc', splitBlocks('').length, 0);
eq('splitBlocks whitespace-only doc', splitBlocks('   \n\n   ').length, 0);

// CRLF is normalized to LF before splitting.
eq('splitBlocks CRLF', splitBlocks('a\r\n\r\nb').length, 2);

// ── blockAnchor determinism ─────────────────────────────────────────────────

const a1 = blockAnchor('First paragraph.');
const a2 = blockAnchor('First paragraph.');
eq('same input same anchor', a1, a2);

// Normalization: whitespace runs collapse, case folds, edges trim.
eq(
  'whitespace + case normalized to same anchor',
  blockAnchor('  First    Paragraph.  '),
  blockAnchor('first paragraph.'),
);

// A real content change moves the anchor.
ok(
  'changed block changes anchor',
  blockAnchor('First paragraph.') !== blockAnchor('Second paragraph.'),
);

// ── Pinned hex values (MUST match the laptop vitest mirror) ──────────────────
// If either copy drifts, these pins fail on one side. The values are djb2 of the
// normalized block, as hex.
eq('anchor("First paragraph.") pinned', blockAnchor('First paragraph.'), 'b7ddffb1');
eq('anchor("# Title") pinned', blockAnchor('# Title'), 'dd09a9ea');
eq('anchor("# Title") normalized', blockAnchor('# Title'), blockAnchor('#   title'));
ok('anchors are hex', /^[0-9a-f]+$/.test(blockAnchor('# Title')));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
