// v0 phone pairing screen. Scans a QR code with the camera and stores whatever
// it reads, then flips the home tab to Paired. A typed-code fallback feeds the
// same store. No crypto / device keys / network yet, that is the next
// increment. SDK 54 camera API: CameraView + useCameraPermissions +
// onBarcodeScanned(BarcodeScanningResult) + barcodeScannerSettings.barcodeTypes.
// House style: no em-dashes, no emojis, brand-sky (#1AA0E6) accents.
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
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

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { setPairing } from '@/lib/pairing';

const BRAND_SKY = '#1AA0E6';

export default function PairScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [saving, setSaving] = useState(false);
  // Latch so a held QR code does not fire setPairing dozens of times.
  const handledRef = useRef(false);

  const finishPairing = useCallback(
    async (raw: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      setSaving(true);
      try {
        await setPairing({ raw });
        router.back();
      } catch {
        // Allow a retry if the write failed.
        handledRef.current = false;
        setSaving(false);
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
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator color={BRAND_SKY} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  // Permission not yet granted: explain and offer the grant button. The manual
  // fallback stays available so pairing works even without the camera.
  if (!permission.granted) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.permissionWrap}>
          <ThemedText type="title" style={styles.center}>
            Pair your phone
          </ThemedText>
          <ThemedText style={styles.body}>
            ResearchOS needs camera access to scan the pairing code shown on your
            desktop. You can also type the code in by hand.
          </ThemedText>
          <Pressable
            style={styles.primaryButton}
            onPress={requestPermission}
            accessibilityRole="button"
          >
            <ThemedText style={styles.primaryButtonText}>
              Allow camera access
            </ThemedText>
          </Pressable>

          <ManualEntry
            value={manualCode}
            onChangeText={setManualCode}
            onSubmit={onSubmitManual}
            saving={saving}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  // Permission granted: live scanner plus the manual fallback below it.
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.scannerWrap}>
        <ThemedText type="title" style={styles.center}>
          Scan to pair
        </ThemedText>
        <ThemedText style={[styles.body, styles.center]}>
          Point your camera at the pairing code on your desktop.
        </ThemedText>

        <View style={styles.cameraFrame}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={saving ? undefined : onBarcodeScanned}
          />
          {saving ? (
            <View style={styles.savingOverlay}>
              <ActivityIndicator color="#ffffff" />
              <ThemedText style={styles.savingText}>Pairing</ThemedText>
            </View>
          ) : null}
        </View>

        <ManualEntry
          value={manualCode}
          onChangeText={setManualCode}
          onSubmit={onSubmitManual}
          saving={saving}
        />
      </SafeAreaView>
    </ThemedView>
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
  return (
    <View style={styles.manualWrap}>
      <ThemedText type="defaultSemiBold">Enter a code manually</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Paste or type the pairing code"
        placeholderTextColor="rgba(128, 128, 128, 0.8)"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
        style={styles.input}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
      />
      <Pressable
        style={[styles.secondaryButton, value.trim().length === 0 && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={value.trim().length === 0 || saving}
        accessibilityRole="button"
      >
        <ThemedText style={styles.secondaryButtonText}>Pair with code</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  body: {
    opacity: 0.7,
    lineHeight: 22,
  },
  permissionWrap: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 18,
  },
  scannerWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    gap: 16,
  },
  cameraFrame: {
    aspectRatio: 1,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: BRAND_SKY,
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
  primaryButton: {
    backgroundColor: BRAND_SKY,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  manualWrap: {
    gap: 10,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#888888',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: BRAND_SKY,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: BRAND_SKY,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
