import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import 'react-native-reanimated';

import { AppSplash } from '@/components/AppSplash';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Keep the native splash up until JS is ready so there is no white flash before
// the branded AppSplash overlay takes over. Called at module load, before render.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already prevented or unavailable in this runtime, safe to ignore.
});

// Show a banner when a lab timer notification fires while the app is open. Per
// the SDK 54 expo-notifications docs the handler returns shouldShowBanner /
// shouldShowList. Guarded so a missing native module (some Expo Go edge) never
// crashes app startup, the in-app timer countdown works regardless.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {
  // expo-notifications unavailable here, skip the foreground handler.
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Branded launch handoff. We hide the native splash once the first frame is
  // ready and mount AppSplash over the app. The app renders underneath the whole
  // time, so when AppSplash shrinks and fades out it reveals the real UI. The
  // overlay stays mounted until its exit animation finishes (onFinish), then we
  // unmount it via state. Guarded so the native hide runs only once.
  const [splashVisible, setSplashVisible] = useState(true);
  const [nativeHidden, setNativeHidden] = useState(false);

  useEffect(() => {
    if (nativeHidden) return;
    setNativeHidden(true);
    // First commit is on screen, the JS overlay now covers the same pixels with
    // a matching background, so hiding the native splash will not flash.
    SplashScreen.hideAsync().catch(() => {
      // Native module missing or already hidden, ignore.
    });
  }, [nativeHidden]);

  const handleSplashFinish = useCallback(() => {
    setSplashVisible(false);
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ title: 'Pair' }} />
        <Stack.Screen name="note" options={{ title: 'Quick note' }} />
        <Stack.Screen name="reorder" options={{ title: 'Scan to reorder' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan' }} />
        <Stack.Screen name="wiki/[slug]" options={{ title: '' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      {splashVisible ? <AppSplash onFinish={handleSplashFinish} /> : null}
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
