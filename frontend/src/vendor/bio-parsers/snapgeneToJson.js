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
//   - fast-xml-parser                        ->  a tiny dependency-free XML
//     scanner (see parseFeaturesXml / parseNotesXml below)
//   - lodash `get`                           ->  a tiny local path getter
//
// Why NOT DOMParser: the SnapGene Features / Notes blocks are XML, and an
// earlier revision used the browser `DOMParser`. That made the WHOLE import
// throw `ReferenceError: DOMParser is not defined` in any non-DOM JS realm
// (Node test harness, SSR, a web worker) the instant a `.dna` file carried a
// Features or Notes block — i.e. essentially every real SnapGene export. The
// wrapper then surfaced "Import Error: Invalid File" with zero sequences. The
// SnapGene XML is small, flat, and well formed (no namespaces / CDATA), so we
// scan it with a regex-based reader instead. No DOM, no deps, runs everywhere.
//
// Block tolerance: every block is read as (1-byte tag, big-endian uint32
// length, body). Tags we understand (0/21 sequence, 10 features, 6 notes) are
// parsed; ANY other tag (including newer ones in modern exports) is skipped by
// its declared length rather than throwing, so future format additions degrade
// gracefully instead of failing the import.
//
// Original credit (per upstream): adapted from IsaacLuo's SnapGeneFileReader
// (https://github.com/IsaacLuo/SnapGeneFileReader). XML layout (tags /
// attributes) reimplemented from the publicly documented SnapGene binary
// format; no third-party (GPL) reader code is vendored.

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

      // A block whose declared length runs past the end of the file means the
      // stream is truncated/corrupt or we lost block alignment. Stop cleanly
      // and keep whatever we parsed so far rather than throwing or reading out
      // of bounds (subarray would just clamp and silently mis-parse).
      if (block_size < 0 || offset + block_size > total) {
        break;
      }

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
      } else if (nextByte === 5) {
        // READ THE PRIMERS. SnapGene stores primers in their own block (type 5)
        // rather than as Features, so the old reader dropped them on the floor
        // (the final `else` skipped the block by length). Emit each primer as a
        // standard GenBank `primer_bind` feature — GenBank's native primer
        // representation, which round-trips through jsonToGenbank and the
        // existing feature display with zero new plumbing. We append rather than
        // overwrite `data.features` so a file with both Features (type 10) and
        // Primers (type 5) blocks keeps both, regardless of block order.
        const xml = read(block_size, "utf8");
        const primerFeatures = parsePrimersXml(xml, isProtein);
        for (const pf of primerFeatures) data.features.push(pf);
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

/** Decode the handful of XML entities SnapGene emits (it double-escapes HTML in
 *  qualifier values, e.g. `&lt;html&gt;`, plus the standard five). */
function decodeXmlEntities(s) {
  if (s == null || s.indexOf("&") === -1) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Ampersand last so we don't re-trigger the rules above.
    .replace(/&amp;/g, "&");
}

/** Pull a single attribute value out of an element's opening-tag text. Returns
 *  `undefined` when absent. Values are XML-entity-decoded. */
function attr(tagText, name) {
  const m = tagText.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? decodeXmlEntities(m[1]) : undefined;
}

/** Iterate over every `<Tag ...>...</Tag>` (or self-closing `<Tag .../>`) block
 *  for `tagName` inside `xml`, returning `{ open, inner }` for each: `open` is
 *  the opening-tag text (attributes live here), `inner` is the element body
 *  (empty for self-closing). A flat, namespace-free scanner — sufficient for
 *  the well-formed XML SnapGene writes, with no DOM dependency. */
function eachElement(xml, tagName) {
  const out = [];
  // Matches `<Tag ...>` or `<Tag ... />`. Group 1 = attributes, group 2 = "/"
  // when self-closing.
  const openRe = new RegExp(`<${tagName}\\b([^>]*?)(/?)>`, "g");
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    const open = m[1] || "";
    if (m[2] === "/") {
      out.push({ open, inner: "" });
      continue;
    }
    // Find the matching close tag, honoring nesting of the same tag name.
    const closeRe = new RegExp(`</?${tagName}\\b[^>]*?(/?)>`, "g");
    closeRe.lastIndex = openRe.lastIndex;
    let depth = 1;
    let innerEnd = -1;
    let c;
    while ((c = closeRe.exec(xml)) !== null) {
      const isSelfClosed = c[1] === "/";
      const isClose = xml[c.index + 1] === "/";
      if (isClose) {
        depth--;
        if (depth === 0) {
          innerEnd = c.index;
          openRe.lastIndex = closeRe.lastIndex;
          break;
        }
      } else if (!isSelfClosed) {
        depth++;
      }
    }
    if (innerEnd === -1) {
      // Unterminated; take the rest of the document as the body.
      out.push({ open, inner: xml.slice(openRe.lastIndex) });
      break;
    }
    out.push({ open, inner: xml.slice(m.index + m[0].length, innerEnd) });
  }
  return out;
}

/** Parse the SnapGene `<Features>` XML block with a dependency-free scanner
 *  (no DOMParser; see file header). Returns a flat list of
 *  `{ name, type, directionality, segments:[{range,color}], colorQual }`. */
function parseFeaturesXml(xml) {
  const out = [];
  for (const { open: featOpen, inner: featInner } of eachElement(
    xml,
    "Feature",
  )) {
    const segments = eachElement(featInner, "Segment").map((seg) => ({
      range: attr(seg.open, "range") || "",
      color: attr(seg.open, "color") || undefined,
    }));

    // Some files carry the color via a <Q name="color"><V .../></Q> qualifier.
    let colorQual;
    for (const q of eachElement(featInner, "Q")) {
      if (attr(q.open, "name") === "color") {
        const v = eachElement(q.inner, "V")[0];
        if (v) {
          colorQual =
            attr(v.open, "text") ||
            attr(v.open, "int") ||
            decodeXmlEntities(v.inner.trim()) ||
            undefined;
        }
      }
    }

    out.push({
      name: attr(featOpen, "name") || undefined,
      type: attr(featOpen, "type") || undefined,
      directionality: attr(featOpen, "directionality") || undefined,
      segments,
      colorQual,
    });
  }
  return out;
}

/** Parse a SnapGene primer binding-site location string into 0-based inclusive
 *  {start, end}, matching how feature ranges are stored elsewhere in this file.
 *  SnapGene writes primer locations as `start..end` (1-based inclusive, e.g.
 *  "100..120"); older / variant exports occasionally use `start-end`. Returns
 *  `null` when neither endpoint parses, so the caller can SKIP that primer
 *  rather than emit a NaN-coordinate feature. */
function getStartAndEndFromLocationString(locstring) {
  const raw = String(locstring == null ? "" : locstring).trim();
  if (!raw) return null;
  // Prefer the SnapGene `..` separator; fall back to a single `-` separator.
  // (A leading `-` would be a negative number, not a separator — split on the
  // dash BETWEEN two numbers only.)
  let parts;
  if (raw.indexOf("..") !== -1) {
    parts = raw.split("..");
  } else {
    const m = raw.match(/^(\d+)\s*-\s*(\d+)$/);
    parts = m ? [m[1], m[2]] : [raw];
  }
  const s = Number(parts[0]);
  // A single-endpoint location (rare) collapses to a 1-bp site.
  const e = parts.length > 1 ? Number(parts[1]) : s;
  if (!Number.isFinite(s) && !Number.isFinite(e)) return null;
  let start = Number.isFinite(s) ? s - 1 : (Number.isFinite(e) ? e - 1 : 0);
  let end = Number.isFinite(e) ? e - 1 : start;
  if (start < 0) start = 0;
  if (end < start) end = start;
  return { start, end };
}

/** Parse the SnapGene `<Primers>` XML block (block type 5) with the same
 *  dependency-free scanner the Features / Notes blocks use (no DOMParser; see
 *  file header). Each primer is emitted as a GenBank `primer_bind` feature
 *  shaped IDENTICALLY to the type-10 features above, so flattenSequenceArray /
 *  validateSequence / jsonToGenbank treat them the same way.
 *
 *  Mapping:
 *    - name      <- Primer @name (fallback "primer")
 *    - type      = "primer_bind" (validated against the feature-type table;
 *                  also drives the existing pink color in feature-colors.ts)
 *    - start/end <- BindingSite @location, 0-based inclusive
 *    - strand    <- BindingSite @boundStrand: "1"/reverse -> -1, else +1
 *    - notes.note = [oligo sequence] (ARRAY form: jsonToGenbank serializes each
 *                   note value as an array, so the oligo survives to /note)
 *
 *  A primer may have multiple binding sites; we emit ONE feature per site so a
 *  primer that anneals in two places shows both. A primer whose binding-site
 *  location fails to parse is SKIPPED (others survive), matching the file's
 *  defensive style. Attribute names vary across SnapGene versions, so every
 *  lookup is tolerant of absence / aliases. */
function parsePrimersXml(xml, isProtein) {
  const out = [];
  for (const { open: primerOpen, inner: primerInner } of eachElement(
    xml,
    "Primer",
  )) {
    const name = attr(primerOpen, "name") || "primer";
    // The oligo sequence may live on the Primer element (attr `sequence`) or,
    // in some exports, on the BindingSite. Capture the primer-level one here.
    const primerSeq =
      attr(primerOpen, "sequence") || attr(primerOpen, "Sequence") || undefined;

    const sites = eachElement(primerInner, "BindingSite");
    // A primer with no explicit binding site can't be placed on the map; skip.
    if (!sites.length) continue;

    for (const site of sites) {
      const location =
        attr(site.open, "location") ||
        attr(site.open, "Location") ||
        attr(site.open, "range") ||
        "";
      const coords = getStartAndEndFromLocationString(location);
      // Skip THIS site (not the whole import) when its location won't parse.
      if (!coords) continue;

      let { start, end } = coords;
      if (isProtein) {
        start = start * 3;
        end = end * 3 + 2;
      }

      // boundStrand: "0" (top) -> forward, "1" (bottom) -> reverse. Be tolerant
      // of alternate spellings / a textual "bottom".
      const boundStrandRaw =
        attr(site.open, "boundStrand") ||
        attr(site.open, "strand") ||
        attr(site.open, "simplified") ||
        "";
      const isReverse =
        boundStrandRaw === "1" ||
        /bottom|reverse|minus/i.test(boundStrandRaw);
      const strand = isReverse ? -1 : 1;

      // Oligo sequence: prefer a site-level sequence, else the primer-level one.
      const seq =
        attr(site.open, "sequence") ||
        attr(site.open, "Sequence") ||
        primerSeq;

      const feature = {
        name,
        type: "primer_bind",
        strand,
        arrowheadType: strand === -1 ? "BOTTOM" : "TOP",
        start,
        end,
      };
      // Carry the oligo sequence as a /note so it survives to GenBank. Array
      // value form, because jsonToGenbank serializes each note key as an array.
      if (seq) feature.notes = { note: [seq] };
      out.push(feature);
    }
  }
  return out;
}

/** Strip XML tags from an element body and decode entities, leaving the text
 *  content (matches the old DOMParser `.textContent` behavior). */
function xmlTextContent(inner) {
  if (inner == null) return undefined;
  return decodeXmlEntities(inner.replace(/<[^>]*>/g, ""));
}

/** Parse the SnapGene `<Notes>` XML block into `{ Notes: { CustomMapLabel,
 *  Description } }` (only the fields the parser consumes). Dependency-free. */
function parseNotesXml(xml) {
  const notes = eachElement(xml, "Notes")[0];
  if (!notes) return {};
  const label = eachElement(notes.inner, "CustomMapLabel")[0];
  const desc = eachElement(notes.inner, "Description")[0];
  return {
    Notes: {
      CustomMapLabel: label ? xmlTextContent(label.inner) : undefined,
      // The Description may wrap its text in `<html><body>…</body></html>`;
      // stripping tags reproduces the old `.textContent` result (the later
      // wrapper-strip in the caller then becomes a no-op, which is fine).
      Description: desc ? xmlTextContent(desc.inner) : undefined,
    },
  };
}

function getStartAndEndFromRangeString(rangestring) {
  // SnapGene ranges are 1-based inclusive "start-end". Be tolerant of a
  // missing/garbled range (modern exports occasionally emit segments without
  // one) so a single odd feature can't NaN-out or throw the whole import.
  const [start, end] = String(rangestring || "").split("-");
  const s = Number(start);
  const e = Number(end);
  return {
    start: Number.isFinite(s) ? s - 1 : 0,
    end: Number.isFinite(e) ? e - 1 : 0,
  };
}

function dec2bin(dec) {
  return (dec >>> 0).toString(2);
}

function isFirstBitA1(num) {
  return Number(num.toString().split("").pop()) === 1;
}

export default snapgeneToJson;
