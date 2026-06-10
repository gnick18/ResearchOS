"use client";

// Flag-gated validation route for the Ketcher embed (chemistry-workbench Phase 1).
//
// Dev-only probe. Default-off behind CHEMISTRY_ENABLED, so it never appears in
// prod until the workbench ships. Mounts the real Ketcher canvas through a
// dynamic ssr:false boundary to confirm it renders in our Next 16 + React 19 +
// Turbopack stack. This route is replaced by the real /chemistry hub + editor
// once the embed is proven.

import dynamic from "next/dynamic";
import { CHEMISTRY_ENABLED } from "@/lib/chemistry/config";

const KetcherEmbed = dynamic(
  () => import("@/components/chemistry/KetcherEmbed"),
  { ssr: false, loading: () => <div style={{ padding: 16 }}>loading editor…</div> },
);

export default function ChemistryEmbedCheckPage() {
  if (!CHEMISTRY_ENABLED) {
    return (
      <div style={{ padding: 24, fontFamily: "monospace", fontSize: 14 }}>
        Chemistry is disabled. Set NEXT_PUBLIC_CHEMISTRY_ENABLED=1 in
        frontend/.env.local and restart to view this validation route.
      </div>
    );
  }
  return (
    <div style={{ height: "100vh" }}>
      <KetcherEmbed />
    </div>
  );
}
