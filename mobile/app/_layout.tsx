import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';
import { useFonts } from 'expo-font';
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_800ExtraBold,
} from '@expo-google-fonts/geist';
import {
  GeistMono_500Medium,
  GeistMono_600SemiBold,
} from '@expo-google-fonts/geist-mono';

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppSplash } from '@/components/AppSplash';
import { AppLockGate } from '@/components/AppLockGate';
import { RainbowBar } from '@/components/ui/RainbowBar';
import { SuccessBurst } from '@/components/SuccessBurst';
import BeakerBotWorkingBubble from '@/components/BeakerBotWorkingBubble';
import { HeaderMascot } from '@/components/HeaderMascot';
import { LabAlarm, LabAlarmWatcher } from '@/components/LabAlarm';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMascotPrefs } from '@/lib/mascot-prefs';
import { startCommandOutboxAutoFlush } from '@/lib/command-outbox';
import {
  addQuickActionListener,
  getInitialQuickAction,
  registerQuickActions,
  routeForQuickAction,
} from '@/lib/quick-actions';

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

  // Load Geist (UI) + Geist Mono (numbers). The native splash stays up until the
  // fonts are ready so there is no fallback-font flash on first paint.
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    Geist_800ExtraBold,
    GeistMono_500Medium,
    GeistMono_600SemiBold,
  });

  // Phone push tap-to-open routing.
  //
  // Push payload contract (the laptop publisher sends this in the notification
  // data; the relay carries it opaque, never any research content). All routing
  // happens here on the phone, so the publisher only has to set the right kind
  // (and a uid where noted). Back-compatible: anything unknown, missing, or the
  // legacy generic wake buzz falls through to the notifications screen.
  //
  //   { kind: 'notifications' }            -> /notifications  (legacy default)
  //   { kind: 'method', uid: string }      -> /method-detail?uid=...
  //   { kind: 'timer' }                    -> /(tabs)/timers
  //   { kind: 'experiment', uid?: string } -> /notebook (with optional uid passthrough)
  //   { kind: 'capture' }                  -> /scan
  //   default / unknown                    -> /notifications
  //
  // The wake-and-fetch design holds: the generic buzz still carries only
  // data.kind, never content; richer kinds add a uid at most so the target screen
  // can fetch + locally decrypt the sealed object. Guarded so a missing native
  // module never breaks startup.
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
        | { kind?: unknown; uid?: unknown }
        | undefined;
      const kind = typeof data?.kind === 'string' ? data.kind : undefined;
      const uid = typeof data?.uid === 'string' ? data.uid : undefined;
      switch (kind) {
        case 'method':
          if (uid) {
            // Library deep-link: open one cached method by owner-namespaced uid.
            router.push({ pathname: '/method-detail', params: { uid } });
          } else {
            // "View on phone" auto-open: no uid means the laptop just published
            // the focused experiment's method snapshot, so open its read mode
            // directly (?read=1) rather than dropping the user on notifications.
            router.push({ pathname: '/method-detail', params: { read: '1' } });
          }
          break;
        case 'timer':
          router.push('/(tabs)/timers');
          break;
        case 'experiment':
          router.push(
            uid
              ? { pathname: '/(tabs)/notebook', params: { uid } }
              : '/(tabs)/notebook',
          );
          break;
        case 'capture':
          router.push('/scan');
          break;
        case 'notifications':
        default:
          router.push('/notifications');
          break;
      }
    });
    return () => sub.remove();
  }, [router]);

  // Home-screen quick actions (long-press the app icon). Register the shortcuts,
  // route the action that cold-started the app, and listen for actions chosen
  // while running. Guarded inside the lib so a missing native module is a no-op.
  useEffect(() => {
    void registerQuickActions();

    const initial = getInitialQuickAction();
    const initialRoute = routeForQuickAction(initial);
    if (initialRoute) {
      router.push(initialRoute);
    }

    const sub = addQuickActionListener((action) => {
      const route = routeForQuickAction(action);
      if (route) router.push(route);
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
    if (nativeHidden || !fontsLoaded) return;
    setNativeHidden(true);
    // First commit is on screen, the JS overlay now covers the same pixels with
    // a matching background, so hiding the native splash will not flash.
    SplashScreen.hideAsync().catch(() => {
      // Native module missing or already hidden, ignore.
    });
  }, [nativeHidden, fontsLoaded]);

  // Flush any bench writes that were queued while offline, now and whenever the
  // network comes back, so variation notes and method checks sync on reconnect.
  useEffect(() => {
    const stop = startCommandOutboxAutoFlush();
    return () => stop();
  }, []);

  const handleSplashFinish = useCallback(() => {
    setSplashVisible(false);
  }, []);

  // Brand the navigator background too (the canvas behind screens + transitions)
  // so there is no white flash between screens. Matches the ThemedView canvas.
  const navTheme =
    colorScheme === 'dark'
      ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: '#070A12' } }
      : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#EEF1F6' } };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
    <ThemeProvider value={navTheme}>
      <View style={styles.root}>
        {/* Every screen uses its own in-content ScreenHeader (back chevron +
            large title), never the native stack header, so the native header is
            hidden by DEFAULT here. A new route is safe without remembering to
            opt out; only screens that need extra options (e.g. modal
            presentation) declare a Stack.Screen. */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
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
        {/* BeakerBot working bubble: appears upper-right while a metered-AI job
            (the method reformat) is in flight, tap to see token usage + time
            left. Renders null when no job is running. Native only (Skia). */}
        {Platform.OS !== 'web' ? <BeakerBotWorkingBubble /> : null}
      </View>
      {splashVisible && Platform.OS !== 'web' ? <AppSplash onFinish={handleSplashFinish} /> : null}
      {/* Biometric app lock. Opt-in (default off), so this renders null and adds
          nothing for current users. When armed it covers the whole app on cold
          start and on a long-enough return from background. Sits above the splash
          so the bench is never briefly visible behind the lock. Native only. */}
      {Platform.OS !== 'web' ? <AppLockGate /> : null}
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
