// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import { InputRefFunc } from "../SelectionHandler";
import AnnotationDoubleClickContext from "../annotationDoubleClickContext";
import { NameRange } from "../elements";
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
  bpsPerBlock: number;
  direction: 1 | -1;
  elementHeight: number;
  findXAndWidth: FindXAndWidthElementType;
  firstBase: number;
  fullSeq: string;
  inputRef: InputRefFunc;
  lastBase: number;
  primerRows: NameRange[][];
  seqBlockRef: unknown;
  width: number;
  yDiff: number;
}) => (
  <g>
    {props.primerRows.map((primers: NameRange[], i: number) => (
      <PrimerRow
        key={`primer-linear-row-${primers[0].id}-${props.firstBase}-${props.lastBase}`}
        bpsPerBlock={props.bpsPerBlock}
        direction={props.direction}
        findXAndWidth={props.findXAndWidth}
        firstBase={props.firstBase}
        fullSeq={props.fullSeq}
        height={props.elementHeight}
        inputRef={props.inputRef}
        lastBase={props.lastBase}
        primers={primers}
        seqBlockRef={props.seqBlockRef}
        width={props.width}
        y={props.yDiff + props.elementHeight * i}
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
  bpsPerBlock: number;
  direction: 1 | -1;
  findXAndWidth: FindXAndWidthElementType;
  firstBase: number;
  fullSeq: string;
  height: number;
  inputRef: InputRefFunc;
  lastBase: number;
  primers: NameRange[];
  seqBlockRef: unknown;
  width: number;
  y: number;
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
  element: NameRange;
  elements: NameRange[];
  findXAndWidth: FindXAndWidthElementType;
  firstBase: number;
  height: number;
  index: number;
  inputRef: InputRefFunc;
  lastBase: number;
}) => {
  const { element, elements, findXAndWidth, firstBase, index, inputRef, lastBase } = props;

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
        y={height / 2 - 5}
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
