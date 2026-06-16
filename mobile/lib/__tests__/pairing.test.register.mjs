// Registers the resolve/load hooks (pairing.test.hooks.mjs) for the pairing
// store test, then imports the test so the hooks are active for its module graph.
// Passed to node via --import so the hooks apply to every subsequent import.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./pairing.test.hooks.mjs', pathToFileURL('./lib/__tests__/').href);
