// Method tab = the method LIBRARY browser (companion method library, 2026-06-13).
//
// The Method tab is your whole method library with phone-modern search, type
// filter chips, and a Type/A-Z/Recent sort. Methods attached to your ACTIVE
// experiments are recommended in a highlighted band on top with a live Active
// dot. Tapping any method opens the big-text read mode (app/method-detail.tsx).
//
// REAL vs FIXTURE (read this before wiring C):
//   - The active-experiment recommendations band is REAL. It uses the
//     MethodProjection list the laptop already publishes via
//     fetchSnapshot('method'). Tapping a rec deep-links to /method-detail?read=1.
//   - The big library list is FIXTURE-backed (lib/method-library DEMO_LIBRARY)
//     because the bulk-library publish path does not exist yet (deferred to the
//     offline-sync task). The offline download prompt + status chip are UI-only
//     placeholders. Tapping a fixture row routes to /method-detail (the
//     published method screen) for now; the real per-method open lands with the
//     library backend.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { useTheme, palette } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot, type MethodSnapshot, type MethodProjection } from '@/lib/snapshots';
import {
  DEMO_LIBRARY,
  METHOD_TYPE_META,
  typeMeta,
  nextSort,
  sortLabel,
  type LibraryMethod,
  type LibrarySort,
} from '@/lib/method-library';

// UI-only offline states (placeholder pending the sync backend). The label uses
// the fixture count so the UI reads as believable.
type OfflineState = 'ready' | 'update' | 'none';

function offlineChipLabel(state: OfflineState, count: number): string {
  if (state === 'ready') return `${count} offline`;
  if (state === 'update') return 'Update available';
  return 'Download for offline';
}

// ---- Type-colored icon badge ----------------------------------------------
function TypeIcon({ type, size = 34 }: { type: string; size?: number }) {
  const meta = typeMeta(type);
  return (
    <View
      style={[
        styles.tico,
        { width: size, height: size, borderRadius: 9, backgroundColor: meta.color },
      ]}
    >
      <ThemedText style={styles.ticoTxt}>{meta.label[0]}</ThemedText>
    </View>
  );
}

// ---- A library row ---------------------------------------------------------
function MethodRow({ m, onPress }: { m: LibraryMethod; onPress: () => void }) {
  const { surface } = useTheme();
  const meta = typeMeta(m.type);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.mrow, { backgroundColor: surface.surface, borderColor: surface.border }]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${m.name}`}
    >
      <TypeIcon type={m.type} />
      <View style={styles.mrowBody}>
        <ThemedText numberOfLines={1} style={[styles.mrowName, { color: surface.text }]}>
          {m.name}
        </ThemedText>
        <ThemedText style={[styles.mrowSub, { color: surface.muted }]}>{meta.label}</ThemedText>
      </View>
      {m.favorite ? <Ionicons name="star" size={15} color={palette.amber} /> : null}
      {m.onPhone ? <Ionicons name="checkmark-circle" size={16} color={palette.success} /> : null}
    </Pressable>
  );
}

export default function MethodLibraryScreen() {
  const router = useRouter();
  const { surface, radii } = useTheme();
  const { pairing } = usePairing();

  // Real active-experiment method snapshot (drives the recommendations band).
  const [snapshot, setSnapshot] = useState<MethodSnapshot | null>(null);

  const load = useCallback(async () => {
    if (!pairing) {
      setSnapshot(null);
      return;
    }
    try {
      const data = (await fetchSnapshot('method', pairing, signWithDevice)) as MethodSnapshot | null;
      setSnapshot(data);
    } catch {
      // Recs are best-effort, a fetch failure must never blank the library.
      setSnapshot(null);
    }
  }, [pairing]);

  const pairingKey = pairing ? `${pairing.u}:${pairing.relayUrl}` : 'none';
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingKey]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [sort, setSort] = useState<LibrarySort>('type');
  // UI-only offline state cycle (placeholder pending the sync backend).
  const [offline, setOffline] = useState<OfflineState>('ready');
  const [promptOpen, setPromptOpen] = useState(false);

  const activeMethods: MethodProjection[] = Array.isArray(snapshot?.methods)
    ? snapshot!.methods!
    : [];
  const experimentName = snapshot?.experimentName;

  // Filtered + searched fixture rows.
  const rows = useMemo(() => {
    const ql = query.trim().toLowerCase();
    return DEMO_LIBRARY.filter((m) => {
      if (filter !== 'all' && m.type !== filter) return false;
      if (!ql) return true;
      return m.name.toLowerCase().includes(ql) || typeMeta(m.type).label.toLowerCase().includes(ql);
    });
  }, [query, filter]);

  // The recs band shows only when not actively searching/filtering.
  const showRecs = !query.trim() && filter === 'all' && activeMethods.length > 0;

  const filterChips = ['all', ...Object.keys(METHOD_TYPE_META)];

  // Open read mode. Real published method deep-links straight to read mode; a
  // fixture row routes to the method screen (the real per-method fetch lands
  // with the library backend).
  const openReal = useCallback(() => router.push('/method-detail?read=1'), [router]);
  const openFixture = useCallback(() => router.push('/method-detail'), [router]);

  // Group rows by type for the default "Type" sort, else flat sorted list.
  const grouped = useMemo(() => {
    if (sort === 'name') {
      return [{ type: null as string | null, items: [...rows].sort((a, b) => a.name.localeCompare(b.name)) }];
    }
    if (sort === 'recent') {
      // No real recency yet, keep fixture order as a stand-in.
      return [{ type: null as string | null, items: rows }];
    }
    const byType = new Map<string, LibraryMethod[]>();
    rows.forEach((m) => {
      const arr = byType.get(m.type) ?? [];
      arr.push(m);
      byType.set(m.type, arr);
    });
    return Array.from(byType.entries()).map(([type, items]) => ({ type, items }));
  }, [rows, sort]);

  return (
    <ScreenFrame>
      <View style={[styles.head, { backgroundColor: surface.surface }]}>
        <View style={styles.headRow}>
          <ThemedText type="title" style={styles.title}>
            Methods
          </ThemedText>
          {/* Offline status chip (UI placeholder pending the sync backend). */}
          <Pressable
            onPress={() => {
              // UI-only cycle, placeholder pending the sync backend. In the
              // "Download for offline" state the chip opens the download prompt
              // (the real trigger is a post-pair ask once the backend exists).
              if (offline === 'none') {
                setPromptOpen(true);
                return;
              }
              setOffline((s) => (s === 'ready' ? 'update' : 'none'));
            }}
            style={[
              styles.offchip,
              { borderColor: surface.border, backgroundColor: surface.sunken },
              offline === 'ready' && { borderColor: palette.successLight, backgroundColor: palette.successLight },
              offline === 'update' && { borderColor: palette.amberBorder, backgroundColor: palette.amberDim },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Offline status"
          >
            <View
              style={[
                styles.offdot,
                {
                  backgroundColor:
                    offline === 'ready' ? palette.success : offline === 'update' ? palette.warning : surface.muted,
                },
              ]}
            />
            <ThemedText
              style={[
                styles.offtxt,
                {
                  color:
                    offline === 'ready' ? palette.success : offline === 'update' ? palette.warning : surface.muted,
                },
              ]}
            >
              {offlineChipLabel(offline, DEMO_LIBRARY.length)}
            </ThemedText>
          </Pressable>
        </View>

        {/* Live search. */}
        <View style={[styles.search, { backgroundColor: surface.sunken, borderColor: surface.border, borderRadius: radii.md }]}>
          <Ionicons name="search" size={17} color={surface.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${DEMO_LIBRARY.length} methods`}
            placeholderTextColor={surface.placeholder}
            style={[styles.searchInput, { color: surface.text }]}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color={surface.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Horizontal type filter chips. */}
      <View style={[styles.filtersWrap, { backgroundColor: surface.surface }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {filterChips.map((t) => {
            const on = filter === t;
            const label = t === 'all' ? 'All' : typeMeta(t).label;
            return (
              <Pressable
                key={t}
                onPress={() => setFilter(t)}
                style={[
                  styles.fchip,
                  { borderColor: surface.border, backgroundColor: surface.sunken },
                  on && { backgroundColor: palette.sky, borderColor: palette.sky },
                ]}
              >
                <ThemedText style={[styles.fchipTxt, { color: on ? palette.white : surface.muted }]}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Count + sort. */}
      <View style={[styles.sortRow, { backgroundColor: surface.surface, borderBottomColor: surface.border }]}>
        <ThemedText style={[styles.cnt, { color: surface.muted }]}>
          {rows.length} of {DEMO_LIBRARY.length} methods
        </ThemedText>
        <Pressable onPress={() => setSort((s) => nextSort(s))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change sort">
          <ThemedText style={[styles.sortTxt, { color: palette.sky }]}>Sort: {sortLabel(sort)}</ThemedText>
        </Pressable>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {/* Active-experiment recommendations (REAL snapshot). */}
        {showRecs ? (
          <View
            style={[
              styles.reccard,
              { borderColor: palette.skyBorder, backgroundColor: palette.skyDim, borderRadius: radii.lg },
            ]}
          >
            <View style={styles.reclblRow}>
              <Ionicons name="flask" size={14} color={palette.sky} />
              <ThemedText style={[styles.reclbl, { color: palette.sky }]}>For your active experiment</ThemedText>
            </View>
            {experimentName ? (
              <ThemedText style={[styles.recexp, { color: surface.muted }]}>{experimentName}</ThemedText>
            ) : null}
            {activeMethods.map((m, i) => {
              const t = m.resolvedType ?? m.methodType ?? 'compound';
              return (
                <Pressable
                  key={m.methodId ?? i}
                  onPress={openReal}
                  style={[styles.recmeth, { backgroundColor: surface.surface, borderColor: surface.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${m.name ?? 'method'}`}
                >
                  <View style={[styles.activedot, { backgroundColor: palette.success }]} />
                  <TypeIcon type={t} size={32} />
                  <View style={styles.mrowBody}>
                    <ThemedText numberOfLines={1} style={[styles.mrowName, { color: surface.text }]}>
                      {m.name ?? 'Method'}
                    </ThemedText>
                    <ThemedText style={[styles.mrowSub, { color: surface.muted }]}>{typeMeta(t).label}</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={surface.muted} />
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Library list (FIXTURE). */}
        {rows.length === 0 ? (
          <ThemedText style={[styles.noResult, { color: surface.muted }]}>
            No methods match. Try a different term or filter.
          </ThemedText>
        ) : (
          grouped.map((g, gi) => (
            <View key={g.type ?? `grp-${gi}`}>
              {g.type ? (
                <ThemedText style={[styles.grphdr, { color: surface.muted, backgroundColor: surface.bg }]}>
                  {typeMeta(g.type).label}
                </ThemedText>
              ) : null}
              {g.items.map((m) => (
                <MethodRow key={m.id} m={m} onPress={openFixture} />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* Offline download prompt (UI placeholder pending the sync backend). */}
      {promptOpen ? (
        <>
          <Pressable style={styles.scrim} onPress={() => setPromptOpen(false)} accessibilityLabel="Dismiss" />
          <View style={[styles.prompt, { backgroundColor: surface.surface, borderTopColor: surface.border }]}>
            <ThemedText style={[styles.promptTtl, { color: surface.text }]}>Download your method library?</ThemedText>
            <ThemedText style={[styles.promptDesc, { color: surface.muted }]}>
              Keep all {DEMO_LIBRARY.length} methods on this phone so read mode works at the bench with no signal. We
              will quietly update it when your laptop changes a method.
            </ThemedText>
            <View style={styles.promptActs}>
              <Pressable
                onPress={() => setPromptOpen(false)}
                style={[styles.promptBtn, { backgroundColor: surface.sunken }]}
                accessibilityRole="button"
                accessibilityLabel="Not now"
              >
                <ThemedText style={[styles.promptBtnTxt, { color: surface.text }]}>Not now</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  setPromptOpen(false);
                  setOffline('ready');
                }}
                style={[styles.promptBtn, { backgroundColor: palette.sky }]}
                accessibilityRole="button"
                accessibilityLabel="Download"
              >
                <ThemedText style={[styles.promptBtnTxt, { color: palette.white }]}>Download</ThemedText>
              </Pressable>
            </View>
          </View>
        </>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 25 },
  offchip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1 },
  offdot: { width: 7, height: 7, borderRadius: 999 },
  offtxt: { fontSize: 10.5, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11, marginTop: 11 },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  filtersWrap: { paddingVertical: 4 },
  filters: { gap: 7, paddingHorizontal: 16, paddingVertical: 7 },
  fchip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  fchipTxt: { fontSize: 12, fontWeight: '700' },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, borderBottomWidth: 1 },
  cnt: { fontSize: 11, fontWeight: '600' },
  sortTxt: { fontSize: 11.5, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 24 },
  reccard: { padding: 12, marginTop: 8, marginBottom: 4, borderWidth: 1 },
  reclblRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 },
  reclbl: { fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  recexp: { fontSize: 11, fontWeight: '700', marginBottom: 6, marginLeft: 2 },
  recmeth: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 11, padding: 10, marginBottom: 6, borderWidth: 1 },
  activedot: { width: 8, height: 8, borderRadius: 999 },
  tico: { alignItems: 'center', justifyContent: 'center' },
  ticoTxt: { fontSize: 13, fontWeight: '800', color: '#ffffff' },
  mrow: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 12, padding: 11, marginBottom: 7, borderWidth: 1 },
  mrowBody: { flex: 1, minWidth: 0 },
  mrowName: { fontSize: 14, fontWeight: '700' },
  mrowSub: { fontSize: 11, marginTop: 1 },
  grphdr: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', paddingVertical: 6, paddingHorizontal: 4, marginTop: 6 },
  noResult: { textAlign: 'center', fontSize: 13, paddingVertical: 40, paddingHorizontal: 20 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,34,0.34)' },
  prompt: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28 },
  promptTtl: { fontSize: 17, fontWeight: '800' },
  promptDesc: { fontSize: 13, lineHeight: 20, marginTop: 7, marginBottom: 14 },
  promptActs: { flexDirection: 'row', gap: 10 },
  promptBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  promptBtnTxt: { fontSize: 14.5, fontWeight: '800' },
});
