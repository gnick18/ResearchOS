/**
 * FloatingTabBar — the floating glass pill nav from the UI contract
 * (docs/mockups/mobile-contract/01-tab-roots.html).
 *
 * Four capability tabs (Home, Notebook, Methods, Inventory) with a raised center
 * ＋ Capture action between Notebook and Methods. Actions are not tabs, so ＋ is a
 * separate button that calls onCapture, never a route. Persistent on tab roots;
 * pushed/detail screens render their own ScreenHeader and never show this bar.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useTheme, fonts } from '@/lib/design';

// Order + labels of the four visible tabs. Routes not listed here (calc, timers,
// wiki) stay navigable via the Home hub but never appear in the bar.
const VISIBLE = [
  { name: 'home', label: 'Home' },
  { name: 'notebook', label: 'Notebook' },
  { name: 'method', label: 'Methods' },
  { name: 'inventory', label: 'Inventory' },
] as const;

function TabIcon({ name, color }: { name: string; color: string }) {
  const p = (d: string) => (
    <Path d={d} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  );
  switch (name) {
    case 'home':
      return <Svg width={22} height={22} viewBox="0 0 24 24">{p('M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5')}</Svg>;
    case 'notebook':
      return <Svg width={22} height={22} viewBox="0 0 24 24">{p('M6 3h11a2 2 0 0 1 2 2v15l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Z')}</Svg>;
    case 'method':
      return <Svg width={22} height={22} viewBox="0 0 24 24">{p('M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM20 5.5C20 4.7 19.3 4 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z')}</Svg>;
    case 'inventory':
      return <Svg width={22} height={22} viewBox="0 0 24 24">{p('m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v18M4 7.5l8 4.5 8-4.5')}</Svg>;
    default:
      return null;
  }
}

export function FloatingTabBar({ state, navigation, onCapture }: BottomTabBarProps & { onCapture?: () => void }) {
  const { surface, palette, shadow, dark } = useTheme();
  const insets = useSafeAreaInsets();

  const item = (cfg: (typeof VISIBLE)[number]) => {
    const routeIndex = state.routes.findIndex((r) => r.name === cfg.name);
    const focused = state.index === routeIndex;
    const color = focused ? palette.sky : surface.tabBarInactiveTint;
    return (
      <Pressable
        key={cfg.name}
        style={styles.item}
        hitSlop={6}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          const route = state.routes[routeIndex];
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={cfg.label}
      >
        <TabIcon name={cfg.name} color={color} />
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {cfg.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + 14 }]} pointerEvents="box-none">
      <View
        style={[
          styles.bar,
          shadow.lg,
          { backgroundColor: dark ? 'rgba(18,24,38,0.94)' : 'rgba(255,255,255,0.94)', borderColor: surface.border },
        ]}
      >
        {item(VISIBLE[0])}
        {item(VISIBLE[1])}
        <Pressable
          style={styles.fab}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            onCapture?.();
          }}
          accessibilityRole="button"
          accessibilityLabel="Capture"
        >
          <Svg width={26} height={26} viewBox="0 0 24 24">
            <Path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
          </Svg>
        </Pressable>
        {item(VISIBLE[2])}
        {item(VISIBLE[3])}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  item: {
    // minWidth (not a fixed width) so longer labels ("Notebook", "Inventory")
    // size to their content and are never horizontally clipped by the item box
    // (RN clips overflowing text, unlike the CSS contract where it overflows).
    // The icon stays centered; padding keeps a consistent touch target.
    minWidth: 52,
    height: 46,
    borderRadius: 16,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    // 10 is the floor: Geist clips its last glyph below ~10px when Android
    // rasterizes at small ppem (verified on-device), so never go under 10 here.
    fontSize: 10,
    lineHeight: 13,
    fontFamily: fonts.semibold,
  },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1AA0E6',
    shadowColor: '#1AA0E6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
});
