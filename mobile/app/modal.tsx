// Settings screen. Presented as a modal from the Notebook header gear. Holds
// device-local app preferences. First control is the floating mascot toggle
// (off by default). House style: no em-dashes, no emojis, no mid-sentence colons.

import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ThemedText } from '@/components/themed-text';
import { useTheme, palette, spacing } from '@/lib/design';
import { useMascotPrefs } from '@/lib/mascot-prefs';

export default function SettingsScreen() {
  const { surface } = useTheme();
  const [mascot, setMascot] = useMascotPrefs();

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
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13, lineHeight: 18 },
});
