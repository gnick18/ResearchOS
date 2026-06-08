// Shared branded layout for every transactional email ResearchOS sends.
//
// Before this module each email hand-rolled its own HTML, so they drifted (some
// branded, some plain, the "branded" ones on a generic blue that was not even
// the brand color). This is the one wrapper they all call, so the whole set
// reads as one family and a NEW email is on-brand by default, just supply the
// heading, body, and an optional button.
//
// Email-client realities baked in here:
//  - RASTER mascot PNG, never inline SVG (Gmail / Outlook strip SVG).
//  - Inline styles only, no <style> block, no classes.
//  - Table-based logo lockup (image + wordmark) for cross-client alignment.
//  - The rainbow band sets a FLAT brand-sky fallback first, then overrides with
//    the gradient, so a client that drops gradients still shows a brand bar.
//  - An absolute asset/link origin (an inbox cannot resolve a relative URL).
//
// House style for any copy passed in: no em-dashes, no emojis, no mid-sentence
// colons.

/** Brand palette used across emails. Sky = identity, action = buttons/links. */
export const EMAIL_COLORS = {
  sky: "#1AA0E6",
  action: "#1283C9",
  ink: "#111827",
  muted: "#4b5563",
  subtle: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  page: "#f3f4f6",
} as const;

/** Pastel rainbow stops (light-mode brand rainbow) for the top band. */
const RAINBOW_STOPS = "#FFD2B0,#FFF1A8,#B7EBB1,#A6D2F4,#D6B5F0";

/** Physical mailing address for the CAN-SPAM footer, overridable per deployment. */
export const POSTAL_ADDRESS =
  process.env.RESEND_POSTAL_ADDRESS ??
  "ResearchOS, University of Wisconsin-Madison, Madison, WI 53706, USA";

/** Minimal HTML-escape for interpolated text fields. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Absolute origin that serves /public assets and that links point at. MUST be
 * absolute (an email client cannot resolve a relative or localhost URL). Reads
 * the same env the app uses, with the canonical production default.
 */
export function emailAssetOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (configured && configured.length > 0) return configured.replace(/\/$/, "");
  return "https://research-os.app";
}

/**
 * Absolute URL of the BeakerBot mascot PNG (public/email/beakerbot.png). A raster
 * PNG, never inline SVG. Renders in real inboxes once the origin serves /public.
 */
export function beakerbotImageUrl(): string {
  return `${emailAssetOrigin()}/email/beakerbot.png`;
}

export interface EmailCta {
  /** Button label (escaped here). */
  label: string;
  /** Button href. Trusted, the caller builds it (keyless link, app URL, etc). */
  url: string;
}

export interface EmailFooterLink {
  label: string;
  /** Trusted href built by the caller. */
  url: string;
}

export interface EmailLayoutOptions {
  /** Hidden inbox-preview text (the snippet shown before opening). */
  preheader?: string;
  /** Optional centered headline. Pass already-escaped/interpolated text. */
  heading?: string;
  /**
   * The main body HTML. TRUSTED, the caller assembles it and is responsible for
   * escaping any interpolated user values with escapeHtml().
   */
  bodyHtml: string;
  /** Optional primary action button. */
  cta?: EmailCta;
  /**
   * Optional HTML rendered inside the card AFTER the button (e.g. the one-line
   * "what ResearchOS is" reassurance). TRUSTED, caller escapes interpolations.
   */
  secondaryHtml?: string;
  /** Optional small print under the card (already-escaped/interpolated HTML). */
  footerNoteHtml?: string;
  /** Optional footer links (rendered on one line, middot-separated). */
  footerLinks?: EmailFooterLink[];
  /** Include the postal-address line in the footer (default false). */
  showPostal?: boolean;
  /** Small grey suffix after the wordmark, e.g. " &middot; business tracker". */
  wordmarkSuffix?: string;
  /** Mascot square size in px (default 48). */
  mascotSize?: number;
}

/**
 * Render the full branded email HTML document. Pure (no I/O), unit-testable.
 */
export function renderEmailLayout(o: EmailLayoutOptions): string {
  const { sky, action, ink, subtle, faint, line, page } = EMAIL_COLORS;
  const size = o.mascotSize ?? 48;
  const mascot = beakerbotImageUrl();

  const preheader = o.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${o.preheader}</div>`
    : "";

  const suffix = o.wordmarkSuffix
    ? `<span style="font-size:13px;font-weight:400;color:${faint};">${o.wordmarkSuffix}</span>`
    : "";

  const heading = o.heading
    ? `<h1 style="font-size:18px;font-weight:600;text-align:center;margin:8px 0 6px;color:${ink};">${o.heading}</h1>`
    : "";

  const cta = o.cta
    ? `<div style="text-align:center;margin:0 0 22px;">
        <a href="${o.cta.url}" style="display:inline-block;background:${action};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:10px;">${escapeHtml(o.cta.label)}</a>
      </div>`
    : "";

  const footerLinks =
    o.footerLinks && o.footerLinks.length > 0
      ? `<p style="margin:0;">${o.footerLinks
          .map(
            (l) => `<a href="${l.url}" style="color:${faint};text-decoration:underline;">${escapeHtml(l.label)}</a>`,
          )
          .join(" &middot; ")}</p>`
      : "";

  const postal = o.showPostal
    ? `<p style="margin:0 0 4px;">${escapeHtml(POSTAL_ADDRESS)}</p>`
    : "";

  const footer =
    o.footerNoteHtml || postal || footerLinks
      ? `<div style="margin-top:18px;text-align:center;font-size:11px;line-height:1.6;color:${faint};">
          ${o.footerNoteHtml ?? ""}
          ${postal}
          ${footerLinks}
        </div>`
      : "";

  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:${page};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${ink};">
  ${preheader}
  <div style="max-width:520px;margin:0 auto;padding:28px 20px;">
    <div style="background:#ffffff;border:1px solid ${line};border-radius:14px;overflow:hidden;">
      <div style="height:4px;background:${sky};background:linear-gradient(90deg,${RAINBOW_STOPS});"></div>
      <div style="padding:28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 14px;">
          <tr>
            <td style="vertical-align:middle;padding-right:10px;">
              <img src="${mascot}" width="${size}" height="${size}" alt="ResearchOS" style="display:block;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;border-radius:9px;" />
            </td>
            <td style="vertical-align:middle;">
              <span style="font-size:22px;font-weight:700;color:${sky};letter-spacing:-0.01em;">ResearchOS</span>${suffix}
            </td>
          </tr>
        </table>
        ${heading}
        ${o.bodyHtml}
        ${cta}
        ${o.secondaryHtml ?? ""}
      </div>
    </div>
    ${footer}
  </div>
</body>
</html>`;
}

/**
 * Shared plaintext footer block (postal + links as plain lines). Keeps the text
 * fallbacks consistent without a full text layout engine.
 */
export function renderEmailTextFooter(opts: {
  note?: string;
  links?: EmailFooterLink[];
  showPostal?: boolean;
}): string[] {
  const out: string[] = [];
  if (opts.note) out.push("", opts.note);
  if (opts.showPostal) out.push("", POSTAL_ADDRESS);
  if (opts.links) for (const l of opts.links) out.push(`${l.label}: ${l.url}`);
  return out;
}
