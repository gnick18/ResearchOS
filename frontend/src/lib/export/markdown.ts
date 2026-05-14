import { parseContent } from "@/lib/stamp-utils";

// Matches markdown image / file refs. Lazy `[^)\n]+?` instead of `[^)\s]+`
// so filenames with spaces survive (mirrors `IMG_REF_REGEX` in
// `lib/attachments/gc.ts`). The HTML form `<img src="...">` is handled too —
// inline pasted HTML images would otherwise be missed.
const MD_REF_REGEX = /!?\[[^\]]*\]\(([^)\n]+?)\)/g;
const HTML_IMG_REF_REGEX = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;

/**
 * Heuristic: does this markdown have any user content beyond the default
 * "# Lab Notes: …" / "# Results: …" stamp header? Used by format generators
 * to skip empty notes/results sections.
 */
export function hasUserContent(content: string | null | undefined): boolean {
  if (!content || !content.trim()) return false;
  const parsed = parseContent(content);
  const userContent = parsed.content.trim();
  if (!userContent) return false;
  const headerOnlyPattern = /^#\s+(Lab Notes|Results):\s+.+\s*$/i;
  if (headerOnlyPattern.test(userContent.trim())) return false;
  return true;
}

/**
 * Strip stamp metadata, returning just the user-authored body. Used by all
 * formats except `raw` (which keeps the raw stamped markdown verbatim).
 */
export function extractUserContent(content: string | null | undefined): string {
  if (!content) return "";
  const parsed = parseContent(content);
  return parsed.content.trim();
}

function parseCandidateRef(raw: string): string | null {
  let src = raw.trim();
  // Strip CommonMark title: `url "title"` or `url 'title'`.
  const titleMatch = src.match(/^(.+?)\s+["'].*["']\s*$/);
  if (titleMatch) src = titleMatch[1].trim();
  // Strip angle brackets (bracketed-URL form, used for safe whitespace).
  if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1);
  if (src.startsWith("./")) src = src.slice(2);
  // Drop query/anchor noise.
  return src.split("#")[0].split("?")[0] || null;
}

/**
 * Return the set of basenames referenced by `markdown` for the given
 * subdirectory. Tolerates both same-folder (`Images/foo.png`) and
 * subfolder-style (`Images/some-day/foo.png`) refs — both protect the
 * top-level `foo.png` from being treated as orphaned, matching the GC
 * convention in `lib/attachments/gc.ts`.
 */
export function extractMarkdownRefs(
  markdown: string,
  subdir: "Images" | "Files"
): Set<string> {
  const prefix = `${subdir}/`;
  const referenced = new Set<string>();
  const collect = (regex: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(markdown)) !== null) {
      const cleaned = parseCandidateRef(m[1]);
      if (!cleaned) continue;
      if (!cleaned.includes(prefix)) continue;
      const afterPrefix = cleaned.slice(cleaned.indexOf(prefix) + prefix.length);
      if (!afterPrefix) continue;
      const segments = afterPrefix.split("/").filter(Boolean);
      const basename = segments[segments.length - 1];
      if (basename) referenced.add(basename);
    }
  };
  collect(new RegExp(MD_REF_REGEX.source, "g"));
  collect(new RegExp(HTML_IMG_REF_REGEX.source, "gi"));
  return referenced;
}

export interface MarkdownRefInfo {
  subdir: "Images" | "Files";
  basename: string;
  /** The raw ref text as it appeared inside `(...)` — useful when the
   *  rewriter needs to detect query strings, fragments, or title segments. */
  original: string;
}

/**
 * Pure rewrite helper: walk every `![alt](Images/foo.png)` / `[label](Files/bar.pdf)`
 * (plus inline `<img src=...>`) ref in `markdown` and replace the URL with
 * whatever `rewrite` returns. Refs that don't sit under an `Images/` or
 * `Files/` prefix are left untouched. The rewriter is given the resolved
 * basename so it can map straight to a zip-internal path without re-parsing.
 */
export function rewriteMarkdownRefs(
  markdown: string,
  rewrite: (ref: MarkdownRefInfo) => string
): string {
  const rewriteUrl = (raw: string): string => {
    const cleaned = parseCandidateRef(raw);
    if (!cleaned) return raw;
    for (const subdir of ["Images", "Files"] as const) {
      const prefix = `${subdir}/`;
      if (!cleaned.includes(prefix)) continue;
      const afterPrefix = cleaned.slice(cleaned.indexOf(prefix) + prefix.length);
      if (!afterPrefix) continue;
      const segments = afterPrefix.split("/").filter(Boolean);
      const basename = segments[segments.length - 1];
      if (!basename) continue;
      return rewrite({ subdir, basename, original: raw });
    }
    return raw;
  };

  // Markdown `![alt](url)` and `[label](url)` — preserve the leading `!` and
  // label text.
  const mdRewritten = markdown.replace(
    /(!?\[[^\]]*\])\(([^)\n]+?)\)/g,
    (_match, prefix: string, url: string) => `${prefix}(${rewriteUrl(url)})`
  );

  // Inline HTML `<img src="...">` form.
  return mdRewritten.replace(
    /(<img\s+[^>]*src=)(["'])([^"']+)(["'])/gi,
    (_match, lead: string, q1: string, url: string, q2: string) =>
      `${lead}${q1}${rewriteUrl(url)}${q2}`
  );
}
