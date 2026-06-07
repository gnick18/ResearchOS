// sequence editor master. BeakerSearch step 1, the SHARED source contract.
//
// BeakerSearch began as the sequence editor's Cmd-K palette. This module is the
// first piece of lifting it into an app-shell-level surface every page can feed.
// For this step the contract is a faithful mirror of the palette's existing data
// inputs (the exact props the CommandPalette already takes), so Sequences can
// register as the first source with ZERO behavior change. Future steps widen this
// into the full per-page contract (context / suggested / entities / results) from
// docs/proposals/beakersearch-website-wide.md.
//
// Pages should import the palette types FROM here, not from
// @/components/sequences/editor-commands, so a later relocation of the palette
// model into this directory is a one-line change. We re-export them below.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type {
  ArtifactNavItem,
  EditorCommand,
  PaletteContext,
  PaletteContextCard,
  PaletteNavGroup,
  SequenceNavItem,
} from "@/components/sequences/editor-commands";
import type { SelectionKind } from "@/lib/sequences/inspector-context";

// Re-export the palette model types so future pages depend on beaker-search, not
// the sequences tree. The definitions still LIVE in editor-commands.ts for this
// step (relocation into beaker-search/ is a future step); only the import path
// pages reach for changes.
export type {
  ArtifactNavItem,
  EditorCommand,
  PaletteContext,
  PaletteContextCard,
  PaletteNavGroup,
  PaletteNavItem,
  SequenceNavItem,
} from "@/components/sequences/editor-commands";
export type { SelectionKind } from "@/lib/sequences/inspector-context";

/** One page's registration with the shared BeakerSearch palette. For this step it
 *  is exactly the palette's existing data inputs. A surface (the open sequence
 *  editor, later any page) supplies one of these via useBeakerSearchSource while
 *  it is mounted, and the provider renders the palette from the ACTIVE source. */
export interface BeakerSearchSource {
  /** Stable id of the registering surface, e.g. "sequences-editor". Used to
   *  replace-by-id on re-register and to remove on unmount. */
  id: string;
  /** The page's full command set (the same list the editor already builds). */
  commands: EditorCommand[];
  /** The live selection kind, so the empty-query Suggested group is biased.
   *  Sequence-editor only; generic pages omit it (the provider defaults "none"). */
  selectionKind?: SelectionKind;
  /** Whether the focused entity carries an organism (also biases Suggested). */
  hasOrganism?: boolean;
  /** The "what am I looking at" context card data. Absent self-hides the card.
   *  Sequence-editor path; generic pages use contextCard below. */
  context?: PaletteContext;
  /** Navigable sibling objects (the other sequences in the collection). */
  sequences?: SequenceNavItem[];
  /** Recent reopenable results (saved artifacts). */
  artifacts?: ArtifactNavItem[];
  /** The collection name, for the "Jump to a sequence" group hint. */
  collectionLabel?: string;

  // BeakerSearch website-wide (step 3), the GENERIC per-page contract. A page
  // that is not the sequence editor supplies these instead of the sequence-shaped
  // fields above. The provider feeds them straight through to the palette.
  /** The page-agnostic "what am I looking at" card (icon + title + meta + chips). */
  contextCard?: PaletteContextCard;
  /** Ordered command ids the page wants lifted into the empty-query Suggested
   *  group (the page reads its own context to choose them). */
  suggestedIds?: string[];
  /** Optional hint clause after the Suggested heading (e.g. "for this experiment"). */
  suggestedHint?: string;
  /** The page's navigable entity / result groups (each under its own heading). */
  navGroups?: PaletteNavGroup[];
}
