/**
 * Tab layout (UI contract: 4 capability tabs + center Capture).
 *
 * Visible tabs: Home / Notebook / Methods / Inventory, rendered by the custom
 * FloatingTabBar (a floating glass pill). The center ＋ is a Capture ACTION, not
 * a route. Calc, Timers, and Wiki remain routes in this group but are reached
 * from the Home hub launcher, never the bar.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Tabs, useRouter } from 'expo-router';
import React from 'react';

import { FloatingTabBar } from '@/components/ui/FloatingTabBar';

export const unstable_settings = {
  initialRouteName: 'home',
};

export default function TabLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      // Capture is an action, not a tab: the ＋ opens the capture flow.
      // TODO(Batch 2): swap this for the ＋ Capture bottom sheet (photo / scan
      // note / quick note / scan package). For now it lands on the Notebook
      // capture surface.
      tabBar={(props) => (
        <FloatingTabBar {...props} onCapture={() => router.navigate('/(tabs)/notebook')} />
      )}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="notebook" options={{ title: 'Notebook' }} />
      <Tabs.Screen name="method" options={{ title: 'Methods' }} />
      <Tabs.Screen name="inventory" options={{ title: 'Inventory' }} />
      {/* Hub-launched, not in the bar */}
      <Tabs.Screen name="calc" options={{ title: 'Calc' }} />
      <Tabs.Screen name="timers" options={{ title: 'Timers' }} />
      <Tabs.Screen name="wiki" options={{ title: 'Wiki' }} />
    </Tabs>
  );
}
