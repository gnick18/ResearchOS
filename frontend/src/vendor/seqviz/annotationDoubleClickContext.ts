// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
//
// ResearchOS addition (seq restructure bot): a tiny React context that carries an
// optional "double-click an annotation" callback down to the deep Linear/Circular
// Annotations render trees WITHOUT threading a new prop through every layer. The
// host (SequenceEditView) opens its FeatureEditorDialog from this. Single-click
// selection behavior is untouched; this only adds a dblclick affordance.
import * as React from "react";

/** Minimal identity for a double-clicked annotation, matched to a host feature. */
export interface AnnotationDblClickRange {
  name: string;
  start: number;
  end: number;
  direction?: number;
}

export type AnnotationDoubleClickHandler = (range: AnnotationDblClickRange) => void;

const AnnotationDoubleClickContext = React.createContext<AnnotationDoubleClickHandler | null>(null);
AnnotationDoubleClickContext.displayName = "AnnotationDoubleClickContext";

export default AnnotationDoubleClickContext;
