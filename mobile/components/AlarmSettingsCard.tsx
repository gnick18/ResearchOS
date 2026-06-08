/**
 * AlarmSettingsCard. Device-local controls for the lab alarm that fires when a
 * timer finishes: pick the sound, toggle sound and vibration. The animation
 * always shows. Lives on the Timer screen. A "Play sample" button previews the
 * chosen sound.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/Card';
import { palette, radii, useTheme } from '@/lib/design';
import {
  ALARM_SOURCES,
  alarmSoundLabel,
  useAlarmPrefs,
  type AlarmSound,
} from '@/lib/alarm-prefs';

const SOUND_CHOICES: AlarmSound[] = ['chime', 'digital'];

export function AlarmSettingsCard() {
  const { surface, spacing } = useTheme();
  const [prefs, setPrefs] = useAlarmPrefs();

  // One preview player tracking the chosen sound. Auto-stops after a few seconds.
  const preview = useAudioPlayer(ALARM_SOURCES[prefs.sound]);
  useEffect(() => {
    return () => {
      try {
        preview.pause();
      } catch {
        // already released
      }
    };
  }, [preview]);

  const playSample = () => {
    try {
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      preview.seekTo(0);
      preview.volume = 1;
      preview.play();
      setTimeout(() => {
        try {
          preview.pause();
        } catch {
          // released
        }
      }, 4000);
    } catch {
      // audio unavailable (e.g. web sandbox)
    }
  };

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.headRow}>
        <Ionicons name="notifications-outline" size={18} color={surface.text} />
        <ThemedText style={[styles.title, { color: surface.text }]}>Alarm</ThemedText>
      </View>
      <ThemedText style={[styles.caption, { color: palette.faint }]}>
        Plays when a timer finishes. The animation always shows.
      </ThemedText>

      <View style={styles.toggleRow}>
        <ThemedText style={[styles.rowLabel, { color: surface.text }]}>Sound</ThemedText>
        <Switch
          value={prefs.soundOn}
          onValueChange={(v) => setPrefs({ soundOn: v })}
          trackColor={{ true: palette.sky, false: '#d1d5db' }}
          thumbColor="#ffffff"
        />
      </View>

      {prefs.soundOn ? (
        <View style={{ gap: 8 }}>
          <View style={styles.choiceRow}>
            {SOUND_CHOICES.map((s) => {
              const on = prefs.sound === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setPrefs({ sound: s })}
                  style={[
                    styles.choice,
                    {
                      borderRadius: radii.md,
                      backgroundColor: on ? palette.skyDim : surface.surface,
                      borderColor: on ? palette.sky : palette.elevatedBorder,
                    },
                  ]}
                >
                  <ThemedText style={[styles.choiceLabel, { color: on ? palette.sky : surface.muted }]}>
                    {alarmSoundLabel(s)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={playSample} style={styles.sample} accessibilityRole="button">
            <Ionicons name="play-circle-outline" size={18} color={palette.sky} />
            <ThemedText style={[styles.sampleLabel, { color: palette.sky }]}>Play sample</ThemedText>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.toggleRow}>
        <ThemedText style={[styles.rowLabel, { color: surface.text }]}>Vibration</ThemedText>
        <Switch
          value={prefs.vibrateOn}
          onValueChange={(v) => setPrefs({ vibrateOn: v })}
          trackColor={{ true: palette.sky, false: '#d1d5db' }}
          thumbColor="#ffffff"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  caption: { fontSize: 12.5, lineHeight: 17 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: { flex: 1, borderWidth: 1, paddingVertical: 11, alignItems: 'center' },
  choiceLabel: { fontSize: 14, fontWeight: '700' },
  sample: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  sampleLabel: { fontSize: 14, fontWeight: '600' },
});
