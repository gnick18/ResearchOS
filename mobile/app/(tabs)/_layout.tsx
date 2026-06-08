/**
 * Tab bar layout (v2 visual foundation).
 *
 * Brand-sky active tint, themed background, comfortable height/padding.
 * All four tabs (Home / Today / Capture / Timers) and their icons are
 * unchanged. Only the visual styling adopts the new design tokens.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/design';

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
          // Give it a little extra height for comfortable touch targets.
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
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="house.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="sun.max.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="camera.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="timers"
        options={{
          title: 'Timers',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="timer" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
