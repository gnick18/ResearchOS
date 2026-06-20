// Cross-boundary sharing, the offline Recovery Kit (1Password Emergency Kit model).
//
// The encrypted key-backup blob normally lives ONLY in the directory and is
// reachable ONLY by proving the account email with a 6-digit code. A user who
// loses access to that email (very common for .edu addresses after graduation)
// cannot recover their identity even when they still hold their 12 recovery
// words. The Recovery Kit closes that gap. It is a downloadable file that carries
// the SAME encrypted blob the directory holds, so a user can recover fully
// offline with just their words, no email and no network.
//
// The blob is end-to-end encrypted by the recovery words (Argon2id +
// XChaCha20-Poly1305, see backup.ts), so the kit leaks nothing on its own. The
// kit deliberately NEVER contains the words. It is useless to anyone who does not
// already hold them.
//
// This module is pure. No React, no IndexedDB, no network. The only side effect
// is downloadRecoveryKit, which is browser-only and guarded.

import { parseKeyBackupField } from "./key-backup-envelope";

/**
 * The fields a Recovery Kit carries. `backupBlob` is the JSON string produced by
 * createIdentityMaterial (a serialized BackupBlob), the same value published to
 * the directory. email and fingerprint let the user (and the restore UI) confirm
 * which identity the kit belongs to. createdAt is an ISO timestamp.
 */
export interface RecoveryKitData {
  email: string;
  fingerprint: string;
  /**
   * The human recovery code (grouped Crockford base32, the same 128-bit secret as
   * the 12 words). Embedded in the kit so one downloaded file is everything the
   * user needs to recover, the 1Password Emergency Kit model. Optional so an old
   * v1 kit (which never carried it) still parses; a freshly built kit always sets
   * it. Because the code is in the file, the kit is now SENSITIVE, keep it private.
   */
  recoveryCode?: string;
  backupBlob: string;
  createdAt: string;
}

/**
 * The machine-readable payload embedded in the kit HTML and accepted as a raw
 * JSON string by parseRecoveryKit.
 */
interface RecoveryKitEnvelope {
  kind: "researchos-recovery-kit";
  version: 1 | 2;
  email: string;
  fingerprint: string;
  createdAt: string;
  /** Present from version 2 on. A v1 kit predates the embedded code. */
  recoveryCode?: string;
  backupBlob: string;
}

const KIT_KIND = "researchos-recovery-kit";
// Version 2 embeds the recovery code in the kit (one self-contained file). v1
// kits never carried it and still parse, parseRecoveryKit reads either.
const KIT_VERSION = 2;
const SCRIPT_ID = "researchos-recovery-kit";

/**
 * Escapes text for safe interpolation into HTML element bodies and attributes.
 * The email and fingerprint are user-influenced, so they pass through this before
 * landing in the human-readable HTML.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes a JSON string for safe embedding inside a <script> element. The only
 * sequence that can break out of a script body is a literal "</", so we neutralize
 * it. JSON.stringify already handles quotes and control characters.
 */
function escapeForScript(json: string): string {
  return json.replace(/<\//g, "<\\/");
}

/**
 * Formats an ISO timestamp into a friendly date for the printed kit. Falls back
 * to the raw value if it does not parse, so a malformed timestamp never throws.
 */
function friendlyDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Builds a self-contained, printable HTML document for the Recovery Kit. The
 * document is human-readable (title, identity details, plain-language guidance,
 * and a blank area to hand-write the 12 words) AND machine-parseable (a JSON
 * envelope inside a <script type="application/json"> block that parseRecoveryKit
 * reads).
 *
 * The kit NEVER contains the recovery words. It only holds the words-encrypted
 * blob, so it is safe to store and safe to print.
 */
export function buildRecoveryKitHtml(data: RecoveryKitData): string {
  const envelope: RecoveryKitEnvelope = {
    kind: KIT_KIND,
    version: KIT_VERSION,
    email: data.email,
    fingerprint: data.fingerprint,
    createdAt: data.createdAt,
    recoveryCode: data.recoveryCode,
    backupBlob: data.backupBlob,
  };
  const envelopeJson = escapeForScript(JSON.stringify(envelope, null, 2));

  const email = escapeHtml(data.email);
  const fingerprint = escapeHtml(data.fingerprint);
  const created = escapeHtml(friendlyDate(data.createdAt));
  const recoveryCode = data.recoveryCode ? escapeHtml(data.recoveryCode) : "";

  // Inline styles are fine here, this is a standalone downloadable document, not
  // an app component. House style applies to the human-facing copy, no em-dashes,
  // no emojis, no mid-sentence colons.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ResearchOS Recovery Kit</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f4f6fb;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    max-width: 720px;
    margin: 32px auto;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 40px;
  }
  h1 { font-size: 26px; margin: 0 0 4px; color: #0f172a; }
  .tagline { color: #475569; margin: 0 0 28px; font-size: 15px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 28px 0 10px; }
  .details {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 8px 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px 20px;
    font-size: 14px;
  }
  .details dt { color: #64748b; font-weight: 600; margin: 0; }
  .details dd { margin: 0; word-break: break-all; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 20px;
    letter-spacing: 0.06em;
    text-align: center;
    word-break: break-all;
    background: #f8fafc;
    border: 2px solid #cbd5e1;
    border-radius: 12px;
    padding: 18px 16px;
    margin: 8px 0 4px;
    color: #0f172a;
  }
  .note {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 12px;
    padding: 16px 20px;
    font-size: 14px;
    color: #1e3a8a;
  }
  .warn {
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 12px;
    padding: 16px 20px;
    font-size: 14px;
    color: #9a3412;
  }
  ul { margin: 8px 0 0; padding-left: 20px; }
  li { margin: 4px 0; }
  .words-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px 24px;
    margin-top: 8px;
  }
  .word-line {
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid #cbd5e1;
    padding: 14px 4px 4px;
  }
  .word-line .num { color: #94a3b8; font-size: 13px; width: 22px; }
  .footer { margin-top: 32px; color: #94a3b8; font-size: 12px; }
  @media print {
    body { background: #ffffff; }
    .sheet { margin: 0; border: none; border-radius: 0; padding: 24px; }
  }
</style>
</head>
<body>
  <main class="sheet">
    <h1>ResearchOS Recovery Kit</h1>
    <p class="tagline">This one file is everything you need to recover your account on a new computer. Keep it private, like a password in your password manager.</p>

    <h2>Your identity</h2>
    <dl class="details">
      <dt>Email</dt>
      <dd>${email}</dd>
      <dt>Fingerprint</dt>
      <dd class="mono">${fingerprint}</dd>
      <dt>Created</dt>
      <dd>${created}</dd>
    </dl>

    <h2>Your recovery code</h2>
    <div class="code">${recoveryCode}</div>

    <h2>What this file is</h2>
    <div class="note">
      <p style="margin:0 0 8px;">This file holds your <strong>encrypted key backup</strong> and the <strong>recovery code</strong> that unlocks it, together, so one file is all you need to get back in.</p>
      <p style="margin:0;">Because the code is in here, treat this file like a password. Keep it in your password manager or another private place. Do not post it or share it.</p>
    </div>

    <h2>How to recover</h2>
    <div class="note">
      <ul>
        <li>Open ResearchOS and go to Settings, then the Sharing identity section.</li>
        <li>Choose to restore with your Recovery Kit.</li>
        <li>Upload this file. That is it, the code inside unlocks your keys.</li>
        <li>Your keys are rebuilt right on your device. No email and no network are needed.</li>
      </ul>
    </div>

    <p class="footer">ResearchOS Recovery Kit, format version ${KIT_VERSION}. The block below lets ResearchOS read your backup when you restore. Do not edit it.</p>
  </main>
  <script type="application/json" id="${SCRIPT_ID}">
${envelopeJson}
  </script>
</body>
</html>`;
}

/**
 * Validates that a parsed value is a usable key-backup string. We do not re-run
 * crypto here, we only confirm it parses to an envelope (or a legacy bare blob)
 * whose mnemonic blob carries the ciphertext field the unwrap path needs, so a
 * truncated or wrong-kind blob is rejected before the user even types their
 * words.
 */
function isUsableBackupBlob(blobString: unknown): boolean {
  if (typeof blobString !== "string" || blobString.length === 0) return false;
  const envelope = parseKeyBackupField(blobString);
  const ciphertext = envelope?.mnemonic?.ciphertext;
  return typeof ciphertext === "string" && ciphertext.length > 0;
}

/**
 * Pulls the JSON envelope out of file contents. Tolerant of two shapes, a full
 * kit HTML document (reads the <script id="researchos-recovery-kit"> block) or a
 * raw JSON string (the envelope on its own). Returns the raw envelope text or
 * null when no candidate is found.
 */
function extractEnvelopeText(fileContents: string): string | null {
  const trimmed = fileContents.trim();
  if (!trimmed) return null;

  // Raw JSON first, the common copy-paste case.
  if (trimmed.startsWith("{")) return trimmed;

  // Otherwise look for the embedded script block. The regex is intentionally
  // loose on attribute order so it matches regardless of how the script tag was
  // serialized, keying on the kit's script id.
  const scriptMatch = trimmed.match(
    /<script\b[^>]*\bid=["']researchos-recovery-kit["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (scriptMatch) return scriptMatch[1].trim();

  return null;
}

/**
 * Parses a Recovery Kit from file contents (full kit HTML OR a raw JSON string)
 * back into RecoveryKitData. Returns null when the input is not a valid kit, for
 * any of these reasons. wrong or missing kind, missing or empty email or
 * fingerprint, a backupBlob that is not JSON with a ciphertext field, or
 * malformed JSON. Callers treat null as "this is not a usable kit".
 */
export function parseRecoveryKit(fileContents: string): RecoveryKitData | null {
  const envelopeText = extractEnvelopeText(fileContents);
  if (!envelopeText) return null;

  let parsed: Partial<RecoveryKitEnvelope>;
  try {
    parsed = JSON.parse(envelopeText) as Partial<RecoveryKitEnvelope>;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.kind !== KIT_KIND) return null;
  if (typeof parsed.email !== "string" || parsed.email.trim().length === 0) {
    return null;
  }
  if (
    typeof parsed.fingerprint !== "string" ||
    parsed.fingerprint.trim().length === 0
  ) {
    return null;
  }
  if (!isUsableBackupBlob(parsed.backupBlob)) return null;

  return {
    email: parsed.email,
    fingerprint: parsed.fingerprint,
    backupBlob: parsed.backupBlob as string,
    recoveryCode:
      typeof parsed.recoveryCode === "string" && parsed.recoveryCode.length > 0
        ? parsed.recoveryCode
        : undefined,
    createdAt:
      typeof parsed.createdAt === "string" ? parsed.createdAt : "",
  };
}

/**
 * Compacts a fingerprint into a filename-safe token (letters and digits only),
 * so the downloaded kit is easy to tell apart from other identities' kits.
 */
function compactFingerprint(fingerprint: string): string {
  const compact = fingerprint.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return compact.length > 0 ? compact : "identity";
}

/**
 * Builds the kit HTML and triggers a browser download of it as a self-contained
 * .html file. Browser-only, it is a no-op outside the browser (guarded for SSR
 * and the test runtime).
 */
export function downloadRecoveryKit(data: RecoveryKitData): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const html = buildRecoveryKitHtml(data);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `researchos-recovery-kit-${compactFingerprint(
    data.fingerprint,
  )}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
