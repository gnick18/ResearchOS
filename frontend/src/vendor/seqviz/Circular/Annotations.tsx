// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import { InputRefFunc } from "../SelectionHandler";
import AnnotationDoubleClickContext from "../annotationDoubleClickContext";
import CircularFeatureInteractionContext from "../circularFeatureInteractionContext";
import CentralIndexContext from "../centralIndexContext";
import { COLOR_BORDER_MAP, darkerColor } from "../colors";
import { Annotation } from "../elements";
import { annotation, annotationLabel, svgText } from "../style";
import { GenArcFunc } from "./Circular";

interface AnnotationsProps {
  annotations: Annotation[][];
  genArc: GenArcFunc;
  getRotation: (index: number) => string;
  inlinedAnnotations: string[];
  inputRef: InputRefFunc;
  lineHeight: number;
  radius: number;
  rowsToSkip: number;
  seqLength: number;
}

/**
 * Used to build up all the path elements. Does not include a display
 * of the annotation name or a line connecting name to annotation
 *
 * Annotations might overlap with one another. To avoid that, annotations are first moved into rows -- non-overlapping
 * arrays or annotation arrays -- and then used to create the array of array of annotation paths.
 */
export class Annotations extends React.PureComponent<AnnotationsProps> {
  /** during an annotation hover event, darken all other pieces of the same annotation */
  hoverAnnotation = (className: string, opacity: string) => {
    if (!document) return;

    const elements = document.getElementsByClassName(className) as HTMLCollectionOf<SVGPathElement>;
    for (let i = 0; i < elements.length; i += 1) {
      elements[i].style.fillOpacity = opacity;
    }
  };

  render() {
    const { annotations, lineHeight, radius, rowsToSkip } = this.props;

    // at least 3 rows inward from default radius (ie index row)
    const rowShiftHeight = lineHeight * rowsToSkip;
    const radiusAdjust = lineHeight * 2 + 3;
    let currBRadius = radius - radiusAdjust - rowShiftHeight;
    let currTRadius = currBRadius - lineHeight; // top radius

    return (
      <CentralIndexContext.Consumer>
        {({ circular }) => (
          <g className="la-vz-circular-annotations">
            {annotations.reduce((acc: React.ReactNode[], anns: Annotation[], i) => {
              if (i) {
                // increment the annRow radii on every loop after first
                currBRadius -= lineHeight + 3;
                currTRadius -= lineHeight + 3;
              }

              return acc.concat(
                anns.map(ann => (
                  <SingleAnnotation
                    key={`la-vz-${ann.id}-annotation-circular-row`}
                    annotation={ann}
                    calcBorderColor={darkerColor}
                    centralIndex={circular}
                    currBRadius={currBRadius}
                    currTRadius={currTRadius}
                    genArc={this.props.genArc}
                    getRotation={this.props.getRotation}
                    hoverAnnotation={this.hoverAnnotation}
                    id={`la-vz-${ann.id}-annotation-circular-row`}
                    inlinedAnnotations={this.props.inlinedAnnotations}
                    inputRef={this.props.inputRef}
                    lineHeight={lineHeight}
                    seqLength={this.props.seqLength}
                  />
                )),
              );
            }, [])}
          </g>
        )}
      </CentralIndexContext.Consumer>
    );
  }
}

interface SingleAnnotationProps {
  annotation: Annotation;
  calcBorderColor: (c: string) => string;
  centralIndex: number;
  currBRadius: number;
  currTRadius: number;
  genArc: GenArcFunc;
  getRotation: (index: number) => string;
  hoverAnnotation: (className: string, opacity: string) => void;
  id: string;
  inlinedAnnotations: string[];
  inputRef: InputRefFunc;
  lineHeight: number;
  seqLength: number;
}

/**
 * SingleAnnotation renders a single annotation within the Circular Viewer
 */
const SingleAnnotation = (props: SingleAnnotationProps) => {
  const {
    annotation: a,
    calcBorderColor,
    centralIndex,
    currBRadius,
    currTRadius,
    genArc,
    getRotation,
    hoverAnnotation,
    inlinedAnnotations,
    inputRef,
    lineHeight,
    seqLength,
  } = props;

  // seq restructure bot — double-click an annotation opens its editor in the host.
  const onAnnotationDoubleClick = React.useContext(AnnotationDoubleClickContext);
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!onAnnotationDoubleClick) return;
    e.stopPropagation();
    onAnnotationDoubleClick({
      name: a.name,
      start: a.start,
      end: a.end,
      direction: a.direction,
    });
  };

  // circular qol bot — CIRCULAR map selection QoL, mirroring the LINEAR map
  // (LinearMap.tsx). SINGLE-click an annotation arc SELECTS its range (the shared
  // editor selection); a SHIFT-click extends the span from the anchor through it
  // (the host computes the union via spanFromShiftClick, identical to the
  // linear/overview handlers). HOVER shows the floating info CARD at the cursor +
  // the red PREVIEW arc; mouse-leave clears both. stopPropagation so the click /
  // hover does not also drive SeqViz's native drag-select on the ring SVG. The
  // double-click (open editor) + native drag-select / rotation stay intact.
  const featureInteraction = React.useContext(CircularFeatureInteractionContext);
  const annRange = { name: a.name, start: a.start, end: a.end, direction: a.direction };
  const handleClick = (e: React.MouseEvent) => {
    if (!featureInteraction?.onFeatureClick) return;
    e.stopPropagation();
    featureInteraction.onFeatureClick(annRange, { shiftKey: e.shiftKey });
  };
  const handleHoverMove = (e: React.MouseEvent) => {
    featureInteraction?.onFeatureHover?.(annRange, e.clientX, e.clientY);
    hoverAnnotation(a.id, "1.0");
  };
  const handleHoverLeave = () => {
    featureInteraction?.onFeatureHover?.(null, 0, 0);
    hoverAnnotation(a.id, "0.7");
  };

  // if it crosses the zero index, correct for actual length
  let annLength = a.end >= a.start ? a.end - a.start : seqLength - a.start + a.end;

  // can't make an arc from a full circle
  annLength = annLength === 0 ? seqLength - 0.1 : annLength;

  // how many degrees should it be rotated?
  const rotation = getRotation(a.start);

  if (currBRadius < 0 || currTRadius < 0) {
    return null;
  }

  // is the name in top or bottom half?
  const mid = (annLength / 2 + a.start + seqLength - centralIndex) % seqLength;
  const bottomHalf = mid > seqLength * 0.25 && mid < seqLength * 0.75;

  const path = genArc({
    arrowFWD: a.direction === 1,
    arrowREV: a.direction === -1,
    innerRadius: currBRadius,
    largeArc: annLength > seqLength / 2,
    length: annLength,
    outerRadius: currTRadius,
    sweepFWD: true,
  });
  const namePath = genArc({
    arrowFWD: false,
    arrowREV: false,
    innerRadius: bottomHalf ? currBRadius : currTRadius,
    largeArc: annLength > seqLength / 2,
    length: annLength,
    outerRadius: bottomHalf ? currBRadius : currTRadius,
    sweepFWD: true,
  });

  const circAnnID = `la-vz-${a.id}-circular`;
  return (
    <g id={`la-vz-${a.id}-annotation-circular`} transform={rotation}>
      <path d={namePath} fill="transparent" id={circAnnID} stroke="transparent" />
      <path
        ref={inputRef(a.id, {
          direction: a.direction,
          end: a.end,
          name: a.name,
          ref: a.id,
          start: a.start,
          type: "ANNOTATION",
          viewer: "CIRCULAR",
        })}
        className={`${a.id} la-vz-annotation`}
        cursor="pointer"
        d={path}
        fill={a.color}
        id={a.id}
        stroke={a.color ? COLOR_BORDER_MAP[a.color] || calcBorderColor(a.color) : "gray"}
        style={annotation}
        onBlur={() => {
          // do nothing
        }}
        onFocus={() => {
          // do nothing
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleHoverMove}
        onMouseOut={handleHoverLeave}
        onMouseOver={handleHoverMove}
      />
      {inlinedAnnotations.includes(a.id) && (
        <text
          dy={-0.4 * lineHeight}
          id={a.id}
          style={svgText}
          onBlur={() => {
            // do nothing
          }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onFocus={() => {
            // do nothing
          }}
          onMouseMove={handleHoverMove}
          onMouseOut={handleHoverLeave}
          onMouseOver={handleHoverMove}
        >
          <textPath
            className="la-vz-annotation-label"
            cursor="pointer"
            dominantBaseline="middle"
            fontSize={12}
            id={a.id}
            startOffset={bottomHalf ? "25%" : "75%"}
            style={annotationLabel}
            textAnchor="middle"
            xlinkHref={`#${circAnnID}`}
          >
            {a.name}
          </textPath>
        </text>
      )}
    </g>
  );
};
