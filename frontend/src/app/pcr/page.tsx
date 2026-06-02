"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The `/pcr` route was retired: `/methods` now fully manages PCR (create the
 * protocol + method-wrapper pair, edit gradients, delete both). The only
 * unique surface here was the "Repair Data" button, which moved into Settings.
 * Old bookmarks land here and bounce forward to `/methods`. Client-side
 * `router.replace` mirrors the `/experiments` and `/results` redirect stubs
 * (no server redirects or next.config rewrites for client-only routes today).
 */
export default function PcrRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/methods");
  }, [router]);
  return null;
}
