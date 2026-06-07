"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * `/sponsors` is an alias for the real `/thanks` page (sponsors plus the
 * open-source thank-you). Old bookmarks and "sponsor us" links land here and
 * bounce forward. Client-side `router.replace` mirrors the `/pcr`,
 * `/experiments`, and `/results` redirect stubs (no server redirects or
 * next.config rewrites for client-only routes today).
 */
export default function SponsorsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/thanks");
  }, [router]);
  return null;
}
