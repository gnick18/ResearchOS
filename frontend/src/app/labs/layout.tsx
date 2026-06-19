import type { Metadata } from "next";

// The /labs page itself is a client component (it uses useRouter for its CTAs),
// so it cannot export `metadata`. Without this the route fell through to the root
// template's bare "ResearchOS" default and carried no page title. This server
// layout supplies the title segment, which the root template wraps into
// "Lab accounts | ResearchOS", plus a sell-page description.
export const metadata: Metadata = {
  title: "Lab accounts",
  description:
    "Run your whole lab as one shared workspace. A lab account makes you the lab head, brings your members in, and turns on the team features while every file still lives on each member's own computer.",
};

export default function LabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
