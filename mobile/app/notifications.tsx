// Notifications on phone (phone channel, 2026-06-12). The laptop routes the
// notification categories you turned on for your phone (Settings, Notifications)
// into a sealed "notifications" snapshot. This screen fetches + unseals it and
// lists them at the bench: an unread dot, a category title, the one-line body,
// and a relative time.
//
// This is a synced LIST, not an OS push. The laptop publishes while it is open;
// this screen shows the latest list on open and on pull-to-refresh. Read state
// is owned by the laptop (the bell), so this list mirrors it rather than marking
// read here.
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
import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTheme, palette } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { registerPushToken } from '@/lib/push-token';
import {
  fetchNotificationsSnapshot,
  type NotificationsSnapshot,
  type SnapshotNotification,
} from '@/lib/snapshots';

export default function NotificationsScreen() {
  const { surface } = useTheme();
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
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={palette.sky}
          />
        }
      >
        <ThemedText style={[styles.tagline, { color: surface.muted }]}>
          The notifications you routed to your phone in Settings. Your laptop
          sends these while it is open.
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
          <Card>
            <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
              Pair this phone
            </ThemedText>
            <ThemedText style={[styles.tagline, { color: surface.muted }]}>
              Pair this phone with your laptop to see the notifications you
              routed here.
            </ThemedText>
          </Card>
        ) : null}

        {loaded && pairing && snapshot === null && !error ? (
          <Card>
            <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
              Not synced yet
            </ThemedText>
            <ThemedText style={[styles.tagline, { color: surface.muted }]}>
              Open ResearchOS on your laptop, and turn on the phone channel for a
              category in Settings, Notifications.
            </ThemedText>
          </Card>
        ) : null}

        {loaded && pairing && snapshot !== null && !error ? (
          items.length > 0 ? (
            <View style={styles.list}>
              {items.map((n, i) => (
                <NotificationRow key={n.id ?? `notif-${i}`} notification={n} />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="notifications-outline"
              text="No phone notifications yet. Turn on the phone channel for a category in Settings, Notifications."
            />
          )
        ) : null}

        {snapshot?.generatedAt ? (
          <ThemedText style={[styles.synced, { color: surface.muted }]}>
            Last synced {formatSynced(snapshot.generatedAt)}
          </ThemedText>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

function NotificationRow({
  notification,
}: {
  notification: SnapshotNotification;
}) {
  const { surface } = useTheme();
  const unread = notification.read === false;
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
    <Card compact>
      <View style={styles.rowTop}>
        <View
          style={[
            styles.unreadDot,
            { backgroundColor: unread ? palette.coral : 'transparent' },
          ]}
        />
        <ThemedText
          style={[
            styles.rowTitle,
            { color: surface.text, fontWeight: unread ? '800' : '600' },
          ]}
          numberOfLines={1}
        >
          {title}
        </ThemedText>
        {when ? (
          <ThemedText style={[styles.rowWhen, { color: surface.muted }]}>
            {when}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText
        style={[styles.rowBody, { color: surface.muted }]}
        numberOfLines={3}
      >
        {body}
      </ThemedText>
    </Card>
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
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 12,
  },
  tagline: { lineHeight: 22 },
  cardTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  list: { gap: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unreadDot: { width: 9, height: 9, borderRadius: 999 },
  rowTitle: { flex: 1, fontSize: 15, lineHeight: 20 },
  rowWhen: { fontSize: 12, lineHeight: 18 },
  rowBody: { fontSize: 13.5, lineHeight: 19, marginTop: 4, marginLeft: 17 },
  synced: { fontSize: 12, marginTop: 4 },
  loadingWrap: { paddingVertical: 24, alignItems: 'center' },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: { lineHeight: 20 },
});
