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
 * Route:  app/wiki/[slug].tsx  (expo-router, slug = entry.slug)
 * Pushed from: app/wiki/index.tsx  via router.push(`/wiki/${entry.slug}`)
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { useTheme, palette } from '@/lib/design';
import {
  getBundledContent,
  entryBySlug,
  type WikiBlock,
  type HeadingBlock,
  type ParagraphBlock,
  type ListBlock,
  type CalloutBlock,
  type CodeBlock,
  type ImageBlock,
} from '@/lib/wiki';

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
      <ScreenFrame edges={['bottom']}>
        <View style={[styles.notFound, { paddingTop: spacing['3xl'] }]}>
          <ThemedText style={[styles.notFoundText, { color: surface.muted }]}>
            Page not found.
          </ThemedText>
        </View>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame edges={['bottom']}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.scroll, { paddingBottom: spacing['4xl'] }]}
      >
        {/* Breadcrumb */}
        {entry.breadcrumbs.length > 1 ? (
          <ThemedText style={[styles.breadcrumb, { color: surface.muted }]}>
            {entry.breadcrumbs.join(' / ')}
          </ThemedText>
        ) : null}

        {/* Title */}
        <ThemedText style={[styles.pageTitle, { color: surface.text }]}>
          {entry.title}
        </ThemedText>

        {/* Blocks */}
        {entry.blocks.map((block, idx) => (
          <BlockView key={idx} block={block} />
        ))}
      </ScrollView>
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
          <ThemedText style={[styles.listMarker, { color: surface.muted }]}>
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
    <View style={[styles.callout, { backgroundColor: bg, borderLeftColor: border }]}>
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
      return { bg: palette.warningLight, border: palette.warning, titleColor: palette.warning };
    case 'danger':
    case 'error':
      return { bg: palette.dangerLight, border: palette.danger, titleColor: palette.danger };
    case 'success':
      return { bg: palette.successLight, border: palette.success, titleColor: palette.success };
    default:
      // tip or anything else
      return { bg: palette.skyDim, border: palette.sky, titleColor: palette.sky };
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
    <View style={[styles.imagePlaceholder, { backgroundColor: surface.sunken, borderColor: surface.border }]}>
      <ThemedText style={[styles.imagePlaceholderLabel, { color: surface.muted }]}>
        Screenshot
      </ThemedText>
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
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 14,
  },

  breadcrumb: { fontSize: 12, lineHeight: 16 },
  pageTitle: { fontSize: 26, fontWeight: '800', lineHeight: 32, marginBottom: 4 },

  h2: { fontSize: 20, fontWeight: '700', lineHeight: 26, marginTop: 8 },
  h3: { fontSize: 17, fontWeight: '700', lineHeight: 23, marginTop: 4 },
  h4: { fontSize: 15, fontWeight: '600', lineHeight: 21, marginTop: 2 },

  paragraph: { fontSize: 15, lineHeight: 23 },

  listWrap: { gap: 6 },
  listItem: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  listMarker: { fontSize: 15, lineHeight: 23, minWidth: 18 },
  listText: { flex: 1, fontSize: 15, lineHeight: 23 },

  callout: {
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 14,
    gap: 4,
  },
  calloutTitle: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  calloutText: { fontSize: 14, lineHeight: 20 },

  codeWrap: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  codeText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },

  imagePlaceholder: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 12,
    gap: 4,
  },
  imagePlaceholderLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  imagePlaceholderText: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' },

  notFound: { alignItems: 'center', paddingHorizontal: 20 },
  notFoundText: { fontSize: 16, lineHeight: 22 },
});
