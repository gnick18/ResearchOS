"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Reveal from "@/components/marketing/Reveal";
import Kicker from "@/components/marketing/Kicker";
import { Icon } from "@/components/icons";
import {
  loadAssetManifest,
  searchAssets,
  listCategoryGroups,
  listSources,
  assetSvgUrl,
  verificationStatus,
  type LibraryAsset,
} from "@/lib/figure/asset-library";

/**
 * Public `/library` landing for the open scientific-asset library.
 *
 * The discovery surface for the BioRender-alternative icon library: a marketing
 * hero, then a LIVE browse + search over the same manifest the figure composer
 * reads (assets.research-os.com), with the category chips + source filter. Every
 * asset is CC0 / CC-BY / CC-BY-SA, and its verbatim credit rides on the card so
 * the provenance is visible before anyone places it.
 *
 * Rendered without the AppShell or a connected folder (same pattern as /about,
 * /open-source) so anyone can browse. The in-composer picker is gated behind
 * ASSET_LIBRARY_ENABLED, but this public page reads the CDN manifest directly,
 * so it works regardless of that flag.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons.
 */

// The contribution surface (the "Add your own icons" band + its Contribute /
// Review CTAs) only appears when contributions are live. The /api/library/submit
// endpoint is gated on the same flag, so showing the CTA while it is off would
// walk the user into a wizard whose submit is rejected. Mirrors the figure rail.
const ASSET_CONTRIBUTE_ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

const SOURCE_LABELS: Record<string, string> = {
  phylopic: "PhyloPic",
  bioicons: "Bioicons",
  community: "Community",
};

function sourceLabel(s: string): string {
  return SOURCE_LABELS[s] ?? s;
}

const GRID_CAP = 300;

export default function AssetLibraryLanding() {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [selected, setSelected] = useState<LibraryAsset | null>(null);

  useEffect(() => {
    let live = true;
    void loadAssetManifest().then((a) => {
      if (!live) return;
      setAssets(a);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const categoryGroups = useMemo(() => listCategoryGroups(assets), [assets]);
  const sources = useMemo(() => listSources(assets), [assets]);
  const results = useMemo(
    () => searchAssets(assets, { query, category, source }),
    [assets, query, category, source],
  );
  const shown = results.slice(0, GRID_CAP);

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="vivid" />
        <div className="relative z-10 mx-auto max-w-5xl px-6 pb-12 pt-16 text-center sm:pt-24">
          <Reveal className="flex justify-center">
            <Kicker>Open asset library</Kicker>
          </Reveal>
          <Reveal as="div" delay={60}>
            <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
              Thousands of open scientific icons, free to use and remix.
            </h1>
          </Reveal>
          <Reveal as="div" delay={120}>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-foreground-muted">
              A growing library of vetted, openly licensed scientific
              illustrations and silhouettes. Search, recolor, and drop them
              straight into a figure. Every icon carries its source and citation,
              so your credits are handled for you.
            </p>
          </Reveal>
          <Reveal as="div" delay={180}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#browse"
                className="inline-flex items-center gap-2 rounded-full bg-brand-action px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                <Icon name="search" className="h-4 w-4" /> Browse the library
              </a>
              <Link
                href="/figures"
                className="inline-flex items-center gap-2 rounded-full border border-border-strong px-5 py-2.5 text-sm font-semibold text-foreground transition hover:border-brand-action"
              >
                Use them in ResearchOS
                <Icon name="chevronRight" className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
          <Reveal as="div" delay={240}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-meta text-foreground-muted">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1">
                <Icon name="shield" className="h-3.5 w-3.5 text-brand-action" />
                CC0, CC-BY, and CC-BY-SA only
              </span>
              {!loading && assets.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1">
                  {assets.length.toLocaleString()} icons
                </span>
              )}
              {sources.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1"
                >
                  {sourceLabel(s)}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Browse */}
      <section id="browse" className="relative border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <Reveal>
            <Kicker>Browse</Kicker>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">
              Find an icon
            </h2>
          </Reveal>

          {/* Search */}
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-border-strong bg-surface-sunken px-3 py-2.5">
            <Icon name="search" className="h-4 w-4 text-foreground-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, common name, or keyword (try owl, dna, microscope)"
              className="w-full bg-transparent text-sm outline-none placeholder:text-foreground-faint"
              aria-label="Search the asset library"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-foreground-faint hover:text-foreground"
                aria-label="Clear search"
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Source filter */}
          {sources.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-meta text-foreground-faint">Source</span>
              <Chip active={source === null} onClick={() => setSource(null)}>
                All
              </Chip>
              {sources.map((s) => (
                <Chip key={s} active={source === s} onClick={() => setSource(s)}>
                  {sourceLabel(s)}
                </Chip>
              ))}
            </div>
          )}

          {/* Category tree, grouped into sections (BioRender-style) */}
          {categoryGroups.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="mr-1 text-meta text-foreground-faint">Category</span>
                <Chip active={category === null} onClick={() => setCategory(null)}>
                  All
                </Chip>
              </div>
              {categoryGroups.map((g) => (
                <div key={g.section} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="mr-1 w-full text-[11px] font-semibold uppercase tracking-wide text-foreground-faint sm:w-auto">
                    {g.section}
                  </span>
                  {g.categories.map((c) => (
                    <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                      {c}
                    </Chip>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Grid */}
          <div className="mt-6">
            {loading ? (
              <p className="py-16 text-center text-foreground-muted">
                Loading the library...
              </p>
            ) : assets.length === 0 ? (
              <p className="py-16 text-center text-foreground-faint">
                The library is not available right now. Please check back soon.
              </p>
            ) : shown.length === 0 ? (
              <p className="py-16 text-center text-foreground-faint">
                No icons match that search. Try a broader term or clear the
                filters.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                {shown.map((a) => (
                  <button
                    key={a.uid}
                    type="button"
                    onClick={() => setSelected(a)}
                    title={a.title}
                    className="group flex aspect-square items-center justify-center rounded-xl border border-border bg-surface-sunken p-2 transition hover:border-brand-action hover:shadow-sm"
                    data-testid="library-asset"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={assetSvgUrl(a)}
                      alt={a.title}
                      loading="lazy"
                      className="h-full w-full object-contain transition group-hover:scale-105"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {!loading && assets.length > 0 && (
            <p className="mt-4 text-meta text-foreground-faint">
              Showing {shown.length.toLocaleString()}
              {results.length > shown.length
                ? ` of ${results.length.toLocaleString()} matches. Narrow your search to see more.`
                : ` ${results.length === 1 ? "match" : "matches"}.`}{" "}
              Credits are added automatically when you place an icon.
            </p>
          )}
        </div>
      </section>

      {/* License + contribute bands */}
      <section className="relative border-t border-border">
        <MarketingBackdrop tone="soft" />
        <div
          className={`relative z-10 mx-auto grid max-w-7xl gap-6 px-6 py-14 ${ASSET_CONTRIBUTE_ENABLED ? "md:grid-cols-2" : ""}`}
        >
          <Reveal className="rounded-2xl border border-border bg-surface-raised/70 p-7">
            <div className="flex items-center gap-2 text-brand-action">
              <Icon name="shield" className="h-5 w-5" />
              <span className="font-mono text-meta font-semibold uppercase tracking-[0.12em]">
                Open by construction
              </span>
            </div>
            <h3 className="mt-3 text-xl font-bold">Licensed to actually use</h3>
            <p className="mt-2 text-foreground-muted">
              We only ingest CC0, public-domain, CC-BY, and CC-BY-SA work, never
              non-commercial or no-derivatives. That means you can recolor,
              resize, and publish, in a paper or a paid product, without a
              license worry. The attribution each license requires is stored with
              the icon and written into your figure for you.
            </p>
          </Reveal>
          {ASSET_CONTRIBUTE_ENABLED && (
          <Reveal
            delay={80}
            className="rounded-2xl border border-border bg-surface-raised/70 p-7"
          >
            <div className="flex items-center gap-2 text-brand-action">
              <Icon name="heart" className="h-5 w-5" />
              <span className="font-mono text-meta font-semibold uppercase tracking-[0.12em]">
                Community
              </span>
            </div>
            <h3 className="mt-3 text-xl font-bold">Add your own icons</h3>
            <p className="mt-2 text-foreground-muted">
              Have illustrations the community could use? Contribute them under an
              open license with tags and a citation. Bulk upload and bulk tagging
              make a whole set quick. Submissions are checked by other researchers,
              wiki-style, so the library stays accurate.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/library/contribute"
                className="inline-flex items-center gap-2 rounded-full bg-brand-action px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                <Icon name="userPlus" className="h-4 w-4" /> Contribute an icon
              </Link>
              <Link
                href="/library/review"
                className="inline-flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-sm font-semibold transition hover:border-brand-action"
              >
                <Icon name="check" className="h-4 w-4" /> Help review submissions
              </Link>
            </div>
          </Reveal>
          )}
        </div>
      </section>

      <MarketingFooter />

      {selected && (
        <AssetDetail asset={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-meta transition ${
        active
          ? "bg-brand-action text-white"
          : "border border-border-strong text-foreground-muted hover:border-brand-action"
      }`}
    >
      {children}
    </button>
  );
}

function AssetDetail({
  asset,
  onClose,
}: {
  asset: LibraryAsset;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyCredit = async () => {
    try {
      await navigator.clipboard.writeText(asset.credit);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; no-op */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={asset.title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold" title={asset.title}>
              {asset.title}
            </h3>
            <p className="mt-0.5 text-meta text-foreground-muted">
              {sourceLabel(asset.source)}
              {asset.category ? ` / ${asset.category}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-foreground-faint hover:bg-surface-sunken hover:text-foreground"
            aria-label="Close"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-center border-b border-border bg-surface-sunken p-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetSvgUrl(asset)}
            alt={asset.title}
            className="max-h-48 w-auto object-contain"
          />
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-meta">
              <Icon name="shield" className="h-3.5 w-3.5 text-brand-action" />
              {asset.license}
            </span>
            {asset.requiresAttribution ? (
              <span className="rounded-full border border-border px-2.5 py-1 text-meta text-foreground-muted">
                Attribution required (added for you)
              </span>
            ) : (
              <span className="rounded-full border border-border px-2.5 py-1 text-meta text-foreground-muted">
                No attribution required
              </span>
            )}
            {verificationStatus(asset) === "unverified" && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-meta text-amber-700">
                Unverified for accuracy
              </span>
            )}
            {verificationStatus(asset) === "verified" && (
              <span className="rounded-full border border-border px-2.5 py-1 text-meta text-foreground-muted">
                Community verified
              </span>
            )}
          </div>
          {verificationStatus(asset) === "unverified" && (
            <p className="text-meta text-foreground-muted">
              A community contribution awaiting an independent review.{" "}
              <Link href="/library/review" className="font-semibold text-brand-action hover:opacity-80">
                Help review
              </Link>
            </p>
          )}

          {asset.creator && (
            <p className="text-meta text-foreground-muted">
              By {asset.creator}
            </p>
          )}

          <div className="rounded-lg border border-border bg-surface-sunken p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-faint">
                Citation
              </span>
              <button
                type="button"
                onClick={copyCredit}
                className="inline-flex items-center gap-1 text-meta font-semibold text-brand-action hover:opacity-80"
              >
                <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-meta leading-relaxed text-foreground-muted">
              {asset.credit}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href="/figures"
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-action px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              <Icon name="figure" className="h-4 w-4" /> Open in figure composer
            </Link>
            <a
              href={asset.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-4 py-2 text-sm font-semibold transition hover:border-brand-action"
            >
              View source
              <Icon name="chevronRight" className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
