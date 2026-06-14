// Inventory tab: dedicated supply-management home. Scan a package hero card
// routes to the existing scan flow. Add a purchase item is the manual path.
// Below these, tracked items (barcode stocks with units ledger) and recent
// purchase orders are shown from the inventory snapshot the laptop publishes.
// All snapshot fields are tolerated missing. House style: no em-dashes,
// no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { useUnreadNotificationCount } from '@/lib/unread-notifications';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTheme, palette, fonts } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot } from '@/lib/snapshots';
import type { InventorySnapshot, TrackedStock, RecentPurchase } from '@/lib/scan';

// A tracked stock is low when its remaining units have hit its reorder point.
function stockIsLow(stock: TrackedStock): boolean {
  return (
    stock.lowAtCount != null &&
    typeof stock.unitsRemaining === 'number' &&
    stock.unitsRemaining <= stock.lowAtCount
  );
}

export default function InventoryScreen() {
  const router = useRouter();
  const { surface, spacing } = useTheme();
  const unreadCount = useUnreadNotificationCount();

  const { pairing, loading: pairingLoading, refresh: refreshPairing } =
    usePairing();

  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!pairing) {
      setSnapshot(null);
      setLoaded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = (await fetchSnapshot(
        'inventory',
        pairing,
        signWithDevice,
      )) as InventorySnapshot | null;
      setSnapshot(data);
      setLoaded(true);
    } catch {
      setError('Could not sync. Pull down to try again.');
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
      refreshPairing();
    }, [refreshPairing]),
  );

  const trackedStocks: TrackedStock[] = Array.isArray(snapshot?.trackedStocks)
    ? snapshot!.trackedStocks!
    : [];
  const recentPurchases: RecentPurchase[] = Array.isArray(snapshot?.recentPurchases)
    ? snapshot!.recentPurchases!
    : [];

  // One-tap "Reorder low" filter on the tracked-items section.
  const [lowOnly, setLowOnly] = useState(false);
  const hasLow = trackedStocks.some(stockIsLow);
  const shownStocks = lowOnly ? trackedStocks.filter(stockIsLow) : trackedStocks;

  return (
    <ScreenFrame edges={['top']}>
      <View style={styles.head}>
        <ThemedText style={[styles.greet, { color: surface.muted }]}>
          {pairing?.labName ?? 'Your lab'}
        </ThemedText>
        <ThemedText type="title">Inventory</ThemedText>
      </View>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={palette.sky}
          />
        }
      >

        {/* Not paired prompt */}
        {!pairing && (pairingLoading || !loaded) ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.sky} />
          </View>
        ) : null}

        {!pairing && loaded ? (
          <Card style={{ gap: spacing.sm }}>
            <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
              Pair this phone
            </ThemedText>
            <ThemedText style={[styles.tagline, { color: surface.muted }]}>
              Pair this phone with your laptop to see your lab inventory.
            </ThemedText>
            <Button
              testID="inventory-pair-cta"
              variant="primary"
              label="Pair this phone"
              onPress={() => router.push('/pair')}
              style={{ marginTop: spacing.xs }}
            />
          </Card>
        ) : null}

        {pairing ? (
          <>
            {/* Scan hero */}
            <ScanHeroCard onPress={() => router.push('/scan')} />

            {/* Add a purchase item (manual path) */}
            <Button
              testID="inventory-add-purchase"
              variant="secondary"
              label="+ Add a purchase item"
              onPress={() => router.push('/add-purchase')}
            />

            {/* Error banner */}
            {error ? (
              <View
                style={[
                  styles.errorBanner,
                  {
                    borderColor: palette.dangerBorder,
                    backgroundColor: palette.dangerLight,
                    borderRadius: 12,
                  },
                ]}
              >
                <ThemedText style={[styles.errorText, { color: palette.danger }]}>
                  {error}
                </ThemedText>
              </View>
            ) : null}

            {loading && !loaded ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={palette.sky} />
              </View>
            ) : null}

            {/* Tracked items */}
            <SectionLabel
              title="Tracked items"
              action={hasLow ? (lowOnly ? 'Show all' : 'Reorder low') : undefined}
              onAction={hasLow ? () => setLowOnly((v) => !v) : undefined}
            />
            {shownStocks.length > 0 ? (
              <Card>
                {shownStocks.map((stock, i) => (
                  <TrackedStockRow
                    key={stock.stockId != null ? String(stock.stockId) : `stock-${i}`}
                    testID={`inventory-tracked-row-${i}`}
                    stock={stock}
                    last={i === shownStocks.length - 1}
                  />
                ))}
              </Card>
            ) : loaded ? (
              <EmptyState
                icon="cube-outline"
                text="No tracked items yet. Scan a barcode to start tracking."
              />
            ) : null}

            {/* Purchase orders */}
            <SectionLabel title="Purchase orders" />
            {recentPurchases.length > 0 ? (
              <Card>
                {recentPurchases.map((po, i) => (
                  <PurchaseOrderRow
                    key={po.purchaseItemId != null ? String(po.purchaseItemId) : `po-${i}`}
                    testID={`inventory-order-row-${i}`}
                    purchase={po}
                    last={i === recentPurchases.length - 1}
                  />
                ))}
              </Card>
            ) : loaded ? (
              <EmptyState
                icon="receipt-outline"
                text="No purchase orders yet. Add a purchase item above."
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

// Sky-gradient hero card matching the contract (Inventory hero):
// linear-gradient(140deg, --sky, #39b4ff), white text, 48 icon tile on
// rgba(255,255,255,.22), shadow-md lift, trailing chevron.
function ScanHeroCard({ onPress }: { onPress: () => void }) {
  const { radii, shadow } = useTheme();
  return (
    <Pressable
      testID="inventory-scan-package"
      onPress={onPress}
      style={({ pressed }) => [
        { borderRadius: radii.lg },
        shadow.md,
        {
          opacity: pressed ? 0.94 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <LinearGradient
        // 140deg in CSS maps to start top-left, end bottom-right tilt.
        colors={[palette.sky, '#39b4ff']}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={[styles.scanHero, { borderRadius: radii.lg }]}
      >
        <View style={styles.scanHeroIcon}>
          <Ionicons name="scan-outline" size={26} color={palette.white} />
        </View>
        <View style={styles.scanHeroText}>
          <ThemedText style={styles.scanHeroTitle}>Scan a package</ThemedText>
          <ThemedText style={styles.scanHeroSub} numberOfLines={2}>
            Receive, track, and reorder
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.92)" />
      </LinearGradient>
    </Pressable>
  );
}

// Contract .lbl: small uppercase faint section label with an optional sky
// action link on the right. Used for "Tracked items" / "Purchase orders".
function SectionLabel({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const { surface } = useTheme();
  return (
    <View style={styles.sectionLabelRow}>
      <ThemedText style={[styles.sectionLabel, { color: surface.faint }]}>
        {title}
      </ThemedText>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <ThemedText style={[styles.sectionAction, { color: palette.sky }]}>
            {action}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function TrackedStockRow({
  stock,
  last,
  testID,
}: {
  stock: TrackedStock;
  last: boolean;
  testID?: string;
}) {
  const { surface } = useTheme();
  const name = stock.itemName ?? 'Unknown item';
  const remaining = stock.unitsRemaining ?? 0;
  const total = stock.totalUnits ?? 0;
  const unitLabel = stock.unitLabel ?? '';
  const isLow =
    stock.lowAtCount != null &&
    typeof stock.unitsRemaining === 'number' &&
    stock.unitsRemaining <= stock.lowAtCount;

  const unitsText = total > 0
    ? `${remaining} of ${total}${unitLabel ? ` ${unitLabel}` : ''} left`
    : `${remaining}${unitLabel ? ` ${unitLabel}` : ''} left`;

  return (
    <View
      testID={testID}
      style={[
        styles.listRow,
        { borderBottomColor: surface.hairline },
        last ? styles.rowLast : null,
      ]}
    >
      <View
        style={[
          styles.thumb,
          isLow
            ? { backgroundColor: palette.dangerDim, borderColor: 'transparent' }
            : { backgroundColor: palette.skyDim, borderColor: palette.skyBorder },
        ]}
      >
        <Ionicons
          name="cube-outline"
          size={18}
          color={isLow ? palette.danger : palette.sky}
        />
      </View>
      <View style={styles.rowText}>
        <ThemedText style={[styles.rowTitle, { color: surface.text }]} numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
          {unitsText}
        </ThemedText>
      </View>
      <View
        style={[
          styles.pill,
          { backgroundColor: isLow ? palette.dangerDim : palette.successDim },
        ]}
      >
        <ThemedText
          style={[
            styles.pillText,
            { color: isLow ? palette.danger : palette.success },
          ]}
        >
          {isLow ? 'Low' : 'OK'}
        </ThemedText>
      </View>
    </View>
  );
}

function PurchaseOrderRow({
  purchase,
  last,
  testID,
}: {
  purchase: RecentPurchase;
  last: boolean;
  testID?: string;
}) {
  const { surface, dark } = useTheme();
  const name = purchase.name ?? 'Unknown item';
  const vendor = purchase.vendor ?? null;
  const orderedDate = purchase.orderedDate
    ? formatShortDate(purchase.orderedDate)
    : null;
  const subParts = [vendor, orderedDate ? `ordered ${orderedDate}` : null].filter(
    Boolean,
  );

  // A purchase in the recentPurchases list is ordered but not yet arrived.
  const status = 'Ordered';

  return (
    <View
      testID={testID}
      style={[
        styles.listRow,
        { borderBottomColor: surface.hairline },
        last ? styles.rowLast : null,
      ]}
    >
      <View
        style={[
          styles.thumb,
          {
            backgroundColor: surface.sunken,
            borderColor: surface.border,
          },
        ]}
      >
        <Ionicons
          name="receipt-outline"
          size={18}
          color={dark ? surface.faint : palette.faint}
        />
      </View>
      <View style={styles.rowText}>
        <ThemedText style={[styles.rowTitle, { color: surface.text }]} numberOfLines={1}>
          {name}
        </ThemedText>
        {subParts.length > 0 ? (
          <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
            {subParts.join('  ·  ')}
          </ThemedText>
        ) : null}
      </View>
      <View style={[styles.pill, { backgroundColor: surface.sunken }]}>
        <ThemedText style={[styles.pillText, { color: surface.muted }]}>
          {status}
        </ThemedText>
      </View>
    </View>
  );
}

function formatShortDate(value?: string | null): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  greet: { fontSize: 12.5, fontFamily: fonts.semibold, marginBottom: 5 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 112,
    gap: 14,
  },
  tagline: { lineHeight: 22 },
  cardTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  loadingWrap: { paddingVertical: 24, alignItems: 'center' },
  errorBanner: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  errorText: { lineHeight: 20 },

  // Section label (contract .lbl): 12px / 700, .08em tracking, uppercase, faint.
  // Sits flush with the card gutter; the scroll gap supplies vertical rhythm.
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
    marginBottom: -4,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.bold,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    lineHeight: 16,
  },
  sectionAction: {
    fontSize: 12.5,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },

  // Scan hero
  scanHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  scanHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanHeroText: { flex: 1 },
  scanHeroTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  scanHeroSub: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },

  // List rows (inside Card)
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 2,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  rowLast: { borderBottomWidth: 0 },
  // Contract .thumb: 46x46, radius 11, 1px border, centred glyph.
  thumb: {
    width: 46,
    height: 46,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontFamily: fonts.semibold, fontWeight: '600', lineHeight: 19 },
  rowMeta: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  // Contract .pill: 5px/11px padding, pill radius, 11.5px / 700.
  pill: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontSize: 11.5, fontFamily: fonts.bold, fontWeight: '700' },
});
