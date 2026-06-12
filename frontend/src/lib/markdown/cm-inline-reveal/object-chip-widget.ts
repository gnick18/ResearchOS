/**
 * object-chip-widget.ts: the inline object-mention chip for the CM6 inline-reveal
 * layer (markdown + ResearchOS embed hybrid, Phase 2).
 *
 * When the caret is NOT inside an object-reference link that is part of a line
 * (a mention, or an inline embed link mid-sentence), the link collapses into an
 * inline Decoration.replace({ widget }) rendering a calm chip pill (the object
 * name). Reveal-on-caret is the same selectionSet trigger as the markers, caret
 * in -> no widget -> the raw [name](/path) source shows as editable text. A lone
 * embed link on its own line is handled separately as a BLOCK embed widget, so it
 * never reaches here.
 *
 * Static DOM, not React, the editor chip is a calm read affordance (you edit by
 * entering the source), so it does not need ObjectChip's router-driven navigation
 * (which could not mount in a detached CM6 widget anyway). The Preview pane still
 * renders the full interactive ObjectChip.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { WidgetType } from "@codemirror/view";

import { parseObjectDeepLink, type ObjectRefType } from "@/lib/references";

/** A link source `[label](url)` whose url is an in-app object route. Null for a
 *  normal link, a reference-style link, or anything that does not parse. */
export function parseObjectLink(
  source: string,
): { label: string; type: ObjectRefType } | null {
  const m = /^\[(.*)\]\((\S+)\)$/.exec(source.trim());
  if (!m) return null;
  const ref = parseObjectDeepLink(m[2]);
  if (!ref) return null;
  const label = m[1].replace(/\\([[\]\\])/g, "$1") || m[2];
  return { label, type: ref.type };
}

export class ObjectChipWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly type: ObjectRefType,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ObjectChipWidget &&
      other.label === this.label &&
      other.type === this.type
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-object-chip";
    span.setAttribute("data-object-chip", this.type);
    span.contentEditable = "false";
    span.textContent = this.label;
    span.style.cssText =
      "display:inline-flex;align-items:center;padding:0 7px;border-radius:999px;" +
      "border:1px solid var(--border);background:var(--surface-sunken);" +
      "font-size:0.9em;font-weight:600;color:var(--foreground);line-height:1.6;";
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
