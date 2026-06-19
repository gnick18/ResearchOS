// ai chat-embeds bot, 2026-06-11.
//
// Lone-embed detection for the chat markdown renderer, self-contained so it
// lives outside the shared RenderedMarkdown/embeds/* files (another session owns
// those). The rule mirrors RenderedMarkdown's loneEmbedFromParagraph but is kept
// here so no shared file needs touching.
//
// A paragraph is a "lone embed" when it contains exactly ONE meaningful child
// (ignoring pure-whitespace text nodes), that child is an <a> element, and the
// href is an object embed link (parseObjectEmbed returns a descriptor with
// isEmbed true). Any other content keeps the paragraph rendering as normal prose.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import {
  parseObjectEmbed,
  parseSettingEmbed,
  type EmbedDescriptor,
  type SettingEmbedDescriptor,
} from "@/lib/references";

/** A minimal hast node shape. We only need a few fields to detect the lone-link
 *  case; unknown extra fields are silently ignored. */
export interface ChatHastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { href?: unknown };
  children?: ChatHastNode[];
}

/** Collect the visible text of a hast subtree. The link text becomes the embed
 *  caption. */
export function chatHastText(node: ChatHastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(chatHastText).join("");
}

/** If the paragraph node contains exactly one meaningful child that is an
 *  object embed link, return its EmbedDescriptor and the link-text caption.
 *  Otherwise return null so the caller renders a normal paragraph. */
export function loneEmbedFromChatParagraph(
  node: ChatHastNode | undefined,
): { descriptor: EmbedDescriptor; caption: string } | null {
  if (!node || !Array.isArray(node.children)) return null;

  // Strip pure-whitespace text nodes so a trailing newline does not count.
  const meaningful = node.children.filter(
    (c) => !(c.type === "text" && /^\s*$/.test(c.value ?? "")),
  );
  if (meaningful.length !== 1) return null;

  const el = meaningful[0];
  if (el.type !== "element" || el.tagName !== "a") return null;

  const href = el.properties?.href;
  const descriptor = parseObjectEmbed(typeof href === "string" ? href : null);
  if (!descriptor || !descriptor.isEmbed) return null;

  return { descriptor, caption: chatHastText(el).trim() };
}

/** If the paragraph node is a lone SETTING embed link (`ros-setting:<key>`),
 *  return its SettingEmbedDescriptor and the link-text caption so the renderer can
 *  swap it for the SettingControlWidget. Additive sibling of
 *  loneEmbedFromChatParagraph; the object-embed path is unchanged. Returns null
 *  for any paragraph that is not exactly one setting-embed link. */
export function loneSettingEmbedFromChatParagraph(
  node: ChatHastNode | undefined,
): { descriptor: SettingEmbedDescriptor; caption: string } | null {
  if (!node || !Array.isArray(node.children)) return null;

  const meaningful = node.children.filter(
    (c) => !(c.type === "text" && /^\s*$/.test(c.value ?? "")),
  );
  if (meaningful.length !== 1) return null;

  const el = meaningful[0];
  if (el.type !== "element" || el.tagName !== "a") return null;

  const href = el.properties?.href;
  const descriptor = parseSettingEmbed(typeof href === "string" ? href : null);
  if (!descriptor) return null;

  return { descriptor, caption: chatHastText(el).trim() };
}
