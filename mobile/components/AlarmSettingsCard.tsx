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
import { palette, radii, fonts, useTheme } from '@/lib/design';
import {
  ALARM_SOURCES,
  alarmSoundLabel,
  useAlarmPrefs,
  type AlarmSound,
} from '@/lib/alarm-prefs';

const SOUND_CHOICES: AlarmSound[] = ['chime', 'digital'];

export function AlarmSettingsCard() {
  const { surface, spacing, shadow } = useTheme();
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
        {/* Amber alarm icon-chip, matching the amber timer accent + the amber
            "Reminder" category chip on the Notifications screen. */}
        <View style={[styles.headChip, { backgroundColor: palette.amberDim }]}>
          <Ionicons name="alarm-outline" size={18} color={palette.amber} />
        </View>
        <View style={styles.headText}>
          <ThemedText style={[styles.title, { color: surface.text }]}>Alarm</ThemedText>
          <ThemedText style={[styles.caption, { color: surface.muted }]}>
            Plays when a timer finishes. The animation always shows.
          </ThemedText>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: surface.hairline }]} />

      <View style={styles.toggleRow}>
        <ThemedText style={[styles.rowLabel, { color: surface.text }]}>Sound</ThemedText>
        <Switch
          value={prefs.soundOn}
          onValueChange={(v) => setPrefs({ soundOn: v })}
          trackColor={{ true: palette.sky, false: surface.borderStrong }}
          thumbColor={palette.white}
        />
      </View>

      {prefs.soundOn ? (
        <View style={styles.soundBlock}>
          {/* Contract segmented control (.seg): a sunken track with the active
              choice lifted onto a surface chip. */}
          <View style={[styles.seg, { backgroundColor: surface.sunken }]}>
            {SOUND_CHOICES.map((s) => {
              const on = prefs.sound === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setPrefs({ sound: s })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.segBtn,
                    on && shadow.sm,
                    {
                      backgroundColor: on ? surface.surface : 'transparent',
                    },
                  ]}
                >
                  <ThemedText
                    style={[styles.segLabel, { color: on ? surface.text : surface.muted }]}
                  >
                    {alarmSoundLabel(s)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={playSample}
            style={[styles.sample, { backgroundColor: palette.skyDim, borderRadius: radii.pill }]}
            accessibilityRole="button"
          >
            <Ionicons name="play-circle" size={18} color={palette.sky} />
            <ThemedText style={[styles.sampleLabel, { color: palette.sky }]}>Play sample</ThemedText>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.divider, { backgroundColor: surface.hairline }]} />

      <View style={styles.toggleRow}>
        <ThemedText style={[styles.rowLabel, { color: surface.text }]}>Vibration</ThemedText>
        <Switch
          value={prefs.vibrateOn}
          onValueChange={(v) => setPrefs({ vibrateOn: v })}
          trackColor={{ true: palette.sky, false: surface.borderStrong }}
          thumbColor={palette.white}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headChip: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontFamily: fonts.bold, fontWeight: '700', lineHeight: 21 },
  caption: { fontSize: 12.5, fontFamily: fonts.ui, lineHeight: 17 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 15, fontFamily: fonts.semibold, fontWeight: '600' },

  soundBlock: { gap: 10 },
  // Contract .seg: sunken pill-track, active choice lifted onto a surface chip.
  seg: { flexDirection: 'row', borderRadius: radii.md, padding: 3, gap: 3 },
  segBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 11,
    alignItems: 'center',
  },
  segLabel: { fontSize: 13.5, fontFamily: fonts.semibold, fontWeight: '600' },

  sample: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  sampleLabel: { fontSize: 13.5, fontFamily: fonts.semibold, fontWeight: '600' },
});
