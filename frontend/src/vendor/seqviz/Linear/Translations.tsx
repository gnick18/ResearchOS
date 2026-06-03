// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import { InputRefFunc } from "../SelectionHandler";
import { borderColorByIndex, colorByIndex } from "../colors";
import { NameRange, SeqType, Translation } from "../elements";
import { clipSegmentToBlock, randomID } from "../sequence";
import { translationAminoAcidLabel, translationHandle, translationHandleLabel } from "../style";
import { FindXAndWidthElementType, FindXAndWidthType } from "./SeqBlock";

const hoverOtherTranshlationHandleRows = (className: string, opacity: number) => {
  if (!document) return;
  const elements = document.getElementsByClassName(className) as HTMLCollectionOf<HTMLElement>;
  for (let i = 0; i < elements.length; i += 1) {
    elements[i].style.fillOpacity = `${opacity}`;
  }
};

interface TranslationRowsProps {
  bpsPerBlock: number;
  charWidth: number;
  elementHeight: number;
  findXAndWidth: FindXAndWidthType;
  findXAndWidthElement: FindXAndWidthElementType;
  firstBase: number;
  fullSeq: string;
  inputRef: InputRefFunc;
  lastBase: number;
  onUnmount: (a: unknown) => void;
  seqType: SeqType;
  translationRows: Translation[][];
  yDiff: number;
}

/** Rows of translations */
export const TranslationRows = ({
  bpsPerBlock,
  charWidth,
  elementHeight,
  findXAndWidth,
  findXAndWidthElement,
  firstBase,
  fullSeq,
  inputRef,
  lastBase,
  onUnmount,
  seqType,
  translationRows,
  yDiff,
}: TranslationRowsProps) => (
  <g className="la-vz-linear-translation" data-testid="la-vz-linear-translation">
    {translationRows.map((translations, i) => {
      // Add up the previous translation heights, taking into account if they have a handle or not
      let currentElementY = yDiff;
      for (let j = 0; j < i; j += 1) {
        const multiplier = translationRows[j][0]["name"] ? 2 : 1;
        currentElementY += elementHeight * multiplier;
      }
      return (
        <TranslationRow
          key={`i-${firstBase}`}
          bpsPerBlock={bpsPerBlock}
          charWidth={charWidth}
          elementHeight={elementHeight}
          findXAndWidth={findXAndWidth}
          findXAndWidthElement={findXAndWidthElement}
          firstBase={firstBase}
          fullSeq={fullSeq}
          height={elementHeight}
          inputRef={inputRef}
          lastBase={lastBase}
          seqType={seqType}
          translations={translations}
          y={currentElementY}
          onUnmount={onUnmount}
        />
      );
    })}
  </g>
);

/**
 * A single row of translations. Multiple of these may be in one seqBlock
 * vertically stacked on top of one another in non-overlapping arrays.
 */
const TranslationRow = (props: {
  bpsPerBlock: number;
  charWidth: number;
  elementHeight: number;
  findXAndWidth: FindXAndWidthType;
  findXAndWidthElement: FindXAndWidthElementType;
  firstBase: number;
  fullSeq: string;
  height: number;
  inputRef: InputRefFunc;
  lastBase: number;
  onUnmount: (a: unknown) => void;
  seqType: SeqType;
  translations: Translation[];
  y: number;
}) => (
  <>
    {props.translations.map((t, i) => (
      <React.Fragment key={`translation-linear-${t.id}-${i}-${props.firstBase}-${props.lastBase}`}>
        <SingleNamedElementAminoacids {...props} translation={t} />
        {t.name && <SingleNamedElementHandle {...props} element={t} elements={props.translations} index={i} />}
      </React.Fragment>
    ))}
  </>
);

interface SingleNamedElementAminoacidsProps {
  bpsPerBlock: number;
  charWidth: number;
  findXAndWidth: FindXAndWidthType;
  firstBase: number;
  fullSeq: string;
  height: number;
  inputRef: InputRefFunc;
  lastBase: number;
  onUnmount: (a: unknown) => void;
  seqType: SeqType;
  translation: Translation;
  y: number;
}

/**
 * A single row for translations of DNA into Amino Acid sequences so a user can
 * see the resulting protein or peptide sequence in the viewer
 */
class SingleNamedElementAminoacids extends React.PureComponent<SingleNamedElementAminoacidsProps> {
  AAs: string[] = [];

  // on unmount, clear all AA references.
  componentWillUnmount = () => {
    const { onUnmount } = this.props;
    this.AAs.forEach(a => onUnmount(a));
  };

  /**
   * make the actual path string
   */
  genPath = (count: number, multiplier: number) => {
    const { charWidth, height: h } = this.props; // width adjust

    const nW = count * charWidth;
    const wA = multiplier * 3;

    return `M 0 0
			L ${nW} 0
			L ${nW + wA} ${h / 2}
			L ${nW} ${h}
			L 0 ${h}
			L ${wA} ${h / 2}
			Z`;
  };

  render() {
    const {
      bpsPerBlock,
      charWidth,
      findXAndWidth,
      firstBase,
      fullSeq,
      height: h,
      inputRef,
      lastBase,
      seqType,
      translation,
      y,
    } = this.props;

    const { AAseq, direction, end, id, start } = translation;
    // sequence-view legibility bot — a COMPUTED ORF track (not an annotated
    // CDS): render it as a muted outline (lower fill opacity, no per-residue
    // fill, dashed-feeling slate stroke) so it stays clearly secondary to your
    // real CDS translations. Stops still pop in crimson.
    const isOrf = !!(translation as { orf?: boolean }).orf;
    // seq introns bot — for a spliced (join) translation, aaToBp[i] is the
    // absolute bp start of codon i, so the AA glyphs land over exon positions
    // and skip the introns. Undefined for single-span translations (unchanged).
    const aaToBp = (translation as { aaToBp?: number[] }).aaToBp;
    const segments = (translation as { segments?: { start: number; end: number }[] }).segments;
    const spliced = !!(aaToBp && segments && segments.length > 1);

    // if rendering an amino-acid sequence directly, each amino acid block is 1:1 with a "base pair".
    // otherwise, each amino-acid covers three bases.
    const bpPerBlockCount = seqType === "aa" ? 1 : 3;

    // substring and split only the amino acids that are relevant to this
    // particular sequence block
    const AAs = AAseq.split("");
    return (
      <g
        ref={inputRef(id, {
          end,
          name: "translation",
          parent: { ...translation, type: "TRANSLATION" },
          start,
          type: "AMINOACID",
          viewer: "LINEAR",
        })}
        className="la-vz-linear-aa-translation"
        data-testid="la-vz-linear-aa-translation"
        id={id}
        transform={`translate(0, ${y})`}
      >
        {/* seq introns bot — dashed intron connector across the gaps between
            exons, along this row's vertical center; mirrors the annotation. */}
        {spliced &&
          (() => {
            const sorted = segments
              .map(s => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) }))
              .sort((p, q) => p.start - q.start);
            return sorted.slice(0, -1).map((ex, gi) => {
              const clip = clipSegmentToBlock(ex.end, sorted[gi + 1].start, firstBase, lastBase);
              if (!clip) return null;
              const { x: gx, width: gw } = findXAndWidth(clip.start, clip.end);
              if (!gw) return null;
              return (
                <line
                  key={`tx-intron-${id}-${gi}-${firstBase}`}
                  className="la-vz-translation-intron"
                  stroke="#94a3b8"
                  strokeDasharray="3 2"
                  strokeWidth={1}
                  x1={gx}
                  x2={gx + gw}
                  y1={h / 2}
                  y2={h / 2}
                />
              );
            });
          })()}
        {AAs.map((a, i) => {
          // generate and store an id reference (that's used for selection)
          const aaId = randomID();
          this.AAs.push(aaId);

          // calculate the start and end point of each amino acid
          // modulo needed here for translations that cross zero index
          let AAStart = spliced ? aaToBp[i] : (start + i * bpPerBlockCount) % fullSeq.length;
          let AAEnd = spliced ? aaToBp[i] + bpPerBlockCount : start + i * bpPerBlockCount + bpPerBlockCount;

          if (AAStart > AAEnd && firstBase >= bpsPerBlock) {
            // amino acid has crossed zero index in the last SeqBlock
            AAEnd += fullSeq.length;
          } else if (AAStart > AAEnd && firstBase < bpsPerBlock) {
            // amino acid has crossed zero index in the first SeqBlock
            AAStart -= fullSeq.length;
          } else if (AAStart === 0 && firstBase >= bpsPerBlock) {
            // extreme edge case (1/3 around zero) where modulo returns zero
            AAStart += fullSeq.length;
            AAEnd += fullSeq.length;
          }

          // build up a selection handler reference for just this amino acid,
          // so a singly translated amino acid can be selected from within the
          // larger translation

          // the amino acid doesn't fit within this SeqBlock (even partially)
          if (AAStart >= lastBase || AAEnd <= firstBase) return null;

          let showAminoAcidLabel = true; // whether to show amino acids abbreviation
          let bpCount = bpPerBlockCount; // start off assuming the full thing is shown
          if (AAStart < firstBase) {
            bpCount = Math.min(bpPerBlockCount, AAEnd - firstBase);
            if (bpCount < 2 && seqType !== "aa") {
              // w/ one bp, the amino acid is probably too small for an abbreviation
              showAminoAcidLabel = false;
            }
          } else if (AAEnd > lastBase) {
            bpCount = Math.min(bpPerBlockCount, lastBase - AAStart);
            if (bpCount < 2 && seqType !== "aa") {
              showAminoAcidLabel = false;
            }
          }

          const { x } = findXAndWidth(Math.max(AAStart, firstBase));

          // direction check needed to determine which direction the amino acid translation
          // arrow are facing
          const path = this.genPath(bpCount, direction === 1 ? 1 : -1);

          // sequence-view legibility bot — a stop codon (TAA/TAG/TGA -> "*")
          // gets a distinct muted-crimson fill + darker crimson border so
          // reading-frame ends / premature stops pop out from the generic
          // per-residue palette, while staying within the calm translation
          // style (same opacity / stroke width as the other residues).
          const isStop = a === "*";
          // ORF residues use a single muted slate (outline treatment) instead
          // of the per-residue palette, so the run reads as one computed guess.
          // Stops still override to crimson so premature stops remain obvious.
          const fill = isStop
            ? "#b91c1c"
            : isOrf
              ? "#cbd5e1"
              : colorByIndex(a.charCodeAt(0));
          const stroke = isStop
            ? "#7f1d1d"
            : isOrf
              ? "#94a3b8"
              : borderColorByIndex(a.charCodeAt(0));

          return (
            <g
              key={aaId}
              ref={inputRef(aaId, {
                end: AAEnd,
                parent: { ...translation, type: "TRANSLATION" },
                start: AAStart,
                type: "AMINOACID",
                viewer: "LINEAR",
              })}
              id={aaId}
              transform={`translate(${x}, 0)`}
            >
              <path
                d={path}
                fill={fill}
                id={aaId}
                shapeRendering="geometricPrecision"
                stroke={stroke}
                style={{
                  cursor: "pointer",
                  // stops sit a touch more opaque so the crimson reads clearly;
                  // ORF residues sit lighter so the computed run stays secondary
                  // to real CDS translations.
                  opacity: isStop ? 0.85 : isOrf ? 0.45 : 0.7,
                  strokeWidth: isStop ? 1 : isOrf ? 1 : 0.8,
                  strokeDasharray: isOrf && !isStop ? "2 1.5" : undefined,
                }}
              />

              {showAminoAcidLabel && (
                <text
                  className="la-vz-translation-amino-acid-label"
                  cursor="pointer"
                  data-testid="la-vz-translation"
                  dominantBaseline="middle"
                  fill={isStop ? "#ffffff" : undefined}
                  fontWeight={isStop ? 700 : undefined}
                  id={aaId}
                  style={translationAminoAcidLabel}
                  textAnchor="middle"
                  x={bpCount * 0.5 * charWidth}
                  y={`${h / 2 + 1}`}
                >
                  {a}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  }
}

/**
 * SingleNamedElement is a single rectangular element in the SeqBlock.
 * It does a bunch of stuff to avoid edge-cases from wrapping around the 0-index, edge of blocks, etc.
 */
const SingleNamedElementHandle = (props: {
  element: NameRange;
  elementHeight: number;
  elements: NameRange[];
  findXAndWidthElement: FindXAndWidthElementType;
  height: number;
  index: number;
  inputRef: InputRefFunc;
  y: number;
}) => {
  const { element, elementHeight, elements, findXAndWidthElement, index, inputRef, y } = props;

  const { color, end, name, start } = element;
  // sequence-view legibility bot — a computed ORF handle reads as an OUTLINE
  // (hollow fill, slate border) with a "computed" cue in the label, so it is
  // obviously not one of your annotated CDS translation handles (solid fill).
  const isOrf = !!(element as { orf?: boolean }).orf;
  const handleFill = isOrf ? "#f1f5f9" : color;
  const handleStroke = isOrf ? "#94a3b8" : color;
  const { width, x: origX } = findXAndWidthElement(index, element, elements);

  // 0.591 is our best approximation of Roboto Mono's aspect ratio (width / height).
  const fontSize = 9;
  const characterWidth = 0.591 * fontSize;
  // Use at most 1/4 of the width for the name handle.
  const availableCharacters = Math.floor(width / 4 / characterWidth);

  // ORF handles carry a "computed" cue so they don't read as an annotated CDS.
  let displayName = isOrf ? "ORF (computed)" : (name ?? "");
  if (displayName && displayName.length > availableCharacters) {
    const charactersToShow = availableCharacters - 1;
    if (charactersToShow < 3) {
      // If we can't show at least three characters, don't show any.
      displayName = "";
    } else {
      displayName = `${displayName.slice(0, charactersToShow)}…`;
    }
  }

  // What's needed for the display + margin at the start + margin at the end
  const nameHandleLeftMargin = 10;
  const nameHandleWidth = displayName.length * characterWidth + nameHandleLeftMargin * 2;

  const x = origX;
  const w = width;
  const height = props.height;
  const marginBottom = 2;
  const marginTop = 2;

  let linePath = "";
  linePath += `M 0 ${marginTop} 
              L ${nameHandleWidth} ${marginTop}
              L ${nameHandleWidth} ${height / 4 - marginBottom / 2 + marginTop / 2}
              L ${w} ${height / 4 - marginBottom / 2 + marginTop / 2} 
              L ${w} ${(3 * height) / 4 - marginBottom / 2 + marginTop / 2} 
              L ${nameHandleWidth} ${(3 * height) / 4 - marginBottom / 2 + marginTop / 2}  
              L ${nameHandleWidth} ${height - marginBottom} 
              L 0 ${height - marginBottom}
              Z`;

  return (
    <g
      ref={inputRef(element.id, {
        end,
        name,
        start,
        type: "TRANSLATION_HANDLE",
        viewer: "LINEAR",
      })}
      id={element.id}
      transform={`translate(0, ${y + elementHeight})`}
    >
      <g id={element.id} transform={`translate(${x}, 0)`}>
        {/* <title> provides a hover tooltip on most browsers */}
        <title>{isOrf ? "Computed ORF (ATG to stop)" : name}</title>
        <path
          className={`${element.id} la-vz-translation-handle`}
          cursor="pointer"
          d={linePath}
          fill={handleFill}
          id={element.id}
          stroke={handleStroke}
          style={translationHandle}
          onBlur={() => {
            // do nothing
          }}
          onFocus={() => {
            // do nothing
          }}
          onMouseOut={() => hoverOtherTranshlationHandleRows(element.id, 0.7)}
          onMouseOver={() => hoverOtherTranshlationHandleRows(element.id, 1.0)}
        />
        <text
          className="la-vz-handle-label"
          cursor="pointer"
          dominantBaseline="middle"
          fill={isOrf ? "#475569" : undefined}
          fontSize={fontSize}
          fontStyle={isOrf ? "italic" : undefined}
          id={element.id}
          style={translationHandleLabel}
          textAnchor="start"
          x={nameHandleLeftMargin}
          y={height / 2 + 1}
          onBlur={() => {
            // do nothing
          }}
          onFocus={() => {
            // do nothing
          }}
          onMouseOut={() => hoverOtherTranshlationHandleRows(element.id, 0.7)}
          onMouseOver={() => hoverOtherTranshlationHandleRows(element.id, 1.0)}
        >
          {displayName}
        </text>
      </g>
    </g>
  );
};
