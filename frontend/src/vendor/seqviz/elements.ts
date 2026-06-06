// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
/** Range is a single element with a range and direction in the viewer */
export interface Range {
  direction: -1 | 0 | 1;
  end: number;
  start: number;
}

/** NameRange elements have been parsed to include an id and name */
export interface NameRange extends Range {
  color?: string;
  id: string;
  name: string;
}

/** AnnotationProp is an annotation provided to SeqViz via the annotations prop. */
export interface AnnotationProp {
  color?: string;
  direction?: number | string;
  end: number;
  name: string;
  start: number;
  // sequence editor master. OPTIONAL caller-supplied stable id. SeqViz normally
  // assigns a randomID; because parseAnnotations spreads the caller object AFTER
  // that default, an id passed here wins and becomes the rendered element id +
  // class. The editor stamps an index-encoding id so a right-click can map the
  // hit element back to its source feature. Absent => SeqViz keeps its randomID.
  id?: string;
  // seq introns bot — OPTIONAL exon spans for a multi-segment (spliced) feature,
  // e.g. a GenBank join(...) CDS. Same coordinate space as start/end. When
  // absent OR length <= 1, the feature renders exactly as before (one box).
  // When length > 1, the renderer draws one box per exon joined by a thin
  // dashed intron connector with a single label.
  segments?: { start: number; end: number }[];
}

/** TranslationProp is an translation provided to SeqViz via the translation prop. */
export interface TranslationProp {
  color?: string;
  direction?: number;
  end: number;
  name: string;
  start: number;
  // seq introns bot — OPTIONAL exon spans for a spliced translation (join CDS).
  // When present (length > 1), the amino-acid sequence is translated from the
  // CONCATENATED exon bases (in left-to-right order) and the AA letters are
  // placed only over exon positions, with introns shown as a dashed gap. When
  // absent, the raw start..end span is translated as before.
  segments?: { start: number; end: number }[];
  // sequence-view legibility bot — marks a COMPUTED open reading frame (an
  // ATG-to-stop guess) rather than an annotated CDS. When true the renderer
  // gives the track a muted / outline treatment so it reads as "computed ORF,
  // not your annotated CDS".
  orf?: boolean;
}

/** Annotation is an annotation after parsing. */
export interface Annotation extends NameRange {
  color: string;
  // seq introns bot — preserved exon spans for spliced (join) features. See AnnotationProp.
  segments?: { start: number; end: number }[];
}

/** Translation is a single translated CDS. */
export interface Translation extends NameRange {
  AAseq: string;
  direction: -1 | 1;
  // seq introns bot — preserved exon spans for spliced (join) translations. See TranslationProp.
  // When present, AAseq is the spliced protein and `aaToBp` maps each AA index to
  // its absolute bp start so the letters land over exon positions only.
  segments?: { start: number; end: number }[];
  aaToBp?: number[];
  // sequence-view legibility bot — see TranslationProp.orf. Survives the
  // createTranslations `...t` spread so the renderer can read it.
  orf?: boolean;
}

/** PrimerProp is a single primer to visualize above/below the linear viewer. */
export interface PrimerProp {
  color?: string;
  direction: 1 | -1;
  end: number;
  id?: string;
  name: string;
  start: number;
  // primer bases bot — optional base-level render detail (see Primer.baseCells).
  // Carried through SeqViz's primer normalization spread so the linear viewer can
  // draw the oligo's actual bases when zoomed.
  baseCells?: PrimerBaseCell[];
  tailLength?: number;
}

/** primer bases bot — one oligo base placed for the base-level (zoomed) render.
 *  `column` is the 0-based FORWARD-strand template column the base sits over;
 *  `role` distinguishes annealing / mismatch / popped 5'-tail bases. Mirrors
 *  PrimerBaseCell in lib/sequences/primer-base-layout (kept here so the vendored
 *  renderer has a local type without importing our strict module's shape). */
export interface PrimerBaseCell {
  oligoIndex: number;
  base: string;
  role: "anneal" | "mismatch" | "tail";
  column: number;
}

/** Primer is a single primer for PCR. */
export interface Primer extends NameRange {
  color: string;
  direction: 1 | -1;
  // primer bases bot — OPTIONAL base-level detail threaded from SequenceEditView
  // so the linear viewer can draw the primer's actual bases SnapGene-style when
  // zoomed in. `baseCells` is the per-base column/role layout; `tailLength` is the
  // count of non-annealing 5' tail bases. Absent when the primer has no stored
  // oligo or does not anneal, in which case the renderer keeps the arrow only.
  baseCells?: PrimerBaseCell[];
  tailLength?: number;
}

/** HighlightProp is a region of the plasmid and the desired highlight for that region. */
export interface HighlightProp {
  color?: string;
  end: number;
  start: number;
}

/** Highlight is the processed version of HighlightProp */
export interface Highlight extends HighlightProp {
  /* direction is ignored for now */
  direction: 1 | -1;
  id: string;
  name: string;
}

export interface Part {
  annotations: Annotation[];
  compSeq: string;
  cutSites: CutSite[];
  name: string;
  primers: Primer[];
  seq: string;
}

export interface Size {
  height: number;
  width: number;
}

export interface Coor {
  x: number;
  y: number;
}

/** a single enzyme to use to digest the sequence with */
export interface Enzyme {
  /** an optional color to highlight the recognition site with */
  color?: string;

  /** the index of the cut-site on the forward strand relative to the start of the recognition site */
  fcut: number;

  /** name is the name of the enzyme. Used in the label above a cut-site */
  name: string;

  /** an optional range over which this enzyme's cut-sites should be limited */
  range?: {
    end: number;
    start: number;
  };

  /** the index of the cut-site on the reverse strand relative to the start of the recognition site */
  rcut: number;

  /** the recognition sequence */
  rseq: string;
}

/**
 * a single recognition site on the sequence
 *
 * TODO: it should be possible to remove name from below (it's on the enzyme)
 * and calc fcut/rcut from start/end + enzyme.fcut/rcut
 */
export interface CutSite extends NameRange {
  /** `1` if top strand (`seq`), `-1` if bottom strand (`compSeq`) */
  direction: 1 | -1;

  /** enzyme used to create this cut-site */
  enzyme: Enzyme;

  /** index relative to start index of the cut on the top strand */
  fcut: number;

  /** index relative to start index of the cut on the bottom strand */
  rcut: number;
}

/** supported input sequence types */
export type SeqType = "dna" | "rna" | "aa" | "unknown";
