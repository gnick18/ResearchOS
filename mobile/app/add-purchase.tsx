// Manual add-purchase screen. Log a purchase without scanning a barcode.
// Fields: product name (required), vendor, catalog number, quantity (stepper,
// default 1). On save calls createPurchase() from lib/scan.ts and shows a
// sent/queued confirmation, then goes back. Disabled when not paired; the
// pairing card prompts to pair first.
//
// Polished to UI contract 04 (add-purchase frame): contract .field labels,
// .input.focus sky ring (focusRing, matching scan.tsx + note.tsx), a side by
// side .calc-row for catalog + quantity, a bordered segmented .stepper with sky
// symbols, a sky .callout routing note, and a contract .success-check done
// state. The screen identity is purchase-violet (matches the scan flow's
// "Add a purchase item" sheet-opt + Capture scan tile). House style: no
// em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTheme, palette, fonts } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { createPurchase } from '@/lib/scan';

// Contract .input.focus: sky border + soft sky glow. Spread onto a focused
// input. Reads a touch hotter on dark, matching scan.tsx / note.tsx.
function focusRing(dark: boolean) {
  return {
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: dark ? 0.5 : 0.28,
    shadowRadius: 6,
    elevation: 0,
  } as const;
}

export default function AddPurchaseScreen() {
  const router = useRouter();
  const { surface, spacing, radii, dark } = useTheme();
  const { pairing, refresh: refreshPairing } = usePairing();

  const [productName, setProductName] = useState('');
  const [vendor, setVendor] = useState('');
  const [catalog, setCatalog] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  // Which field owns the sky focus ring.
  const [focusField, setFocusField] = useState<
    'name' | 'vendor' | 'catalog' | null
  >(null);

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

  // Done state (contract .success-check): a soft violet badge, the queued
  // headline, a muted note, and a primary Done.
  if (sent) {
    return (
      <ScreenFrame>
        <ScreenHeader />
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.doneContent}
        >
          <View style={styles.successCheck}>
            <Ionicons name="checkmark" size={42} color={palette.violet} />
          </View>
          <ThemedText type="title" style={styles.center}>
            Purchase queued
          </ThemedText>
          <ThemedText
            style={[styles.tagline, styles.center, { color: surface.muted }]}
          >
            Saved to your purchase orders. Your PI can send it to the department
            from the laptop.
          </ThemedText>
          <View style={styles.stretch}>
            <Button variant="primary" label="Done" onPress={onDone} />
          </View>
        </ScrollView>
      </ScreenFrame>
    );
  }

  // Shared input style builder so every field carries the same focus ring.
  const inputStyle = (field: 'name' | 'vendor' | 'catalog') => {
    const on = focusField === field;
    return [
      styles.input,
      {
        backgroundColor: on ? surface.surface : surface.surface2,
        borderColor: on ? palette.sky : surface.borderStrong,
        borderRadius: radii.md,
        color: surface.text,
      },
      on ? focusRing(dark) : null,
    ];
  };

  return (
    <ScreenFrame>
      <ScreenHeader />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Purchase-violet identity chip + title (matches the scan flow). */}
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}>
            <Ionicons name="add" size={22} color={palette.violet} />
          </View>
          <ThemedText type="title">Add a purchase</ThemedText>
        </View>

        {!pairing ? (
          <Card style={{ gap: spacing.sm }}>
            <ThemedText style={[styles.fieldLabelLg, { color: surface.text }]}>
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

        {/* Item (required) */}
        <View style={styles.field}>
          <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>
            Item
          </ThemedText>
          <TextInput
            value={productName}
            onChangeText={setProductName}
            onFocus={() => setFocusField('name')}
            onBlur={() => setFocusField((f) => (f === 'name' ? null : f))}
            placeholder="e.g. Q5 High-Fidelity Polymerase"
            placeholderTextColor={surface.placeholder}
            style={inputStyle('name')}
            editable={!saving}
            returnKeyType="next"
          />
        </View>

        {/* Vendor */}
        <View style={styles.field}>
          <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>
            Vendor
          </ThemedText>
          <TextInput
            value={vendor}
            onChangeText={setVendor}
            onFocus={() => setFocusField('vendor')}
            onBlur={() => setFocusField((f) => (f === 'vendor' ? null : f))}
            placeholder="e.g. NEB"
            placeholderTextColor={surface.placeholder}
            style={inputStyle('vendor')}
            editable={!saving}
            returnKeyType="next"
          />
        </View>

        {/* Catalog # + Quantity, side by side (contract .calc-row) */}
        <View style={styles.calcRow}>
          <View style={styles.fieldFlex}>
            <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>
              Catalog #
            </ThemedText>
            <TextInput
              value={catalog}
              onChangeText={setCatalog}
              onFocus={() => setFocusField('catalog')}
              onBlur={() => setFocusField((f) => (f === 'catalog' ? null : f))}
              placeholder="M0491S"
              placeholderTextColor={surface.placeholder}
              style={[...inputStyle('catalog'), styles.mono]}
              editable={!saving}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
            />
          </View>
          <View style={styles.fieldFlex}>
            <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>
              Quantity
            </ThemedText>
            {/* Bordered segmented stepper (contract .stepper): sky symbols, a
                mono value, hairline-divided cells. */}
            <View
              style={[
                styles.stepperBox,
                { borderColor: surface.borderStrong, borderRadius: radii.md },
              ]}
            >
              <Pressable
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={saving || quantity <= 1}
                style={({ pressed }) => [
                  styles.stepBtn,
                  {
                    backgroundColor: surface.surface2,
                    borderRightWidth: 1,
                    borderRightColor: surface.border,
                    opacity: quantity <= 1 || saving ? 0.4 : pressed ? 0.7 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
              >
                <Ionicons name="remove" size={18} color={palette.sky} />
              </Pressable>
              <ThemedText style={[styles.stepVal, { color: surface.text }]}>
                {quantity}
              </ThemedText>
              <Pressable
                onPress={() => setQuantity((q) => q + 1)}
                disabled={saving}
                style={({ pressed }) => [
                  styles.stepBtn,
                  {
                    backgroundColor: surface.surface2,
                    borderLeftWidth: 1,
                    borderLeftColor: surface.border,
                    opacity: saving ? 0.4 : pressed ? 0.7 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
              >
                <Ionicons name="add" size={18} color={palette.sky} />
              </Pressable>
            </View>
          </View>
        </View>

        {/* Routing note (contract .callout, sky). */}
        <View
          style={[
            styles.callout,
            {
              backgroundColor: palette.skyDim,
              borderColor: palette.skyBorder,
              borderRadius: radii.md,
            },
          ]}
        >
          <ThemedText style={[styles.calloutText, { color: surface.text }]}>
            Saves to your purchase orders. Your PI can send it to the department
            from the laptop.
          </ThemedText>
        </View>

        {/* Save */}
        <Button
          variant="primary"
          label="Add purchase"
          onPress={onSave}
          loading={saving}
          disabled={!canSave}
        />
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },
  doneContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 40,
    alignItems: 'center',
    gap: 16,
  },
  center: { textAlign: 'center' },
  stretch: { alignSelf: 'stretch', marginTop: 4 },
  tagline: { fontSize: 14, fontFamily: fonts.ui, lineHeight: 21, maxWidth: 280 },
  mono: { fontFamily: fonts.mono },

  // Title row with a purchase-violet identity tile.
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.violetDim,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Fields (contract .field): small muted label, surface-2 input, sky focus.
  field: { gap: 7 },
  fieldFlex: { flex: 1, gap: 7 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    fontWeight: '600',
    lineHeight: 16,
  },
  fieldLabelLg: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    fontWeight: '600',
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: fonts.ui,
    minHeight: 48,
  },
  calcRow: { flexDirection: 'row', gap: 12 },

  // Stepper (contract .stepper): bordered, segmented, sky symbols, mono value.
  stepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden',
    height: 48,
  },
  stepBtn: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepVal: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontFamily: fonts.monoSemibold,
    fontWeight: '600',
  },

  // Routing note (contract .callout).
  callout: {
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  calloutText: { fontSize: 13, fontFamily: fonts.ui, lineHeight: 19 },

  // Done state (contract .success-check), violet-tinted for purchase identity.
  successCheck: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: palette.violetDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
});
