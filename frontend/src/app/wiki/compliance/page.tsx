import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import { findWikiNode } from "@/lib/wiki/nav";

export default function ComplianceIndex() {
  const node = findWikiNode("/wiki/compliance");
  const children = node?.children ?? [];
  return (
    <WikiPage
      intro="Plain-English answers to the two questions labs ask before they trust an electronic notebook with grant-funded data: does ResearchOS support the NIH Data Management & Sharing Policy, and how does it compare to LabArchives?"
    >
      <div className="grid gap-3 not-prose mt-3 sm:grid-cols-2">
        {children.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 px-5 py-4 transition-colors"
          >
            <div className="font-semibold text-gray-900">{c.label}</div>
            {c.blurb ? (
              <div className="mt-1 text-body text-gray-600">{c.blurb}</div>
            ) : null}
          </Link>
        ))}
      </div>
    </WikiPage>
  );
}
