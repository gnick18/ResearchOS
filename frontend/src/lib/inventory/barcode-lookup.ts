// Manufacturer-barcode online lookup SEAM (chunk 6, design 15.6).
//
// LOCKED decision: the lab-applied `container_code` + manual entry is the
// PRIMARY scan path. This manufacturer-UPC online lookup is a flag-off,
// bring-your-own-key BONUS. Most lab reagents have no retail barcode, so this
// almost never fires; manual entry stays the norm.
//
// This file is intentionally a STUB. It exposes the seam the register flow
// calls, reads an optional Go-UPC API key (empty by default), and returns
// `null` whenever no key is configured, so the register flow simply gets no
// auto-fill. The actual Go-UPC HTTP call is DEFERRED: it needs a live
// browser-direct CORS check (the app has no backend and Vercel has a 4.5 MB
// proxy cap, so the request would have to go straight from the browser to
// Go-UPC). Wiring it is a later task once that CORS behavior is verified live.

/** What a successful manufacturer lookup can contribute to a new item. */
export interface BarcodeLookupResult {
  name?: string;
  vendor?: string;
}

/**
 * Read the optional Go-UPC key. Empty by default; there is no UI to set it yet
 * (a Settings field is part of the deferred wiring). Reading
 * `NEXT_PUBLIC_GO_UPC_KEY` keeps the seam honest without committing to a
 * storage location, and returns "" in every default environment.
 */
function readGoUpcKey(): string {
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_GO_UPC_KEY
      : undefined;
  return (fromEnv ?? "").trim();
}

/**
 * Look up a manufacturer barcode (UPC / EAN / GTIN) for an item name + vendor.
 *
 * Returns `null` when no Go-UPC key is configured (the default), so the
 * register flow performs NO auto-fill. When a key IS present the real HTTP call
 * is still deferred (see the file header), so this currently also returns
 * `null`; the seam is here so the register flow can call it unconditionally.
 */
export async function lookupProductBarcode(
  code: string,
): Promise<BarcodeLookupResult | null> {
  const key = readGoUpcKey();
  if (!key) return null;

  // DEFERRED: with a key present, call Go-UPC browser-direct here and map the
  // response to { name, vendor }. Held until the live CORS check (design 15.6).
  // Returning null for now means a key, even if set, never auto-fills until the
  // real call is wired and verified.
  void code;
  return null;
}
