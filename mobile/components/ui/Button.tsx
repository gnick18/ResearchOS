/**
 * Button primitive (UI contract).
 *
 * Variants: primary (solid accent, white label), secondary (surface card +
 * border, neutral label), ghost (transparent, accent label), soft (accent-dim
 * fill, accent label). Accent tints the relevant surface/label. Geist label,
 * 50pt min height, contract radius. Supports loading + leading icon.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme, palette, fonts, radii as globalRadii, spacing as globalSpacing } from '@/lib/design';
import { useMascotKeepOut } from '@/lib/mascot-avoid';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft';
export type ButtonAccent = 'sky' | 'coral' | 'amber' | 'danger' | 'success';

const ACCENT: Record<ButtonAccent, { solid: string; dim: string; on: string }> = {
  sky: { solid: palette.sky, dim: palette.skyDim, on: palette.sky },
  coral: { solid: palette.coral, dim: palette.coralDim, on: palette.coral },
  amber: { solid: palette.amber, dim: palette.amberDim, on: palette.amber },
  danger: { solid: palette.danger, dim: palette.dangerDim, on: palette.danger },
  success: { solid: palette.success, dim: palette.successDim, on: palette.success },
};

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant;
  /** Tints the fill (primary/soft) or the label (secondary/ghost). Default sky. */
  accent?: ButtonAccent;
  label: string;
  /** Optional leading icon node. */
  icon?: React.ReactNode;
  /** Show a spinner instead of the label. */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  variant = 'primary',
  accent = 'sky',
  label,
  icon,
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const { surface, shadow } = useTheme();
  const a = ACCENT[accent];
  const isDisabled = disabled || loading;
  // Register as a keep-out zone so the floating BeakerBot never parks on a button.
  const keepOut = useMascotKeepOut();

  const labelColor =
    variant === 'primary' ? palette.white : variant === 'secondary' ? surface.text : a.on;

  return (
    <Pressable
      ref={keepOut.ref}
      onLayout={keepOut.onLayout}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && { backgroundColor: a.solid },
        variant === 'soft' && { backgroundColor: a.dim },
        variant === 'secondary' && {
          backgroundColor: surface.surface,
          borderWidth: 1,
          borderColor: surface.borderStrong,
          ...shadow.sm,
        },
        variant === 'ghost' && { backgroundColor: 'transparent' },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      accessibilityRole="button"
      disabled={isDisabled}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? palette.white : a.on} size="small" />
      ) : (
        <View style={styles.inner}>
          {icon ? <View>{icon}</View> : null}
          <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: globalRadii.md,
    paddingVertical: 14,
    paddingHorizontal: globalSpacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 15, fontFamily: fonts.semibold, lineHeight: 20 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
});
