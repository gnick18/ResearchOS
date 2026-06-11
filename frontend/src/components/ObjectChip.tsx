"use client";

// sequence editor master. The note "object chip". A reference pasted into a note
// (an in-app deep link like /sequences?seq=5) renders as a small calm inline pill
// with a type icon plus the object name. Clicking it navigates CLIENT-SIDE
// (router.push), never a full reload. A reference to a now-missing object still
// renders the chip calmly. it just navigates, and the target page handles "not
// found", so nothing crashes here.
//
// Popup-capable types (ai popup-host bot, 2026-06-11): notes open IN PLACE via
// the root ObjectPopupHost rather than navigating. Tasks and experiments are a
// planned follow-up (they are not in ObjectRefType, they open via a separate
// ?openTask= deep link), so they navigate for now like every other type.
// The host is mounted once at the root layout and subscribes to the
// object-popup-bridge bus. Clicking a chip calls openObjectPopup() on
// popup-capable types; all other types keep navigating as before. This makes
// every in-app reference tile (in notes, in BeakerBot answers, anywhere
// RenderedMarkdown renders) open in place when possible, with navigate as the
// universal fallback for types without a popup yet.
//
// Inline SVG icons only (no emojis). Voice. No em-dashes, no mid-sentence colons.

import { useRouter } from "next/navigation";
import type { ObjectRefType } from "@/lib/references";
import { parseObjectDeepLink } from "@/lib/references";
import { openObjectPopup } from "@/components/ai/object-popup-bridge";
import { Icon } from "@/components/icons";

// Types that open as a real popup in the root host. All others navigate.
// Kept in sync with ObjectPopupHost's POPUP_CAPABLE set. If you add a type
// here, add the matching case in ObjectPopupHost too.
const POPUP_CAPABLE_TYPES = new Set<ObjectRefType>(["note"]);

/** A small inline icon per object type. Stroke-only, currentColor, 1em-ish so it
 *  rides the text baseline inside the pill. */
function ChipIcon({ type, className }: { type: ObjectRefType; className?: string }) {
  const common = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  switch (type) {
    case "sequence":
      // A double helix read as a circular molecule.
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case "collection":
      // Stacked layers (a collection of items).
      return (
        <svg {...common}>
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 13l9 5 9-5" />
        </svg>
      );
    case "method":
      // A flask.
      return (
        <svg {...common}>
          <path d="M9 3h6" />
          <path d="M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />
        </svg>
      );
    case "note":
      // A document.
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case "file":
      // A paperclip.
      return (
        <svg {...common}>
          <path d="M21 11l-8.5 8.5a4 4 0 0 1-6-6L14 5a3 3 0 0 1 4 4l-8.5 8.5a1.5 1.5 0 0 1-2-2L15 8" />
        </svg>
      );
    case "molecule":
      // The chemistry vial, from the verified icon registry (so this new ref type
      // adds no raw inline SVG over the guard baseline).
      return <Icon name="vial" className={className} />;
    case "datahub":
      // A Data Hub document (a workbook of tables, analyses, and figures). The
      // chart glyph from the verified registry, so no raw inline SVG is added.
      return <Icon name="chart" className={className} />;
    case "project":
    default:
      // A folder.
      return (
        <svg {...common}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
  }
}

/**
 * The inline object pill. Renders inside flowing markdown text, so it is a
 * `button` styled as a chip (an `a` inside markdown-rendered content can nest
 * oddly, and we want a click handler not an href navigation). The href is kept
 * for context but navigation goes through the router so it is a client-side push.
 *
 * For popup-capable types (note today), the click calls
 * openObjectPopup() which routes to the root ObjectPopupHost. The user sees
 * the real item popup in place without leaving the current view or the BeakerBot
 * conversation. For all other types the chip navigates as before, and navigation
 * is also the automatic fallback whenever the popup host is not mounted.
 */
export default function ObjectChip({
  type,
  href,
  label,
}: {
  type: ObjectRefType;
  href: string;
  label: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      data-object-chip={type}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (POPUP_CAPABLE_TYPES.has(type)) {
          // Open in place via the root popup host. Parse the id from the href
          // so the bridge call is type-and-id clean. If parsing fails (should
          // not happen for a well-formed chip), fall through to navigation.
          const parsed = parseObjectDeepLink(href);
          if (parsed) {
            openObjectPopup(parsed);
            return;
          }
        }
        // Navigate for non-popup types and as the fallback for any parse failure.
        router.push(href);
      }}
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/15 px-2 py-0.5 align-baseline text-[0.92em] font-medium text-sky-700 dark:text-sky-300 transition-colors hover:border-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/20"
    >
      <ChipIcon type={type} className="h-3.5 w-3.5 shrink-0 text-sky-500" />
      <span className="truncate">{label}</span>
    </button>
  );
}
