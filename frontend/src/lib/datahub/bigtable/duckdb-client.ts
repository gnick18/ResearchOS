"use client";

// datahub/bigtable/duckdb-client.ts
//
// The reusable, lazy, client-only DuckDB-WASM engine for the Data Hub large-
// dataset lane (DataHub-largetables lane, Increment 1). It is a singleton that
// loads the SELF-HOSTED DuckDB ESM bundle in a Web Worker the first time a
// dataset is opened (the same lazy-kernel pattern as RDKit / Pyodide), and
// exposes a thin query + Parquet round-trip surface.
//
// PROVENANCE. The loading pattern here is ported VERBATIM from the proven,
// build-green spike (branch spike/duckdb-wasm @ 024c50afd, throwaway probe page
// frontend/src/app/dev/duckdb-spike/page.tsx). The probe page itself is not kept.
//
// THE HARD RULE (the whole reason the build is green). DuckDB must NEVER enter
// Turbopack's module graph. We import the engine ONLY from a runtime URL string
// the bundler cannot statically resolve, wrapped in a /* webpackIgnore: true */
// hint; types come via an erased `import type * as DuckDb`. A normal static or
// dynamic bundler import of "@duckdb/duckdb-wasm" reintroduces a Turbopack panic
// (chunk_group.rs "entered unreachable code"). Do not "simplify" the URL import.
//
// SCOPE (validation gate, spec section 4). DuckDB only MOVES data here (filter,
// slice, page, extract columns, build / copy Parquet). It never computes a
// statistic that ships to the user; every published number stays on the existing
// validated JS engine. This client is the data mover, nothing else.
//
// TODO(Increment 2): the virtualized preview reads pages via query() with
// LIMIT/OFFSET; the transform builder compiles a TransformOp recipe to one SQL
// string executed here; copyQueryToParquet materializes a saved derived dataset.
//
// No em-dashes, no emojis, no mid-sentence colons.

// TYPE-ONLY import: fully erased at compile time, so it never enters the
// bundler's module graph (no Turbopack chunk). It exists purely to type the
// runtime-URL-loaded module below.
import type * as DuckDb from "@duckdb/duckdb-wasm";

type DuckDbModule = typeof DuckDb;

interface EngineHandles {
  duckdb: DuckDbModule;
  db: DuckDb.AsyncDuckDB;
  conn: DuckDb.AsyncDuckDBConnection;
  worker: Worker;
}

let enginePromise: Promise<EngineHandles> | null = null;

// Honest-progress plumbing. The engine load is the ~34-39 MB cold cost; a
// caller (the page-boot loader on the convert path) registers a listener and we
// emit coarse milestones as createEngine advances. A Set so whoever started the
// load and whoever is watching can differ (warm-on-arm starts it with no
// listener, the convert click then attaches one and still sees the rest).
const progressListeners = new Set<(frac: number) => void>();
function emitProgress(frac: number): void {
  for (const listener of progressListeners) {
    try {
      listener(frac);
    } catch {
      // a listener throwing must not derail the engine load
    }
  }
}

// Hard ceiling on the cold load so a silently-failed worker (a wasm that never
// instantiates) surfaces as an error the loader can retry, instead of a spinner
// that hangs forever. Generous: the wasm is ~34-39 MB and a slow disk/connection
// is normal on a first load.
const ENGINE_LOAD_TIMEOUT_MS = 90_000;

/** Guard: this module is client-only and must never run on the server. */
function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error(
      "[bigtable/duckdb-client] DuckDB engine is client-only and cannot run on the server",
    );
  }
}

/**
 * Load the self-hosted DuckDB ESM bundle, instantiate the worker + wasm, open a
 * connection, and load the self-hosted Parquet extension. Ported verbatim from
 * the spike probe. Lazy and memoized: the worker and the ~38 MB wasm never load
 * until the first call, so the editable lane pays nothing.
 */
async function createEngine(): Promise<EngineHandles> {
  assertBrowser();
  emitProgress(0.03);

  // RUNTIME import of a SELF-HOSTED ESM bundle, NOT the npm package. Importing
  // "@duckdb/duckdb-wasm" directly (even dynamically) pulls it into Turbopack's
  // graph and the chunker panics. We ship a pre-bundled, self-contained ESM
  // (public/duckdb/duckdb-browser.bundled.mjs, arrow inlined, no bare specifiers)
  // and import it from a runtime URL string the bundler cannot statically
  // resolve, wrapped in a /* webpackIgnore */ + /* @vite-ignore */ hint so no
  // bundler tries to follow it.
  const origin = window.location.origin;
  const duckdbModuleUrl = `${origin}/duckdb/duckdb-browser.bundled.mjs`;
  const duckdb: DuckDbModule = await import(
    /* webpackIgnore: true */ /* @vite-ignore */ duckdbModuleUrl
  );
  emitProgress(0.18);

  // MANUAL bundles, self-hosted from /public/duckdb. No getJsDelivrBundles (a
  // CDN, blocked by our CSP + violates local-first).
  const MANUAL_BUNDLES: DuckDb.DuckDBBundles = {
    mvp: {
      mainModule: `${origin}/duckdb/duckdb-mvp.wasm`,
      mainWorker: `${origin}/duckdb/duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${origin}/duckdb/duckdb-eh.wasm`,
      mainWorker: `${origin}/duckdb/duckdb-browser-eh.worker.js`,
    },
  };

  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  emitProgress(0.3);
  // The heavy step: the ~34-39 MB wasm streams + instantiates inside the worker.
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  emitProgress(0.75);

  await db.open({
    query: {
      // BigInt columns come back as doubles, which the JS stats engine consumes
      // directly (the editable lane is all doubles too).
      castBigIntToDouble: true,
    },
  });
  const conn = await db.connect();
  emitProgress(0.85);

  // duckdb-wasm 1.29.0 (DuckDB 1.1.1) ships Parquet as a LOADABLE extension,
  // fetched by default from https://extensions.duckdb.org (a CDN, blocked by our
  // CSP). Point the extension repository at our OWN self-hosted copy under
  // /duckdb; duckdb appends /v<ver>/wasm_eh/<ext>.
  await conn.query(`SET autoinstall_known_extensions=true;`);
  await conn.query(`SET autoload_known_extensions=true;`);
  await conn.query(`SET custom_extension_repository='${origin}/duckdb';`);
  await conn.query(`INSTALL parquet;`);
  await conn.query(`LOAD parquet;`);
  emitProgress(1);

  return { duckdb, db, conn, worker };
}

/**
 * Get the live engine, initializing on demand. Idempotent + memoized: the first
 * call loads the worker + wasm + Parquet extension, later calls reuse the same
 * handles. Two robustness rules learned the hard way:
 *   1. A cold load is wrapped in a timeout, so a silently-failed worker rejects
 *      (the caller can show a retry) instead of leaving a promise pending forever.
 *   2. On ANY failure we null out enginePromise, so the NEXT call retries from
 *      scratch. Memoizing a rejected/hung promise is what wedged the lane until a
 *      full page reload.
 */
function ensureEngine(): Promise<EngineHandles> {
  if (!enginePromise) {
    enginePromise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "The large-dataset engine took too long to load. Check your connection and try again.",
              ),
            ),
          ENGINE_LOAD_TIMEOUT_MS,
        );
      });
      try {
        return await Promise.race([createEngine(), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })().catch((err) => {
      // Let the next call retry from scratch rather than re-awaiting a dead promise.
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * Lazily initialize the engine (idempotent, memoized). Resolves once the engine
 * is ready to accept queries. Pass `onProgress` to receive coarse load milestones
 * (0..1) for an honest loading bar; the listener is detached when init settles.
 */
export async function init(onProgress?: (frac: number) => void): Promise<void> {
  if (onProgress) progressListeners.add(onProgress);
  try {
    await ensureEngine();
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

/** Internal: get the live engine, initializing on demand. */
async function engine(): Promise<EngineHandles> {
  return ensureEngine();
}

/**
 * Run a SQL query and return the Arrow result table. The preview grid and the
 * column extractor for analyses both read from the returned Arrow batches
 * (spec section 4). DuckDB only moves data here; published numbers route through
 * the validated JS engine.
 */
export async function query(
  sql: string,
): Promise<DuckDb.AsyncDuckDBConnection extends never ? never : import("apache-arrow").Table> {
  const { conn } = await engine();
  // The connection returns an apache-arrow Table.
  return conn.query(sql) as unknown as import("apache-arrow").Table;
}

/**
 * Register a Parquet (or other) byte buffer as a virtual file the engine can
 * scan, e.g. `read_parquet('<name>')`. This is exactly the shape an FSA File
 * handle hands us (file.arrayBuffer()): register the bytes, then query them. No
 * disk path inside DuckDB, no CDN.
 */
export async function registerParquetBuffer(
  name: string,
  buffer: ArrayBuffer,
): Promise<void> {
  const { db } = await engine();
  await db.registerFileBuffer(name, new Uint8Array(buffer));
}

/**
 * Drop a previously registered virtual file buffer (best effort). Used to free
 * a working buffer after a Parquet has been built and copied out.
 */
export async function dropFileBuffer(name: string): Promise<void> {
  const { db } = await engine();
  try {
    await db.dropFile(name);
  } catch {
    // best effort; a missing buffer is fine
  }
}

/**
 * Run a query and materialize its result to a Parquet byte buffer, returned as
 * an ArrayBuffer the caller writes to disk (data.parquet, or a saved derived
 * dataset, spec section 9 "COPY (query) TO"). Implemented by COPYing to a
 * virtual file then reading the buffer back out, so nothing caches on disk
 * inside the worker beyond the transient buffer.
 */
export async function copyQueryToParquet(sql: string): Promise<ArrayBuffer> {
  const { db, conn } = await engine();
  const outName = `__bigtable_out_${Date.now()}_${Math.random().toString(36).slice(2)}.parquet`;
  try {
    // COPY (<query>) TO '<virtual file>' (FORMAT PARQUET) writes the result as
    // Parquet bytes into the registered virtual filesystem.
    await conn.query(
      `COPY (${sql}) TO '${outName}' (FORMAT PARQUET);`,
    );
    const bytes = await db.copyFileToBuffer(outName);
    // Return a copy detached from the worker's memory.
    return bytes.slice().buffer;
  } finally {
    try {
      await db.dropFile(outName);
    } catch {
      // best effort
    }
  }
}

/**
 * Run a query and materialize its result to a CSV byte buffer, returned as an
 * ArrayBuffer the caller wraps in a Blob for download (Phase 4 export). The mirror
 * of copyQueryToParquet, COPYing to a transient `.csv` virtual file with
 * (FORMAT CSV) and reading the bytes back, so nothing caches on disk inside the
 * worker beyond the transient buffer (dropped in finally).
 */
export async function copyQueryToCsv(sql: string): Promise<ArrayBuffer> {
  const { db, conn } = await engine();
  const outName = `__bigtable_out_${Date.now()}_${Math.random().toString(36).slice(2)}.csv`;
  try {
    // COPY (<query>) TO '<virtual file>' (FORMAT CSV) writes the result as CSV
    // bytes into the registered virtual filesystem.
    await conn.query(
      `COPY (${sql}) TO '${outName}' (FORMAT CSV);`,
    );
    const bytes = await db.copyFileToBuffer(outName);
    // Return a copy detached from the worker's memory.
    return bytes.slice().buffer;
  } finally {
    try {
      await db.dropFile(outName);
    } catch {
      // best effort
    }
  }
}

/**
 * Build a Parquet byte buffer from in-memory rows. The rows are turned into an
 * Arrow table, streamed into a temporary DuckDB table via insertArrowFromIPCStream
 * (the proven interchange path), then COPYied out to Parquet. Used by the ingest
 * path to write data.parquet for a freshly imported / pasted large table.
 *
 * Apache Arrow is imported normally here: only "@duckdb/duckdb-wasm" panics
 * Turbopack, arrow is a plain dep (it is also the result-interchange format).
 */
export async function buildParquetFromRows(
  rows: Record<string, string | number | null>[],
): Promise<ArrayBuffer> {
  const { conn, db } = await engine();
  const arrow = await import("apache-arrow");
  const table = arrow.tableFromJSON(
    rows.length > 0 ? rows : [{}],
  );
  const ipc = arrow.tableToIPC(table, "stream");
  const tmpName = `__bigtable_in_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    await conn.insertArrowFromIPCStream(ipc, { name: tmpName, create: true });
    return await copyQueryToParquet(`SELECT * FROM "${tmpName}"`);
  } finally {
    try {
      await conn.query(`DROP TABLE IF EXISTS "${tmpName}";`);
    } catch {
      // best effort
    }
    void db;
  }
}

/**
 * Tear the engine down (close the connection, terminate the worker). Mainly for
 * tests and for a future "close all datasets" path; the singleton re-creates on
 * the next init().
 */
export async function terminate(): Promise<void> {
  if (!enginePromise) return;
  const { conn, db, worker } = await enginePromise;
  try {
    await conn.close();
    await db.terminate();
    worker.terminate();
  } finally {
    enginePromise = null;
  }
}
