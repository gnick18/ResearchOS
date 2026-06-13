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
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/design';

// Notebook is the landing tab (bench companion replaces Today + Send).
export const unstable_settings = {
  initialRouteName: 'notebook',
};

export default function TabLayout() {
  const { surface } = useTheme();
  // The device's bottom inset (Android 3-button nav / gesture bar, iOS home
  // indicator). With edgeToEdgeEnabled the app draws under the system nav, so
  // the tab bar must reserve this space or the system buttons cover the tabs.
  const insets = useSafeAreaInsets();

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
          // A ~60px icon+label area, plus the device bottom inset reserved below
          // it, so the tabs always sit ABOVE the system nav controls (3-button,
          // gesture bar, or home indicator) instead of hiding behind them.
          height: 60 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom + 8,
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
        name="method"
        options={{
          title: 'Method',
          tabBarIcon: ({ color }) => <Ionicons name="flask" size={24} color={color} />,
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
