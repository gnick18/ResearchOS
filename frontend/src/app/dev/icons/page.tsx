"use client";

// sequence editor master. The verified icon catalog (the icon equivalent of
// brand/). It renders every entry in the ICONS registry, grouped by concept,
// on both a light and a dark tile so you can see each glyph against either
// surface. This page is always in sync with the registry: there is no separate
// list to maintain. No inline <svg> here, only <Icon name=...>.

import { Icon, ICONS, type IconName } from "@/components/icons";

const names = Object.keys(ICONS) as IconName[];

export default function IconCatalogPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-heading font-semibold text-foreground">Verified icon library</h1>
        <p className="mt-2 max-w-2xl text-body text-foreground-muted">
          Every icon on ResearchOS is a custom inline SVG drawn from one registry,
          rendered through <code className="text-meta">&lt;Icon name=&quot;...&quot; /&gt;</code> from
          {" "}
          <code className="text-meta">@/components/icons</code>. This catalog stays in
          sync with that registry. Adding a new icon is a verified-asset change and
          needs Grant&apos;s sign-off.
        </p>
        <p className="mt-2 text-meta text-foreground-muted">{names.length} icons</p>
      </header>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {names.map((name) => {
          const entry = ICONS[name];
          return (
            <li
              key={name}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
            >
              <div className="flex gap-2">
                <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-white py-4 text-neutral-800">
                  <Icon name={name} className="h-6 w-6" />
                </div>
                <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-neutral-900 py-4 text-neutral-100">
                  <Icon name={name} className="h-6 w-6" />
                </div>
              </div>
              <div>
                <div className="text-body font-medium text-foreground">{name}</div>
                <div className="text-meta text-foreground-muted">{entry.concept}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
