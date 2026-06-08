/**
 * The mobile companion is light-mode only (see use-color-scheme.ts). Web build
 * mirrors that: always light, never follows the OS dark setting.
 */
export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}
