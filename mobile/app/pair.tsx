// Phone pairing screen (piece C). Scans (or accepts a pasted) signed pairing
// grant, verifies the grant signature against the user's identity key and that
// it has not expired, generates this phone's device key, then registers that
// device with the relay named in the grant. On success it stores the verified
// pairing and flips the home tab to Paired. SDK 54 camera API: CameraView +
// useCameraPermissions + onBarcodeScanned(BarcodeScanningResult) +
// barcodeScannerSettings.barcodeTypes. House style: no em-dashes, no emojis, no
// mid-sentence colons.
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import { Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/curves/utils.js';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { BeakerBot } from '@/components/ui/BeakerBot';
import { useTheme, palette, fonts } from '@/lib/design';
import { setPairing, setDemoPairing } from '@/lib/pairing';
import {
  getOrCreateDeviceKey,
  getDeviceX25519PubHex,
} from '@/lib/device-identity';
import { registerPushToken } from '@/lib/push-token';

// Canonical grant string, copied verbatim from the relay contract
// (relay/scripts/smoke-capture.mjs / relay/src/worker.ts). Must stay byte
// identical or the signature will not verify.
function capturePairGrantMessage(
  u: string,
  pid: string,
  exp: string,
  url: string,
): string {
  return `researchos-pair-grant\nu=${u}\npid=${pid}\nexp=${exp}\nurl=${url}`;
}

type Grant = { u: string; pid: string; exp: string; url: string };

const enc = new TextEncoder();

function parseGrantPayload(
  raw: string,
): { grant: Grant; sig: string; userX25519PubHex?: string } | null {
  try {
    const parsed = JSON.parse(raw);
    const grant = parsed?.grant;
    const sig = parsed?.sig;
    if (
      grant &&
      typeof grant.u === 'string' &&
      typeof grant.pid === 'string' &&
      typeof grant.exp === 'string' &&
      typeof grant.url === 'string' &&
      typeof sig === 'string'
    ) {
      // Optional top-level field: the user's X25519 sealing key, carried so the
      // phone can seal route-capture commands to the laptop. Absent on grants
      // built before this field existed.
      const userX25519PubHex =
        typeof parsed.userX25519PubHex === 'string'
          ? parsed.userX25519PubHex
          : undefined;
      return { grant, sig, userX25519PubHex };
    }
  } catch {
    // Not a JSON grant payload.
  }
  return null;
}

export default function PairScreen() {
  const router = useRouter();
  const { surface, spacing } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latch so a held QR code does not run the flow dozens of times.
  const handledRef = useRef(false);
  const [demoSaving, setDemoSaving] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const finishPairing = useCallback(
    async (raw: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      setSaving(true);
      setError(null);

      // Allow another attempt after any failure below.
      const fail = (message: string) => {
        setError(message);
        handledRef.current = false;
        setSaving(false);
      };

      const parsed = parseGrantPayload(raw.trim());
      if (!parsed) {
        fail('That code is not a ResearchOS pairing grant. Scan the QR shown under Settings to Devices on your desktop.');
        return;
      }
      const { grant, sig, userX25519PubHex } = parsed;

      // Reject an expired grant before touching the network.
      const expMs = Date.parse(grant.exp);
      if (Number.isNaN(expMs) || expMs <= Date.now()) {
        fail('This pairing code has expired. Generate a fresh one on your desktop and try again.');
        return;
      }

      // Verify the grant signature against the user identity key.
      let valid = false;
      try {
        const message = capturePairGrantMessage(grant.u, grant.pid, grant.exp, grant.url);
        valid = ed25519.verify(hexToBytes(sig), enc.encode(message), hexToBytes(grant.u));
      } catch {
        valid = false;
      }
      if (!valid) {
        fail('This pairing code could not be verified. Scan the QR shown on your desktop.');
        return;
      }

      try {
        const device = await getOrCreateDeviceKey();
        // getOrCreateDeviceKey ensures the X25519 key too, so this never
        // generates a second time; we read its public half for the register.
        const devX25519 = await getDeviceX25519PubHex();
        const label = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Phone';
        const base = grant.url.replace(/\/+$/, '');
        const res = await fetch(`${base}/capture/register?u=${grant.u}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant,
            sig,
            devicePubkey: device.devicePubHex,
            devX25519,
            label,
            userX25519PubHex,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          userX25519PubHex?: string;
        };
        if (!res.ok || body.ok !== true) {
          fail(
            `Could not register this phone (status ${res.status})${body.error ? ` ${body.error}` : ''}. Check your connection and retry.`,
          );
          return;
        }

        const labName =
          typeof (grant as { labName?: unknown }).labName === 'string'
            ? (grant as unknown as { labName: string }).labName
            : undefined;
        const userName =
          typeof (grant as { userName?: unknown }).userName === 'string'
            ? (grant as unknown as { userName: string }).userName
            : undefined;
        // Prefer the key echoed by the relay register response; fall back to
        // the value carried in the scanned grant so pairing still records the
        // sealing key if the relay omits it. Without this key the phone falls
        // back to inbox routing for route-capture commands.
        const userX25519FromResponse =
          typeof body.userX25519PubHex === 'string'
            ? body.userX25519PubHex
            : userX25519PubHex;
        const paired = await setPairing({
          u: grant.u,
          relayUrl: base,
          devicePubkey: device.devicePubHex,
          labName,
          userName,
          userX25519PubHex: userX25519FromResponse,
        });
        // Register this phone's Expo push token so phone-routed notifications can
        // buzz it (phone push P1). Fire and forget: it prompts for the OS
        // notification grant and reaches the relay over the device-signed route,
        // and a denied grant or Expo Go just means no buzz, never a pairing
        // failure. Pairing has already succeeded by here.
        void registerPushToken(paired);
        router.back();
      } catch {
        fail('Could not reach the relay. Check your connection and try again.');
      }
    },
    [router],
  );

  // Write a demo pairing record and navigate directly into the Notebook tab.
  // No keys are generated, no relay is called; the demo guard handles the rest.
  const onTryDemo = useCallback(async () => {
    if (demoSaving) return;
    setDemoSaving(true);
    try {
      await setDemoPairing();
      router.replace('/(tabs)/notebook');
    } finally {
      setDemoSaving(false);
    }
  }, [demoSaving, router]);

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (!result?.data) return;
      finishPairing(result.data);
    },
    [finishPairing],
  );

  const onSubmitManual = useCallback(() => {
    const trimmed = manualCode.trim();
    if (trimmed.length === 0) return;
    finishPairing(trimmed);
  }, [manualCode, finishPairing]);

  // Permission still loading from the OS.
  if (!permission) {
    return (
      <ScreenFrame>
        <ScreenHeader />
        <View style={styles.centered}>
          <ActivityIndicator color={palette.sky} />
        </View>
      </ScreenFrame>
    );
  }

  // Permission not yet granted: explain and offer the grant button. The manual
  // fallback stays available so pairing works even without the camera.
  if (!permission.granted) {
    return (
      <ScreenFrame>
        <ScreenHeader title="Pair this phone" />
        <View style={[styles.permissionWrap, { gap: spacing.lg }]}>
          {/* Hero bot, seated on the contract's sky->#43c0ff gradient tile
              (.bot) so the connect moment reads as a brand welcome, not a bare
              permission prompt. */}
          <View style={styles.heroBlock}>
            <LinearGradient
              colors={[palette.sky, '#43C0FF']}
              start={{ x: 0.15, y: 0 }}
              end={{ x: 0.85, y: 1 }}
              style={styles.heroTile}
            >
              <View style={styles.heroGloss} pointerEvents="none" />
              <BeakerBot size={68} alive color={palette.white} />
            </LinearGradient>
            <ThemedText style={[styles.heroTitle, { color: surface.text }]}>
              Connect to your lab
            </ThemedText>
            <ThemedText style={[styles.heroBody, { color: surface.muted }]}>
              Pair with ResearchOS on your laptop to capture, glance, and sync at
              the bench.
            </ThemedText>
          </View>

          <View style={styles.actionStack}>
            <Button
              testID="pair-allow-camera"
              variant="primary"
              label="Allow camera access"
              icon={
                <Ionicons name="qr-code-outline" size={18} color={palette.white} />
              }
              onPress={requestPermission}
            />

            {error ? <ErrorCallout message={error} /> : null}

            {showManual ? (
              <ManualEntry
                value={manualCode}
                onChangeText={setManualCode}
                onSubmit={onSubmitManual}
                saving={saving}
              />
            ) : (
              <Button
                testID="pair-enter-code"
                variant="secondary"
                label="Enter a code"
                icon={
                  <Ionicons
                    name="keypad-outline"
                    size={17}
                    color={surface.text}
                  />
                }
                onPress={() => setShowManual(true)}
              />
            )}
          </View>

          <DemoLink onPress={onTryDemo} saving={demoSaving} />
        </View>
      </ScreenFrame>
    );
  }

  // Permission granted: live scanner plus the manual fallback below it.
  return (
    <ScreenFrame>
      <ScreenHeader title="Pair this phone" />
      <View style={[styles.scannerWrap, { gap: spacing.md }]}>
        <ThemedText style={[styles.scanTitle, { color: surface.text }]}>
          Scan to pair
        </ThemedText>
        <ThemedText style={[styles.scanSub, { color: surface.muted }]}>
          Point your camera at the pairing code in your laptop Settings.
        </ThemedText>

        {/* Live viewfinder. The dark frame holds the camera, four white corner
            brackets (contract .qrframe .cnr) draw the aim guide, and a faint sky
            scanline + glow sells the "scanning" moment. The saving overlay dims
            it while the grant verifies + registers. */}
        <View style={styles.cameraFrame}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={saving ? undefined : onBarcodeScanned}
          />
          {!saving ? (
            <>
              <View style={styles.scanGuide} pointerEvents="none">
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <View style={styles.scanline} pointerEvents="none" />
            </>
          ) : null}
          {saving ? (
            <View style={styles.savingOverlay}>
              <ActivityIndicator color={palette.white} />
              <ThemedText style={styles.savingText}>Pairing...</ThemedText>
            </View>
          ) : null}
        </View>

        {error ? <ErrorCallout message={error} /> : null}

        <ManualEntry
          value={manualCode}
          onChangeText={setManualCode}
          onSubmit={onSubmitManual}
          saving={saving}
        />

        <DemoLink onPress={onTryDemo} saving={demoSaving} />
      </View>
    </ScreenFrame>
  );
}

// A quiet, tertiary "try the demo" text link for reviewers and curious users.
// Demoted from a full button so it never competes with the real pairing paths,
// but stays easy to find when there is no desktop handy. The escape is always
// present, so the pair screen never soft-locks a phone with no laptop nearby.
function DemoLink({ onPress, saving }: { onPress: () => void; saving: boolean }) {
  const { surface } = useTheme();
  return (
    <Pressable
      testID="pair-try-demo"
      onPress={onPress}
      disabled={saving}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [styles.demoLinkWrap, { opacity: pressed ? 0.6 : 1 }]}
    >
      {saving ? (
        <ActivityIndicator size="small" color={palette.coral} />
      ) : (
        <ThemedText style={[styles.demoLink, { color: surface.muted }]}>
          No desktop?{' '}
          <ThemedText style={[styles.demoLink, styles.demoLinkAccent, { color: palette.coral }]}>
            Try the demo
          </ThemedText>
        </ThemedText>
      )}
    </Pressable>
  );
}

// Recoverable error, styled as the contract's danger callout (tinted inset +
// bordered + an accent lead line), matching note.tsx's failed-send callout so
// the pair screen speaks the same error language as the rest of the app.
function ErrorCallout({ message }: { message: string }) {
  const { surface, radii } = useTheme();
  return (
    <View
      style={[
        styles.callout,
        {
          backgroundColor: palette.dangerDim,
          borderColor: palette.dangerBorder,
          borderRadius: radii.md,
        },
      ]}
    >
      <Ionicons
        name="alert-circle-outline"
        size={18}
        color={palette.danger}
        style={styles.calloutIcon}
      />
      <ThemedText style={[styles.calloutText, { color: surface.text }]}>
        <ThemedText style={[styles.calloutLead, { color: palette.danger }]}>
          Could not pair.
        </ThemedText>{' '}
        {message}
      </ThemedText>
    </View>
  );
}

function ManualEntry({
  value,
  onChangeText,
  onSubmit,
  saving,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  const { surface, radii, spacing, dark } = useTheme();
  // Focus state lifts the field to the elevated surface and wraps it in the
  // contract sky focus ring (.input.focus), matching the note compose fields.
  const [focused, setFocused] = useState(false);
  const empty = value.trim().length === 0;

  return (
    <View style={[styles.manualCard, { gap: spacing.sm }]}>
      <View style={styles.manualHeadRow}>
        <View style={styles.manualBadge}>
          <Ionicons name="keypad-outline" size={15} color={palette.sky} />
        </View>
        <ThemedText style={[styles.manualTitle, { color: surface.text }]}>
          Enter a code manually
        </ThemedText>
      </View>
      <ThemedText style={[styles.manualHint, { color: surface.muted }]}>
        Paste the pairing code shown in your laptop Settings.
      </ThemedText>
      <TextInput
        testID="pair-code-input"
        value={value}
        onChangeText={onChangeText}
        placeholder="ros-pair:eyJ1Ijoi..."
        placeholderTextColor={surface.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          {
            backgroundColor: focused ? surface.surface : surface.surface2,
            borderColor: focused ? palette.sky : surface.borderStrong,
            borderRadius: radii.md,
            color: surface.text,
          },
          focused
            ? {
                shadowColor: palette.sky,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: dark ? 0.5 : 0.28,
                shadowRadius: 6,
                elevation: 0,
              }
            : null,
        ]}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
      />
      <Button
        testID="pair-submit-code"
        variant="primary"
        label="Pair with code"
        loading={saving}
        onPress={onSubmit}
        disabled={empty || saving}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // ---- Permission / connect hero ----
  permissionWrap: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  heroBlock: {
    alignItems: 'center',
    gap: 14,
  },
  // Sky gradient rounded-square that seats the mark (contract .bot tile).
  heroTile: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // Contract --shadow-lg: a soft sky-tinted lift under the hero tile.
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 22,
    elevation: 10,
  },
  // Top-corner sheen so the tile reads as glossy glass, not a flat block.
  heroGloss: {
    position: 'absolute',
    top: -26,
    left: -26,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 31,
    fontFamily: fonts.extrabold,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: fonts.ui,
    textAlign: 'center',
    maxWidth: 320,
  },
  actionStack: {
    gap: 10,
    marginTop: 28,
  },

  // ---- Scanner ----
  scannerWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  scanTitle: {
    fontSize: 23,
    lineHeight: 28,
    fontFamily: fonts.extrabold,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  scanSub: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.ui,
    textAlign: 'center',
  },
  cameraFrame: {
    aspectRatio: 1,
    overflow: 'hidden',
    borderRadius: 26,
    backgroundColor: '#05070C',
    // Lift the viewfinder off the canvas.
    shadowColor: '#0F1722',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
    marginTop: 2,
  },
  camera: { flex: 1 },
  // Inset square holding the four corner brackets, leaving a margin so the
  // brackets float inside the dark frame (contract .qrframe inset).
  scanGuide: {
    ...StyleSheet.absoluteFillObject,
    margin: '14%',
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: palette.white,
    borderWidth: 3,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 12,
  },
  // Faint sky scanline across the aim window (contract .vf-scanline).
  scanline: {
    position: 'absolute',
    left: '16%',
    right: '16%',
    top: '50%',
    height: 2,
    backgroundColor: palette.sky,
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    opacity: 0.85,
  },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(5, 7, 12, 0.55)',
  },
  savingText: {
    color: palette.white,
    fontSize: 14,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },

  // ---- Manual entry card ----
  manualCard: {
    // Plain panel (no Card chrome) so it reads as a quieter inline fallback,
    // not a second hero. Inputs carry their own surface + focus ring.
  },
  manualHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  manualBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: palette.skyDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualTitle: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    fontWeight: '600',
    lineHeight: 20,
  },
  manualHint: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.ui,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    fontFamily: fonts.mono,
    minHeight: 48,
  },

  // ---- Error callout (contract .callout, danger tint) ----
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  calloutIcon: { marginTop: 1 },
  calloutText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.ui,
    lineHeight: 20,
  },
  calloutLead: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    fontWeight: '600',
    lineHeight: 20,
  },

  // ---- Demo entry point (tertiary text link, coral accent) ----
  demoLinkWrap: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  demoLink: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.ui,
  },
  demoLinkAccent: {
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
});
