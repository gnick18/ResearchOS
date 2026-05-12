import { fileService } from "./file-service";

const MANAGED_HEADER = "# Managed by ResearchOS — patterns the app needs ignored.";

async function readGitignoreText(): Promise<string | null> {
  const blob = await fileService.readFileAsBlob(".gitignore");
  if (!blob) return null;
  return blob.text();
}

async function writeGitignoreText(text: string): Promise<void> {
  await fileService.writeFileFromBlob(".gitignore", new Blob([text], { type: "text/plain" }));
}

function hasPattern(existingLines: string[], pattern: string): boolean {
  return existingLines.some((line) => line.trim() === pattern);
}

/**
 * Append the given patterns to the data folder's `.gitignore` if not already
 * present. Idempotent — repeated calls add nothing when everything is
 * covered. Does not touch existing content beyond the appended section.
 *
 * Use this for any file the app writes that should never leave the local
 * device (bot tokens, OAuth secrets, etc.). The data folder may or may not
 * be a git repo, but writing the file is cheap and the entry is harmless if
 * git is never initialized there.
 */
export async function ensureGitignoreEntries(patterns: string[]): Promise<void> {
  const existing = await readGitignoreText();
  const existingLines = (existing ?? "").split(/\r?\n/);
  const missing = patterns.filter((p) => !hasPattern(existingLines, p));
  if (missing.length === 0) return;

  let next: string;
  if (existing === null) {
    next = `${MANAGED_HEADER}\n${missing.join("\n")}\n`;
  } else {
    const trailingNl = existing.endsWith("\n") ? "" : "\n";
    next = `${existing}${trailingNl}${missing.join("\n")}\n`;
  }
  await writeGitignoreText(next);
}
