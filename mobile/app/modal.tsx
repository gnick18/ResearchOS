// Settings screen. Presented as a modal from the Notebook header gear. Holds
// device-local app preferences. First control is the floating mascot toggle
// (off by default). House style: no em-dashes, no emojis, no mid-sentence colons.

import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';

import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { AlarmSettingsCard } from '@/components/AlarmSettingsCard';
import { ThemedText } from '@/components/themed-text';
import { useTheme, palette, spacing } from '@/lib/design';
import { useMascotPrefs } from '@/lib/mascot-prefs';
import { useInteractionPrefs } from '@/lib/interaction-prefs';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export default function SettingsScreen() {
  const { surface } = useTheme();
  const [mascot, setMascot] = useMascotPrefs();
  const [interaction, setInteraction] = useInteractionPrefs();

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
              accessibilityLabel="Show floating mascot"
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
              accessibilityLabel="Reduce motion"
            />
          </View>
        </Card>

        <SectionHeader title="Alerts" />
        <AlarmSettingsCard />

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
});
