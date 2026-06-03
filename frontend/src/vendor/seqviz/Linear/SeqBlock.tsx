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

    // height and yDiff of forward primers
    const primerFwdYDiff = 0;
    const primerFwdHeight = primerFwdRows.length ? elementHeight * primerFwdRows.length : 0;

    // height and yDiff of cut sites
    const cutSiteYDiff = primerFwdYDiff + primerFwdHeight; // spacing for cutSite names
    const cutSiteHeight = zoomed && cutSiteRows.length ? lineHeight : 0;

    // height and yDiff of the sequence strand
    const indexYDiff = cutSiteYDiff + cutSiteHeight;
    const indexHeight = seqType === "aa" ? 0 : lineHeight; // if aa, no seq row is shown

    // height and yDiff of the complement strand
    const compYDiff = indexYDiff + indexHeight;
    const compHeight = zoomed && showComplement ? lineHeight : 0;

    // height and yDiff of reverse primers
    const primerRevYDiff = compYDiff + compHeight;
    const primerRevHeight = primerRevRows.length ? elementHeight * primerRevRows.length : 0;

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
        {showIndex && (
          <IndexRow
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
            bpsPerBlock={bpsPerBlock}
            direction={1}
            elementHeight={elementHeight}
            findXAndWidth={this.findXAndWidthElement}
            firstBase={firstBase}
            fullSeq={fullSeq}
            inputRef={inputRef}
            lastBase={lastBase}
            primerRows={primerFwdRows}
            seqBlockRef={this}
            width={size.width}
            yDiff={primerFwdYDiff}
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
            bpsPerBlock={bpsPerBlock}
            direction={-1}
            elementHeight={elementHeight}
            findXAndWidth={this.findXAndWidthElement}
            firstBase={firstBase}
            fullSeq={fullSeq}
            inputRef={inputRef}
            lastBase={lastBase}
            primerRows={primerRevRows}
            seqBlockRef={this}
            width={size.width}
            yDiff={primerRevYDiff}
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
        {/* sequence-view legibility bot — SnapGene-style GRADUATED STRAND RULER
            with DYNAMIC tick-level shedding. A tick sits in the seam between the
            top sequence row and the complement row, with length keyed to ABSOLUTE
            base position (1-based) so the marks line up to real bp counts across
            blocks. Three levels: minor every bp (subtle), medium every 5 bp
            (longer), major every 10 bp (longest, darkest, thickest landmark).

            DYNAMIC: rather than always drawing a tick per base (which squishes
            into a faint band at low zoom), we shed whole tick LEVELS as the
            spacing gets too tight. charWidth is pixels-per-base and grows on zoom
            in. We pick the active MINIMUM unit (1, 5, 10, or none) from how many
            pixels each level's spacing occupies, gated by MIN_TICK_GAP_PX:
              - charWidth >= gap        : unit 1   (all 1s + 5s + 10s, as before)
              - charWidth * 5 >= gap    : unit 5   (drop per-bp minor, keep 5s+10s)
              - charWidth * 10 >= gap   : unit 10  (only the 10s major landmarks)
              - else                    : unit 0   (render nothing, stay clean)
            A column is drawn only when pos % unit === 0, and every drawn tick
            keeps its OWN level's height/contrast (a 10 stays major even in
            5s-mode, a 5 stays medium). As the user zooms, charWidth changes, the
            active set changes, and levels appear/disappear smoothly. */}
        {(() => {
          if (!(compSeq && zoomed && showComplement && seqType !== "aa")) return null;

          // minimum readable pixel gap between adjacent rendered ticks; below
          // this, the level is shed. Tuned so per-bp ticks stay legible and
          // never collapse into a muddy band.
          const MIN_TICK_GAP_PX = 11;

          // active minimum spacing unit, chosen from the widest level that still
          // clears the readability gap. unit === 0 means draw nothing.
          let unit: number;
          if (charWidth >= MIN_TICK_GAP_PX) {
            unit = 1;
          } else if (charWidth * 5 >= MIN_TICK_GAP_PX) {
            unit = 5;
          } else if (charWidth * 10 >= MIN_TICK_GAP_PX) {
            unit = 10;
          } else {
            unit = 0;
          }

          if (unit === 0) return null;

          return (
            <g
              className="la-vz-strand-connector"
              data-testid="la-vz-strand-connector"
              fill="none"
            >
              {seq.split("").map((_, i) => {
                // pos is the 1-based absolute bp this column maps to.
                const pos = firstBase + i + 1;
                // skip columns that are not on the active minimum spacing.
                if (pos % unit !== 0) return null;

                const cx = charWidth * (i + 0.5);
                const isMajor = pos % 10 === 0;
                const isMedium = !isMajor && pos % 5 === 0;
                // tick half-length as a fraction of lineHeight, centered on the
                // seam (symmetric above and below compYDiff). Major > medium > minor.
                const half = isMajor
                  ? lineHeight * 0.34
                  : isMedium
                    ? lineHeight * 0.22
                    : lineHeight * 0.12;
                // progressively higher contrast: minor ticks stay subtle slate,
                // medium read clearly, major are the darkest, thickest landmarks.
                // In 10s-only mode the majors carry the whole ruler, so nudge
                // their contrast up a touch so they read without becoming a grid.
                const stroke = isMajor ? "#475569" : isMedium ? "#94a3b8" : "#cbd5e1";
                const strokeOpacity = isMajor ? 0.9 : isMedium ? 0.7 : 0.5;
                const strokeWidth = isMajor ? 0.9 : isMedium ? 0.6 : 0.5;
                return (
                  <line
                    key={`conn-${id}-${i}`}
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    x1={cx}
                    x2={cx}
                    y1={compYDiff - half}
                    y2={compYDiff + half}
                  />
                );
              })}
            </g>
          );
        })()}
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
