// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import { InputRefFunc } from "../SelectionHandler";
import AnnotationDoubleClickContext from "../annotationDoubleClickContext";
import { COLOR_BORDER_MAP, darkerColor } from "../colors";
import { getReadableTextColor } from "@/lib/colors";
import { NameRange } from "../elements";
import { clipSegmentToBlock } from "../sequence";
import { annotation, annotationLabel } from "../style";
import { FindXAndWidthElementType } from "./SeqBlock";

const hoverOtherAnnotationRows = (className: string, opacity: number) => {
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
const AnnotationRows = (props: {
  annotationRows: NameRange[][];
  bpsPerBlock: number;
  elementHeight: number;
  findXAndWidth: FindXAndWidthElementType;
  // seq introns bot — raw bp->x/width helper for exon sub-spans (multi-segment features).
  findXAndWidthRaw: (firstIndex?: number, lastIndex?: number) => { width: number; x: number };
  firstBase: number;
  fullSeq: string;
  inputRef: InputRefFunc;
  lastBase: number;
  seqBlockRef: unknown;
  width: number;
  yDiff: number;
}) => (
  <g>
    {props.annotationRows.map((anns: NameRange[], i: number) => (
      <AnnotationRow
        // Two annotations can share an id (e.g. a gene + its CDS at identical
        // coordinates both carry our stable roidx hit-stamp), so the row's
        // lead annotation id is NOT unique across rows in a block. Suffix the
        // row index `i` to keep the React key unique. The id attribute is left
        // alone, so the right-click hit detection (which reads the element id)
        // is unaffected.
        key={`annotation-linear-row-${anns[0].id}-${i}-${props.firstBase}-${props.lastBase}`}
        annotations={anns}
        bpsPerBlock={props.bpsPerBlock}
        findXAndWidth={props.findXAndWidth}
        findXAndWidthRaw={props.findXAndWidthRaw}
        firstBase={props.firstBase}
        fullSeq={props.fullSeq}
        height={props.elementHeight}
        inputRef={props.inputRef}
        lastBase={props.lastBase}
        seqBlockRef={props.seqBlockRef}
        width={props.width}
        y={props.yDiff + props.elementHeight * i}
      />
    ))}
  </g>
);

export default AnnotationRows;

/**
 * A single row of annotations. Multiple of these may be in one seqBlock
 * vertically stacked on top of one another in non-overlapping arrays.
 */
const AnnotationRow = (props: {
  annotations: NameRange[];
  bpsPerBlock: number;
  findXAndWidth: FindXAndWidthElementType;
  findXAndWidthRaw: (firstIndex?: number, lastIndex?: number) => { width: number; x: number };
  firstBase: number;
  fullSeq: string;
  height: number;
  inputRef: InputRefFunc;
  lastBase: number;
  seqBlockRef: unknown;
  width: number;
  y: number;
}) => (
  <g
    className="la-vz-linear-annotation-row"
    height={props.height * 0.8}
    transform={`translate(0, ${props.y})`}
    width={props.width}
  >
    {props.annotations.map((a, i) => {
      // seq introns bot — a multi-segment (join) feature renders as one box per
      // exon joined by a thin dashed intron connector, with a single label.
      const segs = (a as { segments?: { start: number; end: number }[] }).segments;
      if (segs && segs.length > 1) {
        return (
          <SplicedNamedElement
            key={`annotation-linear-spliced-${a.id}-${i}-${props.firstBase}-${props.lastBase}`}
            element={a}
            findXAndWidthRaw={props.findXAndWidthRaw}
            firstBase={props.firstBase}
            height={props.height}
            inputRef={props.inputRef}
            lastBase={props.lastBase}
            width={props.width}
          />
        );
      }
      return (
        <SingleNamedElement
          {...props} // include overflowLeft in the key to avoid two split annotations in the same row from sharing a key
          key={`annotation-linear-${a.id}-${i}-${props.firstBase}-${props.lastBase}`}
          element={a}
          elements={props.annotations}
          index={i}
        />
      );
    })}
  </g>
);

/**
 * seq introns bot — SplicedNamedElement renders a multi-exon (join) feature:
 * one box per exon (clipped to this SeqBlock), a thin dashed intron connector
 * across the gaps, and ONE label centered over the feature's visible extent in
 * this block. The arrowhead is drawn on the terminal exon only (last exon for
 * forward, first exon for reverse). Coordinates are absolute bp in the same
 * space as start/end; each exon's end is the exclusive boundary (matching the
 * single-span path's treatment), so a single exon renders byte-identically to a
 * standalone single-span annotation of the same span.
 */
const SplicedNamedElement = (props: {
  element: NameRange & { segments?: { start: number; end: number }[] };
  findXAndWidthRaw: (firstIndex?: number, lastIndex?: number) => { width: number; x: number };
  firstBase: number;
  height: number;
  inputRef: InputRefFunc;
  lastBase: number;
  width: number;
}) => {
  const { element, findXAndWidthRaw, firstBase, inputRef, lastBase } = props;
  const onAnnotationDoubleClick = React.useContext(AnnotationDoubleClickContext);

  const { color, direction, id, name } = element;
  const forward = direction === 1;
  const reverse = direction === -1;

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

  const height = props.height * 0.8;
  // Opposite-mode border (light edge in dark, dark edge in light) so a feature's
  // outline reads against any background and any fill color. See --seq-feature-stroke.
  const stroke = "var(--seq-feature-stroke)";

  // Normalize + sort exons (genomic order). end is exclusive.
  const exons = (element.segments || [])
    .map(s => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) }))
    .sort((a, b) => a.start - b.start);

  // The arrow-bearing terminal exon: last (forward) / first (reverse).
  const terminalIdx = reverse ? 0 : exons.length - 1;

  const cW = 4; // arrow width
  const cH = height / 4;

  // Build the exon box path within this block. The terminal exon gets an arrow.
  const exonPath = (w: number, isTerminal: boolean): string => {
    const topLeft = isTerminal && reverse ? `M ${2 * cW} 0` : "M 0 0";
    const topRight = isTerminal && forward ? `L ${w - 2 * cW} 0` : `L ${w} 0`;
    let bottomRight = `L ${w} ${height}`;
    if (isTerminal && forward && w > 2 * cW) {
      bottomRight = `L ${w} ${height / 2} L ${w - Math.min(2 * cW, w)} ${height}`;
    }
    let bottomLeft = `L 0 ${height} L 0 0`;
    if (isTerminal && reverse && w > 2 * cW) {
      bottomLeft = `L ${Math.min(2 * cW, w)} ${height} L 0 ${height / 2} L ${Math.min(2 * cW, w)} 0`;
    }
    return `${topLeft} ${topRight} ${bottomRight} ${bottomLeft}`;
  };

  // Visible extent of the whole feature within this block (for the single label).
  const featStart = exons.length ? exons[0].start : element.start;
  const featEnd = exons.length ? exons[exons.length - 1].end : element.end;
  const visFeatStart = Math.max(featStart, firstBase);
  const visFeatEnd = Math.min(featEnd, lastBase);
  const labelBox = visFeatEnd > visFeatStart ? findXAndWidthRaw(visFeatStart, visFeatEnd) : { x: 0, width: 0 };

  const fontSize = 12;
  const annotationCharacterWidth = 0.591 * fontSize;
  const availableCharacters = Math.floor((labelBox.width - 40) / annotationCharacterWidth);
  let displayName = name;
  if (name.length > availableCharacters) {
    const charactersToShow = availableCharacters - 1;
    displayName = charactersToShow < 3 ? "" : `${name.slice(0, charactersToShow)}…`;
  }

  return (
    <g id={id} transform={`translate(0, ${0.1 * height})`}>
      <title>{name}</title>

      {/* Dashed intron connectors across the gaps between consecutive exons. */}
      {exons.slice(0, -1).map((ex, gi) => {
        const clip = clipSegmentToBlock(ex.end, exons[gi + 1].start, firstBase, lastBase);
        if (!clip) return null;
        const { x, width } = findXAndWidthRaw(clip.start, clip.end);
        if (!width) return null;
        return (
          <line
            key={`${id}-intron-${gi}-${firstBase}`}
            className="la-vz-annotation-intron"
            stroke={stroke}
            strokeDasharray="3 2"
            strokeWidth={1}
            x1={x}
            x2={x + width}
            y1={height / 2}
            y2={height / 2}
          />
        );
      })}

      {/* One box per exon, clipped to this block. */}
      {exons.map((ex, ei) => {
        const clip = clipSegmentToBlock(ex.start, ex.end, firstBase, lastBase);
        if (!clip) return null;
        const { x, width } = findXAndWidthRaw(clip.start, clip.end);
        if (!width) return null;
        // Only paint the arrow if the terminal exon is fully (its arrow end)
        // within this block; otherwise draw a plain box for the clipped piece.
        const isTerminal =
          ei === terminalIdx &&
          (forward ? ex.end <= lastBase + 1 : ex.start >= firstBase);
        return (
          <path
            key={`${id}-exon-${ei}-${firstBase}`}
            ref={inputRef(element.id, {
              end: element.end,
              name: element.name,
              ref: element.id,
              start: element.start,
              type: "ANNOTATION",
              viewer: "LINEAR",
            })}
            className={`${element.id} la-vz-annotation`}
            cursor="pointer"
            d={exonPath(width, isTerminal)}
            fill={color}
            id={element.id}
            stroke={stroke}
            style={annotation}
            transform={`translate(${x}, 0)`}
            onDoubleClick={handleDoubleClick}
            onMouseOut={() => hoverOtherAnnotationRows(element.id, 0.7)}
            onMouseOver={() => hoverOtherAnnotationRows(element.id, 1.0)}
          />
        );
      })}

      {/* Single label centered over the feature's visible extent in this block. */}
      {displayName && labelBox.width > 0 && (
        <text
          className="la-vz-annotation-label"
          cursor="pointer"
          dominantBaseline="middle"
          fontSize={fontSize}
          id={element.id}
          style={{ ...annotationLabel, fill: getReadableTextColor(color) }}
          textAnchor="middle"
          x={labelBox.x + labelBox.width / 2}
          y={height / 2 + 1}
          onDoubleClick={handleDoubleClick}
          onMouseOut={() => hoverOtherAnnotationRows(element.id, 0.7)}
          onMouseOver={() => hoverOtherAnnotationRows(element.id, 1.0)}
        >
          {displayName}
        </text>
      )}
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

  // seq restructure bot — double-click an annotation opens its editor in the host.
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
  const height = props.height * 0.8;

  const cW = 4; // jagged cutoff width
  const cH = height / 4; // jagged cutoff height
  const [x, w] = [origX, width];

  // create the SVG path, starting at the topLeft and working clockwise
  // there is additional logic here for if the element overflows
  // to the left or right of this seqBlock, where a "jagged edge" is created
  const topLeft = endREV ? `M ${2 * cW} 0` : "M 0 0";
  const topRight = endFWD ? `L ${width - 2 * cW} 0` : `L ${width} 0`;

  let linePath = "";
  let bottomRight = `L ${width} ${height}`; // flat right edge
  if ((overflowRight && width > 2 * cW) || crossZero) {
    bottomRight = `
        L ${width - cW} ${cH}
        L ${width} ${2 * cH}
        L ${width - cW} ${3 * cH}
        L ${width} ${4 * cH}`; // jagged right edge
  } else if (endFWD) {
    bottomRight = `
        L ${width} ${height / 2}
        L ${width - Math.min(2 * cW, w)} ${height}`; // arrow forward
  }

  let bottomLeft = `L 0 ${height} L 0 0`; // flat left edge
  if (overflowLeft && width > 2 * cW) {
    bottomLeft = `
        L 0 ${height}
        L ${cW} ${3 * cH}
        L 0 ${2 * cH}
        L ${cW} ${cH}
        L 0 0`; // jagged left edge
  } else if (endREV) {
    bottomLeft = `
        L ${Math.min(2 * cW, w)} ${height}
        L 0 ${height / 2}
        L ${Math.min(2 * cW, w)} 0`; // arrow reverse
  }
  linePath = `${topLeft} ${topRight} ${bottomRight} ${bottomLeft}`;

  if ((forward && overflowRight) || (forward && crossZero)) {
    // If it's less than 15 pixels the double arrow barely fits
    if (width > 15) {
      linePath += `
        M ${width - 3 * cW} ${cH}
        L ${width - 2 * cW} ${2 * cH}
        L ${width - 3 * cW} ${3 * cH}
        M ${width - 4 * cW} ${cH}
        L ${width - 3 * cW} ${2 * cH}
        L ${width - 4 * cW} ${3 * cH}`; // add double arrow forward
    }
  } else if ((reverse && overflowLeft) || (reverse && crossZero)) {
    // If it's less than 15 pixels the double arrow barely fits
    if (width > 15) {
      linePath += `
        M ${3 * cW} ${3 * cH}
        L ${2 * cW} ${cH * 2}
        L ${3 * cW} ${cH}
        M ${4 * cW} ${3 * cH}
        L ${3 * cW} ${cH * 2}
        L ${4 * cW} ${cH}`; // add double forward reverse
    }
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
          type: "ANNOTATION",
          viewer: "LINEAR",
        })}
        className={`${element.id} la-vz-annotation`}
        cursor="pointer"
        d={linePath}
        fill={color}
        id={element.id}
        stroke="var(--seq-feature-stroke)"
        style={annotation}
        onBlur={() => {
          // do nothing
        }}
        onFocus={() => {
          // do nothing
        }}
        onDoubleClick={handleDoubleClick}
        onMouseOut={() => hoverOtherAnnotationRows(element.id, 0.7)}
        onMouseOver={() => hoverOtherAnnotationRows(element.id, 1.0)}
      />
      <text
        className="la-vz-annotation-label"
        cursor="pointer"
        dominantBaseline="middle"
        fontSize={fontSize}
        id={element.id}
        style={{ ...annotationLabel, fill: getReadableTextColor(color) }}
        textAnchor="middle"
        x={width / 2}
        y={height / 2 + 1}
        onBlur={() => {
          // do nothing
        }}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {
          // do nothing
        }}
        onMouseOut={() => hoverOtherAnnotationRows(element.id, 0.7)}
        onMouseOver={() => hoverOtherAnnotationRows(element.id, 1.0)}
      >
        {displayName}
      </text>
    </g>
  );
};
