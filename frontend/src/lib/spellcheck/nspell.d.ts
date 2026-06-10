// Minimal ambient types for nspell (ships no .d.ts of its own).
declare module "nspell" {
  export interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    spell(word: string): { correct: boolean; forbidden: boolean; warn: boolean };
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
    wordCharacters(): string[] | undefined;
    dictionary(dic: string | Uint8Array): NSpell;
    personal(dic: string | Uint8Array): NSpell;
  }
  interface NSpellFactory {
    (aff: string | Uint8Array, dic?: string | Uint8Array): NSpell;
    (dictionary: { aff: string | Uint8Array; dic?: string | Uint8Array }): NSpell;
  }
  const nspell: NSpellFactory;
  export default nspell;
}
