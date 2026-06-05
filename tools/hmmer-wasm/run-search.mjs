// Node harness that exercises the WASM hmmsearch module the way a browser
// WebWorker would: load the module, write the .hmm + query into the virtual
// (MEMFS) filesystem, capture stdout, and run main(argv).
//
// Usage: node run-search.mjs <hmmfile> <fastafile>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const createHmmer = require('./hmmsearch.js');

const [, , hmmPath, faPath] = process.argv;
const hmmBytes = readFileSync(hmmPath);
const faBytes = readFileSync(faPath);

let out = '';
const t0 = performance.now();

const Module = await createHmmer({
  noInitialRun: true,
  print: (s) => { out += s + '\n'; },
  printErr: (s) => { out += s + '\n'; },
});

// Mount the two inputs into the in-memory FS (the browser pattern).
Module.FS.writeFile('/query.hmm', hmmBytes);
Module.FS.writeFile('/seq.fasta', faBytes);

const rc = Module.callMain(['/query.hmm', '/seq.fasta']);
const ms = (performance.now() - t0).toFixed(1);

process.stdout.write(out);
process.stderr.write(`\n[harness] exit=${rc} wall=${ms}ms (module load + search)\n`);
