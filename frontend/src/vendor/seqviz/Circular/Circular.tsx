// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import { InputRefFunc } from "../SelectionHandler";
import { CHAR_WIDTH } from "../SeqViewerContainer";
import AnnotationDoubleClickContext from "../annotationDoubleClickContext";
import CircularFeatureInteractionContext from "../circularFeatureInteractionContext";
import CentralIndexContext from "../centralIndexContext";
import { Annotation, Coor, CutSite, Highlight, Range, Size } from "../elements";
import { stackElements } from "../elementsToRows";
import { isEqual } from "../isEqual";
import { viewerCircular } from "../style";
import { Annotations } from "./Annotations";
import { CutSites } from "./CutSites";
import { Find } from "./Find";
import { Index } from "./Index";
import { Labels } from "./Labels";
import { CircularPreviewSelection, Selection } from "./Selection";

/** Sequence length cutoff below which the circular viewer's sequence won't be rendered. */
export const RENDER_SEQ_LENGTH_CUTOFF = 250;

export interface ILabel {
  // RESEARCHOS (primer labels bot): an optional color so primer labels can carry
  // their pink stroke/fill through the shared circular Labels layout engine.
  color?: string;
  end: number;
  id?: string;
  name: string;
  start: number;
  // RESEARCHOS (primer labels bot): "primer" routes a primer NAME through the
  // same de-collision + leader-line engine that lays out feature/enzyme names.
  type: "enzyme" | "annotation" | "primer";
}

/** GenArcFunc is a method that makes an arc on the viewer for a Circular child. */
export type GenArcFunc = (args: {
  arrowFWD?: boolean;
  arrowREV?: boolean;
  innerRadius: number;
  largeArc: boolean;
  length: number;
  offset?: number;
  outerRadius: number;
  // see svg.arc large-arc-flag
  sweepFWD?: boolean;
}) => string;

export interface CircularProps {
  annotations: Annotation[];
  center: { x: number; y: number };
  compSeq: string;
  cutSites: CutSite[];
  handleMouseEvent: (e: any) => void;
  highlights: Highlight[];
  inputRef: InputRefFunc;
  name: string;
  onUnmount: (id: string) => void;
  // RESEARCHOS (primer style bot): primers, drawn as radial markers (not arcs).
  primers?: { color?: string; direction?: -1 | 1; end: number; id?: string; name: string; start: number }[];
  radius: number;
  rotateOnScroll: boolean;
  search: Range[];
  seq: string;
  showComplement: boolean;
  showIndex: boolean;
  size: Size;
  yDiff: number;
  // circular qol bot — the HOVERED feature range to draw a red PREVIEW arc over
  // (the circular analogue of the linear red brackets), or null/absent. Threaded
  // from the host through SeqViz -> SeqViewerContainer -> here.
  circularPreviewRange?: { start: number; end: number } | null;
}

interface CircularState {
  annotationsInRows: Annotation[][];
  inlinedLabels: string[];
  lineHeight: number;
  outerLabels: ILabel[];
  seqLength: number;
}

/** Circular is a circular viewer that contains a bunch of arcs. */
export default class Circular extends React.Component<CircularProps, CircularState> {
  static contextType = CentralIndexContext;
  static context: React.ContextType<typeof CentralIndexContext>;
  declare context: React.ContextType<typeof CentralIndexContext>;

  constructor(props: CircularProps) {
    super(props);

    this.state = {
      annotationsInRows: [],
      inlinedLabels: [],
      lineHeight: 0,
      outerLabels: [],
      seqLength: 0,
    };
  }

  static getDerivedStateFromProps = (nextProps: CircularProps): CircularState => {
    const lineHeight = 14;
    const annotationsInRows = stackElements(nextProps.annotations, nextProps.seq.length);

    /**
     * find the element labels that need to be rendered outside the plasmid. This is done for
     * annotation names/etc for element titles that don't fit within the width of the element
     * they represent. For example, an annotation might be named "Transcription Factor XYZ"
     * but be only 20bps long on a plasmid that's 20k bps. Obviously that name doesn't fit.
     * But, a gene that's 15k on the same plasmid shouldn't have it's label outside the plasmid
     * when it can easily fit on top of the annotation itself
     */
    const seqLength = nextProps.seq.length;
    const cutSiteLabels = nextProps.cutSites;
    const { radius } = nextProps;
    let innerRadius = radius - 3 * lineHeight;
    const inlinedLabels: string[] = [];
    const outerLabels: ILabel[] = [];
    annotationsInRows.forEach((r: Annotation[]) => {
      const circumf = innerRadius * Math.PI;
      r.forEach(ann => {
        // how large is the name of the annotation horizontally (with two char padding)
        const annNameLengthPixels = (ann.name.length + 2) * CHAR_WIDTH;
        // how large would part be if it were wrapped around the plasmid
        let annLengthBases = ann.end - ann.start;
        if (ann.start >= ann.end) annLengthBases += seqLength; // crosses zero-index
        const annLengthPixels = 2 * circumf * (annLengthBases / seqLength);
        if (annNameLengthPixels < annLengthPixels) {
          inlinedLabels.push(ann.id);
        } else {
          const { end, id, name, start } = ann;
          const type = "annotation";
          outerLabels.push({ end, id, name, start, type });
        }
      });
      innerRadius -= lineHeight;
    });

    cutSiteLabels.forEach(c =>
      outerLabels.push({
        ...c.enzyme,
        ...c,
        start: c.fcut,
        type: "enzyme",
      }),
    );

    // RESEARCHOS (primer labels bot): route primer NAMES through the shared outer
    // label engine so they de-collide with one another (and with feature/enzyme
    // names) and get leader lines, exactly like SnapGene. The directional MARKER
    // on the ring is still drawn separately by <CircularPrimers>; only the name
    // travels through Labels. We keep the binding start/end so the leader line
    // seeds at the primer's binding midpoint (where the marker sits), and carry
    // the primer's pink color through so the label/leader render pink.
    (nextProps.primers || []).forEach((p, i) => {
      outerLabels.push({
        color: p.color || "#f472b6",
        end: p.end,
        id: p.id || `circular-primer-${p.name}-${p.start}-${p.end}-${i}`,
        name: p.name,
        start: p.start,
        type: "primer",
      });
    });

    // sort all the labels so they're in ascending order
    outerLabels.sort((a, b) => Math.min(a.start, a.end) - Math.min(b.start, b.end));

    return {
      annotationsInRows: annotationsInRows,
      inlinedLabels: inlinedLabels,
      lineHeight: lineHeight,
      outerLabels: outerLabels,
      seqLength: nextProps.seq.length,
    };
  };

  /**
   * Deep equality comparison
   */
  shouldComponentUpdate = (nextProps: CircularProps) => !isEqual(nextProps, this.props);

  /**
   * Return the SVG rotation transformation needed to put a child element in the
   * correct location around the plasmid. This func makes use of the centralIndex field in parent state
   * to rotate the plasmid viewer.
   */
  getRotation = (index: number): string => {
    const { center } = this.props;
    const { seqLength } = this.state;
    const centralIndex = this.context.circular;

    // how many degrees should it be rotated?
    const adjustedIndex = index - centralIndex;
    const startPerc = adjustedIndex / seqLength;
    const degrees = startPerc * 360;

    return `rotate(${degrees || 0}, ${center.x}, ${center.y})`;
  };

  /**
   * Given an index along the plasmid and its radius, find the coordinate
   * will be used in many of the child components
   *
   * In general, this is for lines and labels
   */
  findCoor = (index: number, radius: number, rotate?: boolean): Coor => {
    const { center } = this.props;
    const { seqLength } = this.state;
    const rotatedIndex = rotate ? index - this.context.circular : index;
    const lengthPerc = rotatedIndex / seqLength;
    const lengthPercCentered = lengthPerc - 0.25;
    const radians = lengthPercCentered * Math.PI * 2;
    const xAdjust = Math.cos(radians) * radius;
    const yAdjust = Math.sin(radians) * radius;

    return {
      x: center.x + xAdjust,
      y: center.y + yAdjust,
    };
  };

  /**
   * Given a coordinate, and the degrees to rotate it, find the new coordinate
   * (assuming that the rotation is around the center)
   *
   * in general this is for text and arcs
   */
  rotateCoor = (coor: Coor, degrees: number): Coor => {
    const { center } = this.props;

    // find coordinate's current angle
    const angle = degrees * (Math.PI / 180); // degrees to radians
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // find the new coordinate
    const xDiff = coor.x - center.x;
    const yDiff = coor.y - center.y;
    const cosX = cos * xDiff;
    const cosY = cos * yDiff;
    const sinX = sin * xDiff;
    const sinY = sin * yDiff;
    const xAdjust = cosX - sinY;
    const yAdjust = sinX + cosY;

    return {
      x: center.x + xAdjust,
      y: center.y + yAdjust,
    };
  };

  /**
   * Given an inner and outer radius, and the length of the element, return the
   * path for an arc that circles the plasmid. The optional paramters sweepFWD and sweepREV
   * are needed for selection arcs (where the direction of the arc isn't known beforehand)
   * and arrowFWD and arrowREV are needed for annotations, where there may be directionality
   */
  genArc: GenArcFunc = (args: {
    arrowFWD?: boolean;
    arrowREV?: boolean;
    innerRadius: number;
    largeArc: boolean;
    length: number;
    offset?: number;
    outerRadius: number;
    // see svg.arc large-arc-flag
    sweepFWD?: boolean;
  }): string => {
    const { arrowFWD, arrowREV, innerRadius, largeArc, length, outerRadius, sweepFWD } = args;
    const { radius } = this.props;
    const { lineHeight, seqLength } = this.state;
    const offset = args.offset === undefined ? 0 : args.offset;
    // build up the six default coordinates
    let leftBottom = this.findCoor(offset, innerRadius);
    let leftTop = this.findCoor(offset, outerRadius);
    let rightBottom = this.findCoor(length + offset, innerRadius);
    let rightTop = this.findCoor(length + offset, outerRadius);
    let leftArrow = "";
    let rightArrow = "";

    // create arrows by making a midpoint along edge and shifting corners inwards
    if (arrowREV || arrowFWD) {
      // one quarter of lineHeight in px is the shift inward for arrows
      const inwardShift = lineHeight / 4;
      // given the arc length (inwardShift) and the radius (from SeqViewer),
      // we can find the degrees to rotate the corners
      const centralAngle = inwardShift / radius;
      // Math.min here is to make sure the arrow it's larger than the element
      const centralAnglePerc = Math.min(centralAngle / 2, length / seqLength);
      const centralAngleDeg = centralAnglePerc * 360;

      if (arrowREV) {
        leftBottom = this.rotateCoor(leftBottom, centralAngleDeg);
        leftTop = this.rotateCoor(leftTop, centralAngleDeg);
        const lArrowC = this.findCoor(0, (innerRadius + outerRadius) / 2);
        leftArrow = `L ${lArrowC.x} ${lArrowC.y}`;
      } else {
        rightBottom = this.rotateCoor(rightBottom, -centralAngleDeg);
        rightTop = this.rotateCoor(rightTop, -centralAngleDeg);
        const rArrowC = this.findCoor(length, (innerRadius + outerRadius) / 2);
        rightArrow = `L ${rArrowC.x} ${rArrowC.y}`;
      }
    }

    const lArc = largeArc ? 1 : 0;
    const sFlagF = sweepFWD ? 1 : 0;
    const sFlagR = sweepFWD ? 0 : 1;

    return `M ${rightBottom.x} ${rightBottom.y}
      A ${innerRadius} ${innerRadius}, 0, ${lArc}, ${sFlagR}, ${leftBottom.x} ${leftBottom.y}
      L ${leftBottom.x} ${leftBottom.y}
      ${leftArrow}
      L ${leftTop.x} ${leftTop.y}
      A ${outerRadius} ${outerRadius}, 0, ${lArc}, ${sFlagF}, ${rightTop.x} ${rightTop.y}
      ${rightArrow}
      Z`;
  };

  /**
   * handle a scroll event and, if it's a CIRCULAR viewer, update the
   * current central index
   */
  handleScrollEvent = (e: React.WheelEvent<SVGElement>) => {
    const { rotateOnScroll, seq } = this.props;
    if (!rotateOnScroll) return;

    // a "large scroll" (1000) should rotate through 20% of the plasmid
    let delta = seq.length * (e.deltaY / 5000);
    delta = Math.floor(delta);

    // must scroll by *some* amount (only matters for very small plasmids)
    if (delta === 0) {
      if (e.deltaY > 0) delta = 1;
      else delta = -1;
    }

    let newCentralIndex = this.context.circular + delta;
    newCentralIndex = (newCentralIndex + seq.length) % seq.length;

    this.context.setCentralIndex("CIRCULAR", newCentralIndex);
  };

  render() {
    const {
      center,
      compSeq,
      cutSites,
      handleMouseEvent,
      inputRef,
      name,
      radius,
      search,
      seq,
      showComplement,
      showIndex,
      size,
      yDiff,
    } = this.props;
    const { annotationsInRows, inlinedLabels, lineHeight, outerLabels, seqLength } = this.state;

    const { findCoor, genArc, getRotation, rotateCoor } = this;

    // props contains props used in many/all children
    const props = {
      center,
      findCoor,
      genArc,
      getRotation,
      inputRef,
      lineHeight,
      radius,
      rotateCoor,
      seqLength,
    };

    // calculate the selection row height based on number of annotation
    const totalRows = 4 + annotationsInRows.length;
    const plasmidId = `la-vz-${name}-viewer-circular`;
    if (!size.height) return null;

    return (
      <svg
        ref={inputRef(plasmidId, { type: "SEQ", viewer: "CIRCULAR" })}
        className="la-vz-viewer-circular"
        data-testid="la-vz-viewer-circular"
        height={size.height}
        id={plasmidId}
        overflow="visible"
        style={viewerCircular}
        width={size.width >= 0 ? size.width : 0}
        onMouseDown={handleMouseEvent}
        onMouseMove={handleMouseEvent}
        onMouseUp={handleMouseEvent}
        onWheel={this.handleScrollEvent}
      >
        <g className="la-vz-circular-root" transform={`translate(0, ${yDiff})`}>
          <Selection {...props} seq={seq} totalRows={totalRows} />
          {/* circular qol bot — red PREVIEW arc over the HOVERED feature's range
              (the circular analogue of the linear red brackets), drawn just above
              the live selection band so it reads as "this is what a click selects"
              without committing. pointer-events:none so it never blocks the arc. */}
          <CircularPreviewSelection
            {...props}
            preview={this.props.circularPreviewRange || null}
            seq={seq}
            totalRows={totalRows}
          />
          <CutSites {...props} cutSites={cutSites} selectionRows={4} />
          <Index
            {...props}
            compSeq={compSeq}
            name={name}
            seq={seq}
            showComplement={showComplement}
            showIndex={showIndex}
            size={size}
            totalRows={totalRows}
            yDiff={yDiff}
          />
          <Find
            genArc={props.genArc}
            getRotation={props.getRotation}
            highlights={this.props.highlights}
            inputRef={props.inputRef}
            lineHeight={props.lineHeight}
            radius={props.radius}
            search={search}
            seqLength={props.seqLength}
          />
          <Annotations {...props} annotations={annotationsInRows} inlinedAnnotations={inlinedLabels} rowsToSkip={0} />
          {/* RESEARCHOS (primer style bot): primers render as lightweight radial
              MARKERS (a short tick + dot + label), not big block arcs. */}
          <CircularPrimers
            findCoor={findCoor}
            getRotation={getRotation}
            inputRef={inputRef}
            lineHeight={lineHeight}
            primers={this.props.primers || []}
            radius={radius}
            seqLength={seqLength}
          />
          <Labels {...props} labels={outerLabels} size={size} yDiff={yDiff} />
        </g>
      </svg>
    );
  }
}

/**
 * RESEARCHOS (primer style bot, directional fix by ring fill bot):
 * Circular primer markers.
 *
 * SnapGene-style: a primer on the circular/map view is a small DIRECTIONAL
 * marker at its binding midpoint — a short radial stem from the plasmid edge
 * with an arrowhead that points ALONG the ring (tangent), clockwise for a
 * forward (+) primer and counter-clockwise for a reverse (-) primer, i.e. in
 * the direction the primer reads (5'->3') around the wheel. The name label
 * sits just outside.
 *
 * Geometry note (ring fill bot): like the Arc/Annotation layers, each marker is
 * BUILT at the top of the ring (index 0, where the tangent is horizontal) and
 * then rotated into place with getRotation(mid). At the top, "clockwise around
 * the ring" points in +x (to the right) and "counter-clockwise" points in -x.
 * We draw the arrowhead accordingly, so after the rotation it always points the
 * way the wheel turns for that strand.
 */
const CircularPrimers = (props: {
  findCoor: (index: number, radius: number, rotate?: boolean) => { x: number; y: number };
  getRotation: (index: number) => string;
  inputRef: InputRefFunc;
  lineHeight: number;
  primers: { color?: string; direction?: -1 | 1; end: number; id?: string; name: string; start: number }[];
  radius: number;
  seqLength: number;
}) => {
  const { findCoor, getRotation, inputRef, primers, radius, seqLength } = props;
  // RESEARCHOS (primer dialog bot): double-clicking a circular primer marker
  // opens the Edit Primer dialog (same context the annotations use).
  const onAnnotationDoubleClick = React.useContext(AnnotationDoubleClickContext);
  // RESEARCHOS (primer hover bot): HOVER a circular primer marker -> the host
  // shows the same coords/length/%GC/Tm card the linear Map shows on hover. The
  // ring's feature arcs already drive onFeatureHover; this is the primer twin.
  const featureInteraction = React.useContext(CircularFeatureInteractionContext);
  if (!primers || !primers.length || !seqLength) return null;

  const stemInner = radius - 2; // stem starts just inside the plasmid edge
  const stemOuter = radius + 7; // and reaches outward to where the arrowhead sits
  // RESEARCHOS (primer labels bot): the name label is no longer drawn here. It is
  // fed into the shared <Labels> de-collision + leader-line engine (see
  // getDerivedStateFromProps) so primer names never stack on top of one another.

  // Top-of-ring anchor (index 0). findCoor(0, r) returns the point at the top
  // of the circle; the tangent there is horizontal, so a clockwise arrow points
  // +x and a counter-clockwise arrow points -x.
  const HEAD_LEN = 6; // arrowhead length along the tangent (px)
  const HEAD_HALF = 3.2; // arrowhead half-height across the tangent (px)

  return (
    <g className="la-vz-circular-primers">
      {primers.map((p, i) => {
        // midpoint index of the binding region (handle a zero-crossing primer)
        let end = p.end;
        if (end < p.start) end += seqLength;
        const mid = ((p.start + end) / 2) % seqLength;

        // Forward (+1) reads clockwise (increasing index); reverse (-1) reads
        // counter-clockwise. Default to forward when direction is absent.
        const fwd = (p.direction ?? 1) >= 0;
        const dir = fwd ? 1 : -1; // +x for clockwise, -x for counter-clockwise

        // Build at the top of the ring, then rotate into place via getRotation.
        const stemTop = findCoor(0, stemInner); // inner end of the radial stem
        const headBase = findCoor(0, stemOuter); // where stem meets arrowhead

        // Arrowhead triangle, tangent to the ring at the top: the tip is shifted
        // along x by dir*HEAD_LEN; the two back corners straddle the tangent.
        const tip = { x: headBase.x + dir * HEAD_LEN, y: headBase.y };
        const backTop = { x: headBase.x, y: headBase.y - HEAD_HALF };
        const backBot = { x: headBase.x, y: headBase.y + HEAD_HALF };
        const headPath = `M ${tip.x} ${tip.y} L ${backTop.x} ${backTop.y} L ${backBot.x} ${backBot.y} Z`;

        const color = p.color || "#f472b6";
        const id = p.id || `circular-primer-${p.name}-${p.start}-${p.end}-${i}`;
        const coordLabel = `${p.name} (${p.start + 1}..${p.end}, ${fwd ? "fwd" : "rev"})`;

        const handleDoubleClick = (e: React.MouseEvent) => {
          if (!onAnnotationDoubleClick) return;
          e.stopPropagation();
          onAnnotationDoubleClick({ name: p.name, start: p.start, end: p.end, direction: p.direction });
        };
        const handleHoverMove = (e: React.MouseEvent) => {
          featureInteraction?.onPrimerHover?.({ name: p.name, start: p.start, end: p.end }, e.clientX, e.clientY);
        };
        const handleHoverLeave = () => {
          featureInteraction?.onPrimerHover?.(null, 0, 0);
        };

        return (
          <g
            key={id}
            cursor="pointer"
            transform={getRotation(mid)}
            onDoubleClick={handleDoubleClick}
            onMouseMove={handleHoverMove}
            onMouseOver={handleHoverMove}
            onMouseOut={handleHoverLeave}
          >
            <title>{coordLabel}</title>
            <line
              ref={inputRef(id, {
                end: p.end,
                name: p.name,
                ref: id,
                start: p.start,
                type: "PRIMER",
                viewer: "CIRCULAR",
              })}
              className="la-vz-circular-primer"
              cursor="pointer"
              stroke={color}
              strokeLinecap="round"
              strokeWidth={1.5}
              x1={stemTop.x}
              x2={headBase.x}
              y1={stemTop.y}
              y2={headBase.y}
            />
            {/* directional arrowhead: tangent to the ring, points the way the
                primer reads (clockwise for fwd, counter-clockwise for rev). */}
            <path className="la-vz-circular-primer-arrow" cursor="pointer" d={headPath} fill={color} stroke="none" />
            {/* RESEARCHOS (primer labels bot): the name label is intentionally NOT
                rendered here anymore. It goes through the shared <Labels> engine
                so it de-collides with other primer/feature names and gets a
                leader line. */}
          </g>
        );
      })}
    </g>
  );
};

/**
 * Create an SVG arc around a single element in the Circular Viewer.
 */
export const Arc = (props: {
  className: string;
  color?: string;
  direction: -1 | 1;
  end: number;
  genArc: GenArcFunc;
  getRotation: (index: number) => string;
  inputRef: InputRefFunc;
  lineHeight: number;
  radius: number;
  seqLength: number;
  start: number;
  style: React.CSSProperties;
}) => {
  const { className, color, direction, genArc, getRotation, inputRef, lineHeight, radius, seqLength, start, style } =
    props;

  let { end } = props;
  // crosses the zero index
  if (end < start) {
    end += seqLength;
  }

  const resultLength = Math.abs(end - start);
  const findPath = genArc({
    innerRadius: radius - lineHeight / 2,
    largeArc: resultLength > seqLength / 2,
    length: resultLength,
    outerRadius: radius + lineHeight / 2,
    sweepFWD: true,
  });

  const id = `circular-${start}-${end}-${direction}`;

  return (
    <path
      key={id}
      ref={inputRef(id, {
        end: end,
        ref: id,
        start: start,
        type: "FIND",
        viewer: "CIRCULAR",
      })}
      className={className}
      cursor="pointer"
      d={findPath}
      fill={color}
      id={id}
      shapeRendering="auto"
      stroke="rgba(0, 0, 0, 0.5)"
      strokeWidth={1}
      style={style}
      transform={getRotation(start)}
    />
  );
};
