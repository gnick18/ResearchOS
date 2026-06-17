// Lab-scoped read: the one genuinely new piece of infrastructure under the
// BeakerBot PI copilot (see docs/proposals/2026-06-17-beakerbot-lab-head-utilities.md).
//
// Every other BeakerBot tool is own-only, it reads the signed-in user's own
// objects. The PI tools need to read the WHOLE lab's synced work. The lab is an
// E2E group keyed by a single symmetric lab key, and the head is a mandatory
// co-owner of that key, so there is no cryptographic barrier. What there IS is a
// trust contract, this read is role-gated to the lab head and it writes an audit
// entry to each member's own audit log on every access, so a member's
// transparency panel can show exactly what the PI's lab view read and when.
//
// The read NEVER interprets. It returns each member's decrypted records as
// plaintext bytes. The tools layered on top aggregate and the model narrates,
// the same house rule as every other BeakerBot tool.

import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import type { GetLabResult } from "./lab-do-client";
import type { LabKeyEnvelope } from "./lab-key";
import type { LabMember } from "./lab-membership";
import type { PiAuditEntry } from "./pi-audit";

import { buildCurrentViewer } from "@/lib/local-api";
import { readUserSettings } from "@/lib/settings/user-settings";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { getLabRemote } from "./lab-do-client";
import { openLabKeyCopy } from "./lab-key";
import { pullMemberLabRecords } from "./lab-sync";
import { appendAuditEntries } from "./pi-audit";

/** One decrypted lab object pulled from a member's synced prefix. */
export interface LabScopedRecord {
  recordType: string;
  recordId: string;
  plaintext: Uint8Array;
}

/** One member's slice of the lab-scoped read. */
export interface LabMemberWork {
  /** The member's username, which is also their lab-sync owner prefix. */
  owner: string;
  records: LabScopedRecord[];
  /** Set when this member's pull failed. records is empty in that case. */
  error?: string;
}

export interface LabScopedReadResult {
  ok: boolean;
  /**
   * Set when the read was refused outright (not a lab head, no unlocked
   * identity, no bound lab, lab not found). members is empty in that case.
   */
  error?: string;
  members: LabMemberWork[];
}

/**
 * The collaborators this read composes. Real implementations are wired as the
 * defaults below, the seam exists so the orchestration (role gate, per-member
 * pull, per-member audit, error isolation) is unit-testable without the relay
 * or the crypto.
 */
export interface LabScopedReadDeps {
  getViewer: typeof buildCurrentViewer;
  getLabId: (username: string) => Promise<string | undefined>;
  getIdentity: () => StoredIdentity | null;
  fetchLab: (labId: string) => Promise<GetLabResult | null>;
  openKey: (
    envelope: LabKeyEnvelope,
    username: string,
    x25519Priv: Uint8Array,
  ) => Uint8Array;
  pullRecords: (params: {
    labId: string;
    memberOwner: string;
    labKey: Uint8Array;
    signerEd25519Priv: Uint8Array;
    signerEd25519Pub: Uint8Array;
  }) => Promise<LabScopedRecord[]>;
  appendAudit: (
    targetUser: string,
    entries: Array<
      Omit<PiAuditEntry, "id" | "timestamp"> & { id?: string; timestamp?: string }
    >,
  ) => Promise<void>;
}

const defaultDeps: LabScopedReadDeps = {
  getViewer: buildCurrentViewer,
  getLabId: async (username) => (await readUserSettings(username)).lab_id,
  getIdentity: getSessionIdentity,
  fetchLab: getLabRemote,
  openKey: openLabKeyCopy,
  pullRecords: pullMemberLabRecords,
  appendAudit: appendAuditEntries,
};

/**
 * Read every lab member's synced work, gated on the lab-head role, auditing each
 * access. This is the foundation every PI tool sits on. It returns facts (the
 * decrypted records) and never a judgment.
 *
 * @param opts.recordTypes optional allow-list, when set only these record types
 *   are returned (and audited as the count read).
 * @param deps injected for testing, real collaborators are the defaults.
 */
export async function readLabMembersWork(
  opts: { recordTypes?: string[] } = {},
  deps: Partial<LabScopedReadDeps> = {},
): Promise<LabScopedReadResult> {
  const d = { ...defaultDeps, ...deps };

  // 1. Role gate. Only a lab head may run a lab-scoped read. This mirrors the
  //    implicit view-all the lab_head account type already carries.
  const viewer = await d.getViewer();
  if (viewer.account_type !== "lab_head") {
    return {
      ok: false,
      error: "lab-scoped read requires the lab-head role",
      members: [],
    };
  }
  const piUsername = viewer.username;

  // 2. Need an unlocked identity (to open the lab key and sign relay reads) and
  //    a bound lab.
  const identity = d.getIdentity();
  if (!identity) {
    return { ok: false, error: "no unlocked identity", members: [] };
  }
  const labId = await d.getLabId(piUsername);
  if (!labId) {
    return { ok: false, error: "this account is not bound to a lab", members: [] };
  }

  // 3. Open the lab from the relay, the roster plus the key envelopes. The
  //    current-generation key is the highest generation. Same derivation as
  //    openLabKeyForHead in lab-head-membership.ts.
  const remote = await d.fetchLab(labId);
  if (!remote || remote.envelopes.length === 0) {
    return {
      ok: false,
      error: "lab not found or has no key envelopes",
      members: [],
    };
  }
  const current = remote.envelopes.reduce((a, b) =>
    b.generation > a.generation ? b : a,
  );
  const labKey = d.openKey(
    current,
    piUsername,
    identity.keys.encryption.privateKey,
  );

  // 4. Every member except the head. The head's own work is reachable through
  //    the own-only tools, so it is not duplicated (and not self-audited) here.
  const members = remote.record.members.filter(
    (m: LabMember) => m.username !== piUsername,
  );

  const out: LabMemberWork[] = [];
  for (const member of members) {
    try {
      const pulled = await d.pullRecords({
        labId,
        memberOwner: member.username,
        labKey,
        signerEd25519Priv: identity.keys.signing.privateKey,
        signerEd25519Pub: identity.keys.signing.publicKey,
      });
      // The reserved "_index" record is the member's search index, not work.
      // It is read through the index readers, never returned as a work record.
      const work = pulled.filter((r) => r.recordType !== "_index");
      const records = opts.recordTypes
        ? work.filter((r) => opts.recordTypes!.includes(r.recordType))
        : work;
      out.push({ owner: member.username, records });

      // 5. Audit the access, written to the MEMBER's own audit log so their
      //    transparency panel can surface it. Read-flavored entry mirroring
      //    emitMethodTransientReadAudit, no old or new value semantics. The
      //    write is best-effort, a logging hiccup must not drop the records the
      //    caller already holds, but it is logged so the trust contract is loud
      //    about a failure rather than silent.
      await d
        .appendAudit(member.username, [
          {
            session_id: "lab-scoped-read",
            actor: piUsername,
            target_user: member.username,
            record_type: "lab-scoped-read",
            record_id: records.length,
            field_path: "lab-scoped-read",
            old_value: null,
            new_value: {
              record_count: records.length,
              record_types: Array.from(
                new Set(records.map((r) => r.recordType)),
              ),
            },
          },
        ])
        .catch((err) => {
          console.warn(
            "[lab-scoped-read] audit write failed for",
            member.username,
            err,
          );
        });
    } catch (err) {
      // One member's relay or decrypt failure isolates to that member, the rest
      // of the lab still reads.
      out.push({
        owner: member.username,
        records: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true, members: out };
}
