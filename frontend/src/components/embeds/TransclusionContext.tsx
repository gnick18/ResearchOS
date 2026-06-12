"use client";

// Markdown embed hybrid, Phase 7 P7-2 (transclusion). The recursion guard.
//
// A transclusion renders another note's section LIVE, and that section can itself
// contain transclusions, so the render is recursive. Two guards stop it from
// spiraling: a DEPTH cap (a chain of transclusions can only nest so far) and a
// VISITED set (a note already on the current chain is a cycle). Both ride a React
// context so each nested RenderedMarkdown inherits the chain from its parent.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { createContext, useContext } from "react";

export interface TransclusionState {
  /** How many transclusions deep we are (0 at the top level). */
  depth: number;
  /** The note ids already on this transclusion chain (cycle detection). */
  visited: string[];
}

/** The most transclusions we will nest before showing a calm "depth limit" card.
 *  3 covers every sane note-references-note case while bounding pathological docs. */
export const MAX_TRANSCLUSION_DEPTH = 3;

const TransclusionContext = createContext<TransclusionState>({ depth: 0, visited: [] });

export function useTransclusionState(): TransclusionState {
  return useContext(TransclusionContext);
}

export const TransclusionProvider = TransclusionContext.Provider;
