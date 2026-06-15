/**
 * TabHeader. The one shared header every bottom-tab root uses (Home, Notebook,
 * Methods, Inventory, Timers, Wiki, Calc), so the title and the action trio are
 * identical across the app.
 *
 * Layout, matching the approved mockup
 * (docs/mockups/2026-06-13-companion-unified-header.html):
 *
 *   [ (eyebrow?)                                                            ]
 *   [ Title .......................... (bell) (today) (settings) ]
 *
 * The three buttons are ALWAYS present (the brand accent sky Ionicons, ~24px) on
 * every tab, so notifications, Today, and Settings are reachable from anywhere:
 *   - Notifications  notifications-outline  -> /notifications  (unread badge)
 *   - Today          today-outline          -> toggles the global Today dropdown
 *                                              (TodayHost in app/_layout), amber
 *                                              "due today" badge
 *   - Settings       settings-outline       -> /modal
 *
 * The Today button reads + toggles lib/today-store, so it works the same from
 * every tab without per-screen wiring. It hides only when the user turns Show
 * Today off in Settings. The bell badge reads the global unread count, so it is
 * correct on every tab with no prop passing.
 *
 * Optional `eyebrow` renders a small muted line above the title (Home uses it for
 * the time-of-day greeting).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { palette } from '@/lib/design';
import { useMascotKeepOut } from '@/lib/mascot-avoid';
import { useTodayPrefs } from '@/lib/today-prefs';
import { toggleToday, useTodayBadgeCount } from '@/lib/today-store';
import { useUnreadNotificationCount } from '@/lib/unread-notifications';

export interface TabHeaderProps {
  /** The tab title, shown at the app-wide large-title scale. */
  title: string;
  /** Optional small muted line above the title (e.g. a greeting on Home). */
  eyebrow?: string;
}

export function TabHeader({ title, eyebrow }: TabHeaderProps) {
  const router = useRouter();
  const [todayPrefs] = useTodayPrefs();
  const unreadCount = useUnreadNotificationCount();
  const todayCount = useTodayBadgeCount();
  // Register the whole action cluster (bell / today / settings) as a mascot
  // keep-out so the floating BeakerBot never parks on top of these buttons.
  const actionsKeepOut = useMascotKeepOut();

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.titleCol}>
          {eyebrow ? (
            <ThemedText numberOfLines={1} style={styles.eyebrow}>
              {eyebrow}
            </ThemedText>
          ) : null}
          <ThemedText type="title" numberOfLines={1}>
            {title}
          </ThemedText>
        </View>

        <View
          ref={actionsKeepOut.ref}
          onLayout={actionsKeepOut.onLayout}
          style={styles.actions}
        >
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

          {/* Today. Always present (unless Show Today is off); toggles the shared
              dropdown panel. */}
          {todayPrefs.showToday ? (
            <Pressable
              testID="tab-today"
              onPress={toggleToday}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={
                todayCount > 0 ? `Today, ${todayCount} due` : 'Today'
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
  titleCol: { flex: 1, marginRight: 8 },
  eyebrow: {
    fontSize: 13,
    lineHeight: 16,
    opacity: 0.6,
    marginBottom: 1,
  },
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
