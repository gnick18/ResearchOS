// v0 scan-to-reorder screen. Point the phone at a reagent box barcode, match it
// against the laptop-published inventory snapshot, and send a reorder request to
// the lab inbox over the encrypted relay. On a match the screen shows the item
// card with an "Add to reorder list" button. On no match it shows the raw code
// with a "Send reorder request anyway" button. A manual-code field runs the same
// lookup for boxes that will not scan. v0 only matches an item's existing
// product_barcode, it never sets a barcode from the phone. SDK 54 expo-camera:
// useCameraPermissions() for the grant, CameraView with onBarcodeScanned and
// barcodeScannerSettings.barcodeTypes for the multi-format scanner. House style:
// no em-dashes, no emojis, no mid-sentence colons, brand-sky (#1AA0E6) accents.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot } from '@/lib/snapshots';
import { uploadReorder, type ReorderPayload } from '@/lib/reorder';

const BRAND_SKY = '#1AA0E6';

// The barcode formats we ask the scanner to detect. Confirmed against the SDK 54
// expo-camera doc BarcodeType union (every value below is a valid member).
const BARCODE_TYPES = [
  'qr',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'codabar',
  'itf14',
  'datamatrix',
] as const;

// One inventory item as it appears in the "inventory" snapshot. Every field is
// tolerated missing so a laptop on an older shape never crashes the screen.
type InventoryItem = {
  id?: number;
  name?: string;
  category?: string;
  vendor?: string | null;
  catalog_number?: string | null;
  product_barcode?: string | null;
  low_at_count?: number | null;
  container_label?: string | null;
};

type InventorySnapshot = {
  generatedAt?: string;
  items?: InventoryItem[];
};

type SyncState =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number; generatedAt?: string }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; error: string };

// What the user is currently looking at after a scan or manual lookup.
type ScanOutcome =
  | { kind: 'none' }
  | { kind: 'match'; item: InventoryItem; code: string }
  | { kind: 'nomatch'; code: string };

export default function ReorderScreen() {
  const { pairing } = usePairing();
  const [permission, requestPermission] = useCameraPermissions();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [sync, setSync] = useState<SyncState>({ kind: 'loading' });
  const [outcome, setOutcome] = useState<ScanOutcome>({ kind: 'none' });
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  const [manualCode, setManualCode] = useState('');
  // Latch so a held barcode does not fire the handler repeatedly. Cleared by the
  // "Scan another" reset.
  const [handled, setHandled] = useState(false);

  const paired = !!pairing;

  // Pull the inventory snapshot once on mount when paired. A 404 (null) means the
  // laptop has not published yet, which is the "no inventory" hint, not an error.
  useEffect(() => {
    let cancelled = false;
    if (!pairing) {
      setSync({ kind: 'empty' });
      return;
    }
    (async () => {
      setSync({ kind: 'loading' });
      try {
        const snap = (await fetchSnapshot(
          'inventory',
          pairing,
          signWithDevice,
        )) as InventorySnapshot | null;
        if (cancelled) return;
        const list = Array.isArray(snap?.items) ? snap!.items! : [];
        setItems(list);
        if (!snap || list.length === 0) {
          setSync({ kind: 'empty' });
        } else {
          setSync({
            kind: 'ready',
            count: list.length,
            generatedAt: snap.generatedAt,
          });
        }
      } catch (err) {
        if (cancelled) return;
        setSync({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Could not sync inventory.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pairing]);

  // Look up a scanned or typed code against the cached items by product_barcode,
  // trimmed string compare. Sets the outcome and resets any prior send status.
  const lookup = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (code.length === 0) return;
      setSend({ kind: 'idle' });
      const match = items.find(
        (it) =>
          typeof it.product_barcode === 'string' &&
          it.product_barcode.trim() === code,
      );
      setOutcome(match ? { kind: 'match', item: match, code } : { kind: 'nomatch', code });
    },
    [items],
  );

  // Camera callback. Guarded by the latch so a held box fires once. Each scan
  // runs the same lookup a manual code does.
  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (handled) return;
      if (!result?.data) return;
      setHandled(true);
      lookup(result.data);
    },
    [handled, lookup],
  );

  const onManualLookup = useCallback(() => {
    if (manualCode.trim().length === 0) return;
    setHandled(true);
    lookup(manualCode);
  }, [manualCode, lookup]);

  // Reset back to a live scanner after handling a scan.
  const onScanAnother = useCallback(() => {
    setOutcome({ kind: 'none' });
    setSend({ kind: 'idle' });
    setHandled(false);
    setManualCode('');
  }, []);

  const onSend = useCallback(
    async (payload: ReorderPayload) => {
      if (!pairing || send.kind === 'sending') return;
      setSend({ kind: 'sending' });
      const res = await uploadReorder(payload, pairing, signWithDevice);
      if (res.ok) {
        setSend({ kind: 'sent' });
      } else {
        setSend({ kind: 'failed', error: res.error });
      }
    },
    [pairing, send.kind],
  );

  const cameraReady = paired && permission?.granted === true && !handled;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText style={styles.tagline}>
            Point the camera at a reagent box barcode to add it to your lab
            reorder list.
          </ThemedText>

          <SyncLine sync={sync} paired={paired} />

          {!paired ? (
            <ThemedView style={styles.card}>
              <ThemedText style={styles.cardHint}>
                Pair this phone from the home tab to scan and send reorders.
              </ThemedText>
            </ThemedView>
          ) : null}

          {paired && permission && !permission.granted ? (
            <ThemedView style={styles.card}>
              <ThemedText type="defaultSemiBold">Camera access needed</ThemedText>
              <ThemedText style={styles.cardHint}>
                ResearchOS needs the camera to scan reagent barcodes.
              </ThemedText>
              <Pressable
                style={styles.primaryButton}
                onPress={requestPermission}
                accessibilityRole="button"
              >
                <ThemedText style={styles.primaryButtonText}>
                  Allow camera
                </ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}

          {cameraReady ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                onBarcodeScanned={onBarcodeScanned}
                barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              />
            </View>
          ) : null}

          {paired && handled ? (
            <OutcomeCard
              outcome={outcome}
              send={send}
              onSend={onSend}
              onScanAnother={onScanAnother}
            />
          ) : null}

          {paired ? (
            <ThemedView style={styles.card}>
              <ThemedText type="defaultSemiBold">Enter a code by hand</ThemedText>
              <ThemedText style={styles.cardHint}>
                For a box that will not scan, type its barcode and look it up.
              </ThemedText>
              <TextInput
                value={manualCode}
                onChangeText={setManualCode}
                placeholder="Barcode"
                placeholderTextColor="rgba(128, 128, 128, 0.8)"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                style={styles.secondaryButton}
                onPress={onManualLookup}
                accessibilityRole="button"
              >
                <ThemedText style={styles.secondaryButtonText}>
                  Look up code
                </ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SyncLine({ sync, paired }: { sync: SyncState; paired: boolean }) {
  if (!paired) return null;
  if (sync.kind === 'loading') {
    return <ThemedText style={styles.syncLine}>Syncing inventory...</ThemedText>;
  }
  if (sync.kind === 'ready') {
    return (
      <ThemedText style={styles.syncLine}>
        Synced {sync.count} item{sync.count === 1 ? '' : 's'}
        {sync.generatedAt ? ` (updated ${formatTime(sync.generatedAt)})` : ''}
      </ThemedText>
    );
  }
  if (sync.kind === 'empty') {
    return (
      <ThemedText style={styles.syncLine}>
        No inventory yet, open ResearchOS on your laptop to publish it.
      </ThemedText>
    );
  }
  return (
    <ThemedText style={[styles.syncLine, styles.syncError]}>
      {sync.message}
    </ThemedText>
  );
}

function OutcomeCard({
  outcome,
  send,
  onSend,
  onScanAnother,
}: {
  outcome: ScanOutcome;
  send: SendState;
  onSend: (payload: ReorderPayload) => void;
  onScanAnother: () => void;
}) {
  if (outcome.kind === 'none') {
    return (
      <ThemedView style={styles.card}>
        <ThemedText style={styles.cardHint}>No code read yet.</ThemedText>
        <Pressable
          style={styles.secondaryButton}
          onPress={onScanAnother}
          accessibilityRole="button"
        >
          <ThemedText style={styles.secondaryButtonText}>Scan again</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const sending = send.kind === 'sending';
  const sent = send.kind === 'sent';

  if (outcome.kind === 'match') {
    const it = outcome.item;
    const lowStock =
      typeof it.low_at_count === 'number' && it.low_at_count !== null;
    const payload: ReorderPayload = {
      itemId: it.id,
      name: it.name,
      catalog_number: it.catalog_number ?? null,
      vendor: it.vendor ?? null,
      product_barcode: it.product_barcode ?? outcome.code,
    };
    return (
      <ThemedView style={styles.card}>
        <ThemedText type="defaultSemiBold">{it.name ?? 'Inventory item'}</ThemedText>
        {it.vendor ? (
          <ThemedText style={styles.cardHint}>Vendor {it.vendor}</ThemedText>
        ) : null}
        {it.catalog_number ? (
          <ThemedText style={styles.cardHint}>Catalog {it.catalog_number}</ThemedText>
        ) : null}
        {it.container_label ? (
          <ThemedText style={styles.cardHint}>{it.container_label}</ThemedText>
        ) : null}
        {lowStock ? (
          <View style={styles.lowPill}>
            <ThemedText style={styles.lowPillText}>
              Reorder at {it.low_at_count}
            </ThemedText>
          </View>
        ) : null}

        {sent ? (
          <SentBlock onScanAnother={onScanAnother} />
        ) : (
          <>
            <Pressable
              style={[styles.primaryButton, sending && styles.buttonDisabled]}
              onPress={() => onSend(payload)}
              disabled={sending}
              accessibilityRole="button"
            >
              {sending ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText style={styles.primaryButtonText}>
                  Add to reorder list
                </ThemedText>
              )}
            </Pressable>
            {send.kind === 'failed' ? (
              <ThemedText style={styles.errorLine}>{send.error}</ThemedText>
            ) : null}
            <Pressable
              style={styles.secondaryButton}
              onPress={onScanAnother}
              accessibilityRole="button"
            >
              <ThemedText style={styles.secondaryButtonText}>
                Scan another
              </ThemedText>
            </Pressable>
          </>
        )}
      </ThemedView>
    );
  }

  // No match.
  const payload: ReorderPayload = { product_barcode: outcome.code };
  return (
    <ThemedView style={styles.card}>
      <ThemedText type="defaultSemiBold">No matching item</ThemedText>
      <ThemedText style={styles.cardHint}>Scanned code {outcome.code}</ThemedText>
      {sent ? (
        <SentBlock onScanAnother={onScanAnother} />
      ) : (
        <>
          <Pressable
            style={[styles.primaryButton, sending && styles.buttonDisabled]}
            onPress={() => onSend(payload)}
            disabled={sending}
            accessibilityRole="button"
          >
            {sending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText style={styles.primaryButtonText}>
                Send reorder request anyway
              </ThemedText>
            )}
          </Pressable>
          {send.kind === 'failed' ? (
            <ThemedText style={styles.errorLine}>{send.error}</ThemedText>
          ) : null}
          <Pressable
            style={styles.secondaryButton}
            onPress={onScanAnother}
            accessibilityRole="button"
          >
            <ThemedText style={styles.secondaryButtonText}>
              Scan another
            </ThemedText>
          </Pressable>
        </>
      )}
    </ThemedView>
  );
}

function SentBlock({ onScanAnother }: { onScanAnother: () => void }) {
  return (
    <>
      <View style={styles.sentPill}>
        <ThemedText style={styles.sentPillText}>Sent to your lab</ThemedText>
      </View>
      <Pressable
        style={styles.secondaryButton}
        onPress={onScanAnother}
        accessibilityRole="button"
      >
        <ThemedText style={styles.secondaryButtonText}>Scan another</ThemedText>
      </Pressable>
    </>
  );
}

// Friendly local rendering of an ISO timestamp; falls back to the raw string.
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },
  tagline: {
    opacity: 0.7,
    lineHeight: 22,
  },
  syncLine: {
    opacity: 0.7,
    fontSize: 14,
  },
  syncError: {
    color: '#dc2626',
    opacity: 1,
  },
  cameraWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  cardHint: {
    opacity: 0.7,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
    color: '#888888',
  },
  primaryButton: {
    backgroundColor: BRAND_SKY,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: BRAND_SKY,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: BRAND_SKY,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  errorLine: {
    color: '#dc2626',
    lineHeight: 20,
  },
  lowPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  lowPillText: {
    color: '#b45309',
    fontSize: 12,
    fontWeight: '600',
  },
  sentPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(22, 163, 74, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  sentPillText: {
    color: '#16a34a',
    fontSize: 12,
    fontWeight: '600',
  },
});
