/**
 * ScreenFrame. The standard screen shell, content filling the safe area. The
 * signature rainbow is NO LONGER drawn here, it lives as fixed top/bottom EDGE
 * overlays at the app root (app/_layout.tsx) so it sits at the true top of the
 * screen (over the status-bar zone) and the true bottom (below the tab bar), and
 * is identical on every screen. ScreenFrame just keeps content inside the safe
 * area. Tab screens use the default top+bottom edges; stack screens with a
 * navigation header pass edges that omit "top".
 *
 * Usage:
 *   <ScreenFrame>
 *     <ScrollView style={{ flex: 1 }} contentContainerStyle={...}>...</ScrollView>
 *   </ScreenFrame>
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import type { ReactNode } from 'react';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { ThemedView } from '@/components/themed-view';

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
        {children}
      </SafeAreaView>
    </ThemedView>
  );
}
