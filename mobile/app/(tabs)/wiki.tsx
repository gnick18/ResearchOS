/**
 * Wiki browse screen.
 *
 * Headline interaction: a search field that ranks across all 66 pages
 * using the ported search.ts logic. Below search, the 8-9 sections are
 * shown as grouped cards (expandable) with the page list inside each card.
 * Tapping any page (from search results or the browse list) pushes the
 * reader screen.
 *
 * Route: app/(tabs)/wiki.tsx  (expo-router auto-discovers this as /wiki)
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { TabHeader } from '@/components/ui/TabHeader';
import { useUnreadNotificationCount } from '@/lib/unread-notifications';
import { Card } from '@/components/ui/Card';
import { useTheme, palette } from '@/lib/design';
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
  const unreadCount = useUnreadNotificationCount();
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
      {/* Header matches every other tab: big title, muted tagline, then search. */}
      <View style={styles.headerArea}>
        <TabHeader title="Wiki" unreadCount={unreadCount} />
        <ThemedText style={[styles.tagline, { color: surface.muted }]}>
          Guides and help, searchable across every page.
        </ThemedText>
        <View style={styles.searchWrap}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            onClear={clearSearch}
            inputRef={inputRef}
          />
        </View>
        <View style={styles.pulledRow}>
          <Ionicons name="cloud-done-outline" size={13} color={surface.muted} />
          <ThemedText style={[styles.pulledNote, { color: surface.muted }]}>
            Last pulled from the web wiki on {formatPulled(pulledAt)}
          </ThemedText>
        </View>
      </View>

      {/* Content area */}
      {grouped ? (
        <SearchResults
          groups={grouped}
          query={query}
          onSelect={goToPage}
        />
      ) : (
        <BrowseList sectionRows={SECTION_ROWS} onSelectPage={goToPage} />
      )}
    </ScreenFrame>
  );
}

// ---------------------------------------------------------------------------
// Search bar
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
  const { surface, radii } = useTheme();
  return (
    <View style={[styles.searchRow, { backgroundColor: surface.surface, borderColor: surface.border, borderWidth: 1, borderRadius: radii.md }]}>
      <Ionicons name="search" size={18} color={surface.muted} style={styles.searchIcon} />
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
  const { surface, spacing } = useTheme();

  if (groups.length === 0) {
    return (
      <View style={[styles.emptyWrap, { paddingTop: spacing['3xl'] }]}>
        <ThemedText style={[styles.emptyText, { color: surface.muted }]}>
          No results for &quot;{query}&quot;
        </ThemedText>
      </View>
    );
  }

  // Flatten to a SectionList-friendly shape.
  type SLSection = { title: string; data: WikiSearchHit[] };
  const sections: SLSection[] = groups.map((g) => ({
    title: g.section.label,
    data: g.hits,
  }));

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.entry.slug}
      contentContainerStyle={[styles.searchListContent, { paddingBottom: 40 }]}
      renderSectionHeader={({ section }) => (
        <View style={[styles.sectionHeader, { backgroundColor: surface.bg }]}>
          <ThemedText style={[styles.sectionLabel, { color: surface.muted }]}>
            {section.title.toUpperCase()}
          </ThemedText>
        </View>
      )}
      renderItem={({ item }) => (
        <SearchHitRow hit={item} query={query} onPress={() => onSelect(item.entry)} />
      )}
    />
  );
}

function SearchHitRow({
  hit,
  query,
  onPress,
}: {
  hit: WikiSearchHit;
  query: string;
  onPress: () => void;
}) {
  const { surface, spacing } = useTheme();
  const isTitleMatch = hit.matchKind === 'title';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.hitRow,
        {
          backgroundColor: pressed ? surface.pressed : surface.surface,
          borderBottomColor: surface.border,
        },
      ]}
    >
      <View style={{ flex: 1, gap: spacing.xs }}>
        <HighlightedText
          text={hit.entry.title}
          highlight={hit.matchKind === 'title' ? query : undefined}
          style={[styles.hitTitle, { color: surface.text }]}
        />
        {!isTitleMatch ? (
          <SnippetText hit={hit} style={[styles.hitSnippet, { color: surface.muted }]} />
        ) : null}
        <ThemedText style={[styles.hitBreadcrumb, { color: surface.muted }]}>
          {hit.entry.breadcrumbs.join(' / ')}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={surface.muted} style={styles.chevron} />
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
  const { surface } = useTheme();
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.browseContent}
      keyboardShouldPersistTaps="handled"
    >
      {sectionRows.map(({ section, pages }) =>
        pages.length === 0 ? null : (
          <View key={section.id} style={styles.sectionBlock}>
            {/* Section label sits OUTSIDE the white card, like the ideal. */}
            <ThemedText style={[styles.sectionLabelOut, { color: surface.muted }]}>
              {section.label.toUpperCase()}
            </ThemedText>
            <Card style={styles.pagesCard}>
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
            </Card>
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
  const accent = overview ? palette.sky : surface.text;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pageRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.border },
        { backgroundColor: pressed ? surface.pressed : overview ? palette.skyDim : 'transparent' },
      ]}
    >
      {overview ? (
        <View style={styles.overviewIcon}>
          <Ionicons name="compass-outline" size={18} color={palette.sky} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText style={[styles.pageTitle, { color: accent }, overview && styles.overviewTitle]}>
          {title}
        </ThemedText>
        {entry.blurb ? (
          <ThemedText style={[styles.pageBlurb, { color: surface.muted }]} numberOfLines={2}>
            {entry.blurb}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={overview ? palette.sky : surface.muted} style={styles.chevron} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerArea: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 4,
  },
  tagline: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  searchWrap: { paddingTop: 12 },
  pulledRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 9, marginLeft: 2 },
  pulledNote: { fontSize: 12, lineHeight: 16 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16, lineHeight: 20 },
  clearBtn: { marginLeft: 6 },

  // Search results list (flat rows under uppercase section headers)
  searchListContent: { flexGrow: 1 },
  sectionHeader: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  hitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hitTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  hitSnippet: { fontSize: 13, lineHeight: 18 },
  hitBreadcrumb: { fontSize: 12, lineHeight: 16 },
  highlight: { backgroundColor: 'rgba(26, 160, 230, 0.20)', color: palette.sky },
  chevron: { marginLeft: 8 },

  // Browse list: grey section label OUTSIDE a white card of page rows.
  browseContent: {
    paddingHorizontal: 24,
    paddingTop: 4,
    gap: 18,
  },
  sectionBlock: { gap: 8 },
  sectionLabelOut: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  pagesCard: { padding: 0, gap: 0, overflow: 'hidden' },

  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  overviewIcon: { marginRight: 11 },
  overviewTitle: { fontWeight: '700' },
  pageTitle: { fontSize: 15, fontWeight: '500', lineHeight: 20 },
  pageBlurb: { fontSize: 13, lineHeight: 18 },

  emptyWrap: { alignItems: 'center', paddingHorizontal: 24 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  bottomPad: { height: 40 },
});
