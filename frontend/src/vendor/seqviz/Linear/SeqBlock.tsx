// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import { InputRefFunc } from "../SelectionHandler";
import { Annotation, CutSite, Highlight, NameRange, Primer, Range, SeqType, Size, Translation } from "../elements";
import { seqBlock, svgText } from "../style";
import AnnotationRows from "./Annotations";
import { CutSites } from "./CutSites";
import Find from "./Find";
import { Highlights } from "./Highlights";
import IndexRow from "./Index";
import PrimeRows from "./Primers";
import Selection from "./Selection";
import { TranslationRows } from "./Translations";

export type FindXAndWidthType = (
  n1?: number | null,
  n2?: number | null,
) => {
  width: number;
  x: number;
};

// primer bases — SnapGene-style base-level primer rendering needs real vertical
// room: an annealing BOX sitting on the template (with a 3' arrowhead), a name
// label clear above/below it, and (when the primer has a non-annealing 5' tail /
// cloning overhang) a SECOND box raised one row OFF the template for the popped
// tail. So in the zoomed base view each primer ROW is taller than the flat
// elementHeight, sized to the bases + lanes, and grows by an extra box-lane only
// when the track actually contains a tailed primer. Zoomed out (arrow-only) it
// stays at elementHeight, byte-identical to before. SeqBlock lays out the strands
// with these heights and Linear.tsx adds the same per block so stacked blocks
// never clip.

/** The per-base glyph size used inside the primer boxes (matches Primers.tsx). */
export const primerBaseFont = (seqFontSize: number, charWidth: number): number =>
  Math.min(seqFontSize, charWidth / 0.62);

/** True when any primer in these stacked rows carries a non-annealing 5' tail. */
export const primerRowsHaveTail = (rows: { tailLength?: number }[][]): boolean =>
  rows.some(row => row.some(p => (p.tailLength ?? 0) > 0));

/**
 * Height of ONE primer row. Zoomed out: the flat elementHeight (arrow-only).
 * Zoomed in: room for the annealing box + the name-label lane, plus a SECOND
 * box-lane when the track has a tailed primer (the raised/lowered 5' tail box).
 * Primers.tsx derives its lane geometry from this same height so the two agree.
 */
export const primerRowHeight = (
  zoomed: boolean,
  hasTail: boolean,
  seqFontSize: number,
  charWidth: number,
  elementHeight: number,
): number => {
  if (!zoomed) return elementHeight;
  const box = primerBaseFont(seqFontSize, charWidth) + 6; // one base box (glyph + padding)
  const label = seqFontSize + 4; // the name lane
  const barb = Math.round(box * 0.85); // headroom for the 3' arrowhead's pull-back (chunky)
  return Math.round(label + barb + box * (hasTail ? 2 : 1) + 5); // + a small strand margin
};

// ruler spacing bot — vertical breathing room reserved between the top sequence
// row and the complement row WHEN the in-seam measuring tape renders (base-level
// zoom, complement shown, DNA). The coordinate number on each 10-tick is centered
// in this lane so it sits clear of both strands' letters instead of bleeding onto
// them. Roughly the number's line-height (fontSize 11 + halo) plus a little air.
// Exported so Linear.tsx can add the same amount to blockHeight (per block) and
// keep block stacking, selection, and overview math consistent.
export const SEAM_GAP = 15;

// ruler spacing bot — single source of truth for "is the in-seam tape active in
// this block". The tape (and therefore the seam gap) only exists when both
// strands render and bases are legible (DNA, zoomed, complement shown). Linear.tsx
// mirrors this exact condition when sizing blockHeight, so the two never drift.
export const tapeSeamActive = (zoomed: boolean, showComplement: boolean, seqType: SeqType): boolean =>
  !!zoomed && !!showComplement && seqType !== "aa";

export type FindXAndWidthElementType = (
  i: number,
  element: NameRange,
  elements: NameRange[],
) => { overflowLeft: boolean; overflowRight: boolean; width: number; x: number };

export interface SeqBlockProps {
  annotationRows: Annotation[][];
  blockHeight: number;
  bpColors?: { [key: number | string]: string };
  bpsPerBlock: number;
  charWidth: number;
  compSeq: string;
  cutSiteRows: CutSite[];
  elementHeight: number;
  firstBase: number;
  fullSeq: string;
  handleMouseEvent: React.MouseEventHandler<SVGSVGElement>;
  highlights: Highlight[];
  id: string;
  inputRef: InputRefFunc;
  key: string;
  lineHeight: number;
  onUnmount: (a: string) => void;
  primerFwdRows: Primer[][];
  primerRevRows: Primer[][];
  searchRows: Range[];
  seq: string;
  seqFontSize: number;
  seqType: SeqType;
  showComplement: boolean;
  showIndex: boolean;
  size: Size;
  translationRows: Translation[][];
  y: number;
  zoom: { linear: number };
  zoomed: boolean;
}

/**
 * SeqBlock
 *
 * Comprised of:
 * 	   IndexRow (the x axis basepair index)
 * 	   AnnotationRows (annotations)
 * 	   Selection (cursor selection range)
 * 	   Find (regions that match the users current find search)
 *     CutSites (cut sites)
 *     Translations
 *
 * a single block of linear sequence. Essentially a row that holds
 * the sequence, and flair around it including the
 * complementary sequence, sequence index, and anotations *
 */
export class SeqBlock extends React.PureComponent<SeqBlockProps> {
  static defaultProps = {};

  componentDidMount = () => {
    this.registerSelf();
  };

  componentDidUpdate = (prevProps: SeqBlockProps) => {
    if (prevProps.id !== this.props.id || prevProps.firstBase !== this.props.firstBase) {
      this.registerSelf();
    }
  };

  componentWillUnmount = () => {
    const { id, onUnmount } = this.props;
    onUnmount(id);
  };

  registerSelf = () => {
    const { firstBase, id, inputRef, seq } = this.props;
    inputRef(id, {
      end: firstBase + seq.length,
      ref: id,
      start: firstBase,
      type: "SEQ",
      viewer: "LINEAR",
    });
  };

  /**
   * For elements in arrays, check whether it wraps around the zero index.
   */
  findXAndWidthElement = (i: number, element: NameRange, elements: NameRange[]) => {
    const { bpsPerBlock, firstBase, fullSeq, seq } = this.props;
    const lastBase = firstBase + seq.length;
    const { end, start } = element;

    let { width, x } = this.findXAndWidth(start, end);

    // does the element overflow to the left or the right of this seqBlock?
    let overflowLeft = start < firstBase;
    let overflowRight = end > lastBase || (start === end && fullSeq.length > bpsPerBlock); // start === end means covers whole plasmid

    // if the element starts and ends in a SeqBlock, by circling all the way around,
    // it will be rendered twice (once from the firstBase to start and another from end to lastBase)
    // eg: https://user-images.githubusercontent.com/13923102/35816281-54571e70-0a68-11e8-92eb-ab56884337ac.png
    const split = elements.reduce((acc, el) => (el.id === element.id ? acc + 1 : acc), 0) > 1; // is this element in two pieces?
    if (split) {
      if (elements.findIndex(el => el.id === element.id) === i) {
        // we're in the first half of the split element
        ({ width, x } = this.findXAndWidth(firstBase, end));
        overflowLeft = true;
        overflowRight = false;
      } else {
        // we're in the second half of the split element
        ({ width, x } = this.findXAndWidth(start, lastBase));
        overflowLeft = false;
        overflowRight = true;
      }
    } else if (start > end) {
      // the element crosses over the zero index and this needs to be accounted for
      // this is very similar to the Block rendering logic in ../Selection/Selection.jsx
      ({ width, x } = this.findXAndWidth(
        start > lastBase ? firstBase : Math.max(firstBase, start),
        end < firstBase ? lastBase : Math.min(lastBase, end),
      ));

      // if this is the first part of element that crosses the zero index
      if (start > firstBase) {
        overflowLeft = true;
        overflowRight = end > lastBase;
      }

      // if this is the second part of an element, check if it overflows
      if (end < firstBase) {
        overflowLeft = start < firstBase;
        overflowRight = true;
      }
    } else if (start === end) {
      // the element circles the entire plasmid — span the entire block
      ({ width, x } = this.findXAndWidth(firstBase, lastBase));
      overflowLeft = true;
      overflowRight = true;
    }

    return { overflowLeft, overflowRight, width, x };
  };

  /**
   * A helper used in child components to position elements on rows. Given first and last base, how far from the left
   * and how wide should it be?
   *
   * If an element and elements are provided, it also factors in whether the element circles around the 0-index.
   */
  findXAndWidth = (firstIndex = 0, lastIndex = 0) => {
    const {
      bpsPerBlock,
      charWidth,
      firstBase,
      fullSeq: { length: seqLength },
      size,
    } = this.props;

    firstIndex |= 0;
    lastIndex |= 0;

    const lastBase = Math.min(firstBase + bpsPerBlock, seqLength);
    const multiBlock = seqLength >= bpsPerBlock;

    let x = 0;
    if (firstIndex >= firstBase) {
      x = (firstIndex - firstBase) * charWidth;
      x = Math.max(x, 0) || 0;
    }

    // find the width for the current element
    let width = size.width;
    if (firstIndex === lastIndex) {
      // it starts on the last bp
      width = 0;
    } else if (firstIndex >= firstBase || lastIndex < lastBase) {
      // it starts or ends in this SeqBlock
      const start = Math.max(firstIndex, firstBase);
      const end = Math.min(lastIndex, lastBase);

      width = size.width * ((end - start) / bpsPerBlock);
      width = Math.abs(width) || 0;
    } else if (firstBase + bpsPerBlock > seqLength && multiBlock) {
      // it's an element in the last SeqBlock, that doesn't span the whole width
      width = size.width * ((seqLength % bpsPerBlock) / bpsPerBlock);
    }

    return { width, x };
  };

  /**
   * Given a bp, return either the bp as was or a text span if it should have a color.
   *
   * We're looking up each bp in the props.bpColors map to see if it should be shaded and, if so,
   * wrapping it in a textSpan with that color as a fill
   */
  seqTextSpan = (bp: string, i: number) => {
    const { bpColors, charWidth, firstBase, id } = this.props;

    let color: string | undefined;
    if (bpColors) {
      color =
        bpColors[bp] ||
        bpColors[bp.toUpperCase()] ||
        bpColors[bp.toLowerCase()] ||
        bpColors[i + firstBase] ||
        undefined;
    }

    return (
      // the +0.2 here and above is to offset the characters they're not right on the left edge. When they are,
      // other elements look like they're shifted too far to the right.
      <tspan key={i + bp + id} fill={color || undefined} x={charWidth * i + charWidth * 0.2}>
        {bp}
      </tspan>
    );
  };

  render() {
    const {
      annotationRows,
      blockHeight,
      bpsPerBlock,
      charWidth,
      compSeq,
      cutSiteRows,
      elementHeight,
      firstBase,
      fullSeq,
      handleMouseEvent,
      highlights,
      id,
      inputRef,
      lineHeight,
      onUnmount,
      primerFwdRows: primerFwdRows,
      primerRevRows: primerRevRows,
      searchRows,
      seq,
      seqFontSize,
      seqType,
      showComplement,
      showIndex,
      size,
      translationRows,
      zoom,
      zoomed,
    } = this.props;

    if (!size.width || !size.height) return null;

    const textProps = {
      fontSize: seqFontSize,
      lengthAdjust: "spacing",
      textAnchor: "start" as const,
      textLength: size.width >= 0 ? size.width : 1,
      textRendering: "optimizeLegibility",
    };

    const lastBase = firstBase + seq.length;

    // primer bases — per-track row height. A track with a tailed primer gets the
    // extra raised/lowered tail box-lane; a plain (no-tail) track only needs the
    // annealing box + label lane. Computed separately for the forward track
    // (above the top strand) and the reverse track (below the complement).
    const primerFwdRowH = primerRowHeight(
      zoomed,
      primerRowsHaveTail(primerFwdRows),
      seqFontSize,
      charWidth,
      elementHeight,
    );
    const primerRevRowH = primerRowHeight(
      zoomed,
      primerRowsHaveTail(primerRevRows),
      seqFontSize,
      charWidth,
      elementHeight,
    );

    // height and yDiff of forward primers (above the top strand). The annealing
    // box sits at the BOTTOM of the track flush above the strand row below; the
    // tail box (if any) and the name label stack upward toward the block top.
    const primerFwdYDiff = 0;
    const primerFwdHeight = primerFwdRows.length ? primerFwdRowH * primerFwdRows.length : 0;

    // height and yDiff of cut sites
    const cutSiteYDiff = primerFwdYDiff + primerFwdHeight; // spacing for cutSite names
    const cutSiteHeight = zoomed && cutSiteRows.length ? lineHeight : 0;

    // height and yDiff of the sequence strand
    const indexYDiff = cutSiteYDiff + cutSiteHeight;
    const indexHeight = seqType === "aa" ? 0 : lineHeight; // if aa, no seq row is shown

    // ruler spacing bot — when the in-seam measuring tape renders, open a real
    // vertical lane between the top sequence row and the complement row so the
    // coordinate number (centered in that lane below) sits clear of both strands'
    // letters. Outside the tape state (zoomed out, no complement, or aa) the gap
    // is 0 and the layout is byte-identical to before. Linear.tsx adds the same
    // SEAM_GAP to blockHeight under the same condition.
    const seamGap = tapeSeamActive(zoomed, showComplement, seqType) ? SEAM_GAP : 0;

    // height and yDiff of the complement strand (pushed down by the seam lane)
    const compYDiff = indexYDiff + indexHeight + seamGap;
    const compHeight = zoomed && showComplement ? lineHeight : 0;

    // height and yDiff of reverse primers (below the complement). The annealing
    // box sits at the TOP of the track flush below the complement row above; the
    // tail box (if any) and the name label stack downward.
    const primerRevYDiff = compYDiff + compHeight;
    const primerRevHeight = primerRevRows.length ? primerRevRowH * primerRevRows.length : 0;

    // height and yDiff of translations
    // elementHeight * 2 is to account for the translation handle. If no name, don't show the handle
    const translationYDiff = primerRevYDiff + primerRevHeight;
    let translationHeight = 0;
    for (let i = 0; i < translationRows.length; i++) {
      const multiplier = translationRows[i][0]["name"] ? 2 : 1;
      translationHeight += elementHeight * multiplier;
    }

    // height and yDiff of annotations
    const annYDiff = translationYDiff + translationHeight;
    const annHeight = elementHeight * annotationRows.length;

    // height and ydiff of the index row
    const elementGap =
      primerRevRows.length + primerRevRows.length + annotationRows.length + translationRows.length ? 3 : 0;

    const indexRowYDiff = annYDiff + annHeight + elementGap;

    // calc the height necessary for the sequence selection
    // it starts 5 above the top of the SeqBlock
    const selectHeight =
      primerFwdHeight +
      cutSiteHeight +
      indexHeight +
      seamGap + // ruler spacing bot — selection rect must cover the seam lane too
      compHeight +
      translationHeight +
      annHeight +
      primerRevHeight +
      elementGap +
      5;
    let selectEdgeHeight = selectHeight + 9; // +9 is the height of a tick + index row

    // needed because otherwise the selection height is very small
    if (!zoomed && selectHeight <= elementHeight) {
      selectEdgeHeight = elementHeight;
    }

    return (
      <svg
        className="la-vz-seqblock"
        cursor="text"
        data-testid="la-vz-seqblock"
        display="block"
        height={blockHeight}
        id={id}
        overflow="visible"
        style={seqBlock}
        width={size.width >= 0 ? size.width : 0}
        onMouseDown={handleMouseEvent}
        onMouseMove={handleMouseEvent}
        onMouseUp={handleMouseEvent}
      >
        {/* ruler redesign bot — ONE owned linear ruler (replaces the two that
            used to fight: this interval ruler and the bolted strand-connector
            tape). Two clean states, swapped at the base-legibility gate:
              State A (baseLegible): the in-seam measuring tape, rendered LATER
                (after the strand glyphs) so its numbers paint on top, and this
                interval row is suppressed (the tape carries the numbers).
              State B (zoomed out): the numbered interval ruler at its row, here. */}
        {showIndex && !(zoomed && showComplement && seqType !== "aa") && (
          <IndexRow
            baseLegible={false}
            charWidth={charWidth}
            findXAndWidth={this.findXAndWidth}
            firstBase={firstBase}
            lastBase={lastBase}
            seq={seq}
            seqType={seqType}
            showIndex={showIndex}
            size={size}
            yDiff={indexRowYDiff}
            zoom={zoom}
          />
        )}
        <Selection.Block
          findXAndWidth={this.findXAndWidth}
          firstBase={firstBase}
          fullSeq={fullSeq}
          lastBase={lastBase}
          selectHeight={selectHeight}
          onUnmount={onUnmount}
        />
        {primerFwdRows.length && (
          <PrimeRows
            baseGap={0}
            bpsPerBlock={bpsPerBlock}
            charWidth={charWidth}
            direction={1}
            elementHeight={primerFwdRowH}
            findXAndWidth={this.findXAndWidthElement}
            firstBase={firstBase}
            fullSeq={fullSeq}
            inputRef={inputRef}
            lastBase={lastBase}
            lineHeight={lineHeight}
            primerRows={primerFwdRows}
            seqBlockRef={this}
            seqFontSize={seqFontSize}
            width={size.width}
            yDiff={primerFwdYDiff}
            zoomed={zoomed}
          />
        )}
        <Highlights
          compYDiff={compYDiff - 3}
          findXAndWidth={this.findXAndWidthElement}
          firstBase={firstBase}
          highlights={highlights}
          indexYDiff={indexYDiff - 3}
          inputRef={inputRef}
          lastBase={lastBase}
          lineHeight={lineHeight}
          listenerOnly={false}
          seqBlockRef={this}
        />
        <Selection.Edges
          findXAndWidth={this.findXAndWidth}
          firstBase={firstBase}
          fullSeq={fullSeq}
          lastBase={lastBase}
          selectEdgeHeight={selectEdgeHeight}
        />
        <Find
          compYDiff={compYDiff - 3}
          filteredRows={showComplement ? searchRows : searchRows.filter(r => r.direction === 1)}
          findXAndWidth={this.findXAndWidth}
          firstBase={firstBase}
          indexYDiff={indexYDiff - 3}
          inputRef={inputRef}
          lastBase={lastBase}
          lineHeight={lineHeight}
          listenerOnly={false}
          zoomed={zoomed}
        />
        {primerRevRows.length && (
          <PrimeRows
            baseGap={0}
            bpsPerBlock={bpsPerBlock}
            charWidth={charWidth}
            direction={-1}
            elementHeight={primerRevRowH}
            findXAndWidth={this.findXAndWidthElement}
            firstBase={firstBase}
            fullSeq={fullSeq}
            inputRef={inputRef}
            lastBase={lastBase}
            lineHeight={lineHeight}
            primerRows={primerRevRows}
            seqBlockRef={this}
            seqFontSize={seqFontSize}
            width={size.width}
            yDiff={primerRevYDiff}
            zoomed={zoomed}
          />
        )}
        {translationRows.length && (
          <TranslationRows
            bpsPerBlock={bpsPerBlock}
            charWidth={charWidth}
            elementHeight={elementHeight}
            findXAndWidth={this.findXAndWidth}
            findXAndWidthElement={this.findXAndWidthElement}
            firstBase={firstBase}
            fullSeq={fullSeq}
            inputRef={inputRef}
            lastBase={lastBase}
            seqType={seqType}
            translationRows={translationRows}
            yDiff={translationYDiff}
            onUnmount={onUnmount}
          />
        )}
        {annotationRows.length && (
          <AnnotationRows
            annotationRows={annotationRows}
            bpsPerBlock={bpsPerBlock}
            elementHeight={elementHeight}
            findXAndWidth={this.findXAndWidthElement}
            /* seq introns bot — raw bp->x/width helper for positioning exon
               sub-spans of a multi-segment (join) feature within this block. */
            findXAndWidthRaw={this.findXAndWidth}
            firstBase={firstBase}
            fullSeq={fullSeq}
            inputRef={inputRef}
            lastBase={lastBase}
            seqBlockRef={this}
            width={size.width}
            yDiff={annYDiff}
          />
        )}

        {zoomed && seqType !== "aa" ? (
          <text
            {...textProps}
            className="la-vz-seq"
            data-testid="la-vz-seq"
            id={id}
            style={svgText}
            transform={`translate(0, ${indexYDiff + lineHeight / 2})`}
          >
            {seq.split("").map(this.seqTextSpan)}
          </text>
        ) : null}
        {/* ruler redesign bot — the bolted `la-vz-strand-connector` per-base
            tick layer was REMOVED here. The strand seam ruler is now owned by
            the single IndexRow above (State A = the in-seam measuring tape). */}
        {compSeq && zoomed && showComplement && seqType !== "aa" ? (
          <text
            {...textProps}
            className="la-vz-comp-seq"
            data-testid="la-vz-comp-seq"
            id={id}
            style={svgText}
            transform={`translate(0, ${compYDiff + lineHeight / 2})`}
          >
            {compSeq.split("").map(this.seqTextSpan)}
          </text>
        ) : null}
        {/* ruler redesign bot — State A: the in-seam measuring tape, rendered
            AFTER the strand glyphs so its 10s numbers paint on top of the seam
            with their white halo. Active only when both strands render (the seam
            exists). It IS the strand connector + ruler + numbers, unified. */}
        {showIndex && zoomed && showComplement && seqType !== "aa" && (
          <IndexRow
            baseLegible={true}
            charWidth={charWidth}
            findXAndWidth={this.findXAndWidth}
            firstBase={firstBase}
            lastBase={lastBase}
            lineHeight={lineHeight}
            /* ruler spacing bot — center the tape baseline + 10s number on the
               visual midpoint BETWEEN the two strand text baselines (top seq at
               indexYDiff + lineHeight/2, complement at compYDiff + lineHeight/2),
               which now lands inside the SEAM_GAP lane. The number sits in its own
               clear band instead of on top of the letters. */
            seamYDiff={(indexYDiff + compYDiff) / 2 + lineHeight / 2}
            seq={seq}
            /* ruler center bot — pass the strand glyph font size so the tape can
               optically center its 10s number in the seam lane (lift by half a
               strand cap-height; the baseline midpoint alone reads too low). */
            seqFontSize={seqFontSize}
            seqType={seqType}
            showIndex={showIndex}
            size={size}
            yDiff={indexRowYDiff}
            zoom={zoom}
          />
        )}
        {zoomed && (
          <CutSites
            cutSites={cutSiteRows}
            findXAndWidth={this.findXAndWidth}
            firstBase={firstBase}
            inputRef={inputRef}
            lastBase={lastBase}
            lineHeight={lineHeight}
            size={size}
            yDiff={cutSiteYDiff - 3}
            zoom={zoom}
          />
        )}
        <Find
          compYDiff={compYDiff - 3}
          filteredRows={showComplement ? searchRows : searchRows.filter(r => r.direction === 1)}
          findXAndWidth={this.findXAndWidth}
          firstBase={firstBase}
          indexYDiff={indexYDiff - 3}
          inputRef={inputRef}
          lastBase={lastBase}
          lineHeight={lineHeight}
          listenerOnly={true}
          zoomed={zoomed}
        />
        <Highlights
          compYDiff={compYDiff - 3}
          findXAndWidth={this.findXAndWidthElement}
          firstBase={firstBase}
          highlights={highlights}
          indexYDiff={indexYDiff - 3}
          inputRef={inputRef}
          lastBase={lastBase}
          lineHeight={lineHeight}
          listenerOnly={true}
          seqBlockRef={this}
        />
      </svg>
    );
  }
}
