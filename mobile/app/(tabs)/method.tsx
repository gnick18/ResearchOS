// Method tab = the method LIBRARY browser (companion method library,
// 2026-06-13; offline sync wired 2026-06-13).
//
// The Method tab is your whole method library with phone-modern search, type
// filter chips, and a Type/A-Z/Recent sort. Methods attached to your ACTIVE
// experiments are recommended in a highlighted band on top with a live Active
// dot. Tapping any method opens the big-text read mode (app/method-detail.tsx).
//
// REAL vs DEMO:
//   - The active-experiment recommendations band uses the MethodProjection list
//     the laptop publishes via fetchSnapshot('method'). Tapping a rec deep-links
//     to /method-detail?read=1 (the focused experiment method).
//   - The big library list is the REAL offline cache (lib/method-library-store).
//     On mount it loads the cache instantly (works offline), then syncs in the
//     background. The offline download prompt + status chip reflect real state:
//     not-downloaded / downloading / offline-ready / update-available. Tapping a
//     library row opens read mode for THAT method from the cached projection,
//     via /method-detail?uid=<owner:id>, so read mode works at the bench with no
//     signal. In demo mode the DEMO_LIBRARY fixture stands in so recordings work.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useTheme, palette, fonts } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import {
  fetchSnapshot,
  type MethodSnapshot,
  type MethodProjection,
  type LibraryMethodEntry,
} from '@/lib/snapshots';
import {
  DEMO_LIBRARY,
  METHOD_TYPE_META,
  typeMeta,
  nextSort,
  sortLabel,
  type LibrarySort,
} from '@/lib/method-library';
import {
  loadCachedLibrary,
  syncLibrary,
  getFavorites,
  toggleFavorite,
  getOptIn,
  setOptIn,
  checkLibraryUpdate,
} from '@/lib/method-library-store';

// A library row as the list renders it. Built from the cached LibraryMethodEntry
// (real) or the DEMO_LIBRARY fixture (demo mode), normalized to one shape.
type Row = {
  uid: string;
  name: string;
  type: string; // a key in METHOD_TYPE_META (resolvedType / methodType)
  favorite: boolean;
  onPhone: boolean; // downloaded for offline use (true once cached)
};

// Real offline sync states. 'downloading' covers both the initial download and
// applying an update.
type OfflineState = 'none' | 'downloading' | 'ready' | 'update';

function offlineChipLabel(state: OfflineState, count: number): string {
  if (state === 'downloading') return 'Downloading';
  if (state === 'ready') return `${count} offline`;
  if (state === 'update') return 'Update available';
  return 'Download for offline';
}

// Pick the display type for a cached entry: the resolved viewer type maps to a
// METHOD_TYPE_META key when one exists, else fall back to the raw methodType.
function entryType(m: LibraryMethodEntry): string {
  const resolved = m.resolvedType ?? m.methodType ?? 'markdown';
  if (resolved in METHOD_TYPE_META) return resolved;
  if (m.methodType && m.methodType in METHOD_TYPE_META) return m.methodType;
  return resolved;
}

// Dim wash of a #rrggbb type color, for the thumbnail background (contract
// .thumb uses a type-dim fill with a colored mono glyph, not a solid fill).
function dimColor(hex: string, alpha = 0.14): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'rgba(71,85,105,0.14)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---- Type thumbnail (contract .thumb): dim type-color tile + mono glyph -----
function TypeIcon({
  type,
  size = 46,
  borderColor,
}: {
  type: string;
  size?: number;
  borderColor: string;
}) {
  const meta = typeMeta(type);
  return (
    <View
      style={[
        styles.tico,
        {
          width: size,
          height: size,
          borderRadius: 11,
          backgroundColor: dimColor(meta.color),
          borderColor,
        },
      ]}
    >
      <ThemedText style={[styles.ticoTxt, { color: meta.color }]}>{meta.label[0]}</ThemedText>
    </View>
  );
}

// ---- A library row ---------------------------------------------------------
function MethodRow({
  m,
  first,
  onPress,
  onToggleFav,
}: {
  m: Row;
  first: boolean;
  onPress: () => void;
  onToggleFav: () => void;
}) {
  const { surface } = useTheme();
  const meta = typeMeta(m.type);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.mrow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.hairline },
        pressed && { backgroundColor: surface.pressed },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${m.name}`}
    >
      <TypeIcon type={m.type} borderColor={surface.border} />
      <View style={styles.mrowBody}>
        <ThemedText numberOfLines={1} style={[styles.mrowName, { color: surface.text }]}>
          {m.name}
        </ThemedText>
        <ThemedText style={[styles.mrowSub, { color: surface.muted }]}>{meta.label}</ThemedText>
      </View>
      <Pressable
        onPress={onToggleFav}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={m.favorite ? `Unfavorite ${m.name}` : `Favorite ${m.name}`}
      >
        <Ionicons
          name={m.favorite ? 'star' : 'star-outline'}
          size={17}
          color={m.favorite ? palette.amber : surface.faint}
        />
      </Pressable>
      {m.onPhone ? <Ionicons name="checkmark-circle" size={16} color={palette.success} /> : null}
    </Pressable>
  );
}

export default function MethodLibraryScreen() {
  const router = useRouter();
  const { surface, radii, shadow } = useTheme();
  const { pairing } = usePairing();
  const isDemo = !!pairing?.demo;

  // Real active-experiment method snapshot (drives the recommendations band).
  const [snapshot, setSnapshot] = useState<MethodSnapshot | null>(null);

  // The library rows (real cache, or DEMO_LIBRARY in demo mode).
  const [rowsAll, setRowsAll] = useState<Row[]>([]);
  const [offline, setOffline] = useState<OfflineState>('none');
  const [promptOpen, setPromptOpen] = useState(false);

  const loadSnapshot = useCallback(async () => {
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

  // Map cached entries -> display rows.
  const toRows = useCallback(
    (methods: LibraryMethodEntry[]): Row[] =>
      methods.map((m, i) => ({
        uid: m.uid ?? `idx-${i}`,
        name: m.name ?? 'Method',
        type: entryType(m),
        favorite: false, // overlaid from the local favorites set below
        onPhone: true, // anything in the cache is on the phone
      })),
    [],
  );

  // Demo rows from the fixture, normalized to the Row shape.
  const demoRows: Row[] = useMemo(
    () =>
      DEMO_LIBRARY.map((m) => ({
        uid: m.id,
        name: m.name,
        type: m.type,
        favorite: m.favorite,
        onPhone: m.onPhone,
      })),
    [],
  );

  // Overlay the local-only favorites set onto a row list.
  const applyFavorites = useCallback(async (rows: Row[]): Promise<Row[]> => {
    const favs = await getFavorites();
    return rows.map((r) => ({ ...r, favorite: favs.has(r.uid) }));
  }, []);

  // Load the cache (instant, offline-ok) then sync in the background.
  const loadLibrary = useCallback(async () => {
    if (isDemo) {
      setRowsAll(demoRows);
      setOffline('ready');
      return;
    }
    if (!pairing) {
      setRowsAll([]);
      setOffline('none');
      return;
    }

    const optedIn = await getOptIn();
    const cached = await loadCachedLibrary();
    if (cached.methods.length > 0) {
      setRowsAll(await applyFavorites(toRows(cached.methods)));
      setOffline('ready');
    } else if (!optedIn) {
      setRowsAll([]);
      setOffline('none');
    }

    // Background sync (only when opted in). Never blocks the cache render.
    if (optedIn) {
      const result = await syncLibrary(pairing, signWithDevice);
      setRowsAll(await applyFavorites(toRows(result.methods)));
      if (result.methods.length > 0) setOffline('ready');
      else if (result.ok) setOffline('none');
    } else {
      // Not opted in but a fetch might show there is something to download. Quiet
      // check so the prompt copy can be honest, no save until the user accepts.
      const check = await checkLibraryUpdate(pairing, signWithDevice);
      if (check?.latestVersion) setOffline('none');
    }
  }, [isDemo, pairing, demoRows, applyFavorites, toRows]);

  const pairingKey = pairing ? `${pairing.u}:${pairing.relayUrl}:${isDemo}` : 'none';
  useEffect(() => {
    void loadSnapshot();
    void loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingKey]);
  useFocusEffect(
    useCallback(() => {
      void loadSnapshot();
      void loadLibrary();
    }, [loadSnapshot, loadLibrary]),
  );

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [sort, setSort] = useState<LibrarySort>('type');

  const activeMethods: MethodProjection[] = Array.isArray(snapshot?.methods)
    ? snapshot!.methods!
    : [];
  const experimentName = snapshot?.experimentName;

  const total = rowsAll.length;

  // Filtered + searched rows.
  const rows = useMemo(() => {
    const ql = query.trim().toLowerCase();
    return rowsAll.filter((m) => {
      if (filter !== 'all' && m.type !== filter) return false;
      if (!ql) return true;
      return m.name.toLowerCase().includes(ql) || typeMeta(m.type).label.toLowerCase().includes(ql);
    });
  }, [rowsAll, query, filter]);

  // The recs band shows only when not actively searching/filtering.
  const showRecs = !query.trim() && filter === 'all' && activeMethods.length > 0;

  // Only show the type filter chips that actually appear in the library.
  const presentTypes = useMemo(() => {
    const set = new Set(rowsAll.map((r) => r.type));
    return Object.keys(METHOD_TYPE_META).filter((t) => set.has(t));
  }, [rowsAll]);
  const filterChips = ['all', ...presentTypes];

  // Begin the offline download: opt in, run an initial sync, show progress.
  const beginDownload = useCallback(async () => {
    setPromptOpen(false);
    if (!pairing || isDemo) return;
    setOffline('downloading');
    await setOptIn(true);
    const result = await syncLibrary(pairing, signWithDevice);
    setRowsAll(await applyFavorites(toRows(result.methods)));
    setOffline(result.methods.length > 0 ? 'ready' : 'none');
  }, [pairing, isDemo, applyFavorites, toRows]);

  // Apply an available update (re-sync, which saves the new version).
  const applyUpdate = useCallback(async () => {
    if (!pairing || isDemo) return;
    setOffline('downloading');
    const result = await syncLibrary(pairing, signWithDevice);
    setRowsAll(await applyFavorites(toRows(result.methods)));
    setOffline('ready');
  }, [pairing, isDemo, applyFavorites, toRows]);

  // Status chip tap: route by real state.
  const onChipPress = useCallback(() => {
    if (offline === 'none') {
      setPromptOpen(true);
    } else if (offline === 'update') {
      void applyUpdate();
    }
    // 'ready' and 'downloading' are non-interactive.
  }, [offline, applyUpdate]);

  // Open read mode. A real library row resolves from the offline cache by uid; a
  // rec deep-links to the focused experiment method. Demo rows route by uid too
  // (the demo cache is the fixture, resolved the same way once wired live).
  const openLibraryRow = useCallback(
    (uid: string) => {
      // Demo mode resolves the tapped row to its seeded read projection by uid, so
      // every seeded type opens its own reader (one method per type for review).
      if (isDemo) {
        router.push(`/method-detail?demo=${encodeURIComponent(uid)}`);
        return;
      }
      router.push(`/method-detail?uid=${encodeURIComponent(uid)}`);
    },
    [router, isDemo],
  );
  const openRec = useCallback(() => router.push('/method-detail?read=1'), [router]);

  const onToggleFav = useCallback(async (uid: string) => {
    const next = await toggleFavorite(uid);
    setRowsAll((prev) => prev.map((r) => (r.uid === uid ? { ...r, favorite: next } : r)));
  }, []);

  // Group rows by type for the default "Type" sort, else flat sorted list.
  const grouped = useMemo(() => {
    if (sort === 'name') {
      return [{ type: null as string | null, items: [...rows].sort((a, b) => a.name.localeCompare(b.name)) }];
    }
    if (sort === 'recent') {
      // No real recency yet, keep cache order as a stand-in.
      return [{ type: null as string | null, items: rows }];
    }
    const byType = new Map<string, Row[]>();
    rows.forEach((m) => {
      const arr = byType.get(m.type) ?? [];
      arr.push(m);
      byType.set(m.type, arr);
    });
    return Array.from(byType.entries()).map(([type, items]) => ({ type, items }));
  }, [rows, sort]);

  return (
    <ScreenFrame>
      <View style={styles.head}>
        {/* Contract title header. Notifications + settings live on Home. */}
        <ThemedText style={[styles.greet, { color: surface.muted }]}>Protocol library</ThemedText>
        <ThemedText type="title">Methods</ThemedText>

        {/* Offline download status chip (real sync state), now below the header. */}
        <View style={styles.offchipRow}>
          <Pressable
            onPress={onChipPress}
            style={[
              styles.offchip,
              { borderColor: surface.border, backgroundColor: surface.sunken },
              offline === 'ready' && { borderColor: palette.successLight, backgroundColor: palette.successLight },
              offline === 'update' && { borderColor: palette.amberBorder, backgroundColor: palette.amberDim },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Offline status"
          >
            {offline === 'downloading' ? (
              <ActivityIndicator size="small" color={surface.muted} />
            ) : (
              <View
                style={[
                  styles.offdot,
                  {
                    backgroundColor:
                      offline === 'ready' ? palette.success : offline === 'update' ? palette.warning : surface.muted,
                  },
                ]}
              />
            )}
            <ThemedText
              style={[
                styles.offtxt,
                {
                  color:
                    offline === 'ready' ? palette.success : offline === 'update' ? palette.warning : surface.muted,
                },
              ]}
            >
              {offlineChipLabel(offline, total)}
            </ThemedText>
          </Pressable>
        </View>

        {/* Live search. */}
        <View
          style={[
            styles.search,
            shadow.sm,
            { backgroundColor: surface.surface, borderColor: surface.borderStrong, borderRadius: radii.md },
          ]}
        >
          <Ionicons name="search" size={18} color={surface.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={total > 0 ? `Search ${total} methods` : 'Search methods'}
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
      {filterChips.length > 1 ? (
        <View style={styles.filtersWrap}>
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
                    { borderColor: surface.border, backgroundColor: surface.surface },
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
      ) : null}

      {/* Count + sort. */}
      <View style={styles.sortRow}>
        <ThemedText style={[styles.cnt, { color: surface.faint }]}>
          {rows.length} of {total} methods
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
                  onPress={openRec}
                  style={({ pressed }) => [
                    styles.recmeth,
                    { backgroundColor: surface.surface, borderColor: surface.border },
                    pressed && { backgroundColor: surface.pressed },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${m.name ?? 'method'}`}
                >
                  <View style={[styles.activedot, { backgroundColor: palette.success }]} />
                  <TypeIcon type={t} size={36} borderColor={surface.border} />
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

        {/* Library list. */}
        {total === 0 && offline === 'none' ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="cloud-download-outline" size={40} color={surface.muted} />
            <ThemedText style={[styles.emptyTtl, { color: surface.text }]}>
              Your library is not on this phone yet
            </ThemedText>
            <ThemedText style={[styles.emptyDesc, { color: surface.muted }]}>
              Download it so read mode works at the bench with no signal.
            </ThemedText>
            <Pressable
              onPress={() => setPromptOpen(true)}
              style={[styles.emptyBtn, { backgroundColor: palette.sky }]}
              accessibilityRole="button"
              accessibilityLabel="Download library"
            >
              <ThemedText style={[styles.emptyBtnTxt, { color: palette.white }]}>Download for offline</ThemedText>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <ThemedText style={[styles.noResult, { color: surface.muted }]}>
            No methods match. Try a different term or filter.
          </ThemedText>
        ) : (
          grouped.map((g, gi) => (
            <View key={g.type ?? `grp-${gi}`}>
              {g.type ? (
                <ThemedText style={[styles.grphdr, { color: surface.faint }]}>
                  {typeMeta(g.type).label}
                </ThemedText>
              ) : null}
              <View
                style={[
                  styles.groupCard,
                  shadow.sm,
                  { backgroundColor: surface.surface, borderColor: surface.border, borderRadius: radii.lg },
                ]}
              >
                {g.items.map((m, ri) => (
                  <MethodRow
                    key={m.uid}
                    m={m}
                    first={ri === 0}
                    onPress={() => openLibraryRow(m.uid)}
                    onToggleFav={() => void onToggleFav(m.uid)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Offline download prompt (real download trigger). */}
      {promptOpen ? (
        <>
          <Pressable style={styles.scrim} onPress={() => setPromptOpen(false)} accessibilityLabel="Dismiss" />
          <View style={[styles.prompt, { backgroundColor: surface.surface, borderTopColor: surface.border }]}>
            <ThemedText style={[styles.promptTtl, { color: surface.text }]}>Download your method library?</ThemedText>
            <ThemedText style={[styles.promptDesc, { color: surface.muted }]}>
              Keep your methods on this phone so read mode works at the bench with no signal. We will quietly update it
              when your laptop changes a method.
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
                onPress={() => void beginDownload()}
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
  head: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  greet: { fontSize: 12.5, fontFamily: fonts.semibold, marginBottom: 4 },
  offchipRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  offchip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1 },
  offdot: { width: 7, height: 7, borderRadius: 999 },
  offtxt: { fontSize: 10.5, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, marginTop: 12 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: fonts.ui, padding: 0 },
  filtersWrap: { paddingTop: 14 },
  filters: { gap: 8, paddingHorizontal: 16, paddingVertical: 2 },
  fchip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  fchipTxt: { fontSize: 13, fontFamily: fonts.semibold, fontWeight: '600' },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 },
  cnt: { fontSize: 12, fontFamily: fonts.bold, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  sortTxt: { fontSize: 12.5, fontFamily: fonts.semibold, fontWeight: '600' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 112 },
  reccard: { padding: 14, marginTop: 8, marginBottom: 4, borderWidth: 1 },
  reclblRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 },
  reclbl: { fontSize: 11, fontFamily: fonts.extrabold, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  recexp: { fontSize: 11.5, fontFamily: fonts.bold, fontWeight: '700', marginBottom: 8, marginLeft: 2 },
  recmeth: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 12, marginBottom: 8, borderWidth: 1 },
  activedot: { width: 8, height: 8, borderRadius: 999 },
  tico: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  ticoTxt: { fontSize: 14, fontFamily: fonts.monoSemibold, fontWeight: '600' },
  groupCard: { paddingHorizontal: 14, paddingVertical: 2, borderWidth: 1, marginBottom: 4 },
  mrow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 2 },
  mrowBody: { flex: 1, minWidth: 0 },
  mrowName: { fontSize: 14, fontFamily: fonts.semibold, fontWeight: '600' },
  mrowSub: { fontSize: 12, fontFamily: fonts.medium, marginTop: 2 },
  grphdr: { fontSize: 12, fontFamily: fonts.bold, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', paddingTop: 16, paddingBottom: 8, paddingHorizontal: 4 },
  noResult: { textAlign: 'center', fontSize: 13, paddingVertical: 40, paddingHorizontal: 20 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 28, gap: 10 },
  emptyTtl: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyDesc: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  emptyBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  emptyBtnTxt: { fontSize: 14.5, fontWeight: '800' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,34,0.34)' },
  prompt: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28 },
  promptTtl: { fontSize: 17, fontWeight: '800' },
  promptDesc: { fontSize: 13, lineHeight: 20, marginTop: 7, marginBottom: 14 },
  promptActs: { flexDirection: 'row', gap: 10 },
  promptBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  promptBtnTxt: { fontSize: 14.5, fontWeight: '800' },
});
