// Notifications on phone (phone channel, 2026-06-12). The laptop routes the
// notification categories you turned on for your phone (Settings, Notifications)
// into a sealed "notifications" snapshot. This screen fetches + unseals it and
// lists them at the bench: a category icon, an unread dot, a category title, the
// one-line body, and a relative time.
//
// This is a synced LIST, not an OS push. The laptop publishes while it is open;
// this screen shows the latest list on open and on pull-to-refresh. Read state
// is owned by the laptop (the bell), so this list mirrors it rather than marking
// read here.
//
// Polished to the locked UI contract (docs/mockups/mobile-contract/
// 06-notifications-components.html, "Notifications list" + "empty"): one tight
// card of .notif rows split by hairlines, each row leading with a category-tinted
// .ni icon chip + an unread .nd dot, a 14/700 title, a muted one-line body, and a
// faint 11.5 relative time. The empty state is the branded "All caught up" tile.
// Geist via design tokens.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useTheme, palette, fonts } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { registerPushToken } from '@/lib/push-token';
import {
  fetchNotificationsSnapshot,
  type NotificationsSnapshot,
  type SnapshotNotification,
} from '@/lib/snapshots';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Category -> tinted icon chip, mirroring the contract's .ni treatment
// (Reminder=amber clock, Shared=sky lines, Purchases=success bag, Lab=violet
// building). Each carries the dim fill + saturated glyph from contract.css; the
// fallback keeps the brand sky so an unrecognised category still reads as ours.
function categoryVisual(category?: string): {
  icon: IoniconName;
  tint: string;
  fill: string;
} {
  const key = (category ?? '').toLowerCase();
  if (key.includes('remind') || key.includes('timer') || key.includes('task')) {
    return { icon: 'alarm-outline', tint: palette.amber, fill: palette.amberDim };
  }
  if (key.includes('shar') || key.includes('collab') || key.includes('method')) {
    return { icon: 'git-network-outline', tint: palette.sky, fill: palette.skyDim };
  }
  if (key.includes('purchas') || key.includes('order') || key.includes('approv')) {
    return { icon: 'bag-check-outline', tint: palette.success, fill: palette.successDim };
  }
  if (key.includes('lab') || key.includes('meeting') || key.includes('team')) {
    return { icon: 'business-outline', tint: palette.violet, fill: palette.violetDim };
  }
  return { icon: 'notifications-outline', tint: palette.sky, fill: palette.skyDim };
}

export default function NotificationsScreen() {
  const { surface, shadow } = useTheme();
  const { pairing } = usePairing();

  const [snapshot, setSnapshot] = useState<NotificationsSnapshot | null>(null);
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
      const data = await fetchNotificationsSnapshot(pairing, signWithDevice);
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
    // Refresh this device's push token whenever the notifications screen opens
    // (phone push P1). Covers an Expo token rotation and an OS notification grant
    // given after pairing. Fire and forget + demo-safe inside registerPushToken.
    if (pairing) void registerPushToken(pairing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingKey]);

  const items: SnapshotNotification[] = Array.isArray(snapshot?.notifications)
    ? snapshot!.notifications!
    : [];

  return (
    <ScreenFrame>
      <ScreenHeader title="Notifications" />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={palette.sky}
          />
        }
      >
        <ThemedText style={[styles.tagline, { color: surface.muted }]}>
          Routed to your phone in Settings. Your laptop sends these while it is
          open.
        </ThemedText>

        {error ? (
          <View
            style={[
              styles.errorBanner,
              {
                borderColor: palette.dangerBorder,
                backgroundColor: palette.dangerLight,
              },
            ]}
          >
            <Ionicons
              name="cloud-offline-outline"
              size={17}
              color={palette.danger}
              style={styles.errorIcon}
            />
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

        {loaded && !pairing ? (
          <StateCard
            icon="phone-portrait-outline"
            title="Pair this phone"
            body="Pair this phone with your laptop to see the notifications you routed here."
          />
        ) : null}

        {loaded && pairing && snapshot === null && !error ? (
          <StateCard
            icon="laptop-outline"
            title="Not synced yet"
            body="Open ResearchOS on your laptop, and turn on the phone channel for a category in Settings, Notifications."
          />
        ) : null}

        {loaded && pairing && snapshot !== null && !error ? (
          items.length > 0 ? (
            <View
              style={[
                styles.listCard,
                shadow.sm,
                {
                  backgroundColor: surface.surface,
                  borderColor: surface.border,
                },
              ]}
            >
              {items.map((n, i) => (
                <NotificationRow
                  key={n.id ?? `notif-${i}`}
                  notification={n}
                  first={i === 0}
                />
              ))}
            </View>
          ) : (
            <CaughtUp />
          )
        ) : null}

        {snapshot?.generatedAt ? (
          <View style={styles.syncedRow}>
            <Ionicons
              name="checkmark-circle"
              size={13}
              color={surface.faint}
            />
            <ThemedText style={[styles.synced, { color: surface.faint }]}>
              Last synced {formatSynced(snapshot.generatedAt)}
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

// A branded info card for the pairing / not-synced states. Leads with a sky
// icon chip so an empty surface still reads as ours, not a bare paragraph.
function StateCard({
  icon,
  title,
  body,
}: {
  icon: IoniconName;
  title: string;
  body: string;
}) {
  const { surface, radii, shadow } = useTheme();
  return (
    <View
      style={[
        styles.stateCard,
        shadow.sm,
        {
          backgroundColor: surface.surface,
          borderColor: surface.border,
          borderRadius: radii.lg,
        },
      ]}
    >
      <View style={[styles.stateIcon, { backgroundColor: palette.skyDim }]}>
        <Ionicons name={icon} size={20} color={palette.sky} />
      </View>
      <View style={styles.stateBody}>
        <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
          {title}
        </ThemedText>
        <ThemedText style={[styles.stateText, { color: surface.muted }]}>
          {body}
        </ThemedText>
      </View>
    </View>
  );
}

// The branded "All caught up" empty state (contract .empty in the empty phone).
function CaughtUp() {
  const { surface, radii } = useTheme();
  return (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.skyDim, borderRadius: radii.lg }]}>
        <Ionicons name="notifications-outline" size={27} color={palette.sky} />
      </View>
      <ThemedText style={[styles.emptyTitle, { color: surface.text }]}>
        All caught up
      </ThemedText>
      <ThemedText style={[styles.emptyText, { color: surface.muted }]}>
        Notifications you route to your phone in Settings will show up here.
      </ThemedText>
    </View>
  );
}

function NotificationRow({
  notification,
  first,
}: {
  notification: SnapshotNotification;
  first: boolean;
}) {
  const { surface } = useTheme();
  const unread = notification.read === false;
  const visual = categoryVisual(notification.category);
  const title =
    notification.title && notification.title.length > 0
      ? notification.title
      : 'ResearchOS';
  const body =
    notification.body && notification.body.length > 0
      ? notification.body
      : 'Open ResearchOS to see it.';
  const when = notification.createdAt
    ? formatRelative(notification.createdAt)
    : '';
  return (
    <View
      style={[
        styles.notif,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: surface.hairline,
        },
      ]}
    >
      {/* Unread dot (.nd): filled coral when unread, a hollow ring when read. */}
      <View
        style={[
          styles.unreadDot,
          unread
            ? { backgroundColor: palette.coral }
            : { borderWidth: 1, borderColor: surface.borderStrong },
        ]}
      />
      {/* Category icon chip (.ni): tinted square carrying the category glyph. */}
      <View style={[styles.iconChip, { backgroundColor: visual.fill }]}>
        <Ionicons name={visual.icon} size={18} color={visual.tint} />
      </View>
      <View style={styles.notifBody}>
        <ThemedText
          style={[
            styles.rowTitle,
            { color: surface.text, fontFamily: unread ? fonts.extrabold : fonts.bold },
          ]}
          numberOfLines={1}
        >
          {title}
        </ThemedText>
        <ThemedText
          style={[styles.rowBody, { color: surface.muted }]}
          numberOfLines={2}
        >
          {body}
        </ThemedText>
        {when ? (
          <ThemedText style={[styles.rowWhen, { color: surface.faint }]}>
            {when}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

function formatSynced(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// A short relative label ("just now", "3h ago", "Jun 11"). Old enough rows fall
// back to a short absolute date so the list stays readable.
function formatRelative(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return '';
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
    gap: 14,
  },
  tagline: { fontSize: 13, fontFamily: fonts.ui, lineHeight: 20, marginLeft: 2 },

  // One tight card holding every notif row, split by hairlines (contract
  // .card.card-tight + .notif + .notif border-top).
  listCard: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  notif: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 2,
  },
  unreadDot: { width: 9, height: 9, borderRadius: 999, marginTop: 14 },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, lineHeight: 19 },
  rowBody: { fontSize: 13, fontFamily: fonts.ui, lineHeight: 18, marginTop: 2 },
  rowWhen: { fontSize: 11.5, fontFamily: fonts.semibold, lineHeight: 16, marginTop: 4 },

  // Branded info cards (pair / not-synced).
  stateCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    borderWidth: 1,
    padding: 16,
  },
  stateIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateBody: { flex: 1, minWidth: 0, gap: 4 },
  cardTitle: { fontSize: 16, fontFamily: fonts.bold, lineHeight: 22 },
  stateText: { fontSize: 13.5, fontFamily: fonts.ui, lineHeight: 20 },

  // Empty "All caught up" state (contract .empty).
  emptyWrap: { alignItems: 'center', paddingTop: 44, paddingHorizontal: 24, gap: 6 },
  emptyIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  emptyTitle: { fontSize: 15.5, fontFamily: fonts.bold, lineHeight: 21 },
  emptyText: {
    fontSize: 13,
    fontFamily: fonts.ui,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 240,
  },

  syncedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 2 },
  synced: { fontSize: 12, fontFamily: fonts.medium, lineHeight: 16 },

  loadingWrap: { paddingVertical: 24, alignItems: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorIcon: { marginTop: 1 },
  errorText: { flex: 1, fontSize: 13.5, fontFamily: fonts.medium, lineHeight: 20 },
});
