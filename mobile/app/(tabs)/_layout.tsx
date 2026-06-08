/**
 * Tab bar layout (5-tab restructure).
 *
 * Five tabs: Today / Send / Calc / Timer / Wiki. The old Home tab is retired;
 * its pairing + send actions move into the Send tab. Brand-sky active tint,
 * themed background, comfortable height/padding. Today is the default tab.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/design';

// Today is the landing tab now that Home is gone.
export const unstable_settings = {
  initialRouteName: 'today',
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
          title: 'Send',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="paperplane.fill" color={color} />
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
