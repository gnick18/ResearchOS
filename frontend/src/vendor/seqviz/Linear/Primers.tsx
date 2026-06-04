// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import { InputRefFunc } from "../SelectionHandler";
import AnnotationDoubleClickContext from "../annotationDoubleClickContext";
import { NameRange, PrimerBaseCell } from "../elements";
import { annotation, annotationLabel } from "../style";
import { FindXAndWidthElementType } from "./SeqBlock";

const hoverOtherPrimerRows = (className: string, opacity: number) => {
  if (!document) return;
  const elements = document.getElementsByClassName(className) as HTMLCollectionOf<HTMLElement>;
  for (let i = 0; i < elements.length; i += 1) {
    elements[i].style.fillOpacity = `${opacity}`;
  }
};

/**
 * Render each row of annotations into its own row.
 * This is not a default export for sake of the React component displayName.
 */
const PrimeRows = (props: {
  baseGap: number;
  bpsPerBlock: number;
  charWidth: number;
  direction: 1 | -1;
  elementHeight: number;
  findXAndWidth: FindXAndWidthElementType;
  firstBase: number;
  fullSeq: string;
  inputRef: InputRefFunc;
  lastBase: number;
  lineHeight: number;
  primerRows: NameRange[][];
  seqBlockRef: unknown;
  seqFontSize: number;
  width: number;
  yDiff: number;
  zoomed: boolean;
}) => (
  <g>
    {props.primerRows.map((primers: NameRange[], i: number) => (
      <PrimerRow
        key={`primer-linear-row-${primers[0].id}-${props.firstBase}-${props.lastBase}`}
        baseGap={props.baseGap}
        bpsPerBlock={props.bpsPerBlock}
        charWidth={props.charWidth}
        direction={props.direction}
        findXAndWidth={props.findXAndWidth}
        firstBase={props.firstBase}
        fullSeq={props.fullSeq}
        height={props.elementHeight}
        inputRef={props.inputRef}
        lastBase={props.lastBase}
        lineHeight={props.lineHeight}
        primers={primers}
        seqBlockRef={props.seqBlockRef}
        seqFontSize={props.seqFontSize}
        width={props.width}
        y={props.yDiff + props.elementHeight * i}
        zoomed={props.zoomed}
      />
    ))}
  </g>
);

export default PrimeRows;

/**
 * A single row of annotations. Multiple of these may be in one seqBlock
 * vertically stacked on top of one another in non-overlapping arrays.
 */
const PrimerRow = (props: {
  baseGap: number;
  bpsPerBlock: number;
  charWidth: number;
  direction: 1 | -1;
  findXAndWidth: FindXAndWidthElementType;
  firstBase: number;
  fullSeq: string;
  height: number;
  inputRef: InputRefFunc;
  lastBase: number;
  lineHeight: number;
  primers: NameRange[];
  seqBlockRef: unknown;
  seqFontSize: number;
  width: number;
  y: number;
  zoomed: boolean;
}) => {
  return (
    <g
      className="la-vz-linear-primer-row"
      height={props.height * 0.8}
      transform={`translate(0, ${props.y})`}
      width={props.width}
    >
      {props.primers
        .filter(a => a.direction == props.direction)
        .map((a, i) => (
          <SingleNamedElement
            {...props} // include overflowLeft in the key to avoid two split primers in the same row from sharing a key
            key={`primer-linear-${a.id}-${i}-${props.firstBase}-${props.lastBase}`}
            element={a}
            elements={props.primers}
            index={i}
          />
        ))}
    </g>
  );
};

/**
 * SingleNamedElement is a single rectangular element in the SeqBlock.
 * It does a bunch of stuff to avoid edge-cases from wrapping around the 0-index, edge of blocks, etc.
 */
const SingleNamedElement = (props: {
  baseGap: number;
  charWidth: number;
  element: NameRange;
  elements: NameRange[];
  findXAndWidth: FindXAndWidthElementType;
  firstBase: number;
  height: number;
  index: number;
  inputRef: InputRefFunc;
  lastBase: number;
  seqFontSize: number;
  zoomed: boolean;
}) => {
  const { baseGap, charWidth, element, elements, findXAndWidth, firstBase, index, inputRef, lastBase, seqFontSize, zoomed } =
    props;

  // RESEARCHOS (primer dialog bot): primers fire the SAME double-click context as
  // annotations so double-clicking a primer on the viewer opens the Edit Primer
  // dialog. The host (SequenceEditView) routes primer_bind features to the
  // primer-specific editor.
  const onAnnotationDoubleClick = React.useContext(AnnotationDoubleClickContext);
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!onAnnotationDoubleClick) return;
    e.stopPropagation();
    onAnnotationDoubleClick({
      name: element.name,
      start: element.start,
      end: element.end,
      direction: element.direction,
    });
  };

  const { color, direction, end, name, start } = element;
  const forward = direction === 1;
  const reverse = direction === -1;
  const { overflowLeft, overflowRight, width, x: origX } = findXAndWidth(index, element, elements);
  const crossZero = start > end && end < firstBase;

  // does the element begin or end within this seqBlock with a directionality?
  const endFWD = forward && end > firstBase && end <= lastBase;
  const endREV = reverse && start >= firstBase && start <= lastBase;

  // create padding on either side, vertically, of an element
  const height = props.height * 0.7;

  const [x, w] = [origX, width];

  // RESEARCHOS (primer style bot): SnapGene-style primer rendering.
  // Instead of a filled block-arrow ("mini gene"), a primer is drawn as a THIN
  // outlined annealing bracket spanning its binding region: a horizontal stroke
  // along the annealing line with small downward "feet" at the region ends, plus
  // a short angled HOOK at the 3' end pointing in the primer's direction
  // (forward => hook at the right/3' end pointing right; reverse => hook at the
  // left/3' end pointing left). Nothing is filled; the stroke carries the primer
  // color. Per-block clipping is preserved: when a primer overflows a SeqBlock
  // boundary we suppress the foot/hook on the overflowing side (the bracket just
  // continues as a flat line into the next block), mirroring the original
  // "jagged edge means it continues" semantics.
  const midY = height / 2; // the annealing line sits on the row's vertical center
  const footH = Math.min(height / 2, 5); // length of the end "feet"
  const hookW = 5; // horizontal reach of the 3' hook
  const hookH = 4; // vertical reach of the 3' hook

  // The annealing line spans the visible binding region within this block.
  let linePath = `M 0 ${midY} L ${width} ${midY}`;

  // Left foot: drawn only when the region actually STARTS in this block (not an
  // overflow continuation, not a cross-zero wrap).
  const startsHere = !overflowLeft && !crossZero;
  // Right foot: drawn only when the region actually ENDS in this block.
  const endsHere = !overflowRight && !crossZero;

  if (startsHere) {
    linePath += ` M 0 ${midY} L 0 ${midY + footH}`;
  }
  if (endsHere) {
    linePath += ` M ${width} ${midY} L ${width} ${midY + footH}`;
  }

  // 3' directional hook. Forward primers anneal 5'->3' left-to-right, so the 3'
  // end is the RIGHT edge; reverse primers run right-to-left, so the 3' end is
  // the LEFT edge. Only draw the hook when that 3' end actually lands in this
  // block (so a primer split across blocks shows its hook once, on the correct
  // piece) and there's room for it.
  if (forward && endFWD && width > hookW + 2) {
    // hook at the right end, caret opening to the right (pointing 3' / forward)
    linePath += ` M ${width - hookW} ${midY - hookH} L ${width} ${midY} L ${width - hookW} ${midY + hookH}`;
  } else if (reverse && endREV && width > hookW + 2) {
    // hook at the left end, caret opening to the left (pointing 3' / reverse)
    linePath += ` M ${hookW} ${midY - hookH} L 0 ${midY} L ${hookW} ${midY + hookH}`;
  }
  // 0.591 is our best approximation of Roboto Mono's aspect ratio (width / height).
  const fontSize = 12;
  const annotationCharacterWidth = 0.591 * fontSize;
  const availableCharacters = Math.floor((width - 40) / annotationCharacterWidth);

  // Ellipsize or hide the name if it's too long.
  let displayName = name;
  if (name.length > availableCharacters) {
    const charactersToShow = availableCharacters - 1;
    if (charactersToShow < 3) {
      // If we can't show at least three characters, don't show any.
      displayName = "";
    } else {
      displayName = `${name.slice(0, charactersToShow)}…`;
    }
  }

  // primer bases — BASE-LEVEL render (SnapGene parity). When zoomed in enough that
  // bases are legible AND this primer carries a per-base layout (its oligo mapped
  // onto template columns by lib/sequences/primer-base-layout), draw the primer as
  // SnapGene does, instead of the thin bracket:
  //   - the ANNEALING region is an outlined BOX hugging the bases, which sit
  //     column-for-column over the template base they pair with. A 3' ARROWHEAD
  //     caps the box on the reading end (right for a forward primer, left for a
  //     reverse one).
  //   - a non-annealing 5' TAIL (a cloning overhang) is a SECOND outlined box,
  //     raised one row OFF the template (up for forward, down for reverse) and
  //     abutting the annealing box at the 5' corner, so the tail reads as
  //     "popping off" the template.
  //   - MISMATCH bases keep their column but render in a contrasting red.
  //   - the NAME label sits in its own lane clear of the boxes (above for forward,
  //     below for reverse), so name and bases never overlap.
  // The whole row's height (props.height) was sized by SeqBlock.primerRowHeight to
  // fit these lanes; we derive the lane geometry from that same height here so the
  // two agree. Zoomed out, none of this runs and the thin arrow + label is used.
  const primerColor = color || "#f472b6";
  // primer bases — the border + arrowhead + name carry the PRIMER's own color
  // (purple/pink/whatever the user set); the bases INSIDE render in a distinct
  // green so they stand out against the border the way SnapGene shows them. Green
  // is tuned to read on the editor's light background (darker than SnapGene's
  // dark-mode green). Mismatches still override to red.
  const baseColor = "#15803d"; // green-700 — the in-primer base glyphs
  const mismatchColor = "#dc2626"; // contrasting red so a mismatch base reads popped
  const baseCells = (element as { baseCells?: PrimerBaseCell[] }).baseCells;
  const renderBases = zoomed && charWidth > 4 && Array.isArray(baseCells) && baseCells.length > 0;

  // column (forward template coord) -> local x within this element's group (the
  // group is translated to origX, so we subtract it). Center is +half a char.
  const colLeftX = (column: number) => (column - firstBase) * charWidth - origX;
  const colCenterX = (column: number) => colLeftX(column) + charWidth / 2;
  const baseFontSize = Math.min(seqFontSize || fontSize, charWidth / 0.62);

  // ---- base-render lane geometry (row-local y: 0 = row top, H = row bottom) ----
  const H = props.height; // the full primer-row height (SeqBlock.primerRowHeight)
  const boxH = baseFontSize + 6; // one base box (glyph + vertical padding)
  const strandMargin = 3; // gap between the annealing box and the strand it hugs

  const annealList = renderBases ? baseCells!.filter(c => c.role !== "tail") : [];
  const tailList = renderBases ? baseCells!.filter(c => c.role === "tail") : [];
  // Clip to THIS block's column window (a primer + its 5' tail can span more than
  // one SeqBlock; each block draws only its own columns). Using the column range
  // (not the primer's pixel width) is essential for the forward tail, whose bases
  // sit to the LEFT of the primer's start, well outside the primer's own x-span.
  const inBlock = (c: PrimerBaseCell) => c.column >= firstBase && c.column <= lastBase;
  const annVis = annealList.filter(inBlock);
  const tailVis = tailList.filter(inBlock);
  const hasTail = tailVis.length > 0;

  // Forward primer: annealing box flush at the BOTTOM of the track (the top strand
  // is just below), tail box raised above it, label above that. Reverse primer:
  // mirror — annealing box flush at the TOP (complement just above), tail below,
  // label below.
  let annTop: number;
  let annBot: number;
  let tailTop: number;
  let tailBot: number;
  let labelY: number;
  if (forward) {
    annBot = H - strandMargin;
    annTop = annBot - boxH;
    tailBot = annTop;
    tailTop = tailBot - boxH;
    // label lane = everything above the topmost box; center the name in it.
    labelY = (hasTail ? tailTop : annTop) / 2;
  } else {
    annTop = strandMargin;
    annBot = annTop + boxH;
    tailTop = annBot;
    tailBot = tailTop + boxH;
    // label lane = everything below the bottommost box; center the name in it.
    labelY = ((hasTail ? tailBot : annBot) + H) / 2;
  }
  const annBaseY = (annTop + annBot) / 2;
  const tailBaseY = (tailTop + tailBot) / 2;

  // Annealing box x-extent from the visible annealing cells, plus the 3' arrowhead.
  const annCols = annVis.map(c => c.column);
  const annX0 = annVis.length ? colLeftX(Math.min(...annCols)) : 0;
  const annX1 = annVis.length ? colLeftX(Math.max(...annCols)) + charWidth : 0;
  // 3' ARROWHEAD — SnapGene "pull back" style. The annealing BODY stays a full
  // rectangle so the bases are fully enclosed and the last letter is never clipped;
  // the arrowhead is an extra barb at the 3' end that rises OFF the body (away from
  // the strand it hugs: up for forward, down for reverse) and sweeps forward to a
  // point in the reading direction. Drawn only when the 3' end lands in this block;
  // otherwise the body runs flat into the next block (the primer continues).
  const headLen = Math.min(charWidth * 0.9, baseFontSize + 3); // forward reach of the tip
  const barbRise = boxH * 0.55; // how far the barb pulls back off the body
  const arrowRight = forward && endFWD;
  const arrowLeft = reverse && endREV;
  const annealBoxPath = (() => {
    if (!annVis.length) return "";
    if (arrowRight) {
      // full top edge to the right corner, riser UP (pull back), sweep to the tip,
      // back down to the bottom-right corner, bottom edge home.
      return `M ${annX0} ${annTop} L ${annX1} ${annTop} L ${annX1} ${annTop - barbRise} L ${annX1 + headLen} ${annBaseY} L ${annX1} ${annBot} L ${annX0} ${annBot} Z`;
    }
    if (arrowLeft) {
      // mirror: full bottom edge to the left corner, riser DOWN (pull back), sweep
      // to the tip on the left, back up to the top-left corner, top edge home.
      return `M ${annX1} ${annBot} L ${annX0} ${annBot} L ${annX0} ${annBot + barbRise} L ${annX0 - headLen} ${annBaseY} L ${annX0} ${annTop} L ${annX1} ${annTop} Z`;
    }
    return `M ${annX0} ${annTop} L ${annX1} ${annTop} L ${annX1} ${annBot} L ${annX0} ${annBot} Z`;
  })();

  // Tail box x-extent from the visible tail cells.
  const tailCols = tailVis.map(c => c.column);
  const tailX0 = hasTail ? colLeftX(Math.min(...tailCols)) : 0;
  const tailX1 = hasTail ? colLeftX(Math.max(...tailCols)) + charWidth : 0;

  // Label centered over the annealing box (falls back to the block center when the
  // annealing region is in another block).
  const labelCenterX = annVis.length ? (annX0 + annX1) / 2 : width / 2;

  // Shared primer interaction handlers (selection ref via the stroked shape, the
  // double-click-to-edit, and the row-dim hover) attach to whichever stroked shape
  // carries the primer in each mode.
  const refForShape = inputRef(element.id, {
    end: end,
    name: element.name,
    ref: element.id,
    start: start,
    type: "PRIMER",
    viewer: "LINEAR",
  });

  if (renderBases) {
    // SnapGene-style box render. The element group sits at the row top (origX, 0)
    // so the lane y's computed above map straight to row-local pixels.
    return (
      <g id={element.id} transform={`translate(${x}, 0)`}>
        <title>{name}</title>
        {/* ANNEALING box (with the 3' arrowhead) — the stroked shape that also
            carries the selection ref + interaction handlers. */}
        {annealBoxPath ? (
          <path
            ref={refForShape}
            className={`${element.id} la-vz-primer`}
            cursor="pointer"
            d={annealBoxPath}
            fill="none"
            id={element.id}
            stroke={primerColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={annotation}
            onBlur={() => {}}
            onDoubleClick={handleDoubleClick}
            onFocus={() => {}}
            onMouseOut={() => hoverOtherPrimerRows(element.id, 0.7)}
            onMouseOver={() => hoverOtherPrimerRows(element.id, 1.0)}
          />
        ) : null}
        {/* 5' TAIL box — raised off the template, abutting the annealing box at the
            5' corner so it reads as one connected shape that pops off. */}
        {hasTail ? (
          <rect
            className={`${element.id} la-vz-primer`}
            cursor="pointer"
            x={Math.min(tailX0, tailX1)}
            y={tailTop}
            width={Math.abs(tailX1 - tailX0)}
            height={boxH}
            rx={2.5}
            fill="none"
            stroke={primerColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            onDoubleClick={handleDoubleClick}
            onMouseOut={() => hoverOtherPrimerRows(element.id, 0.7)}
            onMouseOver={() => hoverOtherPrimerRows(element.id, 1.0)}
          />
        ) : null}
        {/* the primer's actual bases, column-aligned over the template (annealing)
            or packed in the raised tail box (tail). */}
        <g className="la-vz-primer-bases" pointerEvents="none">
          {baseCells!.filter(inBlock).map((cell: PrimerBaseCell) => {
            const isTail = cell.role === "tail";
            const isMismatch = cell.role === "mismatch";
            return (
              <text
                key={`pb-${element.id}-${cell.oligoIndex}`}
                dominantBaseline="middle"
                textAnchor="middle"
                x={colCenterX(cell.column)}
                y={isTail ? tailBaseY : annBaseY}
                fontSize={baseFontSize}
                fontFamily="Roboto Mono, monospace"
                fontWeight={isMismatch ? 700 : 500}
                fill={isMismatch ? mismatchColor : baseColor}
              >
                {cell.base}
              </text>
            );
          })}
        </g>
        {/* NAME label in its own lane, clear of the boxes. */}
        <text
          className="la-vz-primer-label"
          cursor="pointer"
          dominantBaseline="middle"
          fill={primerColor}
          fontSize={fontSize}
          id={element.id}
          style={annotationLabel}
          textAnchor="middle"
          x={labelCenterX}
          y={labelY}
          onDoubleClick={handleDoubleClick}
          onMouseOut={() => hoverOtherPrimerRows(element.id, 0.7)}
          onMouseOver={() => hoverOtherPrimerRows(element.id, 1.0)}
        >
          {displayName}
        </text>
      </g>
    );
  }

  // Zoomed-out (arrow-only): the thin outlined annealing bracket + 3' hook + label,
  // unchanged from before.
  return (
    <g id={element.id} transform={`translate(${x}, ${0.1 * height})`}>
      <title>{name}</title>
      <path
        ref={refForShape}
        className={`${element.id} la-vz-primer`}
        cursor="pointer"
        d={linePath}
        fill="none"
        id={element.id}
        stroke={primerColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={annotation}
        onBlur={() => {}}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {}}
        onMouseOut={() => hoverOtherPrimerRows(element.id, 0.7)}
        onMouseOver={() => hoverOtherPrimerRows(element.id, 1.0)}
      />
      <text
        className="la-vz-primer-label"
        cursor="pointer"
        dominantBaseline="middle"
        fill={primerColor}
        fontSize={fontSize}
        id={element.id}
        style={annotationLabel}
        textAnchor="middle"
        x={width / 2}
        y={height / 2 - 5}
        onBlur={() => {}}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {}}
        onMouseOut={() => hoverOtherPrimerRows(element.id, 0.7)}
        onMouseOver={() => hoverOtherPrimerRows(element.id, 1.0)}
      >
        {displayName}
      </text>
    </g>
  );
};
