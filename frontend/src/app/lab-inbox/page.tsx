import { redirect } from "next/navigation";

/**
 * Legacy `/lab-inbox` route — the surface was renamed to "Lab Overview"
 * on 2026-05-23 (lab overview rename manager) because it now hosts
 * announcements + comments + metrics + roster + audit notices rather
 * than just an inbox of comments. The route directory moved to
 * `app/lab-overview/`; this stub stays behind so any bookmark, external
 * link, or stale notification deep-link continues to land users on the
 * new surface. Server-side `redirect` issues a 307 so HTTP semantics
 * are preserved.
 */
export default function LabInboxRedirect() {
  redirect("/lab-overview");
}
