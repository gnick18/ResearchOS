/**
 * ScreenFrame. The standard screen shell, the thin signature rainbow on the top
 * AND bottom of every screen (Grant's rule 2026-06-08), with the content filling
 * between them inside the safe area. Tab screens use the default top+bottom
 * edges; stack screens that already have a navigation header pass edges that omit
 * "top" so the top rainbow sits just under the header.
 *
 * Usage:
 *   <ScreenFrame>
 *     <ScrollView style={{ flex: 1 }} contentContainerStyle={...}>...</ScrollView>
 *   </ScreenFrame>
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { ThemedView } from '@/components/themed-view';
import { RainbowBar } from './RainbowBar';

export function ScreenFrame({
  children,
  edges = ['top', 'bottom'],
}: {
  children: ReactNode;
  edges?: readonly Edge[];
}) {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={edges}>
        <RainbowBar />
        <View style={{ flex: 1 }}>{children}</View>
        <RainbowBar />
      </SafeAreaView>
    </ThemedView>
  );
}
