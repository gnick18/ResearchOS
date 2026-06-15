/**
 * Wiki browse screen.
 *
 * Headline interaction: a search field that ranks across all 66 pages
 * using the ported search.ts logic. Below search, the 8-9 sections are
 * shown as grouped cards (uppercase label OUTSIDE a tight card of page
 * rows). Tapping any page (from search results or the browse list) pushes
 * the reader screen.
 *
 * Polished to the locked UI contract (docs/mockups/mobile-contract/03-tools.html,
 * "Wiki browse"): searchbar with elevation, success-checkmark freshness note,
 * uppercase faint section labels, .row-list cards of .lrow rows, the first page
 * of each section reading as an "Overview" with a sky .thumb tile, faint
 * chevrons. Geist + Geist Mono via design tokens.
 *
 * Route: app/(tabs)/wiki.tsx  (expo-router auto-discovers this as /wiki)
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { TabHeader } from '@/components/ui/TabHeader';
import { useTheme, palette, fonts } from '@/lib/design';
import {
  getBundledContent,
  loadWikiContent,
  groupSearchHits,
  entriesForSection,
  searchWiki,
  type WikiContent,
  type WikiEntry,
  type WikiSection,
  type WikiSearchHit,
} from '@/lib/wiki';

// ---------------------------------------------------------------------------
// Data (bundled, synchronous)
// ---------------------------------------------------------------------------

const CONTENT: WikiContent = getBundledContent();

// Pre-compute the section -> entries map once.
function buildSectionRows(content: WikiContent) {
  return content.sections.map((section) => ({
    section,
    pages: entriesForSection(content, section.id),
  }));
}

const SECTION_ROWS = buildSectionRows(CONTENT);

function formatPulled(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'recently';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Root screen
// ---------------------------------------------------------------------------

export default function WikiBrowseScreen() {
  const { surface } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);

  // When the wiki content was last pulled from the website wiki. Starts from the
  // bundled copy, then upgrades to the freshest (remote-fetched) copy if one is
  // available, so the line reflects the living, auto-fetched content.
  const [pulledAt, setPulledAt] = useState<string>(CONTENT.generatedAt);
  useEffect(() => {
    let active = true;
    loadWikiContent()
      .then((c) => active && setPulledAt(c.generatedAt))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const hits = useMemo(() => {
    if (query.trim().length < 2) return null;
    return searchWiki(CONTENT, query);
  }, [query]);

  const grouped = useMemo(() => {
    if (!hits) return null;
    return groupSearchHits(hits, CONTENT.sections);
  }, [hits]);

  const goToPage = useCallback(
    (entry: WikiEntry) => {
      router.push(`/wiki/${entry.slug}` as Parameters<typeof router.push>[0]);
    },
    [router],
  );

  const clearSearch = useCallback(() => {
    setQuery('');
    inputRef.current?.blur();
  }, []);

  return (
    <ScreenFrame>
      {/* Header matches every other tab: the shared TabHeader (eyebrow + title
          + notifications / Today / settings trio), then search. */}
      <View style={styles.headerArea}>
        <TabHeader title="Wiki" eyebrow="Guides and help" />
        <View style={styles.searchWrap}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            onClear={clearSearch}
            inputRef={inputRef}
          />
        </View>
        {/* Freshness line. Success checkmark glyph mirrors the contract. */}
        <View style={styles.pulledRow}>
          <Ionicons name="checkmark-circle" size={14} color={palette.success} />
          <ThemedText style={[styles.pulledNote, { color: surface.muted }]}>
            Pulled from the web wiki on {formatPulled(pulledAt)}
          </ThemedText>
        </View>
      </View>

      {/* Content area */}
      {grouped ? (
        <SearchResults groups={grouped} query={query} onSelect={goToPage} />
      ) : (
        <BrowseList sectionRows={SECTION_ROWS} onSelectPage={goToPage} />
      )}
    </ScreenFrame>
  );
}

// ---------------------------------------------------------------------------
// Search bar (contract .searchbar: strong border, surface, soft elevation)
// ---------------------------------------------------------------------------

function SearchBar({
  value,
  onChangeText,
  onClear,
  inputRef,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onClear: () => void;
  inputRef: React.RefObject<TextInput | null>;
}) {
  const { surface, radii, shadow } = useTheme();
  return (
    <View
      style={[
        styles.searchRow,
        shadow.sm,
        {
          backgroundColor: surface.surface,
          borderColor: surface.borderStrong,
          borderWidth: 1,
          borderRadius: radii.md,
        },
      ]}
    >
      <Ionicons name="search" size={18} color={surface.faint} style={styles.searchIcon} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search the wiki..."
        placeholderTextColor={surface.placeholder}
        style={[styles.searchInput, { color: surface.text }]}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable onPress={onClear} hitSlop={8} style={styles.clearBtn}>
          <Ionicons name="close-circle" size={18} color={surface.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

function SearchResults({
  groups,
  query,
  onSelect,
}: {
  groups: Array<{ section: WikiSection; hits: WikiSearchHit[] }>;
  query: string;
  onSelect: (entry: WikiEntry) => void;
}) {
  const { surface, radii, shadow } = useTheme();

  if (groups.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <View style={[styles.emptyIcon, { backgroundColor: palette.skyDim }]}>
          <Ionicons name="search-outline" size={26} color={palette.sky} />
        </View>
        <ThemedText style={[styles.emptyTitle, { color: surface.text }]}>
          No results
        </ThemedText>
        <ThemedText style={[styles.emptyText, { color: surface.muted }]}>
          Nothing in the wiki matches &quot;{query}&quot;. Try a different term.
        </ThemedText>
      </View>
    );
  }

  // One faint uppercase label per matched section, each over its own .row-list
  // card of hit rows (same composition as the browse list).
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.browseContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {groups.map((g) => (
        <View key={g.section.id} style={styles.sectionBlock}>
          <ThemedText style={[styles.sectionLabelOut, { color: surface.faint }]}>
            {g.section.label.toUpperCase()}
          </ThemedText>
          <View
            style={[
              styles.pagesCard,
              shadow.sm,
              { backgroundColor: surface.surface, borderColor: surface.border, borderRadius: radii.lg },
            ]}
          >
            {g.hits.map((hit, i) => (
              <SearchHitRow
                key={hit.entry.slug}
                hit={hit}
                query={query}
                first={i === 0}
                onPress={() => onSelect(hit.entry)}
              />
            ))}
          </View>
        </View>
      ))}
      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

function SearchHitRow({
  hit,
  query,
  first,
  onPress,
}: {
  hit: WikiSearchHit;
  query: string;
  first: boolean;
  onPress: () => void;
}) {
  const { surface } = useTheme();
  const isTitleMatch = hit.matchKind === 'title';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.hitRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.hairline },
        pressed && { backgroundColor: surface.pressed },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${hit.entry.title}`}
    >
      <View style={styles.hitBody}>
        <HighlightedText
          text={hit.entry.title}
          highlight={hit.matchKind === 'title' ? query : undefined}
          style={[styles.hitTitle, { color: surface.text }]}
        />
        {!isTitleMatch ? (
          <SnippetText hit={hit} style={[styles.hitSnippet, { color: surface.muted }]} />
        ) : null}
        <ThemedText style={[styles.hitBreadcrumb, { color: surface.faint }]} numberOfLines={1}>
          {hit.entry.breadcrumbs.join('  ›  ')}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={surface.faint} style={styles.chevron} />
    </Pressable>
  );
}

/** Renders text with a highlighted region. Falls back to plain ThemedText
 *  when there is no highlight. */
function HighlightedText({
  text,
  highlight,
  style,
}: {
  text: string;
  highlight?: string;
  style?: object;
}) {
  if (!highlight || highlight.trim().length < 2) {
    return <ThemedText style={style}>{text}</ThemedText>;
  }
  const lower = text.toLowerCase();
  const hl = highlight.trim().toLowerCase();
  const idx = lower.indexOf(hl);
  if (idx === -1) return <ThemedText style={style}>{text}</ThemedText>;
  return (
    <ThemedText style={style}>
      {text.slice(0, idx)}
      <ThemedText style={[style, styles.highlight]}>{text.slice(idx, idx + hl.length)}</ThemedText>
      {text.slice(idx + hl.length)}
    </ThemedText>
  );
}

function SnippetText({ hit, style }: { hit: WikiSearchHit; style?: object }) {
  const { snippetText, snippetOffset, snippetLength } = hit;
  return (
    <ThemedText style={style} numberOfLines={2}>
      {snippetText.slice(0, snippetOffset)}
      <ThemedText style={[style, styles.highlight]}>
        {snippetText.slice(snippetOffset, snippetOffset + snippetLength)}
      </ThemedText>
      {snippetText.slice(snippetOffset + snippetLength)}
    </ThemedText>
  );
}

// ---------------------------------------------------------------------------
// Browse list (grouped cards)
// ---------------------------------------------------------------------------

function BrowseList({
  sectionRows,
  onSelectPage,
}: {
  sectionRows: Array<{ section: WikiSection; pages: WikiEntry[] }>;
  onSelectPage: (entry: WikiEntry) => void;
}) {
  const { surface, radii, shadow } = useTheme();
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.browseContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {sectionRows.map(({ section, pages }) =>
        pages.length === 0 ? null : (
          <View key={section.id} style={styles.sectionBlock}>
            {/* Uppercase faint label sits OUTSIDE the card, per the contract. */}
            <ThemedText style={[styles.sectionLabelOut, { color: surface.faint }]}>
              {section.label.toUpperCase()}
            </ThemedText>
            <View
              style={[
                styles.pagesCard,
                shadow.sm,
                { backgroundColor: surface.surface, borderColor: surface.border, borderRadius: radii.lg },
              ]}
            >
              {pages.map((entry, i) => (
                <PageRow
                  key={entry.slug}
                  entry={entry}
                  first={i === 0}
                  // The first page of each section is its overview/landing page.
                  overview={i === 0}
                  sectionLabel={section.label}
                  onPress={() => onSelectPage(entry)}
                />
              ))}
            </View>
          </View>
        ),
      )}
      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

function PageRow({
  entry,
  first,
  overview,
  sectionLabel,
  onPress,
}: {
  entry: WikiEntry;
  first?: boolean;
  overview?: boolean;
  sectionLabel?: string;
  onPress: () => void;
}) {
  const { surface } = useTheme();
  // When the overview page just repeats the section name (e.g. FEATURES >
  // "Features"), relabel it to "Overview" so it does not read as a duplicate.
  const dupTitle =
    overview && sectionLabel && entry.title.toLowerCase() === sectionLabel.toLowerCase();
  const title = dupTitle ? 'Overview' : entry.title;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pageRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.hairline },
        pressed && { backgroundColor: surface.pressed },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
    >
      {/* Overview rows lead with a sky .thumb tile (contract first-row treatment). */}
      {overview ? (
        <View style={[styles.thumb, { backgroundColor: palette.skyDim, borderColor: surface.border }]}>
          <Ionicons name="compass-outline" size={18} color={palette.sky} />
        </View>
      ) : null}
      <View style={styles.pageBody}>
        <ThemedText
          style={[
            styles.pageTitle,
            { color: surface.text },
            overview && styles.overviewTitle,
          ]}
          numberOfLines={1}
        >
          {title}
        </ThemedText>
        {entry.blurb ? (
          <ThemedText style={[styles.pageBlurb, { color: surface.muted }]} numberOfLines={2}>
            {entry.blurb}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={surface.faint} style={styles.chevron} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerArea: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  searchWrap: { paddingTop: 12 },
  pulledRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, marginLeft: 2 },
  pulledNote: { fontSize: 12.5, fontFamily: fonts.medium, lineHeight: 17 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 46,
  },
  searchIcon: { marginRight: 9 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: fonts.ui, padding: 0 },
  clearBtn: { marginLeft: 8 },

  hitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingVertical: 12,
  },
  hitBody: { flex: 1, minWidth: 0, gap: 3 },
  hitTitle: { fontSize: 15, fontFamily: fonts.semibold, lineHeight: 20 },
  hitSnippet: { fontSize: 13, fontFamily: fonts.ui, lineHeight: 18 },
  hitBreadcrumb: { fontSize: 11.5, fontFamily: fonts.medium, lineHeight: 16 },
  highlight: { backgroundColor: palette.skyDim, color: palette.sky, fontFamily: fonts.semibold },
  chevron: { marginLeft: 8 },

  // Browse list: faint section label OUTSIDE a card of .lrow page rows.
  browseContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 112,
    gap: 18,
  },
  sectionBlock: { gap: 9 },
  sectionLabelOut: {
    fontSize: 12,
    fontFamily: fonts.bold,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  pagesCard: { borderWidth: 1, paddingHorizontal: 14, overflow: 'hidden' },

  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    paddingHorizontal: 2,
  },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBody: { flex: 1, minWidth: 0, gap: 2 },
  overviewTitle: { fontFamily: fonts.bold },
  pageTitle: { fontSize: 14.5, fontFamily: fonts.semibold, lineHeight: 20 },
  pageBlurb: { fontSize: 12.5, fontFamily: fonts.ui, lineHeight: 18 },

  // Empty / no-results — contract .empty (sky tile + title + subtext).
  emptyWrap: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 32, gap: 6 },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold },
  emptyText: { fontSize: 13, fontFamily: fonts.ui, lineHeight: 19, textAlign: 'center' },
  bottomPad: { height: 24 },
});
