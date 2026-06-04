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

  // primer bases bot — BASE-LEVEL render (SnapGene parity). When zoomed in enough
  // that bases are legible (the same `zoomed` gate the strand letters render
  // under) AND this primer carries a per-base layout (its stored oligo mapped onto
  // template columns by lib/sequences/primer-base-layout), draw the primer's
  // ACTUAL bases:
  //   - ANNEALING bases sit column-for-column on the annealing line (`midY`), over
  //     the template base they pair with (forward column x = (col - firstBase) *
  //     charWidth, made local to this element's group by subtracting origX).
  //   - the non-annealing 5' TAIL bases lift OFF the template as a flap, offset
  //     vertically AWAY from the strand (up for a forward primer whose row sits
  //     above the top strand, down for a reverse primer below the complement), with
  //     a short kink connecting the flap back to the annealing line so it reads as
  //     "pops off" rather than floating.
  //   - MISMATCH bases keep their template column but render in a contrasting red
  //     so a non-pairing base reads as popped even mid-anneal.
  // The name label stays (lifted clear of the forward flap below). Whole layer is a
  // no-op when zoomed out, leaving the arrow + label untouched. Coordinates are in
  // this element's translated group frame; baseLocalX maps a template column to an
  // x in that frame and is clipped to the visible block columns.
  const baseCells = (element as { baseCells?: PrimerBaseCell[] }).baseCells;
  const renderBases = zoomed && charWidth > 4 && Array.isArray(baseCells) && baseCells.length > 0;
  const baseLocalX = (column: number) => (column - firstBase) * charWidth - origX;
  // Flap lifts toward the open base-gap lane: up for forward (row above strand),
  // down for reverse (row below complement). A short connector kink bridges the
  // annealing line to the flap baseline.
  const baseFontSize = Math.min(seqFontSize || fontSize, charWidth / 0.62);
  // primer bases bot — slide the whole base layer toward the strand it pairs with
  // so the annealing bases sit FLUSH against the template and the reserved base-gap
  // lane carries the popped 5' flap on the far side. Forward primers ride above the
  // top strand, so the annealing line drops DOWN by the gap (close to the strand
  // below) and the flap rises up into the freed row space. Reverse primers ride
  // below the complement, so the annealing line stays near the row top (close to
  // the complement above) and the flap drops down into the gap lane below.
  const baseLaneShift = renderBases && forward ? baseGap : 0;
  const annealLineY = midY + baseLaneShift;
  // Annealing bases nudge off the bracket line toward the strand so the stroke
  // does not cut through the glyphs; the flap rises a full base-height away.
  const annealBaseShift = baseFontSize * 0.62;
  const flapOffset = forward ? -(baseFontSize * 1.25 + 4) : baseFontSize * 1.25 + 4;
  const flapBaselineY = annealLineY + flapOffset;
  const primerColor = color || "#f472b6";
  const mismatchColor = "#dc2626"; // contrasting red so a mismatch base reads popped

  return (
    <g id={element.id} transform={`translate(${x}, ${0.1 * height})`}>
      {/* <title> provides a hover tooltip on most browsers */}
      <title>{name}</title>
      <path
        ref={inputRef(element.id, {
          end: end,
          name: element.name,
          ref: element.id,
          start: start,
          type: "PRIMER",
          viewer: "LINEAR",
        })}
        className={`${element.id} la-vz-primer`}
        cursor="pointer"
        d={linePath}
        // primer bases bot — when the base row renders, slide the bracket with the
        // annealing line so the thin stroke underlines the annealing bases instead
        // of sitting at the unshifted row center.
        transform={baseLaneShift ? `translate(0, ${baseLaneShift})` : undefined}
        // RESEARCHOS (primer style bot): thin outlined bracket, not a filled
        // block. No fill; the primer color is carried by the stroke.
        fill="none"
        id={element.id}
        stroke={color || "#f472b6"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={annotation}
        onBlur={() => {
          // do nothing
        }}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {
          // do nothing
        }}
        onMouseOut={() => hoverOtherPrimerRows(element.id, 0.7)}
        onMouseOver={() => hoverOtherPrimerRows(element.id, 1.0)}
      />
      {renderBases && (
        <g className="la-vz-primer-bases" pointerEvents="none">
          {baseCells.map((cell: PrimerBaseCell) => {
            // Only draw bases whose column is visible inside this block (the flap
            // can poke a column or two past the annealed span; we still clip to
            // the block's own column window so a base never paints in a neighbour).
            const cx = baseLocalX(cell.column) + charWidth / 2;
            if (cx < -charWidth || cx > width + charWidth) return null;
            const isTail = cell.role === "tail";
            const isMismatch = cell.role === "mismatch";
            // Annealing bases sit just off the annealing line on the strand-facing
            // side (below for a forward primer, above for a reverse primer) so the
            // thin stroke does not slash through the letters. Tail bases ride the
            // flap baseline (lifted away from the strand).
            const annealY = annealLineY + (forward ? annealBaseShift : -annealBaseShift);
            const y = isTail ? flapBaselineY : annealY;
            // A tail base pops off: a short connector kink from the annealing line
            // up/down to the flap base, drawn once per tail base so the flap reads
            // as lifting off the template rather than floating free.
            const connector = isTail
              ? `M ${cx} ${annealLineY} L ${cx} ${y + (forward ? baseFontSize * 0.4 : -baseFontSize * 0.4)}`
              : null;
            return (
              <g key={`pb-${element.id}-${cell.oligoIndex}`}>
                {connector && (
                  <path
                    d={connector}
                    fill="none"
                    stroke={primerColor}
                    strokeWidth={1}
                    strokeLinecap="round"
                    opacity={0.7}
                  />
                )}
                <text
                  dominantBaseline="middle"
                  textAnchor="middle"
                  x={cx}
                  y={y}
                  fontSize={baseFontSize}
                  fontFamily="Roboto Mono, monospace"
                  fontWeight={isMismatch ? 700 : 500}
                  fill={isMismatch ? mismatchColor : primerColor}
                >
                  {cell.base}
                </text>
              </g>
            );
          })}
        </g>
      )}
      <text
        className="la-vz-primer-label"
        cursor="pointer"
        dominantBaseline="middle"
        // RESEARCHOS (primer colors bot): color the label TEXT in the primer's own
        // color so it matches the annealing bracket. Overrides annotationLabel's
        // dark default. Falls back to the standard primer pink when unset.
        fill={color || "#f472b6"}
        fontSize={fontSize}
        id={element.id}
        style={annotationLabel}
        textAnchor="middle"
        x={width / 2}
        // RESEARCHOS (primer style bot): sit the label just ABOVE the thin
        // annealing line so it doesn't collide with the bracket stroke.
        // primer bases bot — when the base row renders, lift the forward label
        // clear above the popped 5'-tail flap (the flap rises toward the block top)
        // so name + bases don't overlap; reverse keeps the label above the line.
        y={renderBases && forward ? flapBaselineY - baseFontSize : height / 2 - 5}
        onBlur={() => {
          // do nothing
        }}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {
          // do nothing
        }}
        onMouseOut={() => hoverOtherPrimerRows(element.id, 0.7)}
        onMouseOver={() => hoverOtherPrimerRows(element.id, 1.0)}
      >
        {displayName}
      </text>
    </g>
  );
};
