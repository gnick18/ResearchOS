/**
 * TabHeader. The one shared header every bottom-tab uses (Notebook, Inventory,
 * Method, Timer, Wiki, Calc), so the title scale + position and the action
 * buttons are identical across the app. It replaces the per-tab hand-rolled
 * headers (Method used to look different, and only Notebook had the bell + gear).
 *
 * Layout, matching the approved mockup
 * (docs/mockups/2026-06-13-companion-unified-header.html):
 *
 *   [ Title .......................... (bell) (today) (settings) ]
 *
 * The three buttons are the MAIN buttons and are ALL rendered in the brand
 * accent (palette.sky) as Ionicons, ~24px, consistent on every tab:
 *   - Notifications  notifications-outline  -> /notifications  (unread badge)
 *   - Today          today-outline          -> onToday()       (amber count badge)
 *   - Settings       settings-outline       -> /modal
 *
 * The Today button only renders when onToday is provided, so tabs without a
 * Today (or an unpaired / Show-Today-off Notebook) simply pass nothing and the
 * button is hidden. The single connection cue lives on the Notebook pairing
 * card (live / last-synced / offline + tap to Sync now), not in this header.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { palette } from '@/lib/design';

export interface TabHeaderProps {
  /** The tab title, shown at the app-wide large-title scale. */
  title: string;
  /** When provided, the Today button renders and calls this on press. Pass
   *  undefined to hide the Today button (tab has no Today, or it is gated off). */
  onToday?: () => void;
  /** Count shown in the amber Today badge. Hidden when 0 or absent. */
  todayCount?: number;
  /** Unread-notification count for the bell badge. Hidden when 0 or absent. */
  unreadCount?: number;
}

export function TabHeader({
  title,
  onToday,
  todayCount = 0,
  unreadCount = 0,
}: TabHeaderProps) {
  const router = useRouter();

  return (
    <View>
      <View style={styles.row}>
        <ThemedText type="title" numberOfLines={1} style={styles.title}>
          {title}
        </ThemedText>

        <View style={styles.actions}>
          {/* Notifications. */}
          <Pressable
            testID="tab-notifications"
            onPress={() => router.push('/notifications')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : 'Notifications'
            }
            style={styles.btn}
          >
            <Ionicons name="notifications-outline" size={24} color={palette.sky} />
            {unreadCount > 0 ? (
              <View style={[styles.badge, styles.badgeDanger]}>
                <ThemedText style={styles.badgeText}>
                  {unreadCount > 9 ? '9+' : String(unreadCount)}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>

          {/* Today. Only when the tab provides it (paired + Show-Today on). */}
          {onToday ? (
            <Pressable
              testID="tab-today"
              onPress={onToday}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={
                todayCount > 0 ? `Today, ${todayCount} scheduled` : 'Today'
              }
              style={styles.btn}
            >
              <Ionicons name="today-outline" size={24} color={palette.sky} />
              {todayCount > 0 ? (
                <View style={[styles.badge, styles.badgeAmber]}>
                  <ThemedText style={styles.badgeText}>
                    {todayCount > 9 ? '9+' : String(todayCount)}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          ) : null}

          {/* Settings. */}
          <Pressable
            testID="tab-settings"
            onPress={() => router.push('/modal')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={styles.btn}
          >
            <Ionicons name="settings-outline" size={24} color={palette.sky} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { flex: 1, marginRight: 8 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginRight: -6,
  },
  btn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 16,
    height: 16,
    borderRadius: 999,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDanger: { backgroundColor: palette.coral },
  badgeAmber: { backgroundColor: palette.amber },
  badgeText: {
    color: palette.white,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 13,
  },
});
