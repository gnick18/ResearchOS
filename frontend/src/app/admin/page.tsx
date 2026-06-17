import type { Metadata } from "next";

import OperatorShell from "@/components/admin/OperatorShell";
import OperatorAccessRequired from "@/components/admin/OperatorAccessRequired";
import LightOnly from "@/components/LightOnly";
import { isOperator } from "@/lib/sharing/operator-access";

/**
 * Standalone `/admin` route: the unified operator console.
 *
 * Merges the old operator metrics dashboard and the LLC business tracker into
 * one left-rail shell (OperatorShell): Overview / Metrics / Finances / Modeling
 * / Comms. The old `/business` and `/admin/business` routes redirect here so
 * existing bookmarks land in the one console.
 *
 * Operator-only. The API endpoints (/api/admin/metrics, /api/admin/business)
 * 404 for non-operators, so the server data never loads. But the shell ALSO
 * renders the price-modeling tool from client-bundled constants (provider cost,
 * Stripe fee, net margin, pricing assumptions), which do NOT depend on those
 * endpoints. So the earlier "loading the page leaks nothing" assumption was
 * wrong and the cost model was visible to anyone who hit /admin. The page now
 * gates at the server (force-dynamic + isOperator()): an operator gets the
 * OperatorShell, everyone else gets OperatorAccessRequired, a sign-in screen
 * that NEVER mounts the shell, so the operator content is simply absent for a
 * non-operator. force-dynamic is load-bearing, a statically optimized page would
 * evaluate the gate once at build and ship the shell to everyone. Do NOT render
 * the shell outside the operator branch, and do NOT assume an API-gated page is
 * safe when it renders client-computed figures. Like /open-source it renders
 * without the AppShell or a connected folder, and is excluded from the
 * wiki-coverage map (an operator tool, not a documented user feature).
 *
 * Pinned to light mode (Grant 2026-06-11): the operator surfaces always read in
 * the light palette regardless of the user's theme. The full-height
 * bg-surface-sunken root covers the viewport, so the LightOnly scope leaves no
 * dark peek behind it.
 */
export const metadata: Metadata = {
  title: "Operator console | ResearchOS",
  robots: { index: false, follow: false },
};

// Force per-request rendering so the operator gate below runs on every load. A
// statically optimized page would evaluate the check once at build and ship the
// shell to everyone, which is exactly how the client-computed price-modeling
// figures leaked. proxy.ts adds a route-level gate on top of this.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Server gate. The shell renders client-computed pricing/cost figures that do
  // NOT depend on the API-gated data, so the page itself must refuse to render
  // the shell for non-operators. isOperator() honors both the OAuth allow-list
  // and the operator access-code cookie, exactly like every /api/admin route. A
  // non-operator gets the sign-in screen (which never mounts the shell), so the
  // operator content is simply absent from the page for anyone not allowed in.
  const operator = await isOperator();
  return (
    <LightOnly>
      {operator ? <OperatorShell /> : <OperatorAccessRequired />}
    </LightOnly>
  );
}
