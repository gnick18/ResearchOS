import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import { findWikiNode } from "@/lib/wiki/nav";

export default function ComplianceIndex() {
  const node = findWikiNode("/wiki/compliance");
  const children = node?.children ?? [];
  return (
    <WikiPage
      intro="Plain-English answers to the questions labs ask before they trust an electronic notebook with grant-funded data. Does ResearchOS support the NIH Data Management &amp; Sharing Policy, how does it compare to LabArchives, and how do you deposit data to a repository when it is time to share?"
    >
      <div className="grid gap-3 not-prose mt-3 sm:grid-cols-2">
        {children.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block rounded-lg border border-border hover:border-border hover:bg-surface-sunken px-5 py-4 transition-colors"
          >
            <div className="font-semibold text-foreground">{c.label}</div>
            {c.blurb ? (
              <div className="mt-1 text-body text-foreground-muted">{c.blurb}</div>
            ) : null}
          </Link>
        ))}
      </div>
    </WikiPage>
  );
}
