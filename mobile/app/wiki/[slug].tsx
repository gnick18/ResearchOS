/**
 * Wiki reader screen.
 *
 * Renders a single wiki page from the bundled wiki-content.json.
 * Blocks are rendered natively:
 *   heading   -- sized text (h2/h3/h4)
 *   paragraph -- body text with line height
 *   list      -- ordered or unordered items with number/bullet prefix
 *   callout   -- colored card with optional title (tip=sky, warning=amber, danger=red)
 *   code      -- monospace text on a sunken background
 *   image     -- caption shown as muted italic; no remote image fetch
 *
 * Polished to the locked UI contract (docs/mockups/mobile-contract/03-tools.html,
 * "Wiki page reader"): a CALM long-form READ surface. Unlike the structured app
 * screens, the prose reader reads like a page -- a full elevated surface
 * (contract .scroll.page{background:var(--surface)}) rather than a card floating
 * on the flat grey canvas. Receding chrome (back chevron only), a muted section
 * eyebrow, the big .reader h2 title, a .meta line (read-time), then comfortable
 * 1.6-1.7 line-height prose with a clear h2/h3/h4 hierarchy. Geist + Geist Mono
 * via design tokens, consistent with the just-polished wiki browse tab
 * (sky accent, fonts.* tokens).
 *
 * Route:  app/wiki/[slug].tsx  (expo-router, slug = entry.slug)
 * Pushed from: app/(tabs)/wiki.tsx via router.push(`/wiki/${entry.slug}`)
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useTheme, palette, fonts } from '@/lib/design';
import {
  getBundledContent,
  entryBySlug,
  type WikiEntry,
  type WikiBlock,
  type HeadingBlock,
  type ParagraphBlock,
  type ListBlock,
  type CalloutBlock,
  type CodeBlock,
  type ImageBlock,
} from '@/lib/wiki';

// ---------------------------------------------------------------------------
// Read-time estimate. The contract .meta line reads "N min read"; we derive it
// deterministically from the page's word count (~200 wpm, floored at 1) so the
// line is honest rather than a hardcoded number.
// ---------------------------------------------------------------------------
function estimateReadMinutes(entry: WikiEntry): number {
  let words = entry.title.split(/\s+/).filter(Boolean).length;
  for (const block of entry.blocks) {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
      case 'code':
        words += block.text.split(/\s+/).filter(Boolean).length;
        break;
      case 'callout':
        words += `${block.title ?? ''} ${block.text}`.split(/\s+/).filter(Boolean).length;
        break;
      case 'list':
        words += block.items.join(' ').split(/\s+/).filter(Boolean).length;
        break;
      default:
        break;
    }
  }
  return Math.max(1, Math.round(words / 200));
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function WikiReaderScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { surface, spacing } = useTheme();

  const content = getBundledContent();
  const entry = slug ? entryBySlug(content, slug) : null;

  if (!entry) {
    return (
      <ScreenFrame>
        <ScreenHeader />
        <View style={styles.notFoundWrap}>
          <View style={[styles.notFoundIcon, { backgroundColor: palette.skyDim }]}>
            <Ionicons name="document-outline" size={26} color={palette.sky} />
          </View>
          <ThemedText style={[styles.notFoundTitle, { color: surface.text }]}>
            Page not found
          </ThemedText>
          <ThemedText style={[styles.notFoundText, { color: surface.muted }]}>
            That wiki page is not in this bundle. Go back and pick another from
            the list.
          </ThemedText>
        </View>
      </ScreenFrame>
    );
  }

  // Section eyebrow: the page's own section sits one level above its title in
  // the breadcrumb trail (contract muted ".note" eyebrow over the h2).
  const eyebrow =
    entry.breadcrumbs.length > 1
      ? entry.breadcrumbs[entry.breadcrumbs.length - 2]
      : null;
  const readMinutes = estimateReadMinutes(entry);

  return (
    // The reader is a full elevated SURFACE, not a card on the canvas, so the
    // pushed page reads like a clean sheet of paper (contract .scroll.page).
    <ScreenFrame>
      <View style={[styles.page, { backgroundColor: surface.surface }]}>
        <ScreenHeader />
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[styles.scroll, { paddingBottom: spacing['4xl'] }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Article masthead: muted section eyebrow, big title, read-time meta. */}
          {eyebrow ? (
            <ThemedText style={[styles.eyebrow, { color: surface.muted }]}>
              {eyebrow}
            </ThemedText>
          ) : null}
          <ThemedText style={[styles.pageTitle, { color: surface.text }]}>
            {entry.title}
          </ThemedText>
          <ThemedText style={[styles.meta, { color: surface.faint }]}>
            {readMinutes} min read
          </ThemedText>

          {/* Hairline rule closes the masthead before the prose begins. */}
          <View style={[styles.rule, { backgroundColor: surface.hairline }]} />

          {entry.blocks.map((block, idx) => (
            <BlockView key={idx} block={block} />
          ))}
        </ScrollView>
      </View>
    </ScreenFrame>
  );
}

// ---------------------------------------------------------------------------
// Block dispatcher
// ---------------------------------------------------------------------------

function BlockView({ block }: { block: WikiBlock }) {
  switch (block.kind) {
    case 'heading':   return <HeadingView block={block} />;
    case 'paragraph': return <ParagraphView block={block} />;
    case 'list':      return <ListView block={block} />;
    case 'callout':   return <CalloutView block={block} />;
    case 'code':      return <CodeView block={block} />;
    case 'image':     return <ImagePlaceholder block={block} />;
    default:          return null;
  }
}

// ---------------------------------------------------------------------------
// Block renderers
// ---------------------------------------------------------------------------

function HeadingView({ block }: { block: HeadingBlock }) {
  const { surface } = useTheme();
  const sizeStyle =
    block.level === 2 ? styles.h2
    : block.level === 3 ? styles.h3
    : styles.h4;
  return (
    <ThemedText style={[sizeStyle, { color: surface.text }]}>
      {block.text}
    </ThemedText>
  );
}

function ParagraphView({ block }: { block: ParagraphBlock }) {
  const { surface } = useTheme();
  return (
    <ThemedText style={[styles.paragraph, { color: surface.text }]}>
      {block.text}
    </ThemedText>
  );
}

function ListView({ block }: { block: ListBlock }) {
  const { surface } = useTheme();
  return (
    <View style={styles.listWrap}>
      {block.items.map((item, i) => (
        <View key={i} style={styles.listItem}>
          <ThemedText
            style={[
              styles.listMarker,
              { color: block.ordered ? palette.sky : surface.faint },
            ]}
          >
            {block.ordered ? `${i + 1}.` : '•'}
          </ThemedText>
          <ThemedText style={[styles.listText, { color: surface.text }]}>
            {item}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

function CalloutView({ block }: { block: CalloutBlock }) {
  const { surface } = useTheme();
  const { bg, border, titleColor } = calloutColors(block.variant);

  return (
    <View style={[styles.callout, { backgroundColor: bg, borderColor: border }]}>
      {block.title ? (
        <ThemedText style={[styles.calloutTitle, { color: titleColor }]}>
          {block.title}
        </ThemedText>
      ) : null}
      {block.text ? (
        <ThemedText style={[styles.calloutText, { color: surface.text }]}>
          {block.text}
        </ThemedText>
      ) : null}
    </View>
  );
}

function calloutColors(variant: string): { bg: string; border: string; titleColor: string } {
  switch (variant) {
    case 'warning':
      return { bg: palette.amberDim, border: palette.amberBorder, titleColor: palette.amber };
    case 'danger':
    case 'error':
      return { bg: palette.dangerDim, border: palette.dangerBorder, titleColor: palette.danger };
    case 'success':
      return { bg: palette.successDim, border: 'rgba(22,163,74,0.34)', titleColor: palette.success };
    default:
      // tip or anything else: the contract sky callout.
      return { bg: palette.skyDim, border: palette.skyBorder, titleColor: palette.sky };
  }
}

function CodeView({ block }: { block: CodeBlock }) {
  const { surface } = useTheme();
  return (
    <View style={[styles.codeWrap, { backgroundColor: surface.sunken, borderColor: surface.border }]}>
      <ThemedText style={[styles.codeText, { color: surface.text }]}>
        {block.text}
      </ThemedText>
    </View>
  );
}

/**
 * Images are not fetched at runtime (wiki screenshots live on the web host
 * and are not bundled with the app). We show the alt text and caption
 * so users understand what the image depicts.
 * FLAG: to show real screenshots, add a script that copies
 * frontend/public/wiki/screenshots/ into mobile/assets/wiki-screenshots/
 * and resolve the src path at render time.
 */
function ImagePlaceholder({ block }: { block: ImageBlock }) {
  const { surface } = useTheme();
  const displayText = block.caption ?? block.alt;
  if (!displayText) return null;
  return (
    <View style={[styles.imagePlaceholder, { backgroundColor: surface.surface2, borderColor: surface.border }]}>
      <View style={styles.imagePlaceholderHead}>
        <Ionicons name="image-outline" size={14} color={surface.faint} />
        <ThemedText style={[styles.imagePlaceholderLabel, { color: surface.faint }]}>
          Screenshot
        </ThemedText>
      </View>
      <ThemedText style={[styles.imagePlaceholderText, { color: surface.muted }]}>
        {displayText}
      </ThemedText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Full elevated surface so the pushed reader reads like a clean page, not a
  // card on the canvas (contract .scroll.page).
  page: { flex: 1 },
  scroll: {
    paddingHorizontal: 22,
    paddingTop: 8,
    gap: 13,
  },

  // Masthead: muted section eyebrow, big title, faint read-time, hairline rule.
  eyebrow: {
    fontSize: 12.5,
    fontFamily: fonts.semibold,
    lineHeight: 17,
    marginBottom: -6,
  },
  pageTitle: {
    fontSize: 27,
    fontFamily: fonts.extrabold,
    lineHeight: 33,
    letterSpacing: -0.4,
  },
  meta: {
    fontSize: 12.5,
    fontFamily: fonts.medium,
    lineHeight: 17,
    marginTop: -7,
  },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 3, marginBottom: -2 },

  // Heading hierarchy. Clear size + weight steps, generous top margins to let
  // sections breathe on this calm read surface.
  h2: { fontSize: 20, fontFamily: fonts.extrabold, lineHeight: 27, letterSpacing: -0.2, marginTop: 12 },
  h3: { fontSize: 16.5, fontFamily: fonts.bold, lineHeight: 23, marginTop: 8 },
  h4: { fontSize: 14.5, fontFamily: fonts.semibold, lineHeight: 21, marginTop: 4 },

  // Body prose. Comfortable 1.6 line-height per the contract reader.
  paragraph: { fontSize: 15, fontFamily: fonts.ui, lineHeight: 24 },

  listWrap: { gap: 7 },
  listItem: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  listMarker: { fontSize: 15, fontFamily: fonts.semibold, lineHeight: 24, minWidth: 18 },
  listText: { flex: 1, fontSize: 15, fontFamily: fonts.ui, lineHeight: 24 },

  // Callout: tinted inset with a full border (contract .callout), accent title.
  callout: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 13,
    gap: 4,
    marginVertical: 1,
  },
  calloutTitle: { fontSize: 13.5, fontFamily: fonts.bold, lineHeight: 19 },
  calloutText: { fontSize: 13.5, fontFamily: fonts.ui, lineHeight: 21 },

  codeWrap: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  codeText: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 21 },

  imagePlaceholder: {
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 5,
  },
  imagePlaceholderHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  imagePlaceholderLabel: {
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  imagePlaceholderText: { fontSize: 13, fontFamily: fonts.ui, lineHeight: 19, fontStyle: 'italic' },

  // Not-found: contract empty state (sky tile + title + subtext), consistent
  // with the wiki browse no-results screen.
  notFoundWrap: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 32, gap: 6 },
  notFoundIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  notFoundTitle: { fontSize: 16, fontFamily: fonts.bold, lineHeight: 22 },
  notFoundText: { fontSize: 13, fontFamily: fonts.ui, lineHeight: 19, textAlign: 'center' },
});
