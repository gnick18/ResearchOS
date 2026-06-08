/**
 * Wiki browse screen.
 *
 * Headline interaction: a search field that ranks across all 66 pages
 * using the ported search.ts logic. Below search, the 8-9 sections are
 * shown as expandable rows with the page list inside. Tapping any page
 * (from search results or the browse list) pushes the reader screen.
 *
 * Route: app/wiki/index.tsx  (expo-router auto-discovers this as /wiki)
 * Nav wiring the orchestrator must add (in _layout.tsx Stack section):
 *   <Stack.Screen name="wiki/index" options={{ title: 'Help & Wiki' }} />
 *   <Stack.Screen name="wiki/[slug]" options={{ title: '' }} />
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
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
import { useTheme, palette } from '@/lib/design';
import {
  getBundledContent,
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

// ---------------------------------------------------------------------------
// Root screen
// ---------------------------------------------------------------------------

export default function WikiBrowseScreen() {
  const { surface, spacing } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const inputRef = useRef<TextInput>(null);

  const hits = useMemo(() => {
    if (query.trim().length < 2) return null;
    return searchWiki(CONTENT, query);
  }, [query]);

  const grouped = useMemo(() => {
    if (!hits) return null;
    return groupSearchHits(hits, CONTENT.sections);
  }, [hits]);

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
    <ScreenFrame edges={['bottom']}>
      <View style={[styles.header, { backgroundColor: surface.bg, borderBottomColor: surface.border }]}>
        <ThemedText style={[styles.title, { color: surface.text }]}>Help &amp; Wiki</ThemedText>
      </View>

      {/* Search bar */}
      <View style={[styles.searchWrap, { backgroundColor: surface.bg, paddingHorizontal: spacing.lg }]}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          onClear={clearSearch}
          inputRef={inputRef}
        />
      </View>

      {/* Content area */}
      {grouped ? (
        <SearchResults
          groups={grouped}
          query={query}
          onSelect={goToPage}
        />
      ) : (
        <BrowseList
          sectionRows={SECTION_ROWS}
          expandedSections={expandedSections}
          onToggleSection={toggleSection}
          onSelectPage={goToPage}
        />
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
    <View style={[styles.searchRow, { backgroundColor: surface.sunken, borderRadius: radii.md }]}>
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
      contentContainerStyle={[styles.listContent, { paddingBottom: 40 }]}
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
  const { surface, spacing, radii } = useTheme();
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
// Browse list
// ---------------------------------------------------------------------------

function BrowseList({
  sectionRows,
  expandedSections,
  onToggleSection,
  onSelectPage,
}: {
  sectionRows: Array<{ section: WikiSection; pages: WikiEntry[] }>;
  expandedSections: Set<string>;
  onToggleSection: (id: string) => void;
  onSelectPage: (entry: WikiEntry) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.listContent}>
      {sectionRows.map(({ section, pages }) => (
        <SectionAccordion
          key={section.id}
          section={section}
          pages={pages}
          expanded={expandedSections.has(section.id)}
          onToggle={() => onToggleSection(section.id)}
          onSelectPage={onSelectPage}
        />
      ))}
      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

function SectionAccordion({
  section,
  pages,
  expanded,
  onToggle,
  onSelectPage,
}: {
  section: WikiSection;
  pages: WikiEntry[];
  expanded: boolean;
  onToggle: () => void;
  onSelectPage: (entry: WikiEntry) => void;
}) {
  const { surface, spacing } = useTheme();

  return (
    <View>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.sectionAccordion,
          {
            backgroundColor: pressed ? surface.pressed : surface.bg,
            borderBottomColor: surface.border,
          },
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={{ flex: 1 }}>
          <ThemedText style={[styles.sectionTitle, { color: surface.text }]}>
            {section.label}
          </ThemedText>
          {section.blurb ? (
            <ThemedText style={[styles.sectionBlurb, { color: surface.muted }]} numberOfLines={2}>
              {section.blurb}
            </ThemedText>
          ) : null}
        </View>
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={18}
          color={surface.muted}
        />
      </Pressable>

      {expanded
        ? pages.map((entry) => (
            <PageRow
              key={entry.slug}
              entry={entry}
              onPress={() => onSelectPage(entry)}
            />
          ))
        : null}
    </View>
  );
}

function PageRow({
  entry,
  onPress,
}: {
  entry: WikiEntry;
  onPress: () => void;
}) {
  const { surface, spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pageRow,
        {
          backgroundColor: pressed ? surface.pressed : surface.surface,
          borderBottomColor: surface.border,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText style={[styles.pageTitle, { color: surface.text }]}>
          {entry.title}
        </ThemedText>
        {entry.blurb ? (
          <ThemedText style={[styles.pageBlurb, { color: surface.muted }]} numberOfLines={2}>
            {entry.blurb}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={surface.muted} style={styles.chevron} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  searchWrap: { paddingVertical: 10 },
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

  listContent: { flexGrow: 1 },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  hitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hitTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  hitSnippet: { fontSize: 13, lineHeight: 18 },
  hitBreadcrumb: { fontSize: 12, lineHeight: 16 },
  highlight: { backgroundColor: 'rgba(26, 160, 230, 0.20)', color: palette.sky },
  chevron: { marginLeft: 8 },

  sectionAccordion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  sectionBlurb: { fontSize: 13, lineHeight: 18, marginTop: 2 },

  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingLeft: 32,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pageTitle: { fontSize: 15, fontWeight: '500', lineHeight: 20 },
  pageBlurb: { fontSize: 13, lineHeight: 18 },

  emptyWrap: { alignItems: 'center', paddingHorizontal: 20 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  bottomPad: { height: 40 },
});
