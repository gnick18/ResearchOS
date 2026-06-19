/**
 * Inline-reveal theme for the CM6 inline editor (Typora editor chip 2a).
 *
 * The inline-reveal ViewPlugin tags each container content range with a class
 * (cm-strong / cm-em / cm-underline / cm-strike / cm-inline-code / cm-link /
 * cm-quote / cm-h1..h6). This baseTheme renders those classes so the styled
 * content reads like rendered markdown whether or not the markers are revealed.
 * The heading sizes mirror the chip 1 HighlightStyle (1.4 / 1.25 / 1.1 em for
 * h1..h3, bold for h4..h6) so the two layers agree.
 *
 * baseTheme (not theme) so it composes under any future light/dark theme and is
 * always present; the chip 1 EditorView.theme still owns the editor chrome
 * (font, padding, caret). This is purely a styling extension: it never touches
 * the document, so the byte-for-byte round-trip is untouched.
 *
 * House style: no em-dashes, no emojis.
 */

import { EditorView } from "@codemirror/view";

/**
 * The content-class styles for the inline-reveal layer. Returned as an Extension
 * so the editor can spread it into its extension list alongside the plugin.
 */
export const inlineRevealTheme = EditorView.baseTheme({
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  // Single-underscore emphasis renders as underline (ResearchOS convention),
  // resolved per-node from the delimiter char by the plugin.
  ".cm-underline": { textDecoration: "underline" },
  ".cm-strike": { textDecoration: "line-through" },
  ".cm-inline-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "#9333ea",
    backgroundColor: "rgba(147, 51, 234, 0.08)",
    borderRadius: "3px",
    padding: "0.05em 0.25em",
  },
  ".cm-link": { color: "#2563eb", textDecoration: "underline" },
  ".cm-quote": { color: "#6b7280", fontStyle: "italic" },
  ".cm-h1": { fontWeight: "700", fontSize: "1.4em" },
  ".cm-h2": { fontWeight: "700", fontSize: "1.25em" },
  ".cm-h3": { fontWeight: "700", fontSize: "1.1em" },
  ".cm-h4": { fontWeight: "700" },
  ".cm-h5": { fontWeight: "700" },
  ".cm-h6": { fontWeight: "700" },

  // Block-widget chrome (chip 2b). A Table or FencedCode block that the caret is
  // not inside collapses into a rendered widget; these styles give the rendered
  // table / code block readable spacing inside the editor flow. The widget DOM is
  // sanitized markdown HTML, so we style by element under the wrapper class.
  ".cm-inline-block": {
    margin: "0.5em 0",
    // The wrapper inherits `white-space: break-spaces` from `.cm-content`, which
    // would render any stray newline in the widget's HTML as a visible blank
    // line. The render pipeline already trims the outer whitespace (render-html),
    // so this is defense in depth: normal white-space means even an unexpected
    // newline between block elements collapses instead of inflating the widget
    // height. Keeps the rendered table / code block at its true size.
    whiteSpace: "normal",
  },
  ".cm-inline-table table": {
    borderCollapse: "collapse",
    width: "auto",
    fontSize: "0.95em",
  },
  ".cm-inline-table th, .cm-inline-table td": {
    border: "1px solid #d1d5db",
    padding: "0.25em 0.6em",
    textAlign: "left",
  },
  ".cm-inline-table th": {
    backgroundColor: "rgba(0, 0, 0, 0.03)",
    fontWeight: "600",
  },
  // Dark code block, matching the Preview-mode `.prose pre` (globals.css) and
  // the old Hybrid editor look. The global `.hljs-*` syntax colors are tuned
  // for a dark background, so the previous light-gray fill (rgba(0,0,0,0.04))
  // both lost the black look and washed the highlight colors out. Same dark in
  // light and dark app themes, exactly like `.prose pre`.
  ".cm-inline-fenced pre": {
    margin: "0",
    padding: "0.6em 0.8em",
    borderRadius: "6px",
    backgroundColor: "#1f2937",
    overflowX: "auto",
  },
  ".cm-inline-fenced code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.9em",
    color: "#e5e7eb",
  },
  // Inline image widget (chip 2b): the resolved <img> for an untouched Image
  // node. Constrained so a large figure does not blow out the writing column.
  ".cm-inline-image img": {
    maxWidth: "100%",
    borderRadius: "6px",
    verticalAlign: "middle",
  },
});
