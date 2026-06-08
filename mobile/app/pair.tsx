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
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import { Platform } from 'react-native';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/curves/utils.js';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTheme, palette } from '@/lib/design';
import { setPairing } from '@/lib/pairing';
import {
  getOrCreateDeviceKey,
  getDeviceX25519PubHex,
} from '@/lib/device-identity';

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
): { grant: Grant; sig: string } | null {
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
      return { grant, sig };
    }
  } catch {
    // Not a JSON grant payload.
  }
  return null;
}

export default function PairScreen() {
  const router = useRouter();
  const { surface, spacing, radii } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latch so a held QR code does not run the flow dozens of times.
  const handledRef = useRef(false);

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
      const { grant, sig } = parsed;

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
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
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
        await setPairing({
          u: grant.u,
          relayUrl: base,
          devicePubkey: device.devicePubHex,
          labName,
        });
        router.back();
      } catch {
        fail('Could not reach the relay. Check your connection and try again.');
      }
    },
    [router],
  );

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
      <ScreenFrame edges={['bottom']}>
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
      <ScreenFrame edges={['bottom']}>
        <View style={[styles.permissionWrap, { gap: spacing.lg }]}>
          <ThemedText type="title" style={styles.center}>
            Pair your phone
          </ThemedText>
          <ThemedText style={[styles.body, { color: surface.muted }]}>
            ResearchOS needs camera access to scan the pairing code shown on your
            desktop. You can also type the code in by hand.
          </ThemedText>
          <Button
            variant="primary"
            label="Allow camera access"
            onPress={requestPermission}
          />

          {error ? <ErrorBanner message={error} /> : null}

          <ManualEntry
            value={manualCode}
            onChangeText={setManualCode}
            onSubmit={onSubmitManual}
            saving={saving}
          />
        </View>
      </ScreenFrame>
    );
  }

  // Permission granted: live scanner plus the manual fallback below it.
  return (
    <ScreenFrame edges={['bottom']}>
      <View style={[styles.scannerWrap, { gap: spacing.md }]}>
        <ThemedText type="title" style={styles.center}>
          Scan to pair
        </ThemedText>
        <ThemedText style={[styles.body, styles.center, { color: surface.muted }]}>
          Point your camera at the pairing code on your desktop.
        </ThemedText>

        <View
          style={[
            styles.cameraFrame,
            { borderColor: palette.sky, borderRadius: radii.xl },
          ]}
        >
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={saving ? undefined : onBarcodeScanned}
          />
          {saving ? (
            <View style={styles.savingOverlay}>
              <ActivityIndicator color={palette.white} />
              <ThemedText style={styles.savingText}>Pairing</ThemedText>
            </View>
          ) : null}
        </View>

        {error ? <ErrorBanner message={error} /> : null}

        <ManualEntry
          value={manualCode}
          onChangeText={setManualCode}
          onSubmit={onSubmitManual}
          saving={saving}
        />
      </View>
    </ScreenFrame>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View
      style={[
        styles.errorBanner,
        {
          borderColor: palette.dangerBorder,
          backgroundColor: palette.dangerLight,
        },
      ]}
    >
      <ThemedText style={[styles.errorText, { color: palette.danger }]}>
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
  const { surface, radii, spacing } = useTheme();

  return (
    <Card style={{ gap: spacing.sm }}>
      <ThemedText style={[styles.manualTitle, { color: surface.text }]}>
        Enter a code manually
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Paste or type the pairing code"
        placeholderTextColor={surface.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
        style={[
          styles.input,
          {
            borderColor: surface.border,
            borderRadius: radii.md,
            color: surface.text,
          },
        ]}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
      />
      <Button
        variant="secondary"
        label="Pair with code"
        onPress={onSubmit}
        disabled={value.trim().length === 0 || saving}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  body: {
    lineHeight: 22,
  },
  permissionWrap: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  scannerWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  cameraFrame: {
    aspectRatio: 1,
    overflow: 'hidden',
    borderWidth: 2,
    backgroundColor: '#000000',
  },
  camera: { flex: 1 },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  savingText: { color: '#ffffff' },
  manualTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    lineHeight: 20,
  },
});
