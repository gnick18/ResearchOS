// Manual add-purchase screen. Log a purchase without scanning a barcode.
// Fields: product name (required), vendor, catalog number, quantity (stepper,
// default 1). On save calls createPurchase() from lib/scan.ts and shows a
// sent/queued confirmation, then goes back. Disabled when not paired; the
// pairing card prompts to pair first. House style: no em-dashes, no emojis,
// no mid-sentence colons.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTheme, palette } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { createPurchase } from '@/lib/scan';

export default function AddPurchaseScreen() {
  const router = useRouter();
  const { surface, spacing, radii } = useTheme();
  const { pairing, refresh: refreshPairing } = usePairing();

  const [productName, setProductName] = useState('');
  const [vendor, setVendor] = useState('');
  const [catalog, setCatalog] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshPairing();
    }, [refreshPairing]),
  );

  const canSave = productName.trim().length > 0 && !saving && !!pairing;

  const onSave = useCallback(async () => {
    if (!canSave || !pairing) return;
    setSaving(true);
    try {
      const result = await createPurchase(
        {
          name: productName.trim(),
          vendor: vendor.trim() || undefined,
          catalog: catalog.trim() || undefined,
          quantity: quantity > 0 ? quantity : 1,
        },
        `Add purchase: ${productName.trim()}`,
        pairing,
        signWithDevice,
      );
      if (result.ok) {
        setSent(true);
      } else {
        Alert.alert(
          'Could not save',
          result.error ?? 'Unknown error. Try again.',
        );
      }
    } finally {
      setSaving(false);
    }
  }, [canSave, pairing, productName, vendor, catalog, quantity]);

  const onDone = useCallback(() => {
    router.back();
  }, [router]);

  if (sent) {
    return (
      <ScreenFrame edges={['bottom']}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.scrollContent}
        >
          <ThemedText type="title">Purchase queued</ThemedText>
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            The purchase item has been sent to your lab. It will appear in
            ResearchOS on your laptop shortly.
          </ThemedText>
          <Button variant="primary" label="Done" onPress={onDone} />
        </ScrollView>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame edges={['bottom']}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {!pairing ? (
          <Card style={{ gap: spacing.sm }}>
            <ThemedText style={[styles.fieldLabel, { color: surface.text }]}>
              Not paired
            </ThemedText>
            <ThemedText style={[styles.tagline, { color: surface.muted }]}>
              Pair this phone with your laptop to log purchases.
            </ThemedText>
            <Button
              variant="primary"
              label="Pair this phone"
              onPress={() => router.push('/pair')}
              style={{ marginTop: spacing.xs }}
            />
          </Card>
        ) : null}

        {/* Product name (required) */}
        <View style={styles.fieldGroup}>
          <ThemedText style={[styles.fieldLabel, { color: surface.text }]}>
            Product name
          </ThemedText>
          <TextInput
            value={productName}
            onChangeText={setProductName}
            placeholder="e.g. Q5 High-Fidelity Polymerase"
            placeholderTextColor={surface.placeholder}
            style={[
              styles.input,
              {
                borderColor: surface.border,
                borderRadius: radii.md,
                color: surface.text,
                backgroundColor: surface.sunken,
              },
            ]}
            editable={!saving}
            returnKeyType="next"
          />
        </View>

        {/* Vendor */}
        <View style={styles.fieldGroup}>
          <ThemedText style={[styles.fieldLabel, { color: surface.text }]}>
            Vendor
          </ThemedText>
          <TextInput
            value={vendor}
            onChangeText={setVendor}
            placeholder="e.g. NEB"
            placeholderTextColor={surface.placeholder}
            style={[
              styles.input,
              {
                borderColor: surface.border,
                borderRadius: radii.md,
                color: surface.text,
                backgroundColor: surface.sunken,
              },
            ]}
            editable={!saving}
            returnKeyType="next"
          />
        </View>

        {/* Catalog number */}
        <View style={styles.fieldGroup}>
          <ThemedText style={[styles.fieldLabel, { color: surface.text }]}>
            Catalog number
          </ThemedText>
          <TextInput
            value={catalog}
            onChangeText={setCatalog}
            placeholder="e.g. M0491S"
            placeholderTextColor={surface.placeholder}
            style={[
              styles.input,
              {
                borderColor: surface.border,
                borderRadius: radii.md,
                color: surface.text,
                backgroundColor: surface.sunken,
              },
            ]}
            editable={!saving}
            returnKeyType="next"
          />
        </View>

        {/* Quantity stepper */}
        <View style={styles.fieldGroup}>
          <ThemedText style={[styles.fieldLabel, { color: surface.text }]}>
            Quantity
          </ThemedText>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={saving || quantity <= 1}
              style={({ pressed }) => [
                styles.stepBtn,
                {
                  borderColor: surface.border,
                  borderRadius: radii.md,
                  opacity: quantity <= 1 || saving ? 0.4 : pressed ? 0.7 : 1,
                  backgroundColor: surface.sunken,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Decrease quantity"
            >
              <ThemedText style={[styles.stepSymbol, { color: surface.text }]}>
                -
              </ThemedText>
            </Pressable>
            <ThemedText style={[styles.stepValue, { color: surface.text }]}>
              {quantity}
            </ThemedText>
            <Pressable
              onPress={() => setQuantity((q) => q + 1)}
              disabled={saving}
              style={({ pressed }) => [
                styles.stepBtn,
                {
                  borderColor: surface.border,
                  borderRadius: radii.md,
                  opacity: saving ? 0.4 : pressed ? 0.7 : 1,
                  backgroundColor: surface.sunken,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Increase quantity"
            >
              <ThemedText style={[styles.stepSymbol, { color: surface.text }]}>
                +
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {/* Save button */}
        <View style={styles.saveRow}>
          {saving ? (
            <ActivityIndicator color={palette.sky} />
          ) : (
            <Button
              variant="primary"
              label="Save purchase"
              onPress={onSave}
              disabled={!canSave}
            />
          )}
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 20,
  },
  tagline: { lineHeight: 22 },
  fieldGroup: { gap: 8 },
  fieldLabel: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepSymbol: { fontSize: 22, fontWeight: '400', lineHeight: 26 },
  stepValue: { fontSize: 18, fontWeight: '700', minWidth: 32, textAlign: 'center' },
  saveRow: { marginTop: 4 },
});
