"use client";

// Cross-boundary sharing, the OUT-OF-BAND key panel for an invite (P1-A).
//
// After a successful invite-a-non-user (inviteShare / inviteRawShare), the
// branded email is KEYLESS, it never carries the one-time decryption key, so the
// recipient cannot open the item from the email alone. The key travels OUT OF
// BAND, the sender sends it to the recipient over a channel they trust. This
// panel is what the send dialogs show the sender right after the invite, the full
// private link (one click for the recipient) and a short unlock code (for the
// "paste on the accept page" flow), each with a copy button, plus the honest
// one-line reason. See docs/proposals/INVITE_KEY_OUT_OF_EMAIL.md.
//
// The link / code shown here is the ONLY place the key surfaces in the product,
// it is held in component state from the invite call's return and is never sent
// anywhere. Closing the dialog discards it (the recipient can still open via the
// email landing + code, but the sender must re-share if they lose this).

import { useCallback, useState } from "react";

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";

/** One invited item's out-of-band material. title is optional (single-item
 *  dialogs omit it, the bulk dialog labels each entry by its item title). */
export interface InviteOutOfBandItem {
  title?: string;
  /** The full private link (key in the URL fragment), one-click for the recipient. */
  privateLink: string;
  /** The bare 64-hex unlock code, for the paste-on-accept-page flow. */
  unlockCode: string;
}

/** Copies text to the clipboard, returning whether it succeeded. Falls back to a
 *  hidden textarea + execCommand for the rare browser without the async API. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/** A single labelled value (link or code) with a copy button. The value itself is
 *  shown read-only so the sender can see exactly what they are sending. */
function CopyRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }, [value]);

  return (
    <div>
      <p className="text-meta font-medium text-foreground mb-1">{label}</p>
      <div className="flex items-stretch gap-2">
        <div
          className={`flex-1 min-w-0 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-meta text-foreground break-all ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </div>
        <Tooltip label={copied ? "Copied" : "Copy"} placement="top">
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
            className="shrink-0 px-3 rounded-lg border border-border bg-surface-raised text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors flex items-center"
          >
            {copied ? (
              <Icon
                name="check"
                className="w-4 h-4 text-emerald-600 dark:text-emerald-300"
              />
            ) : (
              <Icon name="copy" className="w-4 h-4" />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

export default function InviteOutOfBandPanel({
  recipient,
  items,
}: {
  recipient: string;
  items: InviteOutOfBandItem[];
}) {
  const multiple = items.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-blue-500">
          <Icon name="lock" className="w-5 h-5" />
        </span>
        <div>
          <p className="text-body font-medium text-foreground">
            Now send {recipient} the {multiple ? "links or codes" : "link or code"}{" "}
            yourself
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            The email we sent does not contain the key. The{" "}
            {multiple ? "links and codes" : "link and code"} below{" "}
            {multiple ? "are" : "is"} the key, so send{" "}
            {multiple ? "them" : "it"} to {recipient} over a channel you trust (a
            message, a text, in person). Anyone who gets{" "}
            {multiple ? "them" : "it"} can open the{" "}
            {multiple ? "items" : "item"}, so keep {multiple ? "them" : "it"} off
            public channels.
          </p>
        </div>
      </div>

      <div className="space-y-5 max-h-72 overflow-y-auto">
        {items.map((item, idx) => (
          <div
            key={idx}
            className={
              multiple ? "space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0" : "space-y-3"
            }
          >
            {multiple && item.title && (
              <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold break-words">
                {item.title}
              </p>
            )}
            <CopyRow label="Private link" value={item.privateLink} />
            <CopyRow label="Unlock code" value={item.unlockCode} mono />
          </div>
        ))}
      </div>
    </div>
  );
}
