// Test-only ESM resolve/load hooks so lib/pairing.ts can run as a self-contained
// node script with NATIVE TypeScript stripping and no test framework (the house
// convention, see lib/calculators/custom.test.ts). It does two small jobs:
//
//   1. Resolves the "@/..." path alias (tsconfig paths) to the mobile root, so
//      `import ... from '@/lib/captures'` works outside the bundler.
//   2. Substitutes in-memory stubs for the two native / side-effectful deps the
//      pairing store imports: expo-secure-store (an in-memory Map) and
//      @/lib/captures (a no-op clearAllCaptures). The pairing store logic under
//      test is pure once those are stubbed.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// mobile/ root is two levels up from mobile/lib/__tests__.
const mobileRoot = resolvePath(here, '..', '..');

const SECURE_STORE = 'stub:expo-secure-store';
const CAPTURES = 'stub:captures';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'expo-secure-store') {
    return { url: SECURE_STORE, shortCircuit: true };
  }
  if (specifier === '@/lib/captures') {
    return { url: CAPTURES, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const target = pathToFileURL(resolvePath(mobileRoot, specifier.slice(2))).href;
    return nextResolve(target, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === SECURE_STORE) {
    // In-memory SecureStore: a plain Map behind the three async methods the
    // pairing store uses.
    const source = `
      const mem = new Map();
      export async function getItemAsync(k) { return mem.has(k) ? mem.get(k) : null; }
      export async function setItemAsync(k, v) { mem.set(k, v); }
      export async function deleteItemAsync(k) { mem.delete(k); }
    `;
    return { format: 'module', shortCircuit: true, source };
  }
  if (url === CAPTURES) {
    const source = `export async function clearAllCaptures() {}`;
    return { format: 'module', shortCircuit: true, source };
  }
  return nextLoad(url, context);
}
