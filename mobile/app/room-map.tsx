// Room map (spatial inventory Phase C, phone read-only viewer). Renders the lab's
// 2D room map the laptop publishes (pins marking storage locations on a floor
// plan) so a researcher can SEE where something is. Opened from the Inventory tab
// either plainly or with `?node=<id>` to find a specific item: the screen walks
// that node up to its nearest pinned ancestor and highlights it. House style:
// no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTheme, palette, fonts } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot } from '@/lib/snapshots';
import { SPATIAL_INVENTORY_ENABLED } from '@/lib/features';
import type { InventorySnapshot, LabMapPin, StorageNode, TrackedStock } from '@/lib/scan';

export default function RoomMapScreen() {
  // Spatial inventory (Phase C) is gated off by default. The Inventory tab no
  // longer links here when the flag is off, but guard the route itself so a deep
  // link cannot reach a dormant feature.
  if (!SPATIAL_INVENTORY_ENABLED) {
    return <Redirect href="/inventory" />;
  }
  return <RoomMapScreenInner />;
}

function RoomMapScreenInner() {
  const { surface, spacing } = useTheme();
  const params = useLocalSearchParams<{ node?: string }>();
  const focusNodeId = params.node ? Number(params.node) : null;

  const { pairing, refresh: refreshPairing } = usePairing();
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!pairing) return;
    setLoading(true);
    try {
      const data = (await fetchSnapshot(
        'inventory',
        pairing,
        signWithDevice,
      )) as InventorySnapshot | null;
      setSnapshot(data);
    } catch {
      // Non-fatal: the empty state covers a failed sync.
    } finally {
      setLoading(false);
    }
  }, [pairing]);

  const pairingKey = pairing ? `${pairing.u}:${pairing.relayUrl}` : 'none';
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingKey]);
  useFocusEffect(
    useCallback(() => {
      void refreshPairing();
    }, [refreshPairing]),
  );

  const nodes: StorageNode[] = snapshot?.storageNodes ?? [];
  const externalNodes = nodes.filter((n) => n.isExternal);
  const pins: LabMapPin[] = snapshot?.labMap?.pins ?? [];
  const tracked: TrackedStock[] = snapshot?.trackedStocks ?? [];
  const aspect = snapshot?.labMap?.aspect ?? 1.5;
  const floorplan = snapshot?.labMap?.imageSvg ?? null;

  const nodesById = useMemo(() => {
    const m = new Map<number, StorageNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);
  const pinnedNodeIds = useMemo(
    () => new Set(pins.map((p) => p.nodeId).filter((n): n is number => n != null)),
    [pins],
  );

  // Walk a node up its parent chain to the nearest ancestor that has a pin.
  const pinnedAncestor = useCallback(
    (nodeId: number | null | undefined): number | null => {
      const seen = new Set<number>();
      let cur = nodeId ?? null;
      while (cur != null && !seen.has(cur)) {
        seen.add(cur);
        if (pinnedNodeIds.has(cur)) return cur;
        cur = nodesById.get(cur)?.parentId ?? null;
      }
      return null;
    },
    [nodesById, pinnedNodeIds],
  );

  // The pin to emphasize when arriving from "find on map".
  const focusPinNodeId = useMemo(
    () => (focusNodeId != null ? pinnedAncestor(focusNodeId) : null),
    [focusNodeId, pinnedAncestor],
  );
  useEffect(() => {
    if (focusPinNodeId != null) setSelected(focusPinNodeId);
  }, [focusPinNodeId]);

  // Items located (directly or in a descendant) under a pinned node.
  const itemsUnder = useCallback(
    (pinNodeId: number) =>
      tracked.filter((s) => pinnedAncestor(s.locationNodeId) === pinNodeId).length,
    [tracked, pinnedAncestor],
  );

  const activeNodeId = selected;
  const activeNode = activeNodeId != null ? nodesById.get(activeNodeId) ?? null : null;
  const activePin =
    activeNodeId != null ? pins.find((p) => p.nodeId === activeNodeId) ?? null : null;
  const activeImage = activePin?.image ?? null;
  const couldNotPlace = focusNodeId != null && focusPinNodeId == null;

  // Pinch-zoom + pan on the map. Read-only viewer, so this only transforms what
  // is shown (scale 1..4, panning clamped so the plan always covers the frame).
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const cw = useSharedValue(0);
  const ch = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const clampTranslate = () => {
    'worklet';
    const maxX = Math.max(0, ((scale.value - 1) * cw.value) / 2);
    const maxY = Math.max(0, ((scale.value - 1) * ch.value) / 2);
    tx.value = Math.min(maxX, Math.max(-maxX, tx.value));
    ty.value = Math.min(maxY, Math.max(-maxY, ty.value));
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale));
      clampTranslate();
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        sx.value = 0;
        sy.value = 0;
      }
      runOnJS(setZoomed)(scale.value > 1.01);
    });

  const pan = Gesture.Pan()
    .minDistance(8)
    .onUpdate((e) => {
      'worklet';
      tx.value = sx.value + e.translationX;
      ty.value = sy.value + e.translationY;
      clampTranslate();
    })
    .onEnd(() => {
      'worklet';
      sx.value = tx.value;
      sy.value = ty.value;
    });

  const mapGesture = Gesture.Simultaneous(pinch, pan);
  const mapAnim = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));
  const resetView = () => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    sx.value = 0;
    sy.value = 0;
    setZoomed(false);
  };

  return (
    <ScreenFrame edges={['top']}>
      <ScreenHeader title="Room map" />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {!pairing ? (
          <EmptyState
            icon="phone-portrait-outline"
            text="Pair this phone with your laptop to see the lab map."
          />
        ) : loading && !snapshot ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.sky} />
          </View>
        ) : pins.length === 0 ? (
          <EmptyState
            icon="map-outline"
            text="No room map yet. Build one on your laptop under Inventory, Room map by pinning your freezers and benches on the floor plan."
          />
        ) : (
          <>
            {couldNotPlace ? (
              <View style={[styles.banner, { backgroundColor: palette.dangerDim }]}>
                <Ionicons name="help-circle-outline" size={16} color={palette.danger} />
                <ThemedText style={[styles.bannerText, { color: surface.text }]}>
                  This item's location is not on the map yet.
                </ThemedText>
              </View>
            ) : null}

            <View
              style={[
                styles.canvas,
                {
                  aspectRatio: aspect,
                  borderColor: surface.border,
                  backgroundColor: floorplan ? '#ffffff' : surface.surface2,
                },
              ]}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                cw.value = w;
                ch.value = w / aspect;
              }}
            >
              <GestureDetector gesture={mapGesture}>
                <Animated.View style={[StyleSheet.absoluteFill, mapAnim]}>
              {floorplan ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <SvgXml xml={floorplan} width="100%" height="100%" />
                </View>
              ) : null}
              {/* Tap empty map space to deselect. Pins render after this, so they
                  sit on top and still capture their own taps. */}
              {activeNodeId != null ? (
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => setSelected(null)}
                  accessibilityLabel="Clear selection"
                />
              ) : null}
              {pins.map((pin, i) => {
                if (pin.x == null || pin.y == null) return null;
                const node = pin.nodeId != null ? nodesById.get(pin.nodeId) : null;
                const name = node?.name ?? pin.label ?? 'Pin';
                const on = pin.nodeId != null && pin.nodeId === activeNodeId;
                const dimmed = focusPinNodeId != null && !on;
                return (
                  <Pressable
                    key={`${pin.nodeId ?? 'p'}-${i}`}
                    onPress={() => pin.nodeId != null && setSelected(on ? null : pin.nodeId)}
                    style={[
                      styles.pin,
                      { left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, opacity: dimmed ? 0.45 : 1 },
                    ]}
                  >
                    {/* Label only on the selected pin, so labels never pile up
                        on a dense map. Other pins are just markers; tap to name. */}
                    {on ? (
                      <View
                        style={[
                          styles.pinChip,
                          { backgroundColor: palette.sky, borderColor: palette.sky },
                        ]}
                      >
                        <ThemedText
                          style={[styles.pinText, { color: palette.white }]}
                          numberOfLines={1}
                        >
                          {name}
                        </ThemedText>
                      </View>
                    ) : null}
                    <Ionicons
                      name="location"
                      size={on ? 24 : 20}
                      color={on ? palette.sky : surface.muted}
                    />
                  </Pressable>
                );
              })}
                </Animated.View>
              </GestureDetector>
              {zoomed ? (
                <Pressable
                  onPress={resetView}
                  style={[styles.resetBtn, { backgroundColor: surface.surface, borderColor: surface.border }]}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Reset view"
                >
                  <Ionicons name="contract-outline" size={16} color={surface.muted} />
                </Pressable>
              ) : null}
            </View>

            {activeNode ? (
              <View style={[styles.detail, { borderColor: surface.border, backgroundColor: surface.surface }]}>
                {activeImage ? (
                  <Image
                    source={{ uri: activeImage }}
                    style={[styles.detailPhoto, { borderColor: surface.border }]}
                    resizeMode="cover"
                    accessibilityLabel={`Photo of ${activeNode.name}`}
                  />
                ) : null}
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.detailName, { color: surface.text }]} numberOfLines={1}>
                    {activeNode.name}
                  </ThemedText>
                  <ThemedText style={[styles.detailMeta, { color: surface.muted }]}>
                    {itemsUnder(activeNode.id)} tracked item
                    {itemsUnder(activeNode.id) === 1 ? '' : 's'} here
                  </ThemedText>
                </View>
              </View>
            ) : (
              <ThemedText style={[styles.note, { color: surface.muted }]}>
                Tap a pin to see what is stored there.
              </ThemedText>
            )}
          </>
        )}

        {pairing && externalNodes.length > 0 ? (
          <View style={styles.extSection}>
            <ThemedText style={[styles.extLabel, { color: surface.muted }]}>
              EXTERNAL STORAGE
            </ThemedText>
            <ThemedText style={[styles.extHint, { color: surface.muted }]}>
              Off the room map (a closet, cold room, or shared facility).
            </ThemedText>
            {externalNodes.map((n, i) => (
              <View
                key={n.id ?? `ext-${i}`}
                style={[styles.extRow, { borderColor: surface.border, backgroundColor: surface.surface }]}
              >
                <Ionicons name="open-outline" size={15} color={surface.muted} />
                <ThemedText style={[styles.extName, { color: surface.text }]} numberOfLines={1}>
                  {n.name ?? 'External location'}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 40, alignItems: 'center' },
  extSection: { marginTop: 8, gap: 6 },
  extLabel: { fontSize: 11, letterSpacing: 0.6, fontFamily: fonts.bold, fontWeight: '700' },
  extHint: { fontSize: 12, lineHeight: 16, marginBottom: 2 },
  extRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  extName: { flex: 1, fontSize: 14, fontFamily: fonts.semibold, fontWeight: '600' },
  note: { fontSize: 14, lineHeight: 20 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerText: { fontSize: 13, flex: 1 },
  canvas: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 14,
    position: 'relative',
    overflow: 'hidden',
  },
  pin: {
    position: 'absolute',
    alignItems: 'center',
    // Center the marker on (x,y): shift left half a chip and up the full height.
    transform: [{ translateX: -60 }, { translateY: -44 }],
    width: 120,
  },
  pinChip: {
    maxWidth: 120,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pinText: { fontSize: 11, fontFamily: fonts.semibold, fontWeight: '600', textAlign: 'center' },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  resetBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPhoto: { width: 52, height: 52, borderRadius: 8, borderWidth: 1 },
  detailName: { fontSize: 15, fontFamily: fonts.semibold, fontWeight: '600' },
  detailMeta: { fontSize: 13, marginTop: 1 },
});
