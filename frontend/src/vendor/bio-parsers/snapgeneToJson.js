// @ts-nocheck — vendored third-party source (adapted from TeselaGen/tg-oss
// bio-parsers `snapgeneToJson`, MIT). Kept out of strict typecheck per the
// sequence-editor proposal. See ./LICENSE.
//
// sequence entry-path bot — SnapGene `.dna` (binary) reader, vendored
// NO-INSTALL. The upstream TeselaGen parser depends on `bufferpack`,
// `string_decoder`, `buffer`, `fast-xml-parser`, and `lodash-es` — none of
// which are installed here, and installs are forbidden. This adaptation keeps
// the exact same block-walking algorithm and feature/notes extraction but
// swaps those deps for browser-native primitives:
//   - bufferpack.unpack(">I"/">H"/">b")  ->  DataView big-endian getUint32 /
//     getUint16 / getInt8 (the only three pack formats the parser ever uses)
//   - Buffer / string_decoder                ->  Uint8Array + TextDecoder
//   - fast-xml-parser                        ->  the browser DOMParser
//   - lodash `get`                           ->  a tiny local path getter
//
// Original credit (per upstream): adapted from IsaacLuo's SnapGeneFileReader
// (https://github.com/IsaacLuo/SnapGeneFileReader).

import createInitialSequence from "./utils/createInitialSequence";
import validateSequenceArray from "./utils/validateSequenceArray";
import flattenSequenceArray from "./utils/flattenSequenceArray";
import extractFileExtension from "./utils/extractFileExtension";

const asciiDecoder = new TextDecoder("ascii");
const utf8Decoder = new TextDecoder("utf-8");

/** Minimal lodash-`get` replacement for the two dotted lookups the notes
 *  block uses (`Notes.CustomMapLabel`, `Notes.Description`). */
function getPath(obj, path) {
  if (obj == null) return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Parse a SnapGene `.dna` binary file into the same parsed-sequence array shape
 * the GenBank / FASTA parsers return.
 *
 * @param {ArrayBuffer | Uint8Array | { buffer: ArrayBuffer }} fileObj
 * @param {object} [options] — `{ fileName?: string, isProtein?: boolean }`
 */
async function snapgeneToJson(fileObj, options = {}) {
  try {
    const returnVal = createInitialSequence(options);

    // Normalize whatever we were handed to a DataView over the bytes. Use
    // duck-typing rather than `instanceof ArrayBuffer`: cross-realm callers
    // (e.g. a Node Buffer fed from a different JS realm under jsdom, or bytes
    // produced in a worker) have an ArrayBuffer from a DIFFERENT realm, so
    // `instanceof` is unreliable. Detect by shape instead.
    let arrayBuffer;
    const tag = Object.prototype.toString.call(fileObj);
    if (tag === "[object ArrayBuffer]") {
      arrayBuffer = fileObj;
    } else if (ArrayBuffer.isView(fileObj)) {
      // A typed-array / DataView / Node Buffer view: copy out its window.
      arrayBuffer = fileObj.buffer.slice(
        fileObj.byteOffset,
        fileObj.byteOffset + fileObj.byteLength,
      );
    } else if (
      fileObj &&
      fileObj.buffer &&
      Object.prototype.toString.call(fileObj.buffer) === "[object ArrayBuffer]"
    ) {
      arrayBuffer = fileObj.buffer;
    } else {
      throw new Error("snapgeneToJson: unsupported file input");
    }

    // Re-wrap into same-realm views. Copy through a fresh Uint8Array so a
    // cross-realm ArrayBuffer (see above) can't trip the DataView/Uint8Array
    // constructors either.
    const bytes = Uint8Array.from(new Uint8Array(arrayBuffer));
    const view = new DataView(bytes.buffer);
    const total = bytes.byteLength;

    const ext = extractFileExtension(options.fileName);
    let isProtein = options.isProtein;
    if (ext && /^(prot)$/.test(ext)) {
      isProtein = true;
      options.isProtein = true;
    }

    let offset = 0;

    // Read `size` raw bytes, advancing the cursor. With `fmt === "ascii" |
    // "utf8"` decode to a string, otherwise return the byte slice.
    function read(size, fmt) {
      const slice = bytes.subarray(offset, offset + size);
      offset += size;
      if (fmt === "ascii") return asciiDecoder.decode(slice);
      if (fmt === "utf8") return utf8Decoder.decode(slice);
      return slice;
    }

    // The upstream parser only ever unpacks big-endian "I" (uint32), "H"
    // (uint16), and "b" (int8). Replace bufferpack with DataView reads.
    function unpack(size, mode) {
      const at = offset;
      offset += size;
      if (mode === "I") return view.getUint32(at, false);
      if (mode === "H") return view.getUint16(at, false);
      if (mode === "b") return view.getInt8(at);
      throw new Error("snapgeneToJson: unsupported unpack mode " + mode);
    }

    read(1); // read the first byte (block tag for the header block)
    // READ THE DOCUMENT PROPERTIES
    const length = unpack(4, "I");
    const title = read(8, "ascii");
    if (length !== 14 || title !== "SnapGene") {
      throw new Error("Wrong format for a SnapGene file !");
    }

    const data = {
      ...returnVal.parsedSequence,
      isProtein,
      isDNA: !!unpack(2, "H") && !isProtein,
      exportVersion: unpack(2, "H"),
      importVersion: unpack(2, "H"),
      features: [],
    };

    while (offset <= total) {
      // READ THE WHOLE FILE, BLOCK BY BLOCK, UNTIL THE END.
      // next_byte table (upstream): 0 dna seq, 1 compressed dna, 5 primers,
      // 6 notes, 7 history tree, 8 add'l seq props, 9 file desc, 10 features,
      // 11 history node, 16/17 alignable seq, 18 trace, 19 uracil, 20 colors,
      // 21 protein sequence.
      if (offset >= total) break;
      const nextByteArr = read(1);
      const nextByte = nextByteArr.length ? nextByteArr[0] : -1;
      const block_size = unpack(4, "I");

      if (nextByte === 21 || nextByte === 0) {
        // READ THE SEQUENCE AND ITS PROPERTIES
        const props = unpack(1, "b");
        const binaryRep = dec2bin(props);
        data.circular = isFirstBitA1(binaryRep);
        const size = block_size - 1;
        if (size < 0) return;
        data.size = isProtein ? size * 3 : size;
        data.sequence = read(size, "utf8");
      } else if (nextByte === 10) {
        // READ THE FEATURES
        const strand_dict = {
          // [strand, arrowheadType]
          0: [1, "NONE"],
          1: [1, "TOP"],
          2: [-1, "BOTTOM"],
          3: [1, "BOTH"],
        };
        const xml = read(block_size, "utf8");
        const featureNodes = parseFeaturesXml(xml);
        data.features = [];
        featureNodes.forEach((feat) => {
          const { directionality, segments, name, type, colorQual } = feat;
          let color;
          let maxStart = 0;
          let maxEnd = 0;
          const locations = segments.map((seg) => {
            if (seg.color) color = seg.color;
            let { start, end } = getStartAndEndFromRangeString(seg.range);
            start = isProtein ? start * 3 : start;
            end = isProtein ? end * 3 + 2 : end;
            maxStart = Math.max(maxStart, start);
            maxEnd = Math.max(maxEnd, end);
            return { start, end };
          });
          if (colorQual) color = colorQual;

          data.features.push({
            name,
            type,
            ...(locations.length > 1 && { locations }),
            strand: directionality ? strand_dict[directionality][0] : 1,
            arrowheadType: directionality
              ? strand_dict[directionality][1]
              : "NONE",
            start: maxStart,
            end: maxEnd,
            color,
          });
        });
      } else if (nextByte === 6) {
        // READ THE NOTES
        const xml = read(block_size, "utf8");
        const notes = parseNotesXml(xml);
        const name = getPath(notes, "Notes.CustomMapLabel");
        if (name) data.name = name;
        const description = getPath(notes, "Notes.Description");
        if (description && typeof description === "string") {
          data.description = description
            .replace("<html><body>", "")
            .replace("</body></html>", "");
        }
      } else {
        // WE IGNORE THE WHOLE BLOCK
        read(block_size);
      }
    }

    returnVal.parsedSequence = data;
    return validateSequenceArray(
      flattenSequenceArray([returnVal], options),
      options,
    );
  } catch (e) {
    console.error("Error trying to parse file as snapgene:", e);
    return [
      {
        success: false,
        messages: ["Import Error: Invalid File"],
      },
    ];
  }
}

/** Parse the SnapGene `<Features>` XML block via DOMParser. Returns a flat list
 *  of `{ name, type, directionality, segments:[{range,color}], colorQual }`. */
function parseFeaturesXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const out = [];
  const features = doc.getElementsByTagName("Feature");
  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    const segEls = feat.getElementsByTagName("Segment");
    const segments = [];
    for (let s = 0; s < segEls.length; s++) {
      const seg = segEls[s];
      segments.push({
        range: seg.getAttribute("range") || "",
        color: seg.getAttribute("color") || undefined,
      });
    }
    // Some files carry the color via a <Q name="color"><V .../></Q> qualifier.
    let colorQual;
    const qEls = feat.getElementsByTagName("Q");
    for (let q = 0; q < qEls.length; q++) {
      if (qEls[q].getAttribute("name") === "color") {
        const vEl = qEls[q].getElementsByTagName("V")[0];
        if (vEl) {
          colorQual =
            vEl.getAttribute("text") ||
            vEl.getAttribute("int") ||
            vEl.textContent ||
            undefined;
        }
      }
    }
    out.push({
      name: feat.getAttribute("name") || undefined,
      type: feat.getAttribute("type") || undefined,
      directionality: feat.getAttribute("directionality") || undefined,
      segments,
      colorQual,
    });
  }
  return out;
}

/** Parse the SnapGene `<Notes>` XML block into `{ Notes: { CustomMapLabel,
 *  Description } }` (only the fields the parser consumes). */
function parseNotesXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const notesEl = doc.getElementsByTagName("Notes")[0];
  if (!notesEl) return {};
  const label = notesEl.getElementsByTagName("CustomMapLabel")[0];
  const desc = notesEl.getElementsByTagName("Description")[0];
  return {
    Notes: {
      CustomMapLabel: label ? label.textContent : undefined,
      // The Description may contain raw HTML; innerHTML is unavailable on XML
      // nodes, so reconstruct from textContent (matches upstream's later strip
      // of the <html><body> wrapper, which textContent already removes).
      Description: desc ? desc.textContent : undefined,
    },
  };
}

function getStartAndEndFromRangeString(rangestring) {
  const [start, end] = rangestring.split("-");
  return {
    start: start - 1,
    end: end - 1,
  };
}

function dec2bin(dec) {
  return (dec >>> 0).toString(2);
}

function isFirstBitA1(num) {
  return Number(num.toString().split("").pop()) === 1;
}

export default snapgeneToJson;
