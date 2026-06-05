// sequence editor master. On-device HMMER WebWorker (classic worker).
//
// Runs hmmsearch ENTIRELY on the user's machine. The page posts the bytes of the
// user's Pfam .hmm and the translated CDS protein (as FASTA); this worker loads
// the Emscripten module, writes both into the in-memory (MEMFS) filesystem, runs
// hmmsearch with --max + --domtblout, reads the table back, and posts it home.
// Nothing is sent over the network beyond the one-time static fetch of the
// engine itself (hmmsearch.js + hmmsearch.wasm), which the browser caches.
//
// This is a CLASSIC worker (not an ES module) so it can importScripts the
// Emscripten UMD glue directly, which is the load path that works uniformly
// under Turbopack without any bundler worker resolution. The .wasm sits next to
// this file under /hmmer/, located via Module.locateFile.
//
// v1 runs with --max because the built engine's MSV/SSV SIMD prefilter is broken
// (a separate fix is in flight); the main alignment DP is correct with the
// prefilter off. Drop --max once the prefilter SIMD fix lands. The flag mirrors
// HMMER_FLAGS in the client wrapper; keep the two in sync.

/* global importScripts, createHmmer */

// Load the Emscripten glue. With importScripts the UMD's module/exports/define
// branches do not fire, so `createHmmer` lands as a worker-scope global.
importScripts("/hmmer/hmmsearch.js");

self.onmessage = async (event) => {
  const data = event && event.data ? event.data : {};
  const hmmBytes = data.hmmBytes;
  const proteinFasta = data.proteinFasta;
  const flags = Array.isArray(data.flags) ? data.flags : ["--max"];

  if (!hmmBytes || !proteinFasta) {
    self.postMessage({ error: "Missing HMM database or protein sequence." });
    return;
  }

  // HMMER chatters to stdout/stderr; capture it so it cannot break the worker
  // and is available for diagnostics. We do not surface it to the UI.
  let log = "";
  try {
    const Module = await createHmmer({
      noInitialRun: true,
      // The .wasm lives beside this worker under /hmmer/.
      locateFile: (path) =>
        path.endsWith(".wasm") ? "/hmmer/" + path : path,
      print: (s) => {
        log += s + "\n";
      },
      printErr: (s) => {
        log += s + "\n";
      },
    });

    // Write both inputs into MEMFS, then run the search. db.hmm is the HMM file
    // (the user's Pfam library); query.fa is OUR single translated protein, so
    // the --domtblout env coords land on our protein.
    Module.FS.writeFile("/db.hmm", hmmBytes);
    Module.FS.writeFile("/query.fa", proteinFasta);

    const argv = flags.concat([
      "--domtblout",
      "/out.tbl",
      "/db.hmm",
      "/query.fa",
    ]);
    const rc = Module.callMain(argv);

    let domtblout = "";
    try {
      domtblout = Module.FS.readFile("/out.tbl", { encoding: "utf8" });
    } catch (readErr) {
      // hmmsearch exited without writing the table (a malformed .hmm, etc.).
      self.postMessage({
        error:
          "HMMER did not produce results. The chosen file may not be a valid HMM database. (exit " +
          rc +
          ")",
      });
      return;
    }

    self.postMessage({ domtblout });
  } catch (e) {
    self.postMessage({
      error:
        (e && e.message) ||
        "The on-device domain search failed to run. " + log.slice(-400),
    });
  }
};
