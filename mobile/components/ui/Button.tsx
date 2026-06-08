/**
 * Button primitive. Two variants: Primary (solid sky) and Secondary (outline).
 * Supports disabled state and an optional leading icon (any React node).
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
import { useTheme, palette, radii as globalRadii, spacing as globalSpacing } from '@/lib/design';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant;
  label: string;
  /** Optional leading icon node (e.g. an IconSymbol). */
  icon?: React.ReactNode;
  /** Show a spinner instead of the label. Useful during async operations. */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  variant = 'primary',
  label,
  icon,
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const { surface } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && {
          backgroundColor: palette.sky,
          borderWidth: 0,
        },
        variant === 'secondary' && {
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderColor: palette.sky,
        },
        variant === 'ghost' && {
          backgroundColor: 'transparent',
          borderWidth: 0,
        },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      accessibilityRole="button"
      disabled={isDisabled}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? palette.white : palette.sky}
          size="small"
        />
      ) : (
        <View style={styles.inner}>
          {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
          <Text
            style={[
              styles.label,
              variant === 'primary' && styles.labelPrimary,
              variant === 'secondary' && styles.labelSecondary,
              variant === 'ghost' && { color: surface.muted },
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: globalRadii.md,
    paddingVertical: 13,
    paddingHorizontal: globalSpacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    // keeps the icon vertically centered with the label
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  labelPrimary: {
    color: palette.white,
  },
  labelSecondary: {
    color: palette.sky,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.38,
  },
});
