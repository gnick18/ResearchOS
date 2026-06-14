// Settings screen. Presented as a modal from the Notebook header gear. Holds
// device-local app preferences. First control is the floating mascot toggle
// (off by default).
//
// Polished to the locked UI contract (docs/mockups/mobile-contract/05-system.html,
// "Settings" panel): faint uppercase section labels OUTSIDE tight row-list cards
// (contract .lbl), .setting-row toggle rows with semibold title + muted
// description separated by theme-aware hairlines, a .kv device-and-lab card
// (muted key left, mono/semibold value right), a danger-soft "Unpair this
// phone" button, and a centered "ResearchOS · vX" version line. Same row-list
// vocabulary as the wiki browse list. Geist via design tokens.
//
// Everything the app does is preserved: all seven toggle rows (mascot, Today,
// haptics, reduce motion, app lock) and their exact states, the Alarm card
// (app-only, no render equivalent), the live pairing/device fingerprint, the
// conditional unpair flow, and the about note.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { AlarmSettingsCard } from '@/components/AlarmSettingsCard';
import { ThemedText } from '@/components/themed-text';
import { useTheme, palette, fonts, type SurfaceTokens } from '@/lib/design';
import { useMascotPrefs } from '@/lib/mascot-prefs';
import { useInteractionPrefs } from '@/lib/interaction-prefs';
import { useTodayPrefs } from '@/lib/today-prefs';
import { useAppLockPrefs, getBiometricCapability } from '@/lib/app-lock';
import { usePairing, clearPairing } from '@/lib/pairing';
import { getDevicePubHex } from '@/lib/device-identity';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

// Short, human-comparable form of the device public key, for the laptop-side
// approve-device flow. Full hex stays internal.
function deviceFingerprint(hex: string | null): string {
  if (!hex) return 'Loading...';
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}...${hex.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Section label (contract .lbl): faint, uppercase, OUTSIDE the card, mirroring
// the wiki browse list section labels.
// ---------------------------------------------------------------------------
function SectionLabel({ children }: { children: string }) {
  const { surface } = useTheme();
  return (
    <ThemedText style={[styles.sectionLabel, { color: surface.faint }]}>
      {children.toUpperCase()}
    </ThemedText>
  );
}

// ---------------------------------------------------------------------------
// Row-list card (contract .card-tight): a tight surface holding setting rows
// divided by hairlines. Same elevation + shape as the wiki .row-list card.
// ---------------------------------------------------------------------------
function RowCard({ children }: { children: React.ReactNode }) {
  const { surface, radii, shadow } = useTheme();
  return (
    <View
      style={[
        styles.rowCard,
        shadow.sm,
        { backgroundColor: surface.surface, borderColor: surface.border, borderRadius: radii.lg },
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Toggle row (contract .setting-row): title + optional description on the left,
// a Switch on the right. Hairline divider above every row except the first, so
// it reads as one grouped card. The hairline is theme-aware (works in dark).
// ---------------------------------------------------------------------------
function ToggleRow({
  title,
  description,
  value,
  onValueChange,
  disabled,
  first,
  accessibilityLabel,
  surface,
}: {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (on: boolean) => void;
  disabled?: boolean;
  first?: boolean;
  accessibilityLabel: string;
  surface: SurfaceTokens;
}) {
  return (
    <View
      style={[
        styles.settingRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.hairline },
      ]}
    >
      <View style={styles.settingText}>
        <ThemedText style={[styles.settingTitle, { color: surface.text }]}>{title}</ThemedText>
        {description ? (
          <ThemedText style={[styles.settingDesc, { color: surface.muted }]}>
            {description}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: palette.sky, false: surface.borderStrong }}
        thumbColor={palette.white}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Key/value row (contract .kv): muted key on the left, emphasized value on the
// right. Used for the device-and-lab facts. Fingerprint reads as mono.
// ---------------------------------------------------------------------------
function KvRow({
  label,
  value,
  mono,
  first,
  surface,
}: {
  label: string;
  value: string;
  mono?: boolean;
  first?: boolean;
  surface: SurfaceTokens;
}) {
  return (
    <View
      style={[
        styles.kvRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.hairline },
      ]}
    >
      <ThemedText style={[styles.kvKey, { color: surface.muted }]}>{label}</ThemedText>
      <ThemedText
        style={[styles.kvValue, mono ? styles.kvValueMono : null, { color: surface.text }]}
        numberOfLines={2}
      >
        {value}
      </ThemedText>
    </View>
  );
}

export default function SettingsScreen() {
  const { surface, radii } = useTheme();
  const [mascot, setMascot] = useMascotPrefs();
  const [interaction, setInteraction] = useInteractionPrefs();
  const [today, setToday] = useTodayPrefs();
  const [appLock, setAppLock] = useAppLockPrefs();
  const { pairing, refresh } = usePairing();

  // Whether this phone can use a biometric or screen lock. Until we know, treat
  // it as unavailable so we never offer a toggle that cannot work. Re-checked
  // whenever the screen gains focus, in case the user just set up a screen lock.
  const [biometricReady, setBiometricReady] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    getBiometricCapability()
      .then((cap) => {
        if (active) setBiometricReady(cap.canUse);
      })
      .catch(() => {
        if (active) setBiometricReady(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getDevicePubHex()
      .then((hex) => {
        if (active) setDeviceId(hex);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const onUnpair = () => {
    Alert.alert(
      'Unpair this phone?',
      'This phone will stop sending captures and notes to your lab. You can pair again anytime from the Notebook screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: () => {
            void clearPairing().then(refresh);
          },
        },
      ],
    );
  };

  return (
    <ScreenFrame>
      <ScreenHeader title="Settings" />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel>Appearance</SectionLabel>
        <RowCard>
          <ToggleRow
            first
            surface={surface}
            title="Floating mascot"
            description="Show the little BeakerBot in the corner of every screen. Off by default."
            value={mascot.visible}
            onValueChange={(on) => setMascot({ visible: on })}
            accessibilityLabel="Show floating mascot"
          />
          <ToggleRow
            surface={surface}
            title="Show Today"
            description="A glance at today and overdue tasks at the top of the Notebook tab, synced from your laptop. Turn off to keep the bench lean."
            value={today.showToday}
            onValueChange={(on) => setToday({ showToday: on })}
            accessibilityLabel="Show Today"
          />
        </RowCard>

        <SectionLabel>Interaction</SectionLabel>
        <RowCard>
          <ToggleRow
            first
            surface={surface}
            title="Haptics"
            description="Subtle vibration feedback on taps and alerts."
            value={interaction.haptics}
            onValueChange={(on) => setInteraction({ haptics: on })}
            accessibilityLabel="Haptics"
          />
          <ToggleRow
            surface={surface}
            title="Reduce motion"
            description="Calm the animations. Always on when your device has Reduce Motion enabled."
            value={interaction.reduceMotion}
            onValueChange={(on) => setInteraction({ reduceMotion: on })}
            accessibilityLabel="Reduce motion"
          />
        </RowCard>

        <SectionLabel>Alerts</SectionLabel>
        <AlarmSettingsCard />

        <SectionLabel>Security</SectionLabel>
        <RowCard>
          <ToggleRow
            first
            surface={surface}
            title="Require Face ID or fingerprint to open"
            description={
              biometricReady === false
                ? 'Set up a screen lock on this phone first.'
                : 'Lock the app behind your biometric on launch and after a short time away. Your captures and notes are unpublished research, so this keeps them yours.'
            }
            value={appLock.enabled && biometricReady === true}
            disabled={biometricReady !== true}
            onValueChange={(on) => setAppLock({ enabled: on })}
            accessibilityLabel="Require Face ID or fingerprint to open"
          />
        </RowCard>

        <SectionLabel>Device and lab</SectionLabel>
        <RowCard>
          <KvRow
            first
            surface={surface}
            label="Lab"
            value={
              pairing
                ? pairing.labName ?? 'Paired to your lab'
                : 'Not paired. Pair from the Notebook screen to send captures.'
            }
          />
          <KvRow
            surface={surface}
            label="This device"
            value={deviceFingerprint(deviceId)}
            mono
          />
        </RowCard>

        {pairing ? (
          <Pressable
            onPress={onUnpair}
            accessibilityRole="button"
            accessibilityLabel="Unpair this phone"
            style={({ pressed }) => [
              styles.unpairBtn,
              {
                backgroundColor: palette.dangerDim,
                borderRadius: radii.md,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="link-outline" size={18} color={palette.danger} />
            <ThemedText style={[styles.unpairLabel, { color: palette.danger }]}>
              Unpair this phone
            </ThemedText>
          </Pressable>
        ) : null}

        {/* About: centered brand line + version (contract "ResearchOS · v1.4.0"),
            keeping the descriptive companion note the app carries. */}
        <View style={styles.about}>
          <ThemedText style={[styles.aboutLine, { color: surface.muted }]}>
            <ThemedText style={[styles.aboutBrand, { color: surface.text }]}>
              ResearchOS
            </ThemedText>
            {`  ·  v${APP_VERSION}`}
          </ThemedText>
          <ThemedText style={[styles.aboutNote, { color: surface.faint }]}>
            Your bench companion. Captures and notes stay on your device until you send them to your lab.
          </ThemedText>
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 40,
    gap: 9,
  },

  // Section label OUTSIDE the card (contract .lbl / wiki sectionLabelOut). The
  // top margin opens air above each group; the first one tightens up.
  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.bold,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginTop: 9,
    marginBottom: -1,
    marginLeft: 4,
  },

  // Row-list card (contract .card-tight): tight horizontal padding, hairline
  // dividers drawn per-row, soft elevation from shadow.sm.
  rowCard: {
    borderWidth: 1,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },

  // Toggle row (contract .setting-row).
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  settingText: { flex: 1, gap: 2 },
  settingTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },
  settingDesc: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.ui,
  },

  // Key/value row (contract .kv).
  kvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 12,
  },
  kvKey: {
    fontSize: 13.5,
    fontFamily: fonts.medium,
    flexShrink: 0,
  },
  kvValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13.5,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },
  kvValueMono: {
    fontFamily: fonts.monoSemibold,
    fontSize: 13,
  },

  // Unpair (contract .btn-danger: danger-dim fill, danger label).
  unpairBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 50,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginTop: 6,
  },
  unpairLabel: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    fontWeight: '600',
    lineHeight: 20,
  },

  // About (contract centered version line + companion note).
  about: {
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 24,
  },
  aboutLine: {
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  aboutBrand: {
    fontSize: 13,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  aboutNote: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.ui,
    textAlign: 'center',
  },
});
