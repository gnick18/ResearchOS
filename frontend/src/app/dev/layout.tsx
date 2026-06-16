import { notFound } from "next/navigation";

// Belt-and-suspenders gate for the /dev/* tree (internal scratch/demo surfaces:
// pricing model, design probes, demo videos). It 404s in a local production build
// (`next build`/`next start`, NODE_ENV production) but does NOT reliably fire on
// Vercel: a layout-level notFound() does not set a 404 on deployed App Router
// builds (verified 2026-06-16 via a clean rebuild that still served /dev/* with
// 200). The AUTHORITATIVE production gate is the /dev block in src/proxy.ts
// (middleware), which runs before routing and can't be bypassed. Keep this as a
// second layer, but proxy.ts is what actually closes /dev on prod.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <>{children}</>;
}
