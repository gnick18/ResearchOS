// Class Mode (CM-P2A): the create-class orchestration, factored out of the modal
// so the deps wiring + success/switch path is unit-testable in node without
// jsdom or a real OPFS / session.
//
// The modal collects a class name (and optional term), then calls runCreateClass.
// This resolves the current account, ensures a local identity (a class mints a
// lab, which signs a genesis record), reads the OAuth email, and calls
// provisionClassFolder, which mints the class lab in a fresh managed OPFS folder
// and switches the active folder to it. The current folder is never touched.
//
// Every side-effecting dependency is injectable so a test passes fakes. The real
// implementations are the module defaults, wired to the same sources the
// lab-create flow uses (getSession, getSessionIdentity, ensureLocalIdentity,
// getCurrentUser, provisionClassFolder).
//
// House style: no emojis, no em-dashes, no mid-sentence colons.

import { getSession } from "next-auth/react";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { ensureLocalIdentity } from "@/lib/sharing/identity/ensure-identity";
import { getCurrentUser } from "@/lib/file-system/indexeddb-store";
import {
  provisionClassFolder,
  type ProvisionClassFolderResult,
} from "@/lib/lab/provision-class-folder";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";

/** Compose a class name with an optional term into the branding label that rides
 *  into the provisioner. The term is appended only when present so a bare class
 *  name stays clean. Pure. */
export function composeClassName(name: string, term: string): string {
  const n = name.trim();
  const t = term.trim();
  if (!n) return "";
  return t ? `${n} ${t}` : n;
}

/** The injectable surface runCreateClass needs. Real implementations are the
 *  module defaults; tests pass fakes. */
export interface CreateClassFlowDeps {
  getCurrentUser: () => Promise<string | null>;
  getSessionIdentity: () => StoredIdentity | null;
  ensureLocalIdentity: (username: string) => Promise<unknown>;
  getOauthEmail: () => Promise<string>;
  provisionClassFolder: (params: {
    username: string;
    identity: StoredIdentity;
    oauthEmail: string;
    className?: string;
  }) => Promise<ProvisionClassFolderResult>;
}

const defaultDeps: CreateClassFlowDeps = {
  getCurrentUser,
  getSessionIdentity,
  ensureLocalIdentity,
  getOauthEmail: async () => {
    const session = await getSession();
    return session?.user?.email ?? "";
  },
  provisionClassFolder: (params) => provisionClassFolder(params),
};

/** The result of the create-class flow. ok:true mirrors the provisioner result
 *  (the active folder is already switched). ok:false carries a typed reason plus
 *  a human message the modal can surface verbatim. */
export type CreateClassFlowResult =
  | { ok: true; folderId: string; labId: string; persisted: boolean }
  | {
      ok: false;
      reason: "no-account" | "no-identity" | "no-email" | "provision-failed";
      message: string;
    };

/**
 * Run the create-class flow. Resolves the account, ensures a local identity,
 * reads the OAuth email, then provisions the class folder (which switches the
 * active folder). Returns a typed result so the caller can branch on the
 * durability grant and surface failures with their own copy.
 */
export async function runCreateClass(
  input: { name: string; term: string },
  depsOverride?: Partial<CreateClassFlowDeps>,
): Promise<CreateClassFlowResult> {
  const deps = { ...defaultDeps, ...depsOverride };

  const username = await deps.getCurrentUser();
  if (!username) {
    return {
      ok: false,
      reason: "no-account",
      message:
        "We could not find your account. Sign in again, then create the class.",
    };
  }

  // A class mints a lab, which signs a genesis record, so it needs a local
  // keypair. ensureLocalIdentity is idempotent (a no-op when one already
  // exists), mirroring the lab-create flow so a solo user with no key yet can
  // still stand up a class.
  let identity = deps.getSessionIdentity();
  if (!identity) {
    try {
      await deps.ensureLocalIdentity(username);
      identity = deps.getSessionIdentity();
    } catch {
      // Fall through to the not-ready guard below.
    }
  }
  if (!identity) {
    return {
      ok: false,
      reason: "no-identity",
      message:
        "Your secure identity is not ready yet. Wait a moment, then try again.",
    };
  }

  const oauthEmail = await deps.getOauthEmail();
  if (!oauthEmail) {
    return {
      ok: false,
      reason: "no-email",
      message:
        "A class needs a verified email so students can find it. Sign in with an email-bearing account, then create the class.",
    };
  }

  const className = composeClassName(input.name, input.term);

  const result = await deps.provisionClassFolder({
    username,
    identity,
    oauthEmail,
    className,
  });

  if (!result.ok) {
    return { ok: false, reason: "provision-failed", message: result.message };
  }

  return {
    ok: true,
    folderId: result.folderId,
    labId: result.labId,
    persisted: result.persisted,
  };
}
