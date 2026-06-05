// Loro Phase 3c chunk 3a: deterministic collab session derivation from a doc id.
//
// PURPOSE. Every shared note carries a stable collab_doc_id (see
// lib/collab/client/doc-id.ts). This module derives a (sessionId, sessionKey)
// pair from that id so every holder of the same note can independently compute
// the same relay room address and the same symmetric key K, with no link to
// paste and no server round-trip for the session bootstrap.
//
// The collab_doc_id is the shared secret: it lives inside the note's Loro
// sidecar, which only members have. Holding the doc id is sufficient to prove
// membership (the server also enforces ACLs on the push/open routes, but that
// is a separate layer). Any two members who open the same shared note derive
// identical (sessionId, sessionKey) and arrive at the same relay room with the
// same envelope key.
//
// DERIVATION DESIGN.
//
//   sessionId = hex( HKDF-SHA256(IKM=docId, info="researchos.collab.session-id.v1", length=16) )
//   sessionKey = HKDF-SHA256(IKM=docId, info="researchos.collab.session-key.v1", length=32)
//
// Two separate HKDF calls with distinct `info` strings ensure that even if
// someone learns the sessionId (it is sent in plaintext to the relay as the
// room name) they cannot reverse it to derive the sessionKey. The 32-byte
// HKDF output is used directly as the XChaCha20-Poly1305 symmetric key K
// (same role as the key from generateSessionKey() in envelope.ts).
//
// The relay room name is the hex-encoded 16-byte HKDF output for sessionId,
// making it opaque (the relay cannot correlate it to the doc id or to the
// note's internal id). 32 hex chars is comfortably under the 255-byte
// sessionId limit imposed by the frame layout in envelope.ts.
//
// PERSISTENCE NOTE. The doc id is stored in the Loro meta map under key
// "collab_doc_id" (lib/collab/client/doc-id.ts). It travels with the sidecar
// and is included in the cross-boundary share payload so the recipient derives
// the same (sessionId, sessionKey) on their first open.
//
// Pure crypto, no React, no network, no storage.
// No emojis, no em-dashes, no mid-sentence colons.

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils.js";

// HKDF info strings for each derived value. Distinct strings ensure the two
// outputs are domain-separated even if the docId is the same.
const SESSION_ID_INFO = utf8ToBytes("researchos.collab.session-id.v1");
const SESSION_KEY_INFO = utf8ToBytes("researchos.collab.session-key.v1");

const SESSION_ID_LENGTH = 16; // bytes; hex-encoded to 32 chars, well under the 255-byte limit
const SESSION_KEY_LENGTH = 32; // bytes; matches XChaCha20-Poly1305 key size

/**
 * Derives a deterministic (sessionId, sessionKey) pair from a collab doc id.
 *
 * Every member who holds the same collab_doc_id will derive the EXACT same pair,
 * so they all connect to the same relay room with the same encryption key. This
 * is the auto-connect entry point: no link to paste, no server bootstrap.
 *
 * @param docId - The note's collab_doc_id (a UUID string from
 *   getOrMintCollabDocId / getCollabDocId).
 *
 * @returns { sessionId, sessionKey } where sessionId is a hex string and
 *   sessionKey is a raw 32-byte Uint8Array compatible with the sealFrame /
 *   openFrame API in envelope.ts.
 */
export function collabSessionFromDocId(docId: string): {
  sessionId: string;
  sessionKey: Uint8Array;
} {
  const ikm = utf8ToBytes(docId);

  // Derive the session id: 16 raw bytes -> 32 hex chars.
  const sessionIdBytes = hkdf(sha256, ikm, undefined, SESSION_ID_INFO, SESSION_ID_LENGTH);
  const sessionId = bytesToHex(sessionIdBytes);

  // Derive the session key: 32 raw bytes, used as the symmetric envelope key.
  const sessionKey = hkdf(sha256, ikm, undefined, SESSION_KEY_INFO, SESSION_KEY_LENGTH);

  return { sessionId, sessionKey };
}
