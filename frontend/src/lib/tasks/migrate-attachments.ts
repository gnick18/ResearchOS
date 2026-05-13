import { fileService } from "../file-system/file-service";
import { fetchAllTasksIncludingShared } from "../local-api";
import { getCurrentUserCached } from "../storage/json-store";
import { taskNotesBase, taskResultsBase, taskResultsTabBase } from "./results-paths";
import type { Task } from "../types";

export interface AttachmentsMigrationResult {
  /** Files moved out of Attachments/ into Files/. */
  moved: number;
  /** Files that failed to copy/delete. */
  failed: number;
  /** Whether the markdown content was rewritten (caller should persist). */
  contentRewritten: boolean;
  /** The (possibly rewritten) markdown content. */
  content: string;
}

function splitFilenameExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

async function pickUniqueFilename(dirPath: string, desired: string): Promise<string> {
  const { stem, ext } = splitFilenameExt(desired);
  let candidate = desired;
  let n = 1;
  while (await fileService.fileExists(`${dirPath}/${candidate}`)) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

/**
 * Move every file under `${basePath}/Attachments/` into `${basePath}/Files/`,
 * handling filename collisions by suffixing `-1`, `-2`, … Also rewrites the
 * provided markdown so any `(Attachments/foo.pdf)` references point at the
 * new `Files/foo.pdf` (or whatever collision-resolved name was picked).
 *
 * Safe to call on tasks that have no `Attachments/` folder — returns a
 * zero-count summary and the input content unchanged.
 *
 * This is the per-task helper. Both the lazy read-boundary (in
 * `TaskDetailPopup` / `LabNotesTab` / `ResultsTab`) and the eager Settings
 * "Repair attachment paths" button call into it.
 */
export async function migrateTaskAttachmentsToFiles(
  basePath: string,
  markdownContent: string
): Promise<AttachmentsMigrationResult> {
  const attachDir = `${basePath}/Attachments`;
  const filesDir = `${basePath}/Files`;

  let names: string[] = [];
  try {
    names = await fileService.listFiles(attachDir);
  } catch {
    return { moved: 0, failed: 0, contentRewritten: false, content: markdownContent };
  }
  const real = names.filter((n) => !n.startsWith("."));
  if (real.length === 0) {
    return { moved: 0, failed: 0, contentRewritten: false, content: markdownContent };
  }

  let moved = 0;
  let failed = 0;
  let content = markdownContent;
  let contentRewritten = false;

  for (const name of real) {
    try {
      const finalName = await pickUniqueFilename(filesDir, name);
      const blob = await fileService.readFileAsBlob(`${attachDir}/${name}`);
      if (!blob) {
        failed += 1;
        continue;
      }
      await fileService.writeFileFromBlob(`${filesDir}/${finalName}`, blob);
      await fileService.deleteFile(`${attachDir}/${name}`);

      // Rewrite markdown refs. `Attachments/${name}` → `Files/${finalName}`.
      // Plain string replace (filenames don't have regex metacharacters that
      // matter at this granularity, and `split().join()` covers every
      // occurrence without needing escaping).
      const oldRef = `Attachments/${name}`;
      const newRef = `Files/${finalName}`;
      if (content.includes(oldRef)) {
        content = content.split(oldRef).join(newRef);
        contentRewritten = true;
      }
      moved += 1;
    } catch {
      failed += 1;
    }
  }

  return { moved, failed, contentRewritten, content };
}

export interface AttachmentsRepairSummary {
  scanned: number;
  repaired: number;
  alreadyCorrect: number;
  failed: number;
}

/**
 * Eager repair: walk every task in the current user's directory, migrate any
 * `Attachments/` content into `Files/`, and rewrite the per-task markdown
 * (`notes.md` + `results.md`) refs in place. The lazy boundary handles single
 * tasks on demand; this button finishes the long tail.
 *
 * Counters:
 *  - `scanned`: total task dirs checked.
 *  - `repaired`: dirs that had at least one file moved out of Attachments/.
 *  - `alreadyCorrect`: dirs with no Attachments/ folder (or an empty one).
 *  - `failed`: dirs where the migration threw for at least one file.
 */
export async function repairAttachmentPaths(): Promise<AttachmentsRepairSummary> {
  const summary: AttachmentsRepairSummary = {
    scanned: 0,
    repaired: 0,
    alreadyCorrect: 0,
    failed: 0,
  };

  // Walk every task in the user's directory plus tasks shared from other
  // users (so a receiver with edit permission can clean up a task whose
  // Attachments/ live in the owner's tree). `fetchAllIncludingShared` covers
  // both lanes already.
  let tasks: Array<{ id: number; owner: string }> = [];
  try {
    tasks = await fetchAllTasksIncludingShared();
  } catch {
    return summary;
  }

  for (const task of tasks) {
    summary.scanned += 1;
    const basePath = taskResultsBase(task);

    let attachmentsHadAnything = false;
    try {
      const names = await fileService.listFiles(`${basePath}/Attachments`);
      attachmentsHadAnything = names.some((n) => !n.startsWith("."));
    } catch {
      attachmentsHadAnything = false;
    }

    if (!attachmentsHadAnything) {
      summary.alreadyCorrect += 1;
      continue;
    }

    // Load and rewrite both markdown files so refs stay in sync with the move.
    for (const mdName of ["results.md", "notes.md"] as const) {
      const mdPath = `${basePath}/${mdName}`;
      let original = "";
      try {
        const blob = await fileService.readFileAsBlob(mdPath);
        if (blob) original = await blob.text();
      } catch {
        original = "";
      }
      // The first iteration moves files; subsequent iterations on the same
      // basePath are no-ops (Attachments/ is empty), so only the markdown
      // rewrite path runs for the second file.
      const result = await migrateTaskAttachmentsToFiles(basePath, original);
      if (result.failed > 0) summary.failed += 1;
      if (result.contentRewritten) {
        try {
          await fileService.writeFileFromBlob(
            mdPath,
            new Blob([result.content], { type: "text/markdown" })
          );
        } catch {
          summary.failed += 1;
        }
      }
    }
    summary.repaired += 1;
  }

  return summary;
}

// ── Split shared `Files/`+`Images/` into per-tab scoped folders ─────────────

/** Per-tab summary of the split operation for a single task. */
export interface SplitAttachmentsResult {
  /** Rewritten notes.md content (or the input unchanged). */
  notesContent: string;
  /** Rewritten results.md content (or the input unchanged). */
  resultsContent: string;
  notesContentRewritten: boolean;
  resultsContentRewritten: boolean;
  /** Basenames copied into `${notesBase}/Files`. */
  copiedToNotesFiles: string[];
  /** Basenames copied into `${notesBase}/Images`. */
  copiedToNotesImages: string[];
  /** Basenames copied into `${resultsBase}/Files`. */
  copiedToResultsFiles: string[];
  /** Basenames copied into `${resultsBase}/Images`. */
  copiedToResultsImages: string[];
  /** Basenames present in BOTH notes.md and results.md refs — copied to both
   *  scoped folders so each tab body remains self-contained. */
  duplicatedAcrossTabs: string[];
  /** Files in the legacy shared folder not referenced by either body. Left
   *  in place (per spec: don't delete during migration). */
  legacyOrphans: string[];
  /** Per-file copy failures. */
  failed: number;
}

interface AttachmentRef {
  /** "Files" or "Images". */
  subdir: "Files" | "Images";
  /** Basename only, e.g. `foo.pdf`. */
  basename: string;
  /** The exact src string as it appears in markdown — used for rewriting. */
  rawSrc: string;
}

// Markdown image: ![alt](src "title"?). Note `!?` so we also match plain links
// (used for non-image attachments like PDFs).
const MD_LINK_REGEX = /(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const HTML_IMG_REGEX = /<img\s+([^>]*?)src=["']([^"']+)["']([^>]*?)\/?>/gi;

/**
 * Pull every attachment reference out of a markdown body and classify it as
 * Files/ or Images/, capturing only the basename. Handles canonical
 * `Images/foo`, legacy `../../Images/foo`, `./Images/foo`, and HTML <img>
 * tags. Returns refs in the order they appear so callers can rewrite the
 * markdown deterministically.
 */
function extractAttachmentRefs(markdown: string): AttachmentRef[] {
  const refs: AttachmentRef[] = [];

  const classify = (src: string): AttachmentRef | null => {
    const trimmed = src.split("#")[0].split("?")[0];
    let rest: string;
    let subdir: "Files" | "Images";
    if (trimmed.startsWith("../../Files/")) {
      rest = trimmed.slice("../../Files/".length);
      subdir = "Files";
    } else if (trimmed.startsWith("../../Images/")) {
      rest = trimmed.slice("../../Images/".length);
      subdir = "Images";
    } else if (trimmed.startsWith("./Files/")) {
      rest = trimmed.slice("./Files/".length);
      subdir = "Files";
    } else if (trimmed.startsWith("./Images/")) {
      rest = trimmed.slice("./Images/".length);
      subdir = "Images";
    } else if (trimmed.startsWith("Files/")) {
      rest = trimmed.slice("Files/".length);
      subdir = "Files";
    } else if (trimmed.startsWith("Images/")) {
      rest = trimmed.slice("Images/".length);
      subdir = "Images";
    } else {
      return null;
    }
    // Use the last segment as the basename. Legacy refs like
    // `Images/{folder}/{name}` still protect the top-level basename — that's
    // the same convention `referencedRelativeNames` in attachments/gc.ts uses.
    const segments = rest.split("/").filter(Boolean);
    const basename = segments[segments.length - 1];
    if (!basename) return null;
    return { subdir, basename, rawSrc: src };
  };

  // Snapshot matches first to avoid the regex `lastIndex` interleaving when
  // both global regexes share state on the same string.
  const mdMatches = [...markdown.matchAll(MD_LINK_REGEX)];
  for (const m of mdMatches) {
    const src = m[3];
    const ref = classify(src);
    if (ref) refs.push(ref);
  }
  const htmlMatches = [...markdown.matchAll(HTML_IMG_REGEX)];
  for (const m of htmlMatches) {
    const src = m[2];
    const ref = classify(src);
    if (ref) refs.push(ref);
  }
  return refs;
}

/**
 * Rewrite every Files/Images ref in markdown to the canonical
 * `Files/{basename}` / `Images/{basename}` form (no `../` traversal, no
 * subdirectory segments). Idempotent on already-canonical refs.
 */
function rewriteRefsToCanonical(markdown: string): { content: string; changed: boolean } {
  let changed = false;

  const rewriteSrc = (src: string): string | null => {
    // Preserve any query/anchor noise that callers might rely on.
    const hashIdx = src.indexOf("#");
    const queryIdx = src.indexOf("?");
    const splitAt = [hashIdx, queryIdx].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), src.length);
    const pathPart = src.slice(0, splitAt);
    const suffix = src.slice(splitAt);

    let rest: string;
    let subdir: "Files" | "Images";
    if (pathPart.startsWith("../../Files/")) {
      rest = pathPart.slice("../../Files/".length);
      subdir = "Files";
    } else if (pathPart.startsWith("../../Images/")) {
      rest = pathPart.slice("../../Images/".length);
      subdir = "Images";
    } else if (pathPart.startsWith("./Files/")) {
      rest = pathPart.slice("./Files/".length);
      subdir = "Files";
    } else if (pathPart.startsWith("./Images/")) {
      rest = pathPart.slice("./Images/".length);
      subdir = "Images";
    } else if (pathPart.startsWith("Files/")) {
      rest = pathPart.slice("Files/".length);
      subdir = "Files";
    } else if (pathPart.startsWith("Images/")) {
      rest = pathPart.slice("Images/".length);
      subdir = "Images";
    } else {
      return null;
    }
    const segments = rest.split("/").filter(Boolean);
    const basename = segments[segments.length - 1];
    if (!basename) return null;
    const canonical = `${subdir}/${basename}${suffix}`;
    return canonical === src ? null : canonical;
  };

  const out = markdown
    .replace(MD_LINK_REGEX, (full, bang: string, alt: string, src: string, title?: string) => {
      const replacement = rewriteSrc(src);
      if (replacement == null) return full;
      changed = true;
      return `${bang}[${alt}](${replacement}${title ?? ""})`;
    })
    .replace(HTML_IMG_REGEX, (full, pre: string, src: string, post: string) => {
      const replacement = rewriteSrc(src);
      if (replacement == null) return full;
      changed = true;
      return `<img ${pre}src="${replacement}"${post}>`;
    });

  return { content: out, changed };
}

async function copyIfExists(
  fromPath: string,
  toPath: string
): Promise<"copied" | "missing" | "failed"> {
  if (await fileService.fileExists(toPath)) return "copied"; // already in place — treat as success
  const blob = await fileService.readFileAsBlob(fromPath);
  if (!blob) return "missing";
  try {
    await fileService.writeFileFromBlob(toPath, blob);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * Per-task migrator: copy every Files/Images ref out of the legacy shared
 * folder into the per-tab scoped folder for the body that references it.
 * A file referenced by BOTH bodies is duplicated to both new folders so each
 * tab body stays self-contained (the disk cost is dwarfed by the UX win).
 *
 * Also runs an Attachments/→Files/ migration first so the rare case of "user
 * never ran the previous repair button" still works end-to-end in one click.
 *
 * Returns rewritten bodies; the CALLER is responsible for persisting them.
 * That keeps this helper usable from both the eager Settings button (which
 * writes back) and the lazy on-write path in TaskDetailPopup (which already
 * has its own write-back flow).
 */
export async function splitTaskAttachments(
  task: Pick<Task, "id" | "owner">,
  notesContent: string,
  resultsContent: string
): Promise<SplitAttachmentsResult> {
  const outerBase = taskResultsBase(task);
  const notesTabBase = taskNotesBase(task);
  const resultsTabBase = taskResultsTabBase(task);

  // Step 0: handle the rare double-legacy case (Attachments/ still around)
  // by first folding Attachments/ into the shared Files/ at the outer base.
  // Cheap no-op when no Attachments/ folder exists.
  const attachMig1 = await migrateTaskAttachmentsToFiles(outerBase, notesContent);
  const notesAfterAttach = attachMig1.contentRewritten ? attachMig1.content : notesContent;
  const attachMig2 = await migrateTaskAttachmentsToFiles(outerBase, resultsContent);
  const resultsAfterAttach = attachMig2.contentRewritten ? attachMig2.content : resultsContent;

  // Step 1: collect refs from each body. Use a Set keyed by `subdir|basename`
  // so duplicate references in the same body collapse.
  const collectKeys = (refs: AttachmentRef[]): Set<string> => {
    const out = new Set<string>();
    for (const r of refs) out.add(`${r.subdir}|${r.basename}`);
    return out;
  };
  const notesRefs = collectKeys(extractAttachmentRefs(notesAfterAttach));
  const resultsRefs = collectKeys(extractAttachmentRefs(resultsAfterAttach));

  // Step 2: copy each referenced file from the legacy shared folder into the
  // per-tab scoped folder. Track per-tab counts.
  const summary: SplitAttachmentsResult = {
    notesContent: notesAfterAttach,
    resultsContent: resultsAfterAttach,
    notesContentRewritten: attachMig1.contentRewritten,
    resultsContentRewritten: attachMig2.contentRewritten,
    copiedToNotesFiles: [],
    copiedToNotesImages: [],
    copiedToResultsFiles: [],
    copiedToResultsImages: [],
    duplicatedAcrossTabs: [],
    legacyOrphans: [],
    failed: 0,
  };

  const inBoth = new Set<string>();
  for (const k of notesRefs) {
    if (resultsRefs.has(k)) inBoth.add(k);
  }

  // Files actually present on disk in the legacy shared folder — used at the
  // end to figure out which files are orphans (referenced by neither body).
  const legacyOnDisk = new Map<"Files" | "Images", Set<string>>([
    ["Files", new Set()],
    ["Images", new Set()],
  ]);
  for (const subdir of ["Files", "Images"] as const) {
    try {
      const names = await fileService.listFiles(`${outerBase}/${subdir}`);
      for (const n of names) {
        if (!n.startsWith(".")) legacyOnDisk.get(subdir)!.add(n);
      }
    } catch {
      // Folder absent — fine.
    }
  }

  const copyForTab = async (
    key: string,
    tabBase: string,
    intoFiles: string[],
    intoImages: string[]
  ): Promise<void> => {
    const [subdir, basename] = key.split("|", 2) as ["Files" | "Images", string];
    const fromPath = `${outerBase}/${subdir}/${basename}`;
    const toPath = `${tabBase}/${subdir}/${basename}`;
    // If the file is already in the scoped folder (e.g. user already migrated
    // partially), treat it as a success without re-copying.
    if (await fileService.fileExists(toPath)) {
      if (subdir === "Files") intoFiles.push(basename);
      else intoImages.push(basename);
      return;
    }
    const result = await copyIfExists(fromPath, toPath);
    if (result === "copied") {
      if (subdir === "Files") intoFiles.push(basename);
      else intoImages.push(basename);
    } else if (result === "failed") {
      summary.failed += 1;
    }
    // "missing" → source not on disk; the ref is a dangling pointer. Skip
    // silently (the markdown rewrite will still happen).
  };

  for (const k of notesRefs) {
    await copyForTab(k, notesTabBase, summary.copiedToNotesFiles, summary.copiedToNotesImages);
  }
  for (const k of resultsRefs) {
    await copyForTab(k, resultsTabBase, summary.copiedToResultsFiles, summary.copiedToResultsImages);
  }
  for (const k of inBoth) {
    const [, basename] = k.split("|", 2);
    summary.duplicatedAcrossTabs.push(basename);
  }

  // Step 3: rewrite markdown bodies to canonical relative form. This drops
  // `../../` traversal and any subdirectory segments so each body's refs
  // resolve cleanly against its own tab base.
  const notesRewrite = rewriteRefsToCanonical(notesAfterAttach);
  if (notesRewrite.changed) {
    summary.notesContent = notesRewrite.content;
    summary.notesContentRewritten = true;
  }
  const resultsRewrite = rewriteRefsToCanonical(resultsAfterAttach);
  if (resultsRewrite.changed) {
    summary.resultsContent = resultsRewrite.content;
    summary.resultsContentRewritten = true;
  }

  // Step 4: flag orphans in the legacy shared folder. We don't delete them
  // (per spec — too easy to lose user data); the GC sweep or the user can
  // clean up later.
  for (const subdir of ["Files", "Images"] as const) {
    const onDisk = legacyOnDisk.get(subdir)!;
    for (const name of onDisk) {
      const key = `${subdir}|${name}`;
      if (!notesRefs.has(key) && !resultsRefs.has(key)) {
        summary.legacyOrphans.push(`${subdir}/${name}`);
      }
    }
  }

  return summary;
}

/**
 * Eager repair: walk every task owned by the current user, split its shared
 * legacy `Files/`+`Images/` into per-tab scoped folders, and persist the
 * rewritten markdown bodies. Mirrors `repairAttachmentPaths` in shape and
 * reporting.
 *
 * Skips shared-from-others tasks (per spec — their lazy normalize handles
 * the read side; the receiver can't safely write to the owner's directory
 * from a generic repair pass without coordination).
 */
export async function splitAllTaskAttachments(): Promise<AttachmentsRepairSummary> {
  const summary: AttachmentsRepairSummary = {
    scanned: 0,
    repaired: 0,
    alreadyCorrect: 0,
    failed: 0,
  };

  let tasks: Task[] = [];
  try {
    tasks = await fetchAllTasksIncludingShared();
  } catch {
    return summary;
  }

  // Limit to own tasks. Shared-from-others tasks lazy-normalize on the
  // receiver side at read; their attachments live in the owner's directory
  // and shouldn't be rewritten from here.
  const currentUser = (await getCurrentUserCached()) ?? "";
  const ownTasks = tasks.filter((t) => !t.is_shared_with_me && t.owner === currentUser);

  for (const task of ownTasks) {
    summary.scanned += 1;
    const outerBase = taskResultsBase(task);
    const notesTabBase = taskNotesBase(task);
    const resultsTabBase = taskResultsTabBase(task);

    // Skip if neither legacy nor any tab folder has shared content and
    // both .md files are absent. This is the "fresh task" case — nothing
    // to do.
    let needsAnyWork = false;
    for (const subdir of ["Files", "Images"] as const) {
      try {
        const names = await fileService.listFiles(`${outerBase}/${subdir}`);
        if (names.some((n) => !n.startsWith("."))) {
          needsAnyWork = true;
          break;
        }
      } catch {
        // not present
      }
    }
    if (!needsAnyWork) {
      try {
        const names = await fileService.listFiles(`${outerBase}/Attachments`);
        if (names.some((n) => !n.startsWith("."))) needsAnyWork = true;
      } catch {
        // not present
      }
    }
    if (!needsAnyWork) {
      summary.alreadyCorrect += 1;
      continue;
    }

    // Load both bodies. Missing bodies become empty strings — the splitter
    // still walks them safely.
    let notesContent = "";
    let resultsContent = "";
    try {
      const b = await fileService.readFileAsBlob(`${outerBase}/notes.md`);
      if (b) notesContent = await b.text();
    } catch {
      notesContent = "";
    }
    try {
      const b = await fileService.readFileAsBlob(`${outerBase}/results.md`);
      if (b) resultsContent = await b.text();
    } catch {
      resultsContent = "";
    }

    let taskFailed = false;
    try {
      const result = await splitTaskAttachments(task, notesContent, resultsContent);
      if (result.failed > 0) taskFailed = true;

      if (result.notesContentRewritten && notesContent) {
        try {
          await fileService.writeFileFromBlob(
            `${outerBase}/notes.md`,
            new Blob([result.notesContent], { type: "text/markdown" })
          );
        } catch {
          taskFailed = true;
        }
      }
      if (result.resultsContentRewritten && resultsContent) {
        try {
          await fileService.writeFileFromBlob(
            `${outerBase}/results.md`,
            new Blob([result.resultsContent], { type: "text/markdown" })
          );
        } catch {
          taskFailed = true;
        }
      }
    } catch {
      taskFailed = true;
    }

    if (taskFailed) summary.failed += 1;
    summary.repaired += 1;
    void notesTabBase;
    void resultsTabBase;
  }

  return summary;
}
