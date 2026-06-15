/**
 * TodayPanel - the Apple-Notification-Center-style pull-down Today panel.
 *
 * Matches the approved mockup: docs/mockups/2026-06-13-companion-today-pulldown.html
 *
 * Today no longer lives inline in the Notebook body. It is a full-screen
 * overlay that pulls DOWN from the top of the screen over a dimmed scrim. The
 * panel revamps the summary into three glanceable stat tiles (Today / Overdue /
 * Coming up) above compact color-ticked grouped task rows, a "Last synced" line,
 * and a bottom grab handle to pull up / tap to dismiss.
 *
 * This is a presentational overlay. It does NOT fetch; all snapshot data is
 * passed down from the Notebook screen (which already loads it). The component
 * is driven by the `visible` prop (a useEffect snaps the shared value to match)
 * and by a Pan gesture on the bottom grab handle.
 *
 * Animation: react-native-reanimated v4 (useSharedValue / useAnimatedStyle /
 * withSpring / withTiming, worklets) + react-native-gesture-handler (Gesture.Pan
 * + GestureDetector). JS-only, no native module changes. GestureHandlerRootView
 * is mounted at the app root (app/_layout.tsx).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { RainbowBar } from '@/components/ui/RainbowBar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, palette, fonts } from '@/lib/design';
import type { SnapshotTask } from '@/lib/snapshots';

// The panel is anchored to the top of the screen and translated up by its own
// height (plus a margin) when closed. We over-allocate a tall closed offset so
// the panel is fully off-screen regardless of measured height before layout.
const SCREEN_H = Dimensions.get('window').height;
const CLOSED_OFFSET = -SCREEN_H;

export interface TodayPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Drives the date line and stat tiles. */
  snapshot: { generatedAt?: string } | null;
  /** Today's scheduled rows. */
  tasks: SnapshotTask[];
  overdueTasks: SnapshotTask[];
  upcomingTasks: SnapshotTask[];
  /** Counts (used for the tiles + fallbacks when row arrays are absent). */
  overdue: number;
  upcoming: number;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Preformatted "Jun 13, 1:54 PM" style string, or null. */
  syncedLabel: string | null;
}

export function TodayPanel({
  visible,
  onClose,
  snapshot,
  tasks,
  overdueTasks,
  upcomingTasks,
  overdue,
  upcoming,
  loading,
  loaded,
  error,
  syncedLabel,
}: TodayPanelProps) {
  const { surface, dark } = useTheme();
  const reduceMotion = useReducedMotion();
  const router = useRouter();

  // Partition active tasks: experiments go into the dedicated band, everything
  // else stays in the regular Today task list.
  const activeBandTasks = tasks.filter((t) => t.task_type === 'experiment');
  const activeListTasks = tasks.filter((t) => t.task_type !== 'experiment');

  // translateY: 0 = fully open, CLOSED_OFFSET = fully hidden above the screen.
  const translateY = useSharedValue(CLOSED_OFFSET);
  // Panel height, measured on layout, so the drag threshold + clamp are exact.
  const panelH = useSharedValue(SCREEN_H);

  // Snap to match the visible prop. Spring for the Apple feel; a near-instant
  // timing when reduce motion is on so it just appears/disappears.
  useEffect(() => {
    const target = visible ? 0 : CLOSED_OFFSET;
    if (reduceMotion) {
      translateY.value = withTiming(target, { duration: 1 });
    } else {
      translateY.value = withSpring(target, {
        damping: 22,
        stiffness: 220,
        mass: 0.9,
      });
    }
  }, [visible, reduceMotion, translateY]);

  const closeOpen = () => {
    if (reduceMotion) {
      translateY.value = withTiming(0, { duration: 1 });
    } else {
      translateY.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.9 });
    }
  };

  const animateClose = () => {
    if (reduceMotion) {
      translateY.value = withTiming(CLOSED_OFFSET, { duration: 1 }, () => {
        runOnJS(onClose)();
      });
    } else {
      translateY.value = withSpring(
        CLOSED_OFFSET,
        { damping: 24, stiffness: 240, mass: 0.9 },
        () => {
          runOnJS(onClose)();
        },
      );
    }
  };

  // Pan on the bottom grab handle: dragging up (negative dy) tucks the panel
  // away. We track translationY from the open base (0), clamp to [CLOSED, 0],
  // and on release decide by distance (~40% of panel height) or an upward fling.
  const dragPan = Gesture.Pan()
    .onChange((e) => {
      'worklet';
      const next = Math.min(0, translateY.value + e.changeY);
      translateY.value = Math.max(CLOSED_OFFSET, next);
    })
    .onEnd((e) => {
      'worklet';
      const threshold = -panelH.value * 0.4;
      const flingUp = e.velocityY < -600;
      if (translateY.value < threshold || flingUp) {
        runOnJS(animateClose)();
      } else {
        runOnJS(closeOpen)();
      }
    });

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Scrim opacity tracks how far open the panel is (1 = fully open).
  const scrimStyle = useAnimatedStyle(() => {
    const progress = 1 - Math.min(1, translateY.value / CLOSED_OFFSET);
    return {
      opacity: progress,
      // Skip touches entirely when closed so the Notebook stays interactive.
      pointerEvents: progress > 0.02 ? ('auto' as const) : ('none' as const),
    };
  });

  const dateLabel = formatTodayDate();

  const showRows = loaded && snapshot !== null && !error;
  const hasTodayRows = activeListTasks.length > 0;

  return (
    <View style={styles.host} pointerEvents="box-none">
      {/* Dimmed scrim. Tap to dismiss. Sits below the panel, above content. */}
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={animateClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss Today"
        />
      </Animated.View>

      {/* The panel itself. */}
      <Animated.View
        style={[
          styles.panel,
          {
            backgroundColor: surface.surface,
            borderColor: surface.border,
          },
          panelStyle,
        ]}
        onLayout={(e) => {
          panelH.value = e.nativeEvent.layout.height;
        }}
        accessibilityViewIsModal
      >
        {/* Rainbow brand edge (contract .rb-edge): the signature sliver pinned to
            the panel's top, clipped to its rounded corners. Reuses the shared
            RainbowBar primitive (pastel light / vivid dark). */}
        <View style={styles.rainbowEdge} pointerEvents="none">
          <RainbowBar height={3} />
        </View>

        <View style={styles.headerRow}>
          <ThemedText style={[styles.title, { color: surface.text }]}>
            Today
          </ThemedText>
          <ThemedText style={[styles.date, { color: surface.muted }]}>
            {dateLabel}
          </ThemedText>
        </View>

        {/* Three glanceable stat tiles. */}
        <View style={styles.stats}>
          <StatTile count={tasks.length} label="Today" tone="today" />
          <StatTile count={overdue} label="Overdue" tone="over" />
          <StatTile count={upcoming} label="Coming up" tone="soon" />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
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
            <ThemedText style={[styles.helper, { color: surface.muted }]}>
              Syncing today...
            </ThemedText>
          ) : null}

          {loaded && snapshot === null && !error ? (
            <ThemedText style={[styles.helper, { color: surface.muted }]}>
              Open ResearchOS on your laptop to sync today.
            </ThemedText>
          ) : null}

          {showRows ? (
            <>
              {/* Active experiments band: pinned above the regular Today list. */}
              {activeBandTasks.length > 0 ? (
                <ActiveExperimentsBand
                  experiments={activeBandTasks}
                  dark={dark}
                  onPress={(task) => {
                    // Deep-link to the method read view for the focused experiment.
                    // The method snapshot is published separately by the laptop when
                    // the user taps "View method on phone". We navigate to the same
                    // route the Method tab's recs band uses (/method-detail?read=1),
                    // which reads the currently published method snapshot. If the
                    // laptop has not published a method snapshot for this experiment
                    // the read screen shows its "open a method from the laptop"
                    // empty state, which is the correct degradation.
                    router.push('/method-detail?read=1');
                  }}
                />
              ) : null}

              <GroupLabel text="Today" color={surface.muted} />
              {hasTodayRows ? (
                activeListTasks.map((task, i) => (
                  <TaskRow key={task.id ?? `today-${i}`} task={task} tone="today" />
                ))
              ) : (
                <ThemedText style={[styles.empty, { color: surface.muted }]}>
                  Nothing scheduled for today.
                </ThemedText>
              )}

              {overdueTasks.length > 0 ? (
                <>
                  <GroupLabel text="Overdue" color={surface.muted} />
                  {overdueTasks.map((task, i) => (
                    <TaskRow
                      key={task.id ?? `overdue-${i}`}
                      task={task}
                      tone="over"
                    />
                  ))}
                </>
              ) : overdue > 0 ? (
                <>
                  <GroupLabel text="Overdue" color={surface.muted} />
                  <ThemedText style={[styles.empty, { color: palette.danger }]}>
                    {overdue} overdue
                  </ThemedText>
                </>
              ) : null}

              {upcomingTasks.length > 0 ? (
                <>
                  <GroupLabel text="Coming up" color={surface.muted} />
                  {upcomingTasks.map((task, i) => (
                    <TaskRow
                      key={task.id ?? `upcoming-${i}`}
                      task={task}
                      tone="soon"
                    />
                  ))}
                </>
              ) : upcoming > 0 ? (
                <>
                  <GroupLabel text="Coming up" color={surface.muted} />
                  <ThemedText style={[styles.empty, { color: surface.muted }]}>
                    {upcoming} upcoming
                  </ThemedText>
                </>
              ) : null}
            </>
          ) : null}

          {syncedLabel ? (
            <ThemedText style={[styles.synced, { color: surface.muted }]}>
              Last synced {syncedLabel}
            </ThemedText>
          ) : null}
        </ScrollView>

        {/* Bottom grab handle: drag up or tap to dismiss. */}
        <GestureDetector gesture={dragPan}>
          <Pressable
            onPress={animateClose}
            accessibilityRole="button"
            accessibilityLabel="Close Today"
            style={styles.grab}
          >
            <View style={[styles.grabBar, { backgroundColor: surface.border }]} />
            <ThemedText style={[styles.grabLabel, { color: surface.muted }]}>
              pull up to close
            </ThemedText>
          </Pressable>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

// ── Active experiments band ───────────────────────────────────────────────────

/**
 * Parse a YYYY-MM-DD date string to a UTC midnight timestamp. Returns NaN when
 * the string is missing or malformed. No date-lib dependency; the phone already
 * receives dates in this format from the snapshot.
 */
function parseDateStr(value?: string): number {
  if (!value) return NaN;
  const ms = Date.parse(value);
  return ms;
}

/**
 * Compute the "Day N" (or "Day N of M") label for an experiment card.
 *
 * N = floor((today - start_date) / 86400000) + 1, clamped to >= 1.
 * M = floor((end_date - start_date) / 86400000) + 1 (only shown when M > 1).
 *
 * All arithmetic is in UTC milliseconds (the dates are stored as YYYY-MM-DD
 * without a time component, so UTC midnight comparisons are correct regardless
 * of the phone's locale).
 */
function dayLabel(start_date?: string, end_date?: string): string {
  const now = new Date();
  // Represent today as a UTC midnight timestamp for consistent arithmetic.
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const startMs = parseDateStr(start_date);
  if (isNaN(startMs)) return 'Day 1';
  const dayN = Math.max(1, Math.floor((todayUTC - startMs) / 86400000) + 1);
  const endMs = parseDateStr(end_date);
  if (!isNaN(endMs) && endMs > startMs) {
    const totalDays = Math.floor((endMs - startMs) / 86400000) + 1;
    if (totalDays > 1) return `Day ${dayN} of ${totalDays}`;
  }
  return `Day ${dayN}`;
}

/** One experiment card inside the Active Experiments band. */
function ExperimentCard({
  task,
  dark,
  onPress,
}: {
  task: SnapshotTask;
  dark: boolean;
  onPress: () => void;
}) {
  const { surface } = useTheme();
  // Subtle purple-tinted surface so the experiment cards are visually distinct
  // from the neutral sky-tinted Today task rows and the rest of the panel.
  const cardBg = dark ? 'rgba(91,71,214,0.14)' : 'rgba(91,71,214,0.07)';
  const cardBorder = dark ? 'rgba(91,71,214,0.30)' : 'rgba(91,71,214,0.20)';
  const chipBg = dark ? 'rgba(91,71,214,0.22)' : 'rgba(91,71,214,0.12)';

  const label = dayLabel(task.start_date, task.end_date);
  const hasMethod = !!task.linkedMethodName;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.expCard,
        { backgroundColor: cardBg, borderColor: cardBorder },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open method for ${task.name ?? 'experiment'}`}
    >
      <View style={styles.expCardTop}>
        <ThemedText
          style={[styles.expName, { color: surface.text }]}
          numberOfLines={1}
        >
          {task.name && task.name.length > 0 ? task.name : 'Untitled experiment'}
        </ThemedText>
        <View style={[styles.dayChip, { backgroundColor: chipBg }]}>
          <ThemedText style={[styles.dayChipText, { color: palette.purple }]}>
            {label}
          </ThemedText>
        </View>
      </View>
      {hasMethod ? (
        <View style={styles.expMethodRow}>
          {/* Flask glyph rendered as a unicode character keeps the no-emoji rule
              (this is a scientific symbol, not an emoji codepoint). Using a
              View-based inline mark keeps everything in the existing text stack. */}
          <View style={[styles.flaskDot, { backgroundColor: palette.purple }]} />
          <ThemedText
            style={[styles.expMethodName, { color: surface.muted }]}
            numberOfLines={1}
          >
            {task.linkedMethodName}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** The full "ACTIVE EXPERIMENTS" band, rendered only when >= 1 experiment.
 *  Exported so the Home hub can show the same glance above its Today section. */
export function ActiveExperimentsBand({
  experiments,
  dark,
  onPress,
}: {
  experiments: SnapshotTask[];
  dark: boolean;
  onPress: (task: SnapshotTask) => void;
}) {
  const { surface } = useTheme();
  return (
    <View style={styles.expBand}>
      <ThemedText style={[styles.expBandHeader, { color: surface.muted }]}>
        {`ACTIVE EXPERIMENTS · ${experiments.length}`}
      </ThemedText>
      {experiments.map((task, i) => (
        <ExperimentCard
          key={task.id ?? `exp-${i}`}
          task={task}
          dark={dark}
          onPress={() => onPress(task)}
        />
      ))}
    </View>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

// A single glanceable count tile (Today sky / Overdue red / Coming up amber).
// Glanceable stat tile, styled to match the Notebook capture cards: a saturated
// gradient fill, a white glyph in a translucent tile, white count + label, and a
// soft circle accent bleeding off the bottom-right corner.
function StatTile({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: 'today' | 'over' | 'soon';
}) {
  const grad: readonly [string, string] =
    tone === 'today'
      ? [palette.sky, '#39B4FF']
      : tone === 'over'
        ? ['#FF6F61', '#FF9182']
        : ['#F59E0B', '#FBBF24'];
  const icon =
    tone === 'today'
      ? 'today-outline'
      : tone === 'over'
        ? 'alert-circle-outline'
        : 'time-outline';
  return (
    <View style={styles.stat}>
      <LinearGradient
        colors={grad}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.statBlob} pointerEvents="none" />
      <View style={styles.statIconTile}>
        <Ionicons name={icon} size={15} color={palette.white} />
      </View>
      <ThemedText style={styles.statNum}>{count}</ThemedText>
      <ThemedText numberOfLines={1} style={styles.statLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

function GroupLabel({ text, color }: { text: string; color: string }) {
  return <ThemedText style={[styles.group, { color }]}>{text}</ThemedText>;
}

// A compact, color-ticked task row (contained, not a full-height card).
/** A single Today/Overdue/Coming-up row. Exported so the Home hub renders its
 *  live Today section with the exact same row as the Today pull-down panel. */
export function TaskRow({
  task,
  tone,
}: {
  task: SnapshotTask;
  tone: 'today' | 'over' | 'soon';
}) {
  const { surface } = useTheme();
  const tickColor =
    tone === 'over' ? palette.danger : tone === 'soon' ? palette.amber : palette.sky;
  const meta = [formatDateRange(task.start_date, task.end_date), task.task_type]
    .filter((part): part is string => !!part && part.length > 0)
    .join('  -  ');
  return (
    <View style={[styles.trow, { backgroundColor: surface.sunken }]}>
      <View style={[styles.tick, { backgroundColor: tickColor }]} />
      <View style={styles.trowBody}>
        <ThemedText
          style={[
            styles.trowTitle,
            { color: tone === 'over' ? palette.danger : surface.text },
          ]}
          numberOfLines={1}
        >
          {task.name && task.name.length > 0 ? task.name : 'Untitled task'}
        </ThemedText>
        {meta.length > 0 ? (
          <ThemedText style={[styles.trowMeta, { color: surface.muted }]}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

function formatDateRange(start?: string, end?: string): string {
  const s = formatShortDate(start);
  const e = formatShortDate(end);
  if (s && e) return s === e ? s : `${s} to ${e}`;
  return s || e || '';
}

function formatShortDate(value?: string): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatTodayDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  // Full-screen overlay host, above the tab content. box-none lets touches fall
  // through to the Notebook when the scrim is hidden (closed).
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,18,34,0.34)',
  },
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    // Slightly below the very top so it clears the status bar / notch and reads
    // as pulled down from the top edge.
    top: 8,
    maxHeight: '92%',
    borderWidth: 1,
    borderRadius: 30,
    // Clip the rainbow brand edge to the rounded top corners.
    overflow: 'hidden',
    // Extra top room so content clears the 3px rainbow sliver.
    paddingTop: 19,
    paddingHorizontal: 16,
    paddingBottom: 10,
    shadowColor: '#081e3c',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.4,
    shadowRadius: 40,
    elevation: 16,
  },
  // Contract .rb-edge: a 3px signature rainbow sliver across the panel top.
  rainbowEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  title: { fontSize: 21, fontFamily: fonts.extrabold, fontWeight: '800', letterSpacing: -0.3 },
  date: { fontSize: 12, fontFamily: fonts.semibold, fontWeight: '600' },

  // Stat tiles
  stats: { flexDirection: 'row', gap: 9, marginBottom: 13 },
  stat: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 92,
    overflow: 'hidden', // clip the corner blob to the rounded card
    justifyContent: 'flex-end', // count + label sit at the bottom-left
    // Soft lift so the colored tiles read as elevated, per the contract.
    shadowColor: '#0F1722',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  statBlob: {
    position: 'absolute',
    right: -18,
    bottom: -22,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  statIconTile: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statNum: {
    // Top-right, opposite the top-left icon tile, so the big count never
    // overlaps the glyph.
    position: 'absolute',
    top: 8,
    right: 12,
    fontSize: 26,
    fontFamily: fonts.extrabold,
    fontWeight: '800',
    lineHeight: 28,
    color: palette.white,
  },
  statLabel: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    fontWeight: '700',
    marginTop: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: 'rgba(255,255,255,0.92)',
  },

  // Active experiments band
  expBand: {
    marginTop: 4,
    marginBottom: 2,
  },
  expBandHeader: {
    fontSize: 10.5,
    fontFamily: fonts.extrabold,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginHorizontal: 4,
  },
  expCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    gap: 4,
  },
  expCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
  },
  expName: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  dayChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  dayChipText: {
    fontSize: 10,
    fontFamily: fonts.extrabold,
    fontWeight: '800',
  },
  expMethodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  flaskDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    flexShrink: 0,
  },
  expMethodName: {
    fontSize: 10.5,
    fontFamily: fonts.medium,
    flex: 1,
    minWidth: 0,
  },

  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 4 },

  group: {
    fontSize: 10.5,
    fontFamily: fonts.extrabold,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 6,
    marginHorizontal: 4,
  },
  trow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 12,
    marginBottom: 6,
  },
  tick: { width: 7, height: 7, borderRadius: 999 },
  trowBody: { flex: 1, minWidth: 0 },
  trowTitle: { fontSize: 12.5, fontFamily: fonts.bold, fontWeight: '700' },
  trowMeta: { fontSize: 10.5, fontFamily: fonts.medium, marginTop: 1 },

  empty: { fontSize: 12.5, fontFamily: fonts.ui, lineHeight: 18, marginHorizontal: 4, marginBottom: 6 },
  helper: { fontSize: 12.5, fontFamily: fonts.ui, lineHeight: 18, marginHorizontal: 4, paddingVertical: 8 },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  errorText: { fontSize: 12.5, fontFamily: fonts.medium, lineHeight: 18 },
  synced: { fontSize: 10.5, fontFamily: fonts.medium, marginTop: 8, marginHorizontal: 4 },

  grab: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 11,
    paddingBottom: 3,
  },
  grabBar: { width: 42, height: 5, borderRadius: 999 },
  grabLabel: {
    fontSize: 10,
    fontFamily: fonts.bold,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
