import { StyleSheet, Text, type TextProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';
import { fonts } from '@/lib/design';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return (
    <Text
      style={[
        { color },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'link' ? styles.link : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: fonts.ui,
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },
  title: {
    // App-wide large title. Contract sizing (27 / Geist extrabold / tight
    // tracking); lineHeight sits a touch above the size so descenders never clip.
    fontSize: 27,
    fontFamily: fonts.extrabold,
    fontWeight: '800',
    lineHeight: 32,
    letterSpacing: -0.7,
  },
  subtitle: {
    fontSize: 20,
    fontFamily: fonts.bold,
    fontWeight: 'bold',
  },
  link: {
    lineHeight: 30,
    fontSize: 16,
    fontFamily: fonts.ui,
    color: '#0a7ea4',
  },
});
