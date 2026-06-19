"use client";

// Special Thanks banner rendered at the very top of the asset library landing
// page. Shows the canonical BeakerBot mascot alongside a pulsing heart, then
// lists every open-source library we ingest from as clickable link-pills.
//
// The mascot is the shared IntroBubbleBot (same component used on the OAuth
// landing and every entry screen). The heart glyph is the approved
// <Icon name="heart"> from the icon registry -- no inline SVG here.
//
// External links follow the pattern used in AssetLibraryLanding: plain <a>
// with target="_blank" rel="noopener noreferrer". No openLink helper exists
// in this codebase; standard HTML link semantics are used throughout.
//
// Animations (mascot lean + heartbeat) live in SpecialThanksBanner.module.css
// and are suppressed via @media (prefers-reduced-motion: reduce).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { IntroBubbleBot } from "@/components/onboarding/oauth-first/IntroBubbleBot";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import styles from "./SpecialThanksBanner.module.css";

interface SourceLibrary {
  name: string;
  license: string;
  url: string;
}

// The 13 open-source icon libraries that feed the ResearchOS asset library.
// Verbatim names, licenses, and URLs as approved.
const SOURCE_LIBRARIES: SourceLibrary[] = [
  {
    name: "PhyloPic",
    license: "CC0 / CC-BY",
    url: "https://www.phylopic.org",
  },
  {
    name: "Bioicons",
    license: "CC0 / CC-BY",
    url: "https://bioicons.com",
  },
  {
    name: "Reactome Icon Library",
    license: "CC-BY",
    url: "https://reactome.org/icon-lib",
  },
  {
    name: "Health Icons",
    license: "MIT",
    url: "https://healthicons.org",
  },
  {
    name: "Tabler Icons",
    license: "MIT",
    url: "https://tabler.io/icons",
  },
  {
    name: "Devicon",
    license: "MIT",
    url: "https://devicon.dev",
  },
  {
    name: "SciDraw",
    license: "CC-BY",
    url: "https://scidraw.io",
  },
  {
    name: "janosh/diagrams",
    license: "MIT",
    url: "https://github.com/janosh/diagrams",
  },
  {
    name: "Electrical Symbol Library",
    license: "CC0",
    url: "https://github.com/basverdoes/ElectricalSymbolLibrary",
  },
  {
    name: "Arcadia Science",
    license: "CC0",
    url: "https://zenodo.org/records/17203578",
  },
  {
    name: "DBCLS Togo Picture Gallery",
    license: "CC-BY",
    url: "https://togotv.dbcls.jp/en/pics.html",
  },
  {
    name: "SwissBioPics",
    license: "CC-BY",
    url: "https://www.swissbiopics.org",
  },
  {
    name: "EMBL-EBI Icon Fonts",
    license: "CC-BY-SA",
    url: "https://github.com/ebiwd/EBI-Icon-fonts",
  },
];

export function SpecialThanksBanner() {
  return (
    <section
      className={`${styles.banner} border-b border-border bg-surface-raised/60`}
      aria-label="Special thanks to open-source icon libraries"
    >
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Mascot + heart composition */}
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6 sm:items-end sm:justify-center">
          {/* BeakerBot leaning toward the heart */}
          <div className={styles.mascotWrap} aria-hidden>
            <IntroBubbleBot size="lg" />
          </div>

          {/* Pulsing heart, placed in front of / beside the beaker.
              The heartGlyph class overrides the Icon wrapper's default
              fill="none" / stroke="currentColor" with the warm pink used
              by the IntroBubbleBot easter egg (#ff5b8a), keeping the
              colour on-brand without needing a style prop on <Icon>. */}
          <div
            className={styles.heartWrap}
            aria-hidden
          >
            <Icon
              name="heart"
              className={`h-12 w-12 ${styles.heartGlyph}`}
            />
          </div>
        </div>

        {/* Heading and subline */}
        <div className="mt-6 text-center">
          <h2 className="text-xl font-bold tracking-tight">Special thanks</h2>
          <p className="mt-1.5 text-sm text-foreground-muted">
            Our icons come from these open libraries, shared freely by the
            people who made them.
          </p>
        </div>

        {/* Source library pills */}
        <div
          className="mt-5 flex flex-wrap justify-center gap-2"
          role="list"
          aria-label="Open-source icon libraries"
        >
          {SOURCE_LIBRARIES.map((lib) => (
            <Tooltip key={lib.url} label={`${lib.name} (${lib.license})`} placement="top">
              <a
                href={lib.url}
                target="_blank"
                rel="noopener noreferrer"
                role="listitem"
                className="inline-flex flex-col items-center rounded-full border border-border-strong bg-surface px-3.5 py-1.5 transition hover:border-brand-action hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
              >
                <span className="text-sm font-medium leading-tight text-foreground">
                  {lib.name}
                </span>
                <span className="text-[11px] leading-tight text-foreground-faint">
                  {lib.license}
                </span>
              </a>
            </Tooltip>
          ))}
        </div>
      </div>
    </section>
  );
}

export default SpecialThanksBanner;
