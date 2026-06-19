import { defaultSchema } from "rehype-sanitize";
import type { Options as SanitizeOptions } from "rehype-sanitize";

/**
 * Sanitize schema for rendered markdown.
 *
 * Starts from hast-util-sanitize's defaultSchema (GitHub-style allowlist) and
 * narrows it further:
 *   - href/src protocols cut down to web-safe schemes (no irc/xmpp/data/etc).
 *   - Comment nodes preserved so `<!-- stamp:start -->` markers from
 *     stamp-utils.ts survive the parse → sanitize → render roundtrip while
 *     still being invisible in the rendered DOM.
 *   - `u` added to the tag allowlist. GitHub's default schema omits `<u>`,
 *     but ResearchOS uses underline as a first-class inline format (the
 *     `_text_` convention plus the `<u>` literal injected by the Cmd+U
 *     keyboard shortcut), so it must survive sanitization.
 *
 * The defaultSchema already strips `iframe`, `script`, `style`, `object`,
 * `embed`, `form`, `meta`, `link`, `base`, plus every `on*` handler, the
 * `style` attribute, and `srcdoc`/`srcDoc`. We rely on those defaults rather
 * than re-listing them so future upstream tightenings flow through.
 */
export const markdownSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  allowComments: true,
  tagNames: [...(defaultSchema.tagNames ?? []), "u"],
  protocols: {
    ...defaultSchema.protocols,
    // ros-setting is an inert app-internal marker scheme (ros-setting:dateFormat)
    // that the BeakerBot chat upgrades to a live setting control. It navigates
    // nowhere, so it is not an exfiltration or script vector like data:/javascript:.
    // Allowed so the sanitizer does not strip the href before the embed detector
    // reads it. Other embeds use relative #ros= urls and need no scheme here.
    href: ["http", "https", "mailto", "tel", "ros-setting"],
    src: ["http", "https"],
    cite: ["http", "https"],
    longDesc: ["http", "https"],
  },
};
