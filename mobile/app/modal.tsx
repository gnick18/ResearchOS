// Settings screen. Presented as a modal from the Notebook header gear. Holds
// device-local app preferences. First control is the floating mascot toggle
// (off by default). House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';

import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { AlarmSettingsCard } from '@/components/AlarmSettingsCard';
import { ThemedText } from '@/components/themed-text';
import { useTheme, palette, spacing } from '@/lib/design';
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

export default function SettingsScreen() {
  const { surface } = useTheme();
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
      >
        <SectionHeader title="Appearance" />
        <Card>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText style={[styles.rowTitle, { color: surface.text }]}>
                Floating mascot
              </ThemedText>
              <ThemedText style={[styles.rowSub, { color: surface.muted }]}>
                Show the little BeakerBot in the corner of every screen. Off by default.
              </ThemedText>
            </View>
            <Switch
              value={mascot.visible}
              onValueChange={(on) => setMascot({ visible: on })}
              trackColor={{ true: palette.sky, false: surface.border }}
              thumbColor={palette.white}
              accessibilityLabel="Show floating mascot"
            />
          </View>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <ThemedText style={[styles.rowTitle, { color: surface.text }]}>
                Show Today
              </ThemedText>
              <ThemedText style={[styles.rowSub, { color: surface.muted }]}>
                A glance at today and overdue tasks at the top of the Notebook tab, synced from your laptop. Turn off to keep the bench lean.
              </ThemedText>
            </View>
            <Switch
              value={today.showToday}
              onValueChange={(on) => setToday({ showToday: on })}
              trackColor={{ true: palette.sky, false: surface.border }}
              thumbColor={palette.white}
              accessibilityLabel="Show Today"
            />
          </View>
        </Card>

        <SectionHeader title="Interaction" />
        <Card>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText style={[styles.rowTitle, { color: surface.text }]}>
                Haptics
              </ThemedText>
              <ThemedText style={[styles.rowSub, { color: surface.muted }]}>
                Subtle vibration feedback on taps and alerts.
              </ThemedText>
            </View>
            <Switch
              value={interaction.haptics}
              onValueChange={(on) => setInteraction({ haptics: on })}
              trackColor={{ true: palette.sky, false: surface.border }}
              thumbColor={palette.white}
              accessibilityLabel="Haptics"
            />
          </View>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <ThemedText style={[styles.rowTitle, { color: surface.text }]}>
                Reduce motion
              </ThemedText>
              <ThemedText style={[styles.rowSub, { color: surface.muted }]}>
                Calm the animations. Always on when your device has Reduce Motion enabled.
              </ThemedText>
            </View>
            <Switch
              value={interaction.reduceMotion}
              onValueChange={(on) => setInteraction({ reduceMotion: on })}
              trackColor={{ true: palette.sky, false: surface.border }}
              thumbColor={palette.white}
              accessibilityLabel="Reduce motion"
            />
          </View>
        </Card>

        <SectionHeader title="Alerts" />
        <AlarmSettingsCard />

        <SectionHeader title="Security" />
        <Card>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText style={[styles.rowTitle, { color: surface.text }]}>
                Require Face ID or fingerprint to open
              </ThemedText>
              <ThemedText style={[styles.rowSub, { color: surface.muted }]}>
                {biometricReady === false
                  ? 'Set up a screen lock on this phone first.'
                  : 'Lock the app behind your biometric on launch and after a short time away. Your captures and notes are unpublished research, so this keeps them yours.'}
              </ThemedText>
            </View>
            <Switch
              value={appLock.enabled && biometricReady === true}
              disabled={biometricReady !== true}
              onValueChange={(on) => setAppLock({ enabled: on })}
              trackColor={{ true: palette.sky, false: surface.border }}
              thumbColor={palette.white}
              accessibilityLabel="Require Face ID or fingerprint to open"
            />
          </View>
        </Card>

        <SectionHeader title="Device and lab" />
        <Card>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText style={[styles.rowTitle, { color: surface.text }]}>
                Lab
              </ThemedText>
              <ThemedText style={[styles.rowSub, { color: surface.muted }]}>
                {pairing
                  ? pairing.labName ?? 'Paired to your lab'
                  : 'Not paired. Pair from the Notebook screen to send captures.'}
              </ThemedText>
            </View>
          </View>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <ThemedText style={[styles.rowTitle, { color: surface.text }]}>
                This device
              </ThemedText>
              <ThemedText style={[styles.rowSub, { color: surface.muted }]}>
                {deviceFingerprint(deviceId)}
              </ThemedText>
            </View>
          </View>
        </Card>
        {pairing ? (
          <Button
            variant="secondary"
            accent="coral"
            label="Unpair this phone"
            onPress={onUnpair}
            style={styles.unpairBtn}
          />
        ) : null}

        <SectionHeader title="About" />
        <Card>
          <View style={styles.row}>
            <ThemedText style={[styles.rowTitle, { color: surface.text }]}>
              ResearchOS
            </ThemedText>
            <ThemedText style={[styles.rowValue, { color: surface.muted }]}>
              Version {APP_VERSION}
            </ThemedText>
          </View>
          <ThemedText style={[styles.aboutNote, { color: surface.muted }]}>
            Your bench companion. Captures and notes stay on your device until you send them to your lab.
          </ThemedText>
        </Card>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowDivider: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13, lineHeight: 18 },
  rowValue: { fontSize: 15 },
  aboutNote: { fontSize: 13, lineHeight: 18, marginTop: spacing.sm },
  unpairBtn: { marginTop: spacing.sm },
});
