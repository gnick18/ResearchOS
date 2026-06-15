"use client";

// Markdown embed hybrid, Phase 1. The note block-embed renderer.
//
// Loaded lazily by ObjectEmbed when a `[caption](/notes/ID#ros=card)` embed
// is on screen. Reads the note with a plain effect (no QueryClient, this
// component is used inside RenderedMarkdown which has many contexts). A
// deleted or unreadable note degrades to the calm generic card.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { notesApi } from "@/lib/local-api";
import type { Note } from "@/lib/types";
import { objectDeepLink } from "@/lib/references";
import { deriveExcerptFromMarkdown } from "@/lib/methods/excerpt";
import { ObjectEmbedCard, UnavailableEmbedCard, type EmbedRendererProps } from "./ObjectEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; note: Note };

/** Pick a short excerpt from the note. Tries the first entry's content, then
 *  falls back to the description field. Run through deriveExcerptFromMarkdown so
 *  the invisible stamp scaffold (<!-- stamp:start --> ...) and any leading H1 are
 *  stripped, never leaking into the card. */
function noteExcerpt(note: Note): string {
  const raw = note.entries[0]?.content?.trim() || note.description?.trim() || "";
  return deriveExcerptFromMarkdown(raw);
}

export default function NoteEmbed({ descriptor, caption }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });
    notesApi
      .get(Number(descriptor.id))
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
  }, [descriptor.id]);

  if (state.k === "loading") {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} loading />;
  }
  if (state.k === "missing") {
    return <UnavailableEmbedCard descriptor={descriptor} caption={caption} />;
  }

  const note = state.note;
  const title = note.title || caption;
  const excerpt = noteExcerpt(note);
  const href = objectDeepLink("note", descriptor.id);

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open note ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      {excerpt ? (
        <div className="px-3 py-2">
          <p className="line-clamp-2 text-meta text-foreground-muted">{excerpt}</p>
        </div>
      ) : null}
    </div>
  );
}
