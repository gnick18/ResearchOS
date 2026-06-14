/**
 * NotebookChooser - bottom-sheet modal for choosing which notebook a capture
 * or quick note should be filed in.
 *
 * Matches the approved mockup: docs/mockups/2026-06-09-mobile-notebook-chooser.html
 *
 * Sheet sections (in order):
 *   RECOMMENDED - what is open on the laptop (experiment or note context), only
 *                 shown when present. For an experiment context the recommended
 *                 fast path is kept as the Alert (Notes/Results chooser) routed
 *                 by the caller; we surface it here as a single highlighted card.
 *   Your notebooks  (kind "own", amber icon)
 *   Shared with you (kind "shared", green icon)
 *   1:1 notebooks   (kind "oneOnOne", violet icon + PI/student tag)
 *   Unsorted note   pinned footer (inbox, gray icon)
 *
 * Tapping a multi-entry running notebook opens the existing NoteEntryPicker to
 * choose the entry; single-entry or non-running notebooks call onPickNotebook
 * directly with the first (or only) entry id.
 *
 * Props:
 *   visible               - controls Modal visibility
 *   notebooks             - list returned by fetchNotebooks
 *   recommended           - the focus context (experiment or note kind); null = none
 *   onPickNotebook(nb, entryId) - user picked a notebook + entry
 *   onUnsorted()          - user wants the inbox (no routing command posted)
 *   onClose()             - user dismissed without choosing
 *
 * Accessibility: reduceMotion aware (animationType="none").
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, palette } from '@/lib/design';
import type { NotebookSummary } from '@/lib/notebooks';
import type { FocusContext } from '@/lib/focus-context';
import { NoteEntryPicker } from '@/components/NoteEntryPicker';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NotebookChooserProps {
  visible: boolean;
  notebooks: NotebookSummary[];
  /** The current focus context from getFocusContext(). Null when nothing is open. */
  recommended: FocusContext | null;
  /** Called when the user picks a notebook (and, if applicable, an entry). */
  onPickNotebook: (notebook: NotebookSummary, entryId: string | null) => void;
  /** Called when the user taps "Unsorted note (inbox)". */
  onUnsorted: () => void;
  /** Called when the sheet is dismissed without a selection. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Icon sub-components — crisp react-native-svg glyphs matching the capture
// contract (docs/mockups/mobile-contract/02-capture.html): 1.8px stroked,
// rounded joins, tinted rounded-square chip behind each.
// ---------------------------------------------------------------------------

const ICON_GLYPH = 22;

function IconChip({
  bg,
  border,
  children,
}: {
  bg: string;
  border?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.iconWrap,
        { backgroundColor: bg },
        border ? { borderWidth: 1, borderColor: border } : null,
      ]}
    >
      {children}
    </View>
  );
}

/** Notebook icon: bookmarked notebook cover (contract glyph). */
function NoteIcon({ color, bg, border }: { color: string; bg: string; border?: string }) {
  return (
    <IconChip bg={bg} border={border}>
      <Svg width={ICON_GLYPH} height={ICON_GLYPH} viewBox="0 0 24 24" fill="none">
        <Path
          d="M6 3h11a2 2 0 0 1 2 2v15l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Z"
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      </Svg>
    </IconChip>
  );
}

/** People icon: two figures (contract shared/mentoring glyph). */
function PeopleIcon({ color, bg, border }: { color: string; bg: string; border?: string }) {
  return (
    <IconChip bg={bg} border={border}>
      <Svg width={ICON_GLYPH} height={ICON_GLYPH} viewBox="0 0 24 24" fill="none">
        <Circle cx={9} cy={8} r={3} stroke={color} strokeWidth={1.8} />
        <Path
          d="M3.5 19a5.5 5.5 0 0 1 11 0"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
        <Path
          d="M16 5.2a3 3 0 0 1 0 5.6M18 19a5.5 5.5 0 0 0-2.4-4.5"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </IconChip>
  );
}

/** Inbox/archive icon (contract unsorted glyph). */
function InboxIcon({ color, bg, border }: { color: string; bg: string; border?: string }) {
  return (
    <IconChip bg={bg} border={border}>
      <Svg width={ICON_GLYPH} height={ICON_GLYPH} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 8h16v11H4z"
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        <Path
          d="M4 8l2-3h12l2 3M9 12h6"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </IconChip>
  );
}

/** Experiment/beaker icon (contract photo-filing glyph). */
function FlaskIcon({ color, bg, border }: { color: string; bg: string; border?: string }) {
  return (
    <IconChip bg={bg} border={border}>
      <Svg width={ICON_GLYPH} height={ICON_GLYPH} viewBox="0 0 24 24" fill="none">
        <Path
          d="M9 3h6M10 3v6L5.5 17a2.5 2.5 0 0 0 2.2 3.7h8.6A2.5 2.5 0 0 0 18.5 17L14 9V3"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </IconChip>
  );
}

/** Chevron right indicator. */
function Chevron({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" style={styles.chevron}>
      <Path
        d="m9 6 6 6-6 6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Pill badge
// ---------------------------------------------------------------------------

function Pill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  const { surface } = useTheme();
  return (
    <Text style={[styles.sectionLabel, { color: surface.muted }]}>{label.toUpperCase()}</Text>
  );
}

// ---------------------------------------------------------------------------
// Notebook option row
// ---------------------------------------------------------------------------

interface NotebookRowProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  recommended?: boolean;
  pillLabel?: string;
  pillColor?: string;
  pillBg?: string;
  onPress: () => void;
  showTopDivider?: boolean;
  inGroup?: boolean;
  testID?: string;
}

function NotebookRow({
  title,
  subtitle,
  icon,
  recommended,
  pillLabel,
  pillColor,
  pillBg,
  onPress,
  showTopDivider,
  inGroup,
  testID,
}: NotebookRowProps) {
  const { surface } = useTheme();
  return (
    <Pressable
      testID={testID}
      style={({ pressed }) => [
        styles.optRow,
        inGroup && styles.optRowInGroup,
        showTopDivider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.border },
        recommended && [styles.optRowRec, { shadowColor: palette.sky, backgroundColor: palette.skyDim, borderColor: palette.skyBorder }],
        !inGroup && !recommended && { borderColor: surface.border, backgroundColor: surface.sunken },
        inGroup && { backgroundColor: 'transparent' },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {icon}
      <View style={styles.optBody}>
        <View style={styles.optTitleRow}>
          <Text style={[styles.optTitle, { color: surface.text }]} numberOfLines={1}>
            {title}
          </Text>
          {pillLabel && pillColor && pillBg ? (
            <Pill label={pillLabel} color={pillColor} bg={pillBg} />
          ) : null}
          {recommended ? (
            <Pill label="open" color={palette.sky} bg={palette.skyDim} />
          ) : null}
        </View>
        <Text
          style={[styles.optSub, { color: recommended ? palette.sky : surface.muted }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      <Chevron color={recommended ? palette.sky : surface.faint} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NotebookChooser({
  visible,
  notebooks,
  recommended,
  onPickNotebook,
  onUnsorted,
  onClose,
}: NotebookChooserProps) {
  const { surface } = useTheme();
  const reduceMotion = useReducedMotion();
  // Lift the sheet above the device's bottom inset (Android gesture bar / iOS
  // home indicator) so its last row is never tucked under the nav controls.
  const insets = useSafeAreaInsets();

  // When the user taps a multi-entry running notebook we show the entry picker.
  const [entryPickerNotebook, setEntryPickerNotebook] = useState<NotebookSummary | null>(null);

  // Determine the recommended notebook entry ID for the entry picker.
  // When the focus context is a note, carry its openEntryId.
  const entryPickerRecommendedId =
    entryPickerNotebook && recommended?.kind === 'note'
      ? recommended.openEntryId ?? recommended.lastEditedEntryId ?? null
      : entryPickerNotebook
        ? entryPickerNotebook.lastEditedEntryId
        : null;

  const handlePickNotebook = useCallback(
    (nb: NotebookSummary) => {
      // Multi-entry running log: open the entry picker.
      if (nb.isRunningLog && nb.entries.length > 1) {
        setEntryPickerNotebook(nb);
        return;
      }
      // Single entry or non-running: pick directly.
      onPickNotebook(nb, nb.entries[0]?.id ?? null);
    },
    [onPickNotebook],
  );

  const handleEntryPick = useCallback(
    (entryId: string) => {
      if (!entryPickerNotebook) return;
      setEntryPickerNotebook(null);
      onPickNotebook(entryPickerNotebook, entryId);
    },
    [entryPickerNotebook, onPickNotebook],
  );

  const handleEntryInbox = useCallback(() => {
    setEntryPickerNotebook(null);
    onUnsorted();
  }, [onUnsorted]);

  const handleEntryDismiss = useCallback(() => {
    setEntryPickerNotebook(null);
  }, []);

  // Partition notebooks by kind.
  const ownNbs = notebooks.filter((nb) => nb.kind === 'own');
  const sharedNbs = notebooks.filter((nb) => nb.kind === 'shared');
  const oneOnOneNbs = notebooks.filter((nb) => nb.kind === 'oneOnOne');

  // Resolved recommended notebook (only for "note" focus context, not experiment,
  // since experiment context is handled as a fast-path Alert in the caller).
  const recNote: NotebookSummary | null =
    recommended?.kind === 'note'
      ? notebooks.find((nb) => nb.noteId === recommended.noteId) ?? null
      : null;

  // Build the entry subtitle for a notebook row.
  function entrySubtitle(nb: NotebookSummary): string {
    const count = nb.entries.length;
    if (count === 0) return 'No entries yet';
    if (count === 1) return '1 entry';
    return `${count} entries`;
  }

  // Build subtitle for shared notebooks.
  function sharedSubtitle(nb: NotebookSummary): string {
    if (nb.partnerUsername) return `from ${nb.partnerUsername} · can edit`;
    return 'shared · can edit';
  }

  // Build subtitle for 1:1 notebooks.
  function oneOnOneSubtitle(nb: NotebookSummary): string {
    return 'your mentoring notebook';
  }

  // Build pill props for 1:1 notebooks based on isLabHead.
  function oneOnOnePill(nb: NotebookSummary): { label: string; color: string; bg: string } | null {
    if (nb.isLabHead === null) return null;
    if (nb.isLabHead) {
      // Current user is the PI; the other participant is the student.
      return { label: 'PI', color: palette.purple, bg: palette.purpleLight };
    }
    // Current user is the student; the other participant is the PI.
    return { label: 'PI', color: palette.purple, bg: palette.purpleLight };
  }

  // Amber color constants for own notebooks.
  const amberBg = palette.amberDim;
  const amberColor = palette.amber;

  // Green color constants for shared notebooks.
  const greenColor = palette.success;
  const greenBg = palette.successLight;

  // Violet color constants for 1:1 notebooks.
  const violetColor = '#9333EA';
  const violetBg = 'rgba(147, 51, 234, 0.12)';

  // Gray color constants for inbox.
  const grayColor = surface.muted;
  const grayBg = `rgba(0,0,0,0.06)`;

  // Entry picker entries sorted newest-first.
  const entryPickerEntries = entryPickerNotebook
    ? [...entryPickerNotebook.entries].sort((a, b) => b.date.localeCompare(a.date))
    : [];

  return (
    <>
      <Modal
        visible={visible && !entryPickerNotebook}
        transparent
        animationType={reduceMotion ? 'none' : 'slide'}
        onRequestClose={onClose}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: surface.surface,
                paddingBottom: Math.max(24, insets.bottom + 16),
              },
            ]}
            onPress={() => {}}
          >
            {/* Grab handle */}
            <View style={[styles.grab, { backgroundColor: surface.border }]} />

            <Text style={[styles.sheetTitle, { color: surface.text }]}>File this capture</Text>
            <Text style={[styles.sheetSub, { color: surface.muted }]}>
              Pick a notebook, or leave it in the inbox.
            </Text>

            <ScrollView
              style={styles.scroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* RECOMMENDED: experiment fast path (experiment kind) */}
              {recommended?.kind === 'experiment' ? (
                <>
                  <SectionHeader label="Recommended" />
                  <NotebookRow
                    title={recommended.name}
                    subtitle="Your active experiment"
                    icon={<FlaskIcon color={palette.white} bg={palette.sky} />}
                    recommended
                    onPress={() => {
                      // For an experiment context, the caller's Alert handles Notes/Results.
                      // We call onClose so the caller's experiment branch takes over.
                      onClose();
                    }}
                  />
                </>
              ) : null}

              {/* RECOMMENDED: note context */}
              {recommended?.kind === 'note' && recNote ? (
                <>
                  <SectionHeader label="Recommended" />
                  <NotebookRow
                    title={recNote.title}
                    subtitle="Open on your laptop"
                    icon={<NoteIcon color={palette.white} bg={palette.sky} />}
                    recommended
                    onPress={() => handlePickNotebook(recNote)}
                  />
                </>
              ) : null}

              {/* YOUR NOTEBOOKS */}
              {ownNbs.length > 0 ? (
                <>
                  <SectionHeader label="Your notebooks" />
                  <View style={[styles.group, { backgroundColor: surface.sunken, borderColor: surface.border }]}>
                    {ownNbs.map((nb, idx) => (
                      <NotebookRow
                        key={nb.noteId}
                        testID={`notebook-chooser-row-${idx}`}
                        title={nb.title}
                        subtitle={entrySubtitle(nb)}
                        icon={<NoteIcon color={amberColor} bg={amberBg} />}
                        onPress={() => handlePickNotebook(nb)}
                        showTopDivider={idx > 0}
                        inGroup
                      />
                    ))}
                  </View>
                </>
              ) : null}

              {/* SHARED WITH YOU */}
              {sharedNbs.length > 0 ? (
                <>
                  <SectionHeader label="Shared with you" />
                  <View style={[styles.group, { backgroundColor: surface.sunken, borderColor: surface.border }]}>
                    {sharedNbs.map((nb, idx) => (
                      <NotebookRow
                        key={nb.noteId}
                        title={nb.title}
                        subtitle={sharedSubtitle(nb)}
                        icon={<PeopleIcon color={greenColor} bg={greenBg} />}
                        onPress={() => handlePickNotebook(nb)}
                        showTopDivider={idx > 0}
                        inGroup
                      />
                    ))}
                  </View>
                </>
              ) : null}

              {/* 1:1 NOTEBOOKS */}
              {oneOnOneNbs.length > 0 ? (
                <>
                  <SectionHeader label="1:1 notebooks" />
                  <View style={[styles.group, { backgroundColor: surface.sunken, borderColor: surface.border }]}>
                    {oneOnOneNbs.map((nb, idx) => {
                      const pill = oneOnOnePill(nb);
                      const displayTitle = nb.partnerUsername
                        ? `1:1 with ${nb.partnerUsername}`
                        : nb.title;
                      return (
                        <NotebookRow
                          key={nb.noteId}
                          title={displayTitle}
                          subtitle={oneOnOneSubtitle(nb)}
                          icon={<PeopleIcon color={violetColor} bg={violetBg} />}
                          pillLabel={pill?.label}
                          pillColor={pill?.color}
                          pillBg={pill?.bg}
                          onPress={() => handlePickNotebook(nb)}
                          showTopDivider={idx > 0}
                          inGroup
                        />
                      );
                    })}
                  </View>
                </>
              ) : null}

              {/* UNSORTED footer */}
              <Pressable
                testID="notebook-chooser-unsorted"
                style={({ pressed }) => [
                  styles.unsortedBtn,
                  { borderColor: surface.borderStrong },
                  pressed && styles.pressed,
                ]}
                onPress={onUnsorted}
                accessibilityRole="button"
                accessibilityLabel="Unsorted note, send to inbox"
              >
                <InboxIcon color={grayColor} bg={grayBg} border={surface.border} />
                <Text style={[styles.unsortedText, { color: surface.muted }]}>
                  Unsorted note (inbox)
                </Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Entry picker: shown when the user tapped a multi-entry running notebook. */}
      {entryPickerNotebook ? (
        <NoteEntryPicker
          visible
          noteTitle={entryPickerNotebook.title}
          entries={entryPickerEntries}
          recommendedEntryId={entryPickerRecommendedId}
          recommendedBadge={
            recommended?.kind === 'note' &&
            recommended.openEntryId === entryPickerRecommendedId
              ? 'open now'
              : 'last edited'
          }
          onPick={handleEntryPick}
          onInbox={handleEntryInbox}
          onDismiss={handleEntryDismiss}
        />
      ) : null}
    </>
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
    maxHeight: '90%',
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
    marginBottom: 4,
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
    marginTop: 12,
    marginBottom: 8,
  },
  // Grouped rows (own/shared/oneOnOne sections)
  group: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 4,
  },
  // Option row (standalone, not in a group)
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 13,
    marginBottom: 9,
  },
  optRowInGroup: {
    borderWidth: 0,
    borderRadius: 0,
    marginBottom: 0,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  optRowRec: {
    borderColor: palette.sky,
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
    gap: 7,
    flexWrap: 'wrap',
  },
  optTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  optSub: {
    fontSize: 12,
    marginTop: 2,
  },
  // Pill badge
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  // Chevron
  chevron: {
    flexShrink: 0,
  },
  // Unsorted footer
  unsortedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    marginTop: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 14,
  },
  unsortedText: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
  },
  // Icon chip
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
