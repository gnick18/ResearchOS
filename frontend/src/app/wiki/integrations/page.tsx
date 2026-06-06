import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import { findWikiNode } from "@/lib/wiki/nav";

export default function IntegrationsIndex() {
  const node = findWikiNode("/wiki/integrations");
  const children = node?.children ?? [];
  return (
    <WikiPage
      intro="Optional add-ons that connect ResearchOS to outside services. All are off by default."
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
