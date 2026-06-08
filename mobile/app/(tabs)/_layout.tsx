/**
 * Tab bar layout (5-tab restructure).
 *
 * Five tabs: Notebook / Inventory / Calc / Timer / Wiki.
 * Notebook is the default tab (bench companion: today glance + capture + note).
 * Inventory is the new dedicated supply management home.
 * Calc, Timer, and Wiki are tool tabs unchanged from before.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/design';

// Notebook is the landing tab (bench companion replaces Today + Send).
export const unstable_settings = {
  initialRouteName: 'notebook',
};

export default function TabLayout() {
  const { surface } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,

        // Brand-sky active tint, muted inactive.
        tabBarActiveTintColor: surface.tabBarActiveTint,
        tabBarInactiveTintColor: surface.tabBarInactiveTint,

        // Themed background + subtle top border.
        tabBarStyle: {
          backgroundColor: surface.tabBarBg,
          borderTopColor: surface.tabBarBorder,
          borderTopWidth: 1,
          // A little extra height for comfortable touch targets.
          height: Platform.OS === 'ios' ? 84 : 68,
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
        },

        // Label sits tight under the icon.
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="notebook"
        options={{
          title: 'Notebook',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="note.text" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="shippingbox.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calc"
        options={{
          title: 'Calc',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="function" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="timers"
        options={{
          title: 'Timer',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="timer" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="wiki"
        options={{
          title: 'Wiki',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="book.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
