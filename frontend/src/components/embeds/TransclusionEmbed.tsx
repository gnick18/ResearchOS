"use client";

// Markdown embed hybrid, Phase 7 P7-2 (transclusion). The live section renderer.
//
// Loaded by ObjectEmbed when a note embed's view is "transclude". Loads the source
// note, pulls the named section via extractNoteSection, and renders that section's
// markdown LIVE through RenderedMarkdown inside a quiet frame. Edit the source note
// and every transclusion of it updates, because each render reads the note fresh.
//
// Recursion is guarded by TransclusionContext: a depth cap and a visited set. When
// either trips we render a calm placeholder instead of recursing, so a note that
// transcludes itself (or a cycle of notes) can never render forever.
//
// A missing note, a missing section, or a load failure all degrade to a calm card.
// The renderer never throws.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { notesApi } from "@/lib/local-api";
import type { Note } from "@/lib/types";
import { objectDeepLink } from "@/lib/references";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import { extractNoteSection } from "@/lib/embeds/markdown-section";
import { ObjectEmbedCard, UnavailableEmbedCard, type EmbedRendererProps } from "./ObjectEmbed";
import {
  MAX_TRANSCLUSION_DEPTH,
  TransclusionProvider,
  useTransclusionState,
} from "./TransclusionContext";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; note: Note };

/** The quiet header line above a transcluded section: "Transcluded from <note> >
 *  <heading>". The note title + an Open link, with the section name when present. */
function TransclusionHeader({
  noteTitle,
  heading,
  href,
}: {
  noteTitle: string;
  heading: string;
  href: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
      <span className="truncate text-meta text-foreground-muted">
        Transcluded from{" "}
        <span className="font-semibold text-foreground">{noteTitle}</span>
        {heading ? (
          <>
            {" › "}
            <span className="font-semibold text-foreground">{heading}</span>
          </>
        ) : null}
      </span>
      <span className="flex-1" />
      <a
        href={href}
        aria-label={`Open source note: ${noteTitle}`}
        className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
      >
        Open
      </a>
    </div>
  );
}

/** A calm placeholder used when the recursion guard trips (depth limit or cycle).
 *  No live render, no recursion, just an explanatory line so the user understands
 *  why the section is not expanded here. */
function GuardCard({ message }: { message: string }) {
  return (
    <div className="px-3 py-3">
      <p className="text-meta text-foreground-muted">{message}</p>
    </div>
  );
}

/** A calm "section not found" card: the note loaded, but no entry / heading matched
 *  the requested section. Names the section so the user can fix the reference. */
function SectionNotFoundCard({
  noteTitle,
  heading,
  href,
}: {
  noteTitle: string;
  heading: string;
  href: string;
}) {
  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-meta text-foreground-muted">
          Transcluded from{" "}
          <span className="font-semibold text-foreground">{noteTitle}</span>
        </span>
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open source note: ${noteTitle}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      <div className="px-3 py-3">
        <p className="text-meta text-foreground-muted">
          Section{" "}
          <span className="font-semibold text-foreground">{heading || "(whole note)"}</span>{" "}
          not found in this note.
        </p>
      </div>
    </div>
  );
}

export default function TransclusionEmbed({ descriptor, caption, basePath }: EmbedRendererProps) {
  const { depth, visited } = useTransclusionState();
  const id = descriptor.id;
  const heading = descriptor.opts.section ?? "";

  // Guard BEFORE loading: a depth-limit or already-visited id never even reads the
  // note, which is what makes a cycle terminate instead of fetching forever.
  const overDepth = depth >= MAX_TRANSCLUSION_DEPTH;
  const cycle = visited.includes(id);

  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    if (overDepth || cycle) return;
    let cancelled = false;
    setState({ k: "loading" });
    notesApi
      .get(Number(id))
      .then((n) => {
        if (cancelled) return;
        setState(n ? { k: "ok", note: n } : { k: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ k: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, overDepth, cycle]);

  if (overDepth) {
    return <GuardCard message="Transclusion depth limit reached." />;
  }
  if (cycle) {
    return <GuardCard message="Transclusion cycle detected." />;
  }

  if (state.k === "loading") {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} loading />;
  }
  if (state.k === "missing") {
    return <UnavailableEmbedCard descriptor={descriptor} caption={caption} />;
  }

  const note = state.note;
  const href = objectDeepLink("note", id);
  const section = extractNoteSection(note, heading);

  if (section == null) {
    return (
      <SectionNotFoundCard noteTitle={note.title} heading={heading} href={href} />
    );
  }

  return (
    <div>
      <TransclusionHeader noteTitle={note.title} heading={heading} href={href} />
      <div className="px-3 py-2">
        <TransclusionProvider value={{ depth: depth + 1, visited: [...visited, id] }}>
          <RenderedMarkdown content={section} basePath={basePath} />
        </TransclusionProvider>
      </div>
    </div>
  );
}
