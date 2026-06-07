// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
// seqviz spike bot: replaced the `csstype` import + module augmentation with a
// local CSSProperties alias so we don't have to vendor the `csstype` package.
// React.CSSProperties already permits SVG style props and CSS custom properties.
import type * as React from "react";

namespace CSS {
  export type Properties = React.CSSProperties;
}

export const svgText: CSS.Properties = {
  MozUserSelect: "none",
  WebkitUserSelect: "none",
  background: "none",
  fill: "var(--seq-letter)",
  fontFamily: "Roboto Mono, Monaco, monospace",
  msUserSelect: "none",
  userSelect: "none",
};

export const search: CSS.Properties = {
  cursor: "pointer",
  fill: "rgba(255, 251, 7, 0.5)",
};

export const highlight: CSS.Properties = {
  cursor: "pointer",
  fill: "rgba(255, 251, 7, 0.25)",
  strokeWidth: "1",
};

export const selection: CSS.Properties = {
  fill: "var(--seq-selection-fill)",
  shapeRendering: "auto",
};

export const selectionEdge: CSS.Properties = {
  fill: "var(--seq-letter)",
  shapeRendering: "geometricPrecision",
  stroke: "var(--seq-letter)",
};

export const cutSite: CSS.Properties = {
  fill: "transparent",
  shapeRendering: "auto",
  stroke: "var(--seq-enzyme)",
  strokeWidth: "1",
};

export const cutSiteHighlight: CSS.Properties = {
  cursor: "pointer",
  fill: "rgb(255, 251, 7)",
  fillOpacity: 0,
  shapeRendering: "auto",
  stroke: "var(--seq-enzyme)",
  strokeWidth: "1",
};

export const indexLine: CSS.Properties = {
  fill: "transparent",
  shapeRendering: "geometricPrecision",
  stroke: "var(--seq-ruler-text)",
  strokeWidth: "1",
};

export const indexTick: CSS.Properties = {
  fill: "transparent",
  shapeRendering: "geometricPrecision",
  stroke: "var(--seq-ruler-text)",
  strokeWidth: "1",
};

export const indexTickLabel: CSS.Properties = {
  ...svgText,
  fill: "var(--seq-ruler-text)",
  fontSize: "12",
  fontWeight: 300,
  textRendering: "optimizeLegibility",
};

export const annotation: CSS.Properties = {
  fillOpacity: "0.7",
  shapeRendering: "geometricPrecision",
  strokeWidth: "0.5",
};

export const annotationLabel: CSS.Properties = {
  ...svgText,
  color: "rgb(42, 42, 42)",
  fontWeight: 400,
  shapeRendering: "geometricPrecision",
  strokeLinejoin: "round",
  textRendering: "optimizeLegibility",
};

export const translationHandle: CSS.Properties = {
  fillOpacity: "0.7",
  shapeRendering: "geometricPrecision",
  strokeWidth: "0.5",
};

export const translationHandleLabel: CSS.Properties = {
  ...svgText,
  fill: "var(--seq-translation)",
  color: "var(--seq-translation)",
  fontSize: "9",
  fontWeight: 400,
  shapeRendering: "geometricPrecision",
  strokeLinejoin: "round",
  textRendering: "optimizeLegibility",
};

export const translationAminoAcidLabel: CSS.Properties = {
  ...svgText,
  fill: "var(--seq-translation)",
  color: "var(--seq-translation)",
  fontSize: "12",
  fontWeight: 400,
};

export const viewerCircular: CSS.Properties = {
  cursor: "text",
  fontSize: "12",
  fontWeight: 300,
  margin: "auto",
};

export const circularLabel: CSS.Properties = {
  ...svgText,
  cursor: "pointer",
};

export const circularLabelHover: CSS.Properties = {
  ...circularLabel,
  textDecoration: "underline",
};

export const circularLabelLine: CSS.Properties = {
  fill: "none",
  stroke: "var(--seq-strand)",
  strokeWidth: "1",
};

export const linearScroller: CSS.Properties = {
  cursor: "text",
  fontWeight: 300,
  height: "100%",
  outline: "none !important",
  overflowX: "hidden",
  overflowY: "scroll",
  padding: "10px",
  position: "relative",
};

export const seqBlock: CSS.Properties = {
  overflow: "visible",
  padding: 0,
  width: "100%",
};
