import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppSplash } from '@/components/AppSplash';
import { RainbowBar } from '@/components/ui/RainbowBar';
import { SuccessBurst } from '@/components/SuccessBurst';
import { HeaderMascot } from '@/components/HeaderMascot';
import { LabAlarm, LabAlarmWatcher } from '@/components/LabAlarm';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMascotPrefs } from '@/lib/mascot-prefs';

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
  const router = useRouter();
  // Floating mascot is opt-in (default off). The code stays mounted-capable;
  // this just gates whether it renders. Toggle lives on the Settings screen.
  const [mascotPrefs] = useMascotPrefs();

  // Phone push P1 tap-to-open. A generic wake-and-fetch buzz carries only
  // data.kind = "notifications" (never content); tapping it opens the
  // notifications screen, which fetches + locally decrypts the sealed snapshot.
  // Guarded so a missing native module never breaks startup.
  useEffect(() => {
    let Notifications: typeof import('expo-notifications') | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Notifications = require('expo-notifications');
    } catch {
      return;
    }
    if (!Notifications) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data as
        | { kind?: unknown }
        | undefined;
      if (data?.kind === 'notifications') {
        router.push('/notifications');
      }
    });
    return () => sub.remove();
  }, [router]);

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

  // Brand the navigator background too (the canvas behind screens + transitions)
  // so there is no white flash between screens. Matches the ThemedView canvas.
  const navTheme =
    colorScheme === 'dark'
      ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: '#0a0e1a' } }
      : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#f2f3f7' } };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
    <ThemeProvider value={navTheme}>
      <View style={styles.root}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pair" options={{ headerShown: false }} />
          <Stack.Screen name="note" options={{ headerShown: false }} />
          <Stack.Screen name="reorder" options={{ headerShown: false }} />
          <Stack.Screen name="scan" options={{ headerShown: false }} />
          <Stack.Screen name="bulk" options={{ headerShown: false }} />
          <Stack.Screen name="annotate" options={{ headerShown: false }} />
          <Stack.Screen name="add-purchase" options={{ headerShown: false }} />
          <Stack.Screen name="method-detail" options={{ headerShown: false }} />
          <Stack.Screen name="calc-custom" options={{ headerShown: false }} />
          <Stack.Screen name="wiki/[slug]" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
        </Stack>
        {/* The signature rainbow lives at the true top and bottom EDGES of the
            screen (over the status-bar zone and below the tab bar), as fixed
            overlays, so it is identical on every screen and matches the mockup.
            pointerEvents none so it never eats taps. */}
        <View style={styles.rainbowTop} pointerEvents="none">
          <RainbowBar />
        </View>
        <View style={styles.rainbowBottom} pointerEvents="none">
          <RainbowBar />
        </View>
        {/* Celebratory "sent to your lab" burst, floats over everything, never
            blocks taps, renders null when idle. */}
        {/* Skia overlays are native-only. On the web build (used as a fast
            design-preview of the real screens) they are skipped, since Skia
            needs a CanvasKit shim there. They render normally on iOS/Android. */}
        {Platform.OS !== 'web' ? <SuccessBurst /> : null}
        {/* Live BeakerBot mascot, floats in a corner and dodges buttons. Idle
            breathe + blink, tap him for a heart burst. Opt-in (default off),
            toggled on the Settings screen. */}
        {Platform.OS !== 'web' && mascotPrefs.visible ? <HeaderMascot /> : null}
        {/* Lab alarm: watcher raises it when a timer finishes, overlay takes
            over the screen. Native only (Skia). */}
        {Platform.OS !== 'web' ? <LabAlarmWatcher /> : null}
        {Platform.OS !== 'web' ? <LabAlarm /> : null}
      </View>
      {splashVisible && Platform.OS !== 'web' ? <AppSplash onFinish={handleSplashFinish} /> : null}
      <StatusBar style="auto" />
    </ThemeProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rainbowTop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50 },
  rainbowBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50 },
});
