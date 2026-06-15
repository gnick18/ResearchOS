// Lab identity + branding: tests that the cosmetic branding fields reach the
// relay /lab/create body. These are NOT in the signed log; they ride alongside
// the genesis as plain meta. We mock fetch (the relay LabRecordDO is workerd) and
// force the lab tier on so ensureEnabled does not short-circuit.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatedLab } from "./lab-key";

vi.mock("./config", () => ({ LAB_TIER_ENABLED: true }));
vi.mock("@/lib/loro/config", () => ({ COLLAB_RELAY_URL: "wss://relay.test" }));

import { createLabRemote } from "./lab-do-client";

/** A minimal CreatedLab whose only used fields are record.log[0], envelope, and
 *  record.head. The branding test does not exercise crypto. */
function fakeCreated(): CreatedLab {
  return {
    record: {
      labId: "lab-1",
      head: {
        username: "emile",
        x25519PublicKey: "aa",
        ed25519PublicKey: "bb",
        role: "head",
      },
      members: [],
      keyGeneration: 0,
      log: [
        {
          seq: 0,
          type: "create",
          keyGeneration: 0,
          roster: [],
          issuedAt: 1,
          prevHash: "",
          signature: "cc",
        },
      ],
    },
    envelope: { generation: 0, copies: [] },
    labKey: new Uint8Array(),
  } as unknown as CreatedLab;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createLabRemote branding", () => {
  it("attaches labName/piTitle/piDisplay to the create body when supplied", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    await createLabRemote("lab-1", fakeCreated(), {
      labName: "Fungal Interactions Lab",
      piTitle: "Dr.",
      piDisplay: "Emile Gluck-Thaler",
    });
    expect(body.labName).toBe("Fungal Interactions Lab");
    expect(body.piTitle).toBe("Dr.");
    expect(body.piDisplay).toBe("Emile Gluck-Thaler");
    // The genesis artifacts are still present alongside the branding.
    expect(body.entry).toBeTruthy();
    expect(body.envelope).toBeTruthy();
    expect(body.head).toBeTruthy();
  });

  it("omits the branding keys entirely when none are supplied", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    await createLabRemote("lab-1", fakeCreated());
    expect("labName" in body).toBe(false);
    expect("piTitle" in body).toBe(false);
    expect("piDisplay" in body).toBe(false);
  });
});
