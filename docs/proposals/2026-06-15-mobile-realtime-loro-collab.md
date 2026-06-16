# Mobile real-time collaborative editing (Loro CRDT on the phone)

Status: feasibility (research complete), 2026-06-15. Owner: MobileUI lane. Question from Grant: could we put the Loro CRDT on the phone so it has real-time typing with laptops? Verdict: **hard but doable, no showstopper** — and clearer than expected because Loro already ships the pieces.

## Where we are today
- Laptop notes/results editor = **`loro-crdt` ^1.12.3 + `loro-codemirror`** (real CRDT collaborative editor in InlineMarkdownEditor / LiveMarkdownEditor / TaskDetailPopup).
- Phone link = **poll-based Cloudflare Worker relay** (`relay/worker.ts`): laptop publishes sealed snapshots, phone fetches; phone posts sealed commands, laptop polls. **No live connection.** The phone has **no Loro at all** today.

## The two hard parts and how they resolve

### 1. Running Loro on React Native
- **Don't bet on WASM-on-Hermes.** Hermes did gain WASM in 2025 (Expo SDK 55 / Callstack Polygen), but it's young and `loro-crdt`'s wasm-bindgen glue isn't a drop-in. Wrong tool for a CRDT hot path.
- **Use the official native binding.** Loro ships first-party FFI via UniFFI (`loro-ffi`) including **`loro-react-native`** — a Turbo Module with native Kotlin/ObjC++ + a TS `LoroDoc` API, MIT, on npm. Same machinery Automerge uses for `react-native-automerge`. Maturity caveat: small (~20 stars, ~8 releases) — pin a version, read its source. Requires RN New Architecture (Turbo Modules) + a prebuild dev build — **both of which we already do** (no Expo Go, but our mobile app already uses custom dev builds).
- **The editor forces a WebView regardless.** `loro-codemirror` is CodeMirror = a DOM editor; there is no native-RN CodeMirror. So the editing surface lives in a WebView no matter what. The clean consequence: host `loro-crdt` + `loro-codemirror` *together inside that WebView* — keystroke -> CRDT -> CodeMirror is all in-WebView (fast); only periodic update blobs cross the RN bridge to the network.

### 2. A live sync transport
- **Loro is transport-agnostic** (export update/snapshot byte-blobs, import on the other side; exchange version vectors for deltas). It also ships the **Loro Protocol** (sync + presence/cursors + an experimental E2E-encrypted mode), Yjs-compatible.
- **Cloudflare Durable Object + WebSocket per document** is the templated pattern (prior art: `y-durableobjects`, `yjs-cf-ws-provider` with the WebSocket Hibernation API + R2 snapshot). We already run a CF Worker relay, so this is **incremental** — promote the relay to a per-document DO that fans out blobs.
- **E2E stays intact.** Loro's E2E mode relays opaque ciphertext the server never decrypts — exactly our posture. A DO that fans out encrypted blobs needs no plaintext. Reuse our existing WebCrypto vault (from the identity work) for keys. Caveat: with E2E the relay can't compact plaintext; clients hold canonical state and we checkpoint *encrypted* snapshots. Loro's E2E mode is experimental — validate before relying on it.

## Recommended path (1-dev team)
1. **Start: pure WebView-hosted `loro-crdt` + `loro-codemirror`, bridged to RN** (`react-native-react-bridge`). Everything (CRDT + editor) in the WebView; RN only ferries network blobs + presence. **~1-2 weeks to first live phone<->laptop edit.** Lowest risk start. Risk = WebView<->RN bridge ergonomics, large-doc memory, mobile keyboard/scroll feel.
2. **Graduate: adopt the native `loro-react-native` binding** where we want LoroDoc accessible to native RN code (offline persistence, background sync, other object types). **+~1-2 weeks.** Risk = binding immaturity + native-build/CI friction.
3. **Turn on Loro Protocol E2E mode** once the basic loop is proven.

Transport build either way: **promote the CF Worker relay to a per-document Durable Object** (port the Yjs DO template to relay Loro blobs — the DO stays a dumb ciphertext fan-out), WebSocket hibernation + encrypted R2 checkpoints.

## Exists vs. we build
- **Exists:** `loro-react-native` (native Turbo Module), `loro-crdt`, `loro-codemirror`, Loro Protocol (sync + presence + E2E), `react-native-react-bridge`, `y-durableobjects` / `yjs-cf-ws-provider` DO+WS+R2 templates, `uniffi-bindgen-react-native` (Filament/Mozilla-backed).
- **We build:** the per-document Durable Object relay (port the Yjs template — small), the WebView<->RN message bridge, E2E key management (reuse our WebCrypto vault), and offline persistence + reconnect-and-flush (reuse our existing mobile outbox pattern).

## Honest verdict + how it relates to the hub arc
No showstopper. The only hard constraints are mundane: the editor must live in a WebView (CodeMirror is DOM-bound), the native binding is young (read its code), and Loro's E2E mode is experimental (validate). This is the **biggest** mobile build we have discussed (multi-week, new live transport), versus **Phase 2c (read-only notes)** which needs none of it and is days.

Suggested sequencing: ship **Phase 2c (render notes read-only)** first — it delivers "see the experiment's notes on the phone" immediately and is the embed seam — then treat **real-time Loro editing as its own project** starting with the 1-2 week WebView prototype if/when live mobile editing is a priority. 2c is not wasted: the read renderer and the WebView editor can coexist (read view by default, tap-to-edit opens the live WebView editor later).

## Sources
loro-react-native https://github.com/loro-dev/loro-react-native · loro-ffi https://github.com/loro-dev/loro-ffi · Loro Protocol https://loro.dev/blog/loro-protocol · uniffi-bindgen-react-native https://github.com/jhugman/uniffi-bindgen-react-native · react-native-automerge https://github.com/automerge/react-native-automerge · react-native-react-bridge https://github.com/inokawa/react-native-react-bridge · y-durableobjects https://github.com/napolab/y-durableobjects · yjs-cf-ws-provider https://github.com/TimoWilhelm/yjs-cf-ws-provider · Cloudflare Durable Objects https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/ · Polygen / WASM in Hermes https://www.callstack.com/newsletters/react-native-evals-expo-sdk-55-and-webassembly-in-hermes · Expo New Architecture https://docs.expo.dev/guides/new-architecture/
