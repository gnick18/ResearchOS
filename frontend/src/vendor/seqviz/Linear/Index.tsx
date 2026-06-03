// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import { SeqType, Size } from "../elements";
import { indexLine, indexTick, indexTickLabel } from "../style";
import { FindXAndWidthType } from "./SeqBlock";

/**
 * Linear DNA ruler (redesigned). ONE owned ruler with two states:
 *   State A (base-level zoom): a crisp per-base measuring tape in the strand
 *     seam, with the coordinate number on each 10-tick (the only number source;
 *     the separate bottom index row is suppressed in this state).
 *   State B (zoomed out): a plain numbered interval ruler at SeqViz's
 *     5 / 10 / 20 / 50 tick logic.
 */

interface IndexProps {
  charWidth: number;
  findXAndWidth: FindXAndWidthType;
  firstBase: number;
  lastBase: number;
  seq: string;
  seqType: SeqType;
  showIndex: boolean;
  size: Size;
  yDiff: number;
  zoom: { linear: number };
  // ruler redesign bot — the seam y (center between top and complement strands)
  // and whether bases are legible (State A vs State B). When seamYDiff is
  // provided AND baseLegible is true, this ruler renders as the in-seam
  // measuring tape; otherwise it falls back to the interval ruler at yDiff.
  seamYDiff?: number;
  baseLegible?: boolean;
  lineHeight?: number;
}

// State A measuring-tape contrast. Real slate, not the old 0.45-opacity wash:
// per-base minor ticks are a medium slate, fives a touch darker, tens darkest.
const TAPE_BASELINE = "#94a3b8";
const TAPE_MINOR = "#94a3b8"; // every base
const TAPE_FIVE = "#64748b"; // every 5
const TAPE_TEN = "#334155"; // every 10 (also carries the numbers)

/**
 * Index is the single OWNED linear ruler (ruler redesign bot).
 *
 * It replaces the two rulers that used to fight each other: SeqViz's interval
 * ruler and the bolted per-base `la-vz-strand-connector` tape in SeqBlock. It
 * has exactly two clean states, swapped at the base-legibility threshold (the
 * same gate that decides whether base letters render), with NO opacity shedding
 * and no faint middle band:
 *
 *   State A (bases legible): a crisp measuring tape in the strand seam. A solid
 *     thin baseline, a full-contrast tick at EVERY base, taller at every 5,
 *     tallest at every 10, with the coordinate number at every 10. This single
 *     element IS the strand connector and the ruler and the number row.
 *
 *   State B (zoomed out): a plain numbered interval ruler (ticks + numbers at
 *     SeqViz's existing 5 / 10 / 20 / 50 interval logic), no per-base ticks.
 */
export default class Index extends React.PureComponent<IndexProps> {
  // ---- State B: the numbered interval ruler (SeqViz's original behavior) ----
  // given each basepair in the sequence, go through each and find whether 1) it is divisible
  // by the number set for tally thresholding and, if it is, 2) add its location to the list
  // of positions for tickInc
  genTicks = () => {
    const { charWidth, findXAndWidth, firstBase, seq, seqType, size, zoom } = this.props;
    const seqLength = seq.length;

    // the tally's distance on the x-axis is zoom dependent:
    // (0, 10]: every 50
    // (10, 40]: every 20
    // (40, 70]: every 10
    // (70, 100] every 5
    let tickInc = 0;
    switch (true) {
      case zoom.linear > 85:
        tickInc = 5;
        break;
      case zoom.linear > 40:
        tickInc = 10;
        break;
      case zoom.linear > 10:
        tickInc = 20;
        break;
      case zoom.linear >= 0:
        tickInc = 50;
        break;
      default:
        tickInc = 10;
    }

    // if rendering amino acids, double the tick frequency
    if (seqType === "aa") {
      tickInc = tickInc / 2;
    }

    // create the array that will hold all the indexes in the array
    const tickIndexes: number[] = [];
    if (firstBase === 0) {
      tickIndexes.push(1);
    }

    let i = 0;
    while ((i + firstBase) % tickInc !== 0) {
      i += 1;
    }
    while (i < seqLength) {
      if (i + firstBase !== 0) {
        tickIndexes.push(i + firstBase);
      }
      i += tickInc;
    }

    return tickIndexes.map(p => {
      let { x: tickFromLeft } = findXAndWidth(p - 1, p - 1); // for midpoint
      tickFromLeft += charWidth / 2;

      let digits = Math.ceil(Math.log10(p + 1)); // digits in num
      digits -= 1; // don't shift for the middle digit

      const indexCharWidth = 7.7; // this is pretty stable, can calculate w/ a long number's width / char count
      const textWidth = digits * indexCharWidth;

      let { x: textFromLeft } = findXAndWidth(p - 1, p - 1);
      textFromLeft += charWidth / 2;
      textFromLeft -= textWidth / 2 + 3; // this +3 I cannot explain
      textFromLeft = Math.max(0, textFromLeft); // keep off left edge
      textFromLeft = Math.min(size.width - textWidth / 2, textFromLeft); // keep off right edge

      const transTick = `translate(${tickFromLeft}, 1)`;
      const transText = `translate(${textFromLeft}, 10)`;

      return (
        <React.Fragment key={p}>
          <path className="la-vz-index-tick" d="M 0 0 L 0 7" style={indexTick} transform={transTick} />
          <text
            className="la-vz-index-tick-label"
            dominantBaseline="hanging"
            style={indexTickLabel}
            transform={transText}
          >
            {p}
          </text>
        </React.Fragment>
      );
    });
  };

  // ---- State A: the per-base measuring tape, drawn in the strand seam ----
  // A crisp tape: full-contrast tick at every base, taller every 5, tallest
  // every 10. The coordinate number sits at each 10-tick on the seam (the only
  // number source in State A; the separate bottom index row is hidden there).
  renderTape = () => {
    const { charWidth, firstBase, lineHeight, seq } = this.props;
    const half = lineHeight ?? 14; // seam half-height fallback if not provided

    // tick half-lengths above/below the baseline, graduated by landmark level.
    const minorHalf = half * 0.16;
    const fiveHalf = half * 0.28;
    const tenHalf = half * 0.42;

    const ticks: React.ReactNode[] = [];
    const numbers: React.ReactNode[] = [];

    for (let i = 0; i < seq.length; i++) {
      const pos = firstBase + i + 1; // 1-based absolute bp this column maps to
      const cx = charWidth * (i + 0.5); // center of the base column

      const isTen = pos % 10 === 0;
      const isFive = !isTen && pos % 5 === 0;

      const tickHalf = isTen ? tenHalf : isFive ? fiveHalf : minorHalf;
      const stroke = isTen ? TAPE_TEN : isFive ? TAPE_FIVE : TAPE_MINOR;
      const strokeWidth = isTen ? 1.1 : isFive ? 0.85 : 0.7;

      ticks.push(
        <line
          key={`tick-${i}`}
          stroke={stroke}
          strokeWidth={strokeWidth}
          x1={cx}
          x2={cx}
          y1={-tickHalf}
          y2={tickHalf}
        />,
      );

      if (isTen) {
        // number centered on the 10-tick, sitting ON the seam baseline. The two
        // strand rows nearly meet at the seam, so the number gets a white halo
        // rect that punches it through the glyphs and keeps it crisp. fontSize
        // is the stable label size (12); halfW estimates the label box.
        const label = String(pos);
        const numFontSize = 11;
        const numCharW = numFontSize * 0.62; // monospace-ish digit advance
        const halfW = (label.length * numCharW) / 2 + 1.5;
        const halfH = numFontSize / 2 + 1;
        numbers.push(
          <React.Fragment key={`num-${i}`}>
            <rect
              fill="#ffffff"
              height={halfH * 2}
              width={halfW * 2}
              x={cx - halfW}
              y={-halfH}
            />
            <text
              className="la-vz-index-tick-label"
              dominantBaseline="middle"
              fontSize={numFontSize}
              style={indexTickLabel}
              textAnchor="middle"
              transform={`translate(${cx}, 0)`}
            >
              {label}
            </text>
          </React.Fragment>,
        );
      }
    }

    const baselineWidth = charWidth * seq.length;

    return (
      <g className="la-vz-ruler-tape" data-testid="la-vz-ruler-tape" fill="none">
        <line stroke={TAPE_BASELINE} strokeWidth={0.8} x1={0} x2={baselineWidth} y1={0} y2={0} />
        {ticks}
        <g fill={TAPE_TEN} stroke="none">
          {numbers}
        </g>
      </g>
    );
  };

  render() {
    const { baseLegible, findXAndWidth, firstBase, lastBase, lineHeight, seamYDiff, showIndex, yDiff } = this.props;

    if (!showIndex) return null;

    // State A: the in-seam measuring tape. Active only when bases are legible
    // and the seam position is known. One hard swap, no fade.
    if (baseLegible && typeof seamYDiff === "number" && typeof lineHeight === "number") {
      return <g transform={`translate(0, ${seamYDiff})`}>{this.renderTape()}</g>;
    }

    // State B: the numbered interval ruler in its original position.
    const { width, x } = findXAndWidth(firstBase, lastBase);
    return (
      <g transform={`translate(0, ${yDiff})`}>
        <path className="la-vz-index-line" d={`M 0 1 L ${x + width} 1`} style={indexLine} />
        {this.genTicks()}
      </g>
    );
  }
}
