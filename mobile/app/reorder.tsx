// v0 scan-to-reorder screen. Point the phone at a reagent box barcode, match it
// against the laptop-published inventory snapshot, and send a reorder request to
// the lab inbox over the encrypted relay. On a match the screen shows the item
// card with an "Add to reorder list" button. On no match it shows the raw code
// with a "Send reorder request anyway" button. A manual-code field runs the same
// lookup for boxes that will not scan. v0 only matches an item's existing
// product_barcode, it never sets a barcode from the phone. SDK 54 expo-camera:
// useCameraPermissions() for the grant, CameraView with onBarcodeScanned and
// barcodeScannerSettings.barcodeTypes for the multi-format scanner. House style:
// no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTheme, palette } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot } from '@/lib/snapshots';
import { uploadReorder, type ReorderPayload } from '@/lib/reorder';

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
  const { surface, spacing, radii } = useTheme();
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
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            Point the camera at a reagent box barcode to add it to your lab
            reorder list.
          </ThemedText>

          <SyncLine sync={sync} paired={paired} />

          {!paired ? (
            <EmptyState
              icon="barcode-outline"
              text="Pair this phone from the home tab to scan and send reorders."
            />
          ) : null}

          {paired && permission && !permission.granted ? (
            <Card style={{ gap: spacing.sm }}>
              <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
                Camera access needed
              </ThemedText>
              <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
                ResearchOS needs the camera to scan reagent barcodes.
              </ThemedText>
              <Button
                variant="primary"
                label="Allow camera"
                onPress={requestPermission}
              />
            </Card>
          ) : null}

          {cameraReady ? (
            <View
              style={[
                styles.cameraWrap,
                { borderRadius: radii.lg },
              ]}
            >
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
            <Card style={{ gap: spacing.sm }}>
              <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
                Enter a code by hand
              </ThemedText>
              <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
                For a box that will not scan, type its barcode and look it up.
              </ThemedText>
              <TextInput
                value={manualCode}
                onChangeText={setManualCode}
                placeholder="Barcode"
                placeholderTextColor={surface.placeholder}
                style={[
                  styles.input,
                  {
                    borderColor: surface.border,
                    borderRadius: radii.md,
                    color: surface.text,
                  },
                ]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button
                variant="secondary"
                label="Look up code"
                onPress={onManualLookup}
              />
            </Card>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SyncLine({ sync, paired }: { sync: SyncState; paired: boolean }) {
  const { surface } = useTheme();
  if (!paired) return null;
  if (sync.kind === 'loading') {
    return (
      <ThemedText style={[styles.syncLine, { color: surface.muted }]}>
        Syncing inventory...
      </ThemedText>
    );
  }
  if (sync.kind === 'ready') {
    return (
      <ThemedText style={[styles.syncLine, { color: surface.muted }]}>
        Synced {sync.count} item{sync.count === 1 ? '' : 's'}
        {sync.generatedAt ? ` (updated ${formatTime(sync.generatedAt)})` : ''}
      </ThemedText>
    );
  }
  if (sync.kind === 'empty') {
    return (
      <ThemedText style={[styles.syncLine, { color: surface.muted }]}>
        No inventory yet, open ResearchOS on your laptop to publish it.
      </ThemedText>
    );
  }
  return (
    <ThemedText style={[styles.syncLine, { color: palette.danger }]}>
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
  const { surface, spacing } = useTheme();

  if (outcome.kind === 'none') {
    return (
      <Card style={{ gap: spacing.sm }}>
        <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
          No code read yet.
        </ThemedText>
        <Button variant="secondary" label="Scan again" onPress={onScanAnother} />
      </Card>
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
      <Card style={{ gap: spacing.sm }}>
        <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
          {it.name ?? 'Inventory item'}
        </ThemedText>
        {it.vendor ? (
          <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
            Vendor {it.vendor}
          </ThemedText>
        ) : null}
        {it.catalog_number ? (
          <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
            Catalog {it.catalog_number}
          </ThemedText>
        ) : null}
        {it.container_label ? (
          <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
            {it.container_label}
          </ThemedText>
        ) : null}
        {lowStock ? (
          <View
            style={[
              styles.pill,
              { backgroundColor: palette.warningLight },
            ]}
          >
            <ThemedText style={[styles.pillText, { color: palette.warning }]}>
              Reorder at {it.low_at_count}
            </ThemedText>
          </View>
        ) : null}

        {sent ? (
          <SentBlock onScanAnother={onScanAnother} />
        ) : (
          <>
            <Button
              variant="primary"
              label="Add to reorder list"
              loading={sending}
              onPress={() => onSend(payload)}
              disabled={sending}
            />
            {send.kind === 'failed' ? (
              <ThemedText style={[styles.errorLine, { color: palette.danger }]}>
                {send.error}
              </ThemedText>
            ) : null}
            <Button
              variant="secondary"
              label="Scan another"
              onPress={onScanAnother}
            />
          </>
        )}
      </Card>
    );
  }

  // No match.
  const payload: ReorderPayload = { product_barcode: outcome.code };
  return (
    <Card style={{ gap: spacing.sm }}>
      <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
        No matching item
      </ThemedText>
      <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
        Scanned code {outcome.code}
      </ThemedText>
      {sent ? (
        <SentBlock onScanAnother={onScanAnother} />
      ) : (
        <>
          <Button
            variant="primary"
            label="Send reorder request anyway"
            loading={sending}
            onPress={() => onSend(payload)}
            disabled={sending}
          />
          {send.kind === 'failed' ? (
            <ThemedText style={[styles.errorLine, { color: palette.danger }]}>
              {send.error}
            </ThemedText>
          ) : null}
          <Button
            variant="secondary"
            label="Scan another"
            onPress={onScanAnother}
          />
        </>
      )}
    </Card>
  );
}

function SentBlock({ onScanAnother }: { onScanAnother: () => void }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.pill, { backgroundColor: palette.successLight }]}>
        <ThemedText style={[styles.pillText, { color: palette.success }]}>
          Sent to your lab
        </ThemedText>
      </View>
      <Button variant="secondary" label="Scan another" onPress={onScanAnother} />
    </View>
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
    lineHeight: 22,
  },
  syncLine: {
    fontSize: 14,
    lineHeight: 20,
  },
  cameraWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  cardHint: {
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  errorLine: {
    lineHeight: 20,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
