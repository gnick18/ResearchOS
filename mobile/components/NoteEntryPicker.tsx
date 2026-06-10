/**
 * NoteEntryPicker - bottom-sheet modal for choosing which note entry a photo
 * should land in (Phase 1.5, note routing).
 *
 * Shown when the user is about to send a photo and the laptop has a multi-entry
 * running-log note open. The picker leads with a "Recommended" card (the entry
 * currently open on the laptop, else the last-edited entry, badged to explain
 * why it is recommended), then lists all entries newest-first with their dates.
 * A "Send to inbox instead" ghost button is always visible at the bottom.
 *
 * Matches the approved mockup: docs/mockups/2026-06-09-mobile-send-destination.html
 * (frame "note-multi"). Amber note icon, sky recommended border, date column.
 *
 * Accessibility: reduceMotion friendly (no spring animation). Uses Modal so the
 * sheet is keyboard-safe on both iOS and Android.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useCallback, useReducer } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme, palette } from '@/lib/design';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NoteEntryOption {
  id: string;
  title: string;
  /** ISO date string, YYYY-MM-DD. */
  date: string;
}

export interface NoteEntryPickerProps {
  visible: boolean;
  /** The note's display title, shown in the subtitle. */
  noteTitle: string;
  /** All entries to display, in the ORDER they should appear in the "All entries"
   *  list (caller is responsible for sorting, usually newest-first by date). */
  entries: NoteEntryOption[];
  /** The entry id to badge as "recommended". Null when no recommendation. */
  recommendedEntryId: string | null;
  /** Label for the recommendation badge ("open now" or "last edited"). */
  recommendedBadge?: string;
  onPick: (entryId: string) => void;
  onInbox: () => void;
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD" or an ISO string and return { day: number, month: string }. */
function parseDateLabel(dateStr: string): { day: string; month: string } {
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T12:00:00' : ''));
  const day = String(d.getDate());
  const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return { day, month };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** The amber note-square icon used in every note option card. */
function NoteIcon({ size = 20 }: { size?: number }) {
  return (
    <View
      style={[
        styles.noteIconWrap,
        { width: size + 20, height: size + 20, borderRadius: (size + 20) * 0.275 },
      ]}
    >
      {/* Simple note shape: outer rect + two text lines (mimics the mockup SVG). */}
      <View style={[styles.noteIconRect, { width: size, height: size }]}>
        <View style={styles.noteIconLine} />
        <View style={[styles.noteIconLine, { width: '70%' }]} />
      </View>
    </View>
  );
}

/** Recommended entry card, visually highlighted with a sky border. */
function RecommendedCard({
  entry,
  badge,
  onPress,
}: {
  entry: NoteEntryOption;
  badge: string;
  onPress: () => void;
}) {
  const { surface } = useTheme();
  const { day, month } = parseDateLabel(entry.date);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.optCard,
        styles.optCardRec,
        { backgroundColor: palette.skyDim },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, recommended, ${badge}`}
    >
      <NoteIcon />
      <View style={styles.optBody}>
        <View style={styles.optTitleRow}>
          <Text style={[styles.optTitle, { color: surface.text }]} numberOfLines={1}>
            {entry.title}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        </View>
        <Text style={[styles.optSub, { color: surface.muted }]}>
          {month} {day} &middot; {badge === 'open now' ? 'the entry you have open' : 'most recently edited'}
        </Text>
      </View>
      <Chevron />
    </Pressable>
  );
}

/** A row in the "All entries" list. */
function EntryRow({
  entry,
  onPress,
  showTopDivider,
}: {
  entry: NoteEntryOption;
  onPress: () => void;
  showTopDivider: boolean;
}) {
  const { surface } = useTheme();
  const { day, month } = parseDateLabel(entry.date);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.entryRow,
        showTopDivider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.border },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={entry.title}
    >
      <View style={styles.dateCol}>
        <Text style={[styles.dateDay, { color: surface.text }]}>{day}</Text>
        <Text style={[styles.dateMonth, { color: surface.muted }]}>{month}</Text>
      </View>
      <View style={styles.entryBody}>
        <Text style={[styles.entryTitle, { color: surface.text }]} numberOfLines={1}>
          {entry.title}
        </Text>
      </View>
      <Chevron />
    </Pressable>
  );
}

function Chevron() {
  return (
    <Text style={styles.chevron}>{'›'}</Text>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NoteEntryPicker({
  visible,
  noteTitle,
  entries,
  recommendedEntryId,
  recommendedBadge = 'recommended',
  onPick,
  onInbox,
  onDismiss,
}: NoteEntryPickerProps) {
  const { surface } = useTheme();
  const reduceMotion = useReducedMotion();

  const recommended = recommendedEntryId
    ? entries.find((e) => e.id === recommendedEntryId) ?? null
    : null;

  // All entries sorted as passed in (caller handles newest-first).
  const allEntries = entries;

  const handlePick = useCallback(
    (id: string) => {
      onPick(id);
    },
    [onPick],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        {/* Stop propagation on the sheet so tapping inside does not dismiss. */}
        <Pressable style={[styles.sheet, { backgroundColor: surface.surface }]} onPress={() => {}}>
          {/* Grab handle */}
          <View style={[styles.grab, { backgroundColor: surface.border }]} />

          <Text style={[styles.sheetTitle, { color: surface.text }]}>Which entry?</Text>
          <Text style={[styles.sheetSub, { color: surface.muted }]} numberOfLines={1}>
            Open on your laptop &middot; {noteTitle}
          </Text>

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Recommended section */}
            {recommended && (
              <>
                <Text style={[styles.sectionLabel, { color: surface.muted }]}>Recommended</Text>
                <RecommendedCard
                  entry={recommended}
                  badge={recommendedBadge}
                  onPress={() => handlePick(recommended.id)}
                />
              </>
            )}

            {/* All entries section */}
            <Text style={[styles.sectionLabel, { color: surface.muted }]}>All entries</Text>
            <View style={[styles.entriesGroup, { backgroundColor: surface.sunken, borderColor: surface.border }]}>
              {allEntries.map((entry, idx) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onPress={() => handlePick(entry.id)}
                  showTopDivider={idx > 0}
                />
              ))}
            </View>
          </ScrollView>

          {/* Footer: inbox escape */}
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
            onPress={onInbox}
            accessibilityRole="button"
          >
            <Text style={[styles.ghostBtnText, { color: surface.muted }]}>
              Send to inbox instead
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 12, 20, 0.42)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: '88%',
  },
  grab: {
    width: 38,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginHorizontal: 4,
    marginBottom: 3,
  },
  sheetSub: {
    fontSize: 13,
    marginHorizontal: 4,
    marginBottom: 14,
    lineHeight: 18,
  },
  scroll: {
    flexGrow: 0,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginHorizontal: 6,
    marginTop: 8,
    marginBottom: 8,
  },
  // Recommended card
  optCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.10)',
    borderRadius: 15,
    padding: 14,
    marginBottom: 10,
  },
  optCardRec: {
    borderColor: palette.sky,
    shadowColor: palette.sky,
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  optBody: {
    flex: 1,
    minWidth: 0,
  },
  optTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  optTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  optSub: {
    fontSize: 12.5,
    marginTop: 2,
  },
  badge: {
    backgroundColor: palette.skyDim,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeText: {
    color: palette.sky,
    fontSize: 11,
    fontWeight: '700',
  },
  // Note icon
  noteIconWrap: {
    backgroundColor: palette.amberDim,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  noteIconRect: {
    borderWidth: 1.5,
    borderColor: palette.amber,
    borderRadius: 3,
    padding: 3,
    gap: 3,
    alignItems: 'flex-start',
  },
  noteIconLine: {
    height: 2,
    width: '100%',
    backgroundColor: palette.amber,
    borderRadius: 1,
  },
  // All-entries list
  entriesGroup: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  dateCol: {
    width: 34,
    alignItems: 'center',
  },
  dateDay: {
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 20,
  },
  dateMonth: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  entryBody: {
    flex: 1,
    minWidth: 0,
  },
  entryTitle: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 20,
    color: 'rgba(0,0,0,0.3)',
    lineHeight: 22,
  },
  // Ghost button (inbox escape)
  ghostBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 6,
  },
  ghostBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
  },
});
