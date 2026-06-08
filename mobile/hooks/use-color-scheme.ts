/**
 * The mobile companion is light-mode only. We deliberately do not follow the OS
 * dark setting, so every surface renders the one ironclad light theme. (Dark
 * variants still exist in the theme tokens but are never selected.)
 */
export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}
