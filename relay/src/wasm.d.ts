// Wrangler/esbuild bundles a `.wasm` import as a WebAssembly.Module. This
// ambient declaration lets TypeScript type the loro-crdt wasm import in
// worker.ts (the runtime value is provided by the bundler, not at type time).
declare module "*.wasm" {
  const moduleContent: WebAssembly.Module;
  export default moduleContent;
}
