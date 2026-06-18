// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";
import { useResizeDetector } from "./_shims/useResizeDetector";

import Circular, { CircularProps } from "./Circular/Circular";
import { EventHandler } from "./EventHandler";
import Linear, { LinearProps } from "./Linear/Linear";
import SelectionHandler, { InputRefFunc } from "./SelectionHandler";
import CentralIndexContext from "./centralIndexContext";
import AnnotationDoubleClickContext from "./annotationDoubleClickContext";
import CircularFeatureInteractionContext from "./circularFeatureInteractionContext";
import { Annotation, CutSite, Highlight, NameRange, Primer, SeqType } from "./elements";
import { isEqual } from "./isEqual";
import SelectionContext, { ExternalSelection, Selection, defaultSelection } from "./selectionContext";

/**
 * This is the width in pixels of a character that's 12px
 * This will need to change whenever the css of the plasmid viewer text changes
 * just divide the width of some rectangular text by it's number of characters
 */
export const CHAR_WIDTH = 7.2;

export interface CustomChildrenProps {
  circularProps: Omit<CircularProps, "handleMouseEvent" | "inputRef" | "onUnmount">;
  handleMouseEvent: React.MouseEventHandler;
  inputRef: InputRefFunc;
  linearProps: Omit<LinearProps, "handleMouseEvent" | "inputRef" | "onUnmount">;
  onUnmount: (ref: string) => void;
}

export interface SeqVizChildRefs {
  circular?: React.RefObject<HTMLElement>;
  linear?: React.RefObject<HTMLElement>;
}

interface SeqViewerContainerProps {
  annotations: Annotation[];
  bpColors: { [key: number | string]: string };
  children?: (props: CustomChildrenProps) => React.ReactNode;
  compSeq: string;
  copyEvent: (event: React.KeyboardEvent<HTMLElement>) => boolean;
  cutSites: CutSite[];
  height: number;
  highlights: Highlight[];
  name: string;
  onSelection: (selection: Selection) => void;
  primers: Primer[];
  refs?: SeqVizChildRefs;
  rotateOnScroll: boolean;
  search: NameRange[];
  selectAllEvent: (event: React.KeyboardEvent<HTMLElement>) => boolean;
  selection?: ExternalSelection;
  seq: string;
  seqType: SeqType;
  showComplement: boolean;
  showIndex: boolean;
  targetRef?: React.LegacyRef<HTMLDivElement>;
  /** testSize is a forced height/width that overwrites anything from sizeMe. For testing */
  testSize?: { height: number; width: number };
  translations: NameRange[];
  viewer: "linear" | "circular" | "both" | "both_flip";
  width: number;
  zoom: { circular: number; linear: number };
  /** sequence Phase 2a bot — editable mode + edit callback (threaded to EventHandler). */
  editable?: boolean;
  onEdit?: (edit: import("./EventHandler").SeqEdit) => number | void;
  /** seq restructure bot — double-click an annotation arrow opens its editor. Provided via context to the deep render trees. */
  onAnnotationDoubleClick?: import("./annotationDoubleClickContext").AnnotationDoubleClickHandler;
  /** circular qol bot — CIRCULAR map selection QoL (single/shift-click select + hover card/preview). Provided via context to the deep circular Annotations tree. */
  circularFeatureInteraction?: import("./circularFeatureInteractionContext").CircularFeatureInteraction;
  /** circular qol bot — the HOVERED feature range to draw a red PREVIEW arc over (the circular analogue of the linear red brackets), or null. Threaded straight to the Circular viewer. */
  circularPreviewRange?: { start: number; end: number } | null;
}

export interface SeqViewerContainerState {
  centralIndex: {
    circular: number;
    linear: number;
    linearScrollToken: number;
    setCentralIndex: (type: "LINEAR" | "CIRCULAR", value: number) => void;
  };
  selection: Selection;
}

/**
 * a parent sequence viewer component that holds whatever is common between
 * the linear and circular sequence viewers. The Header is an example
 */
class SeqViewerContainer extends React.Component<SeqViewerContainerProps, SeqViewerContainerState> {
  constructor(props: SeqViewerContainerProps) {
    super(props);

    this.state = {
      centralIndex: {
        circular: 0,
        linear: 0,
        linearScrollToken: 0,
        setCentralIndex: this.setCentralIndex,
      },
      selection: this.getSelection(defaultSelection, props.selection),
    };
  }

  selectionIsProgramatic(selection: any): selection is Selection {
    // If the selection was done programatically, it has not type
    if (selection) return !selection.type;
    return false;
  }

  // If the selection prop updates, also scroll the linear view to the new selection
  componentDidUpdate = (prevProps: SeqViewerContainerProps) => {
    // Only scroll if the selection was done passed in as a prop by a user of SeqViz. Otherwise the selection was
    // made by the user clicking an element or selecting a range of sequences
    if (this.selectionIsProgramatic(this.props.selection)) {
      const sel = this.props.selection;
      const prevSel = prevProps.selection;
      if ((sel?.start !== prevSel?.start || sel?.end !== prevSel?.end) && sel?.start !== sel?.end) {
        this.setCentralIndex("LINEAR", sel?.start || 0);
      }
    }
  };

  /** this is here because the size listener is returning a new "size" prop every time */
  shouldComponentUpdate = (nextProps: SeqViewerContainerProps, nextState: any) =>
    !isEqual(nextProps, this.props) || !isEqual(nextState, this.state);

  /**
   * Update the central index of the linear or circular viewer.
   */
  setCentralIndex = (type: "LINEAR" | "CIRCULAR", value: number) => {
    if (type !== "LINEAR" && type !== "CIRCULAR") {
      throw new Error(`Unknown central index type: ${type}`);
    }

    if (type === "LINEAR") {
      // Always update and increment the scroll token so InfiniteScroll scrolls
      // even when the target position hasn't changed (e.g. re-clicking the same
      // annotation after manually scrolling the linear view away).
      this.setState({
        centralIndex: {
          ...this.state.centralIndex,
          linear: value,
          linearScrollToken: this.state.centralIndex.linearScrollToken + 1,
        },
      });
    } else {
      if (this.state.centralIndex.circular === value) {
        return; // nothing changed
      }
      this.setState({ centralIndex: { ...this.state.centralIndex, circular: value } });
    }
  };

  /**
   * Update selection in state. Should only be performed from handlers/selection.jsx
   */
  setSelection = (selection: Selection) => {
    // If the user passed a selection, do not update our state here
    const { parent: _, ref: __, ...rest } = selection;
    if (!this.props.selection) this.setState({ selection });
    if (this.props.onSelection) this.props.onSelection(rest);
  };

  /**
   * Returns the selection that was either a prop (optional) or the selection maintained in state.
   */
  getSelection = (state: Selection, prop?: ExternalSelection): Selection => {
    if (prop) {
      return { ...prop, clockwise: typeof prop.clockwise === "undefined" || !!prop.clockwise, type: "" };
    }
    return state;
  };

  /**
   * given the width of the screen, and the current zoom, how many basepairs should be displayed
   * on the screen at a given time and what should their size be
   */
  linearProps = () => {
    const { seq, seqType, viewer } = this.props;
    const size = this.props.testSize || { height: this.props.height, width: this.props.width };
    const zoom = this.props.zoom.linear;

    if (this.props.refs?.linear?.current && this.props.children) {
      size.width = this.props.refs.linear.current.clientWidth;
      size.height = this.props.refs.linear.current.clientHeight;
    } else if (viewer.includes("both")) {
      // hack
      size.width /= 2;
    }

    const seqFontSize = Math.min(Math.round(zoom * 0.1 + 9.5), 18); // max 18px

    // otherwise the sequence needs to be cut into smaller subsequences
    // a sliding scale in width related to the degree of zoom currently active.
    //
    // ── RESEARCHOS MODIFICATION (spacing + ruler redesign bot) ───────────────
    // DNA density multiplier. charWidth ends up == size.width / bpsPerBlock, so
    // with multiplier m we get charWidth ~= seqFontSize / m. The vendor default
    // of 1.4 packed bases tightly (charWidth ~= 0.71 * fontSize). We lower it to
    // 0.8 for a SnapGene-style roomy layout (charWidth ~= 1.25 * fontSize), which
    // gives each base clearly more horizontal room so the in-seam ruler number on
    // a 10-tick reads cleanly and never crowds the letters left and right (Grant:
    // widen the space between letters so the number is not on top of them). The
    // amino-acid branch keeps its own / 3 spacing and therefore rides this wider
    // base width self-consistently. bpsPerBlock and charWidth feed the overview
    // box, the coordinate / selection readouts, and the dynamic strand-ruler
    // thresholds, all of which recompute from these values.
    const DNA_DENSITY = 0.8;
    let bpsPerBlock = Math.round((size.width / seqFontSize) * DNA_DENSITY) || 1; // width / 1 * seqFontSize
    if (seqType === "aa") {
      bpsPerBlock = Math.round(bpsPerBlock / 3); // more space for each amino acid
    }

    if (zoom <= 5) {
      bpsPerBlock *= 3;
    } else if (zoom <= 10) {
      // really ramp up the range, since at this zoom it'll just be a line
      bpsPerBlock *= 2;
    } else if (zoom > 70) {
      // keep font height the same but scale number of bps in one row
      bpsPerBlock = Math.round(bpsPerBlock * (70 / zoom));
    }
    bpsPerBlock = Math.max(1, bpsPerBlock);

    // ── RESEARCHOS MODIFICATION (wrap toggle bot) ────────────────────────────
    // SINGLE-LINE (UNWRAPPED) mode. When the host passes `wrapSequence === false`
    // we render the WHOLE sequence as ONE block at a FIXED, readable character
    // width (driven by the host's `singleLineCharWidth`, mapped from the zoom
    // knob) instead of chunking it into vertically-stacked rows. We do this by
    // (1) making bpsPerBlock == seq.length (Linear.render then produces a single
    // SeqBlock) and (2) overriding size.width to seq.length * charWidth so the
    // block is wider than the container; the scroller (style.ts) then scrolls
    // HORIZONTALLY. SeqBlock positions every element with charWidth on the x axis
    // and widths as size.width * (span / bpsPerBlock) == span * charWidth, so the
    // ruler, features, translations, primers and enzymes all stay consistent on
    // the single row. WRAPPED mode (the `else` path) is byte-identical to before.
    const singleLine = this.props.wrapSequence === false && seq.length > 0;
    if (singleLine) {
      const cw =
        typeof this.props.singleLineCharWidth === "number" && this.props.singleLineCharWidth > 0
          ? this.props.singleLineCharWidth
          : 7.2; // CHAR_WIDTH fallback
      bpsPerBlock = seq.length; // one block: the whole sequence on one row
      size.width = Math.max(1, seq.length * cw); // wider than the container -> x-scroll
      const charWidth = cw;
      const lineHeight = 1.4 * seqFontSize;
      const elementHeight = 16;
      return {
        ...this.props,
        bpsPerBlock,
        charWidth,
        elementHeight,
        lineHeight,
        seqFontSize,
        size,
        zoom: { linear: zoom },
      };
    }

    if (size.width && bpsPerBlock < seq.length) {
      size.width -= 28; // -28 px for the padding (10px) + scroll bar (18px)
    }

    const charWidth = size.width / bpsPerBlock; // width of each basepair

    const lineHeight = 1.4 * seqFontSize; // aspect ratio is 1.4 for roboto mono
    const elementHeight = 16; // the height, in pixels, of annotations, ORFs, etc

    return {
      ...this.props,
      bpsPerBlock,
      charWidth,
      elementHeight,
      lineHeight,
      seqFontSize,
      size,
      zoom: { linear: zoom },
    };
  };

  /**
   * given the length of the sequence and the dimensions of the viewbox, how should
   * zoom of the plasmid viewer affect the radius of the circular viewer and its vertical shift
   *
   * minPixelPerBP = s / 50 where
   * s = theta * radius where
   * radius = h / 2 + c ^ 2 / 8 h    (https://en.wikipedia.org/wiki/Circular_segment)
   * and theta = 50 / seqLength
   */
  circularProps = () => {
    const {
      seq: { length: seqLength },
      viewer,
    } = this.props;
    const size = this.props.testSize || { height: this.props.height, width: this.props.width };
    const zoom = this.props.zoom.circular;

    if (this.props.refs?.circular?.current) {
      size.width = this.props.refs.circular.current.clientWidth;
      size.height = this.props.refs.circular.current.clientHeight;
    } else if (viewer.includes("both")) {
      // hack
      size.width /= 2;
    }

    const center = {
      x: size.width / 2,
      y: size.height / 2,
    };

    const limitingDim = Math.min(size.height, size.width);

    const exp = 0.83; // exponent... greater exp leads to flatter curve (c in fig)
    const beta = Math.exp(Math.log(50 / seqLength) / -(100 ** exp)); // beta coefficient (b in fig)
    const bpsOnArc = seqLength * beta; // calc using the full expression

    // ── RESEARCHOS MODIFICATION (ring fill bot) ──────────────────────────────
    // Upstream SeqViz uses `radius = limitingDim * 0.34`. That factor is tuned
    // for the "both" layout, where the ring only gets HALF the container width
    // and shares the box with the linear panel; at full size it leaves a large
    // dead margin, so a standalone circular Map looks small and adrift.
    //
    // For a STANDALONE circular viewer (viewer === "circular", our Map tab) we
    // size the ring to FILL the box: take half the limiting dimension and
    // reserve only the band the outer feature/primer labels actually need
    // (Labels.tsx places names at radius + lineHeight*3.5 for short plasmids,
    // plus a little for the leading text). This makes the ring as large as fits
    // and stays centered (center is width/2, height/2). The "both"/"both_flip"
    // and "linear" layouts keep the original 0.34 factor untouched.
    const isStandaloneCircular = viewer === "circular";
    const LABEL_BAND = 56; // px reserved outside the ring for outer labels + ticks
    const radius = isStandaloneCircular
      ? Math.max(1, limitingDim / 2 - LABEL_BAND)
      : limitingDim * 0.34;

    return {
      ...this.props,
      bpsOnArc,
      center,
      radius: radius === 0 ? 1 : radius,
      size,
      yDiff: 0,
      zoom: { circular: zoom },
    };
  };

  render() {
    const { selection: selectionProp, seq, viewer } = this.props;
    const { centralIndex, selection } = this.state;

    const linearProps = this.linearProps();
    const circularProps = this.circularProps();

    const mergedSelection = this.getSelection(selection, selectionProp);

    return (
      <div
        ref={this.props.targetRef}
        className="la-vz-viewer-container"
        data-testid="la-vz-viewer-container"
        style={{
          height: "100%",
          position: "relative",
          width: "100%",
        }}
      >
        <CentralIndexContext.Provider value={centralIndex}>
         <AnnotationDoubleClickContext.Provider value={this.props.onAnnotationDoubleClick || null}>
          <CircularFeatureInteractionContext.Provider value={this.props.circularFeatureInteraction || null}>
          <SelectionContext.Provider value={mergedSelection}>
            <SelectionHandler
              bpsPerBlock={linearProps.bpsPerBlock}
              center={circularProps.center}
              centralIndex={centralIndex.circular}
              seq={seq}
              setCentralIndex={this.setCentralIndex}
              setSelection={this.setSelection}
              yDiff={circularProps.yDiff}
            >
              {(inputRef, handleMouseEvent, onUnmount) => (
                <EventHandler
                  bpsPerBlock={linearProps.bpsPerBlock}
                  copyEvent={this.props.copyEvent}
                  editable={this.props.editable}
                  handleMouseEvent={handleMouseEvent}
                  onEdit={this.props.onEdit}
                  selectAllEvent={this.props.selectAllEvent}
                  selection={mergedSelection}
                  seq={seq}
                  setSelection={this.setSelection}
                >
                  {this.props.children ? (
                    this.props.children({
                      circularProps,
                      handleMouseEvent,
                      inputRef,
                      linearProps,
                      onUnmount,
                    })
                  ) : (
                    <>
                      {/* TODO: this sucks, some breaking refactor in future should get rid of it SeqViewer */}
                      {viewer === "linear" && (
                        <Linear
                          {...linearProps}
                          handleMouseEvent={handleMouseEvent}
                          inputRef={inputRef}
                          onUnmount={onUnmount}
                        />
                      )}
                      {viewer === "circular" && (
                        <Circular
                          {...circularProps}
                          handleMouseEvent={handleMouseEvent}
                          inputRef={inputRef}
                          onUnmount={onUnmount}
                        />
                      )}
                      {viewer === "both" && (
                        <>
                          <Circular
                            {...circularProps}
                            handleMouseEvent={handleMouseEvent}
                            inputRef={inputRef}
                            onUnmount={onUnmount}
                          />
                          <Linear
                            {...linearProps}
                            handleMouseEvent={handleMouseEvent}
                            inputRef={inputRef}
                            onUnmount={onUnmount}
                          />
                        </>
                      )}
                      {viewer === "both_flip" && (
                        <>
                          <Linear
                            {...linearProps}
                            handleMouseEvent={handleMouseEvent}
                            inputRef={inputRef}
                            onUnmount={onUnmount}
                          />
                          <Circular
                            {...circularProps}
                            handleMouseEvent={handleMouseEvent}
                            inputRef={inputRef}
                            onUnmount={onUnmount}
                          />
                        </>
                      )}
                    </>
                  )}
                </EventHandler>
              )}
            </SelectionHandler>
          </SelectionContext.Provider>
          </CircularFeatureInteractionContext.Provider>
         </AnnotationDoubleClickContext.Provider>
        </CentralIndexContext.Provider>
      </div>
    );
  }
}

const SeqViewerContainerWithResize: React.FC<
  Omit<SeqViewerContainerProps, "height" | "width" | "targetRef">
> = props => {
  const { height, ref, width } = useResizeDetector();

  return <SeqViewerContainer {...props} height={height || 0} targetRef={ref} width={width || 0} />;
};

export default SeqViewerContainerWithResize;
