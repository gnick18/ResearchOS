/**
 * Stamp utilities for markdown files.
 *
 * Every notes / results / method markdown file ships with a "stamp" block at
 * the top that captures the date, time, experiment name, and project folder.
 * The block is bounded by HTML comments so the boundary markers themselves
 * never appear in the rendered preview — `react-markdown` (with `rehype-raw`)
 * strips HTML comments, and per the CommonMark spec a comment opens an HTML
 * block that can interrupt an open paragraph, so the closing marker can't
 * accidentally get absorbed into the date/time/experiment paragraph above it.
 *
 * New (current) format:
 *
 *     <!-- stamp:start -->
 *     2026-02-15
 *     12:07 PM
 *     experiment: Western Blot Analysis
 *     project folder: Protein Research
 *     <!-- stamp:end -->
 *     ___
 *
 * Legacy formats that the parser still accepts (lazy-normalize on read,
 * `repairStampFormats` finishes the tail under Settings → Data maintenance):
 *
 *     [stamp-start]: # (hidden) … [stamp-end]: # (hidden)     ← previous default
 *     [//]: # (STAMP_START)      … [//]: # (STAMP_END)
 *     <!-- STAMP_START -->       … <!-- STAMP_END -->
 *
 * Reopened tracking:
 *     [last-access]: # (2026-02-15T12:07:00Z)
 *     ___
 *     *Reopened on 2026-02-16 at 2:30 PM*
 *     ___
 */

const REOPEN_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export interface StampData {
  date: string;
  time: string;
  experimentName: string;
  projectFolder: string;
}

export interface ParsedContent {
  stamp: StampData | null;
  lastAccess: string | null;
  reopenedStamps: string[];
  content: string;
}

// ── Stamp boundary patterns ─────────────────────────────────────────────────
//
// Every boundary helper below derives its regex from these four pairs so the
// "what counts as a stamp" definition lives in exactly one place.

const STAMP_BOUNDARIES = [
  // New format (HTML comment block — invisible in every CommonMark renderer).
  { start: /<!--\s*stamp:start\s*-->/, end: /<!--\s*stamp:end\s*-->/ },
  // Legacy: link reference definitions with a unique label.
  { start: /\[stamp-start\]: # \([^)]*\)/, end: /\[stamp-end\]: # \([^)]*\)/ },
  // Legacy: anchor-style ref defs.
  { start: /\[\/\/\]: # \(STAMP_START\)/, end: /\[\/\/\]: # \(STAMP_END\)/ },
  // Legacy: old SHOUTY HTML comment markers.
  { start: /<!-- STAMP_START -->/, end: /<!-- STAMP_END -->/ },
] as const;

function source(re: RegExp): string {
  return re.source;
}

/**
 * Build a regex that matches any supported `<start>(<body>)<end>` pair.
 */
function stampBodyPattern(flags: string): RegExp {
  const alternation = STAMP_BOUNDARIES.map(
    ({ start, end }) => `(?:${source(start)}([\\s\\S]*?)${source(end)})`
  ).join("|");
  return new RegExp(alternation, flags);
}

/**
 * Build a regex that matches any supported full stamp block (start → end → ___).
 */
function stampBlockPattern(flags: string): RegExp {
  const alternation = STAMP_BOUNDARIES.map(
    ({ start, end }) => `(?:${source(start)}[\\s\\S]*?${source(end)}\\s*___\\s*\\n?)`
  ).join("|");
  return new RegExp(alternation, flags);
}

/**
 * Build a regex that matches any supported stamp-end line followed by the ___
 * separator (used as an insertion anchor by `updateLastAccess` and friends).
 */
function stampEndAnchorPattern(): RegExp {
  const alternation = STAMP_BOUNDARIES.map(
    ({ end }) => `(?:${source(end)}\\s*___\\s*\\n)`
  ).join("|");
  return new RegExp(`(${alternation})`);
}

/**
 * Build a regex that matches any supported `start ... end` pair as a whole
 * (used by `updateStampNames` which rewrites the body in-place).
 */
function stampWholePattern(): RegExp {
  const alternation = STAMP_BOUNDARIES.map(
    ({ start, end }) => `(${source(start)}[\\s\\S]*?${source(end)})`
  ).join("|");
  return new RegExp(alternation);
}

// ── Last-access boundary patterns ──────────────────────────────────────────
//
// Two parallel arrays: the `_CAPTURE` variants pull out the ISO timestamp,
// the `_LINE` variants match the entire line for global replace.

const LAST_ACCESS_CAPTURE: RegExp[] = [
  /\[last-access\]: # \(([^)]+)\)/,
  /\[\/\/\]: # \(LAST_ACCESS: ([^)]+)\)/,
  /<!-- LAST_ACCESS: ([^>]+) -->/,
];

const LAST_ACCESS_LINE: RegExp[] = [
  /\[last-access\]: # \([^)]+\)/,
  /\[\/\/\]: # \(LAST_ACCESS: [^)]+\)/,
  /<!-- LAST_ACCESS: [^>]+ -->/,
];

function lastAccessLinePattern(flags: string): RegExp {
  const alternation = LAST_ACCESS_LINE.map(source).join("|");
  return new RegExp(`(?:${alternation})\\s*\\n?`, flags);
}

// ── Generators ─────────────────────────────────────────────────────────────

/**
 * Generate a fresh stamp block in the canonical (HTML-comment) format.
 *
 * Body lines end with two trailing spaces so the markdown renderer keeps each
 * line on its own row inside the paragraph between the two comments. The
 * trailing comment closes the paragraph because CommonMark allows HTML block
 * comments (type 2) to interrupt an open paragraph.
 */
export function generateStamp(experimentName: string, projectFolder: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // Two trailing spaces on each body line are markdown hard line breaks, so
  // each piece of metadata stays on its own visual row. The closing comment
  // on its own line still terminates the paragraph: type-2 HTML blocks
  // (CommonMark §4.6) can interrupt an open paragraph, so the closing marker
  // does not get pulled into the body the way the legacy `[stamp-end]:` link
  // reference definition did.
  const HB = "  ";
  return [
    "<!-- stamp:start -->",
    `${dateStr}${HB}`,
    `${timeStr}${HB}`,
    `experiment: ${experimentName}${HB}`,
    `project folder: ${projectFolder}${HB}`,
    "<!-- stamp:end -->",
    "___",
  ].join("\n");
}

export function generateLastAccess(): string {
  const now = new Date().toISOString();
  return `[last-access]: # (${now})`;
}

export function generateReopenedStamp(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA");
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `___
*Reopened on ${dateStr} at ${timeStr}*
___`;
}

// ── Parsers ────────────────────────────────────────────────────────────────

/**
 * Parse the stamp metadata out of `content`. Accepts any of the four supported
 * boundary formats; returns `null` if no stamp is recognized.
 */
export function parseStamp(content: string): StampData | null {
  const match = content.match(stampBodyPattern(""));
  if (!match) return null;

  // The body capture is whichever group is defined for the matched alternative.
  const stampBody = match.slice(1).find((g) => typeof g === "string");
  if (typeof stampBody !== "string") return null;

  const lines = stampBody
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 4) return null;

  let experimentName = "";
  let projectFolder = "";
  for (const line of lines) {
    if (line.startsWith("experiment:")) {
      experimentName = line.replace("experiment:", "").trim();
    } else if (line.startsWith("project folder:")) {
      projectFolder = line.replace("project folder:", "").trim();
    }
  }

  return {
    date: lines[0] || "",
    time: lines[1] || "",
    experimentName,
    projectFolder,
  };
}

export function parseLastAccess(content: string): string | null {
  for (const pattern of LAST_ACCESS_CAPTURE) {
    const m = content.match(pattern);
    if (m && m[1]) return m[1];
  }
  return null;
}

export function shouldAddReopenedStamp(content: string): boolean {
  const lastAccessStr = parseLastAccess(content);
  if (!lastAccessStr) return false;
  try {
    const lastAccess = new Date(lastAccessStr);
    const now = new Date();
    return now.getTime() - lastAccess.getTime() > REOPEN_THRESHOLD_MS;
  } catch {
    return false;
  }
}

export function parseContent(content: string): ParsedContent {
  const stamp = parseStamp(content);
  const lastAccess = parseLastAccess(content);

  const reopenedRegex = /___\s*\n\*Reopened on[^*]+\*\s*\n___/g;
  const reopenedStamps: string[] = [];
  let m;
  while ((m = reopenedRegex.exec(content)) !== null) {
    reopenedStamps.push(m[0]);
  }

  const userContent = content
    .replace(stampBlockPattern("g"), "")
    .replace(lastAccessLinePattern("g"), "")
    .replace(/___\s*\n\*Reopened on[^*]+\*\s*\n___/g, "")
    .trim();

  return { stamp, lastAccess, reopenedStamps, content: userContent };
}

// ── In-place updates ───────────────────────────────────────────────────────

/**
 * Update the experiment name and project folder of the stamp in `content`,
 * preserving the existing date / time. Works on every supported format.
 */
export function updateStampNames(
  content: string,
  experimentName: string,
  projectFolder: string
): string {
  const whole = content.match(stampWholePattern());
  if (!whole) return content;

  const stampContent = whole.slice(1).find((g) => typeof g === "string");
  if (typeof stampContent !== "string") return content;

  const updated = stampContent
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("experiment:")) {
        // Preserve trailing two-space line break (matches the renderer's
        // expectation for hard breaks inside the body paragraph).
        const hasHardBreak = line.endsWith("  ");
        return `experiment: ${experimentName}${hasHardBreak ? "  " : ""}`;
      }
      if (trimmed.startsWith("project folder:")) {
        const hasHardBreak = line.endsWith("  ");
        return `project folder: ${projectFolder}${hasHardBreak ? "  " : ""}`;
      }
      return line;
    })
    .join("\n");

  return content.replace(stampContent, updated);
}

export function updateLastAccess(content: string): string {
  const now = new Date().toISOString();
  const newLastAccess = `[last-access]: # (${now})`;

  let updated = content.replace(lastAccessLinePattern("g"), "");

  const stampEnd = updated.match(stampEndAnchorPattern());
  if (stampEnd) {
    updated = updated.replace(stampEnd[1], stampEnd[1] + newLastAccess + "\n");
  } else {
    updated = newLastAccess + "\n" + updated;
  }

  return updated;
}

export function addReopenedStamp(content: string): string {
  const reopenedStamp = generateReopenedStamp();

  const lastAccessRe = lastAccessLinePattern("");
  const lastAccess = content.match(lastAccessRe);
  if (lastAccess) {
    return content.replace(lastAccess[0], lastAccess[0] + reopenedStamp + "\n");
  }

  const stampEnd = content.match(stampEndAnchorPattern());
  if (stampEnd) {
    return content.replace(stampEnd[1], stampEnd[1] + reopenedStamp + "\n");
  }

  return reopenedStamp + "\n" + content;
}

// ── Lazy normalization ─────────────────────────────────────────────────────

/**
 * Detect whether the file's stamp is in a legacy format. Returns `true` if
 * there's a stamp present and it's not the current (HTML-comment) format.
 *
 * Used by the eager Settings repair button and the lazy-normalize boundary
 * before saving — callers can decide whether to bother rewriting on disk.
 */
export function hasLegacyStampFormat(content: string): boolean {
  if (!content) return false;
  // The new format wins. If we can find it, nothing to do.
  if (STAMP_BOUNDARIES[0].start.test(content) && STAMP_BOUNDARIES[0].end.test(content)) {
    return false;
  }
  // Any other format with both start and end is a legacy stamp.
  for (let i = 1; i < STAMP_BOUNDARIES.length; i += 1) {
    const { start, end } = STAMP_BOUNDARIES[i];
    if (start.test(content) && end.test(content)) return true;
  }
  return false;
}

/**
 * Rewrite a legacy stamp into the canonical (HTML-comment) format, preserving
 * the existing date / time / experiment / project values. Safe to run on
 * content with no stamp (returns input unchanged) or content that's already
 * in the new format (returns input unchanged).
 */
export function normalizeStampFormat(content: string): string {
  if (!content) return content;
  if (!hasLegacyStampFormat(content)) return content;

  const stamp = parseStamp(content);
  if (!stamp) return content;

  // Find which legacy block to replace (the whole `start … end ___` chunk).
  const blockRe = stampBlockPattern("");
  const blockMatch = content.match(blockRe);
  if (!blockMatch) return content;

  const HB = "  ";
  const newBlock =
    [
      "<!-- stamp:start -->",
      `${stamp.date}${HB}`,
      `${stamp.time}${HB}`,
      `experiment: ${stamp.experimentName}${HB}`,
      `project folder: ${stamp.projectFolder}${HB}`,
      "<!-- stamp:end -->",
      "___",
    ].join("\n") + "\n";

  // `blockMatch[0]` includes the trailing `___\n?`, so we replace the whole
  // span and append the rebuilt block (which also ends with `___\n`).
  return content.replace(blockMatch[0], newBlock);
}

// ── File scaffolding ───────────────────────────────────────────────────────

/**
 * Create a fresh file body with a stamp, last-access marker, and an H1 header.
 *
 * `type === 'method'` is used by newly-created method markdown files in the
 * methods library; falls back to `'notes'`-style header content.
 */
export function createNewFileContent(
  experimentName: string,
  projectFolder: string,
  type: "notes" | "results" | "method" = "notes"
): string {
  const stamp = generateStamp(experimentName, projectFolder);
  const lastAccess = generateLastAccess();
  const header =
    type === "notes"
      ? `# Lab Notes: ${experimentName}`
      : type === "results"
        ? `# Results: ${experimentName}`
        : `# ${experimentName}`;

  return `${stamp}
${lastAccess}

${header}
`;
}

/**
 * Render the stamp for the live preview banner (header + four lines). Used
 * when the editor wants to display the stamp values without touching the
 * underlying markdown file.
 */
export function renderStampDisplay(
  stamp: StampData,
  currentExperimentName: string,
  currentProjectFolder: string,
  type: "notes" | "results" | "method" = "notes"
): string {
  const header =
    type === "notes"
      ? `# Lab Notes: ${currentExperimentName}`
      : type === "results"
        ? `# Results: ${currentExperimentName}`
        : `# ${currentExperimentName}`;

  const HB = "  ";
  return [
    `${stamp.date}${HB}`,
    `${stamp.time}${HB}`,
    `experiment: ${currentExperimentName}${HB}`,
    `project folder: ${currentProjectFolder}${HB}`,
    "___",
    header,
  ].join("\n");
}
