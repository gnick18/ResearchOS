/**
 * Shared-store guard for lib/pairing.ts.
 *
 * Regression test for the per-instance pairing bug: usePairing used to hold its
 * own copy per consumer, so an unpair/pair on one screen left other mounted
 * consumers (Home, TodayHost) fetching with the stale pairing (still demo data
 * after pairing a real lab) until the app restarted. The fix makes the store a
 * single module singleton, so a write anywhere notifies every subscriber. This
 * test registers a subscriber (exactly how useSyncExternalStore wires up) and
 * proves that after setDemoPairing -> clearPairing -> setPairing(real) the
 * subscriber's view of the shared store is the final real pairing (demo
 * undefined), with the listener notified on every write.
 *
 * No mobile test runner is installed (mobile/package.json has no jest/vitest),
 * so this is a self-contained node script following the house convention (see
 * lib/calculators/custom.test.ts). It mocks expo-secure-store (an in-memory Map)
 * and @/lib/captures (a no-op clearAllCaptures) via a resolve/load loader. Run it
 * from the mobile/ directory:
 *
 *   node --experimental-strip-types \
 *     --import ./lib/__tests__/pairing.test.register.mjs \
 *     lib/__tests__/pairing.test.ts
 *
 * It prints one line per assertion and exits non-zero on the first failure.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
// Extension-bearing import so the file runs directly under node native TS
// stripping (the loader resolves the .ts specifier).
import {
  setPairing,
  setDemoPairing,
  clearPairing,
  subscribePairing,
  getPairingSnapshot,
} from '../pairing.ts';

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, oracle: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(oracle);
  if (ok) {
    passed += 1;
    console.log(`  ok  ${label} = ${JSON.stringify(actual)}`);
  } else {
    failed += 1;
    console.error(
      `FAIL  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(oracle)}`,
    );
  }
}

const REAL: Parameters<typeof setPairing>[0] = {
  u: 'aaaa000000000000000000000000000000000000000000000000000000000000aaaa',
  relayUrl: 'https://relay.example.org',
  devicePubkey: 'bbbb000000000000000000000000000000000000000000000000000000000000bbbb',
  labName: 'Real Lab',
  userName: 'Dr. Grant Nickles',
};

async function main(): Promise<void> {
  // Subscribe the same way useSyncExternalStore does: a listener that re-reads
  // getPairingSnapshot on every emit. This stands in for an already-mounted
  // consumer (Home / TodayHost) that must see writes made on any other screen.
  let notifyCount = 0;
  let lastRef = getPairingSnapshot();
  const unsub = subscribePairing(() => {
    notifyCount += 1;
    lastRef = getPairingSnapshot();
  });

  // Seed the demo pairing on "one screen". setDemoPairing calls setPairing, so it
  // must update the shared store and notify.
  await setDemoPairing();
  eq('after setDemoPairing -> notified', notifyCount >= 1, true);
  eq('after setDemoPairing -> demo flag set', lastRef.pairing?.demo, true);
  eq('after setDemoPairing -> labName', lastRef.pairing?.labName, 'Demo Lab');

  const afterDemoCount = notifyCount;

  // Unpair the demo on "another screen".
  await clearPairing();
  eq('after clearPairing -> notified again', notifyCount > afterDemoCount, true);
  eq('after clearPairing -> pairing null', lastRef.pairing, null);

  const afterClearCount = notifyCount;

  // Pair a real lab on yet another screen.
  await setPairing(REAL);
  eq('after setPairing -> notified again', notifyCount > afterClearCount, true);

  // The final value every consumer must see is the real pairing, with demo gone.
  eq('final pairing -> u', lastRef.pairing?.u, REAL.u);
  eq('final pairing -> labName', lastRef.pairing?.labName, 'Real Lab');
  eq('final pairing -> userName', lastRef.pairing?.userName, 'Dr. Grant Nickles');
  eq('final pairing -> demo undefined', lastRef.pairing?.demo, undefined);
  eq('final pairing -> loaded true', lastRef.loaded, true);

  // getPairingSnapshot must return a STABLE reference between emits (one mutation
  // = one new object), as useSyncExternalStore requires. Reading twice with no
  // write in between returns the identical reference.
  const a = getPairingSnapshot();
  const b = getPairingSnapshot();
  eq('snapshot reference stable between emits', a === b, true);

  unsub();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
