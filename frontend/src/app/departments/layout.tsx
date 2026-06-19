import type { Metadata } from "next";

// The /departments page itself is a client component (it uses useRouter for its
// CTAs), so it cannot export `metadata`. Without this the route fell through to
// the root template's bare "ResearchOS" default and carried no page title. This
// server layout supplies the title segment, which the root template wraps into
// "Departments | ResearchOS", plus a sell-page description.
export const metadata: Metadata = {
  title: "Departments",
  description:
    "Bring your labs together as one department, with central admin and billing above each lab, while every member's data still lives on their own computer.",
};

export default function DepartmentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
