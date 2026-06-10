/**
 * code-languages.ts: the code-block LANGUAGE PICKER data + fence-insertion math.
 *
 * The inline (CM6) markdown editor inserts a fenced code block on
 * Mod-Shift-c (the code-fence combo) and from the Style Guide rail's
 * "Code block" entry. Both paths open a small searchable language picker; the
 * chosen language is written onto the opening fence (e.g. ```python) so the
 * rehypeHighlight preview colorizes the block.
 *
 * This module is the pure, React-free core shared by the picker popup
 * (CodeLanguagePicker.tsx) and the editor (InlineMarkdownEditor.tsx):
 *   - COMMON_LANGUAGES: the searchable list (label + fence code + aliases),
 *     ported verbatim from the pre-migration HybridMarkdownEditor.
 *   - filterLanguages(): the label / code / alias substring filter.
 *   - buildFencedCodeInsertion(): the fenced-block string + caret math for a
 *     given language and (optional) selected body text.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

export interface CodeLanguage {
  /** The token written onto the opening fence (```<code>). Empty for plain. */
  code: string;
  /** The human label shown in the picker. */
  label: string;
  /** Extra search terms (file extensions / common short names). */
  aliases: string[];
}

/**
 * The ~21 common languages, ported verbatim from the pre-migration
 * HybridMarkdownEditor so the picker offers the same set Grant remembers. The
 * "Plain Text" entry carries an empty code so selecting it writes a bare ```
 * fence (no language token), matching the historical no-language behavior.
 */
export const COMMON_LANGUAGES: CodeLanguage[] = [
  { code: "javascript", label: "JavaScript", aliases: ["js"] },
  { code: "typescript", label: "TypeScript", aliases: ["ts"] },
  { code: "python", label: "Python", aliases: ["py"] },
  { code: "bash", label: "Bash/Shell", aliases: ["sh", "shell"] },
  { code: "json", label: "JSON", aliases: [] },
  { code: "html", label: "HTML", aliases: [] },
  { code: "css", label: "CSS", aliases: [] },
  { code: "sql", label: "SQL", aliases: [] },
  { code: "java", label: "Java", aliases: [] },
  { code: "c", label: "C", aliases: [] },
  { code: "cpp", label: "C++", aliases: ["c++"] },
  { code: "csharp", label: "C#", aliases: ["c#", "cs"] },
  { code: "go", label: "Go", aliases: ["golang"] },
  { code: "rust", label: "Rust", aliases: ["rs"] },
  { code: "ruby", label: "Ruby", aliases: ["rb"] },
  { code: "php", label: "PHP", aliases: [] },
  { code: "swift", label: "Swift", aliases: [] },
  { code: "kotlin", label: "Kotlin", aliases: [] },
  { code: "yaml", label: "YAML", aliases: ["yml"] },
  { code: "markdown", label: "Markdown", aliases: ["md"] },
  { code: "dockerfile", label: "Dockerfile", aliases: [] },
  { code: "plaintext", label: "Plain Text", aliases: ["text", "none"] },
];

/**
 * Filter COMMON_LANGUAGES by a case-insensitive substring match against the
 * label, the fence code, OR any alias. An empty / whitespace-only search
 * returns the full list (the picker shows everything before the user types).
 */
export function filterLanguages(search: string): CodeLanguage[] {
  const q = search.trim().toLowerCase();
  if (!q) return COMMON_LANGUAGES;
  return COMMON_LANGUAGES.filter(
    (lang) =>
      lang.label.toLowerCase().includes(q) ||
      lang.code.toLowerCase().includes(q) ||
      lang.aliases.some((alias) => alias.toLowerCase().includes(q)),
  );
}

/**
 * The "Plain Text" sentinel: selecting it writes a bare ``` fence with no
 * language token. Any language whose code is empty OR equals this is treated as
 * plain, so the on-disk fence stays exactly ``` (the historical default).
 */
export const PLAIN_TEXT_CODE = "plaintext";

/**
 * Whether a Style Guide click-to-insert snippet is the "insert a code block"
 * request (a bare fenced block with no language). The editor intercepts this so
 * the toolbar entry opens the language picker instead of splicing a bare fence,
 * matching the keyboard shortcut. Recognizes a snippet whose first line is a
 * lone opening fence with no language token and that contains a closing fence.
 */
export function isCodeBlockInsertSyntax(syntax: string): boolean {
  const lines = syntax.split("\n");
  if (lines.length < 2) return false;
  // First line is exactly the opening fence with no language token.
  if (lines[0].trim() !== "```") return false;
  // A later line is a lone closing fence.
  return lines.slice(1).some((line) => line.trim() === "```");
}

/** Whether a fence code means "no language token on the fence". */
function isPlain(code: string): boolean {
  return code === "" || code === PLAIN_TEXT_CODE;
}

export interface FencedCodeInsertion {
  /** The full fenced block to splice in at the selection. */
  insert: string;
  /** Caret/selection start offset, relative to the insertion's start (`from`). */
  selFrom: number;
  /** Caret/selection end offset, relative to the insertion's start (`from`). */
  selTo: number;
}

/**
 * Build the fenced-block insertion for a chosen language and (optional) selected
 * body text, plus the caret math. Offsets are RELATIVE to the start of the
 * insertion so the caller can add its own range.from.
 *
 * The produced fence is:
 *   ```<lang>\n<body>\n```
 * where <lang> is the language code ("" for Plain Text, yielding a bare ```
 * fence). With no selected body the caret lands on the (empty) body line ready
 * to type; with a selected body the body stays selected, offset past the
 * opening fence line.
 */
export function buildFencedCodeInsertion(
  selectedText: string,
  code: string,
): FencedCodeInsertion {
  const lang = isPlain(code) ? "" : code;
  const insert = "```" + lang + "\n" + selectedText + "\n```";
  // Body line starts after the opening fence (3 backticks + the language token)
  // and its trailing newline.
  const bodyStart = 3 + lang.length + 1;
  return {
    insert,
    selFrom: bodyStart,
    selTo: bodyStart + selectedText.length,
  };
}
