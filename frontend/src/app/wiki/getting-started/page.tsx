import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import { findWikiNode } from "@/lib/wiki/nav";

export default function GettingStartedIndex() {
  const node = findWikiNode("/wiki/getting-started");
  const children = node?.children ?? [];
  return (
    <WikiPage
      intro="Short pages that take you from a brand-new visitor to a working ResearchOS install, or skip ahead to the in-browser demo."
    >
      <p>Work through these in order:</p>
      <div className="grid gap-3 not-prose mt-3">
        {children.map((c, i) => (
          <Link
            key={c.href}
            href={c.href}
            className="block rounded-lg border border-border hover:border-border hover:bg-surface-sunken px-5 py-4 transition-colors"
          >
            <div className="text-meta text-foreground-muted">Step {i + 1}</div>
            <div className="mt-0.5 font-semibold text-foreground">{c.label}</div>
            {c.blurb ? (
              <div className="mt-1 text-body text-foreground-muted">{c.blurb}</div>
            ) : null}
          </Link>
        ))}
      </div>
    </WikiPage>
  );
}
