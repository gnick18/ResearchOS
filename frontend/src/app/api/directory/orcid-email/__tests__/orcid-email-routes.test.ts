// Tests for the ORCID email-capture route handlers (section 18.7).
//
//   start  : MANDATORY ORCID session, else 401; sends an OTP on a good email.
//   verify : MANDATORY ORCID session AND a valid OTP before any binding; on
//            success storeOrcidEmail writes the email_hash + email_enc; a bad or
//            absent OTP never writes a binding; link-to-existing-account is the
//            same code path (the hash is keyed by orcid_id) so it just succeeds.
//
// All side-effecting deps are mocked. The auth mock is reassigned per-test so the
// session can be an ORCID session, an email session, or absent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ------------------------------------------------------------------

const authMock = vi.fn();
vi.mock("@/lib/sharing/auth", () => ({
  auth: () => authMock(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

vi.mock("@/lib/sharing/directory/guard", () => ({
  getPepper: () => "test-pepper-exactly-32bytes-here!",
  isSharingEnabled: () => true,
  extractClientIp: () => "127.0.0.1",
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status }),
}));

// Rate limiters always pass in tests.
vi.mock("@/lib/sharing/directory/ratelimit", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/sharing/directory/ratelimit")
  >("@/lib/sharing/directory/ratelimit");
  return {
    ...actual,
    getIpLimiter: () => ({ limit: async () => ({ success: true }) }),
    getSignupLimiter: () => ({ limit: async () => ({ success: true }) }),
    // OTP store helpers are overridden per-test via the spies below.
    readOtp: vi.fn(),
    consumeOtp: vi.fn(async () => undefined),
    incrementOtpAttempts: vi.fn(async () => 1),
    storeOtp: vi.fn(async () => undefined),
  };
});

// The mailer must not actually send.
vi.mock("@/lib/sharing/directory/mailer", () => ({
  sendOtpEmail: vi.fn(async () => undefined),
}));

// Seed grant is best-effort and irrelevant to these assertions.
vi.mock("@/lib/billing/seed-grant", () => ({
  seedStarterGrant: vi.fn(async () => undefined),
}));

// db: spy on the schema + binding writes; the routes only need them to resolve.
const storeOrcidEmailMock = vi.fn(
  async (_orcidId: string, _canonicalEmail: string, _emailHash: string) =>
    undefined,
);
vi.mock("@/lib/sharing/directory/db", () => ({
  ensureSchema: vi.fn(async () => undefined),
  ensureOrcidSchema: vi.fn(async () => undefined),
  storeOrcidEmail: (orcidId: string, canonicalEmail: string, emailHash: string) =>
    storeOrcidEmailMock(orcidId, canonicalEmail, emailHash),
}));

// otp.verifyOtp is real (pure); we control the stored hash via the readOtp mock.
import { hashOtp } from "@/lib/sharing/directory/otp";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

import { POST as startPost } from "../start/route";
import { POST as verifyPost } from "../verify/route";
import { readOtp, consumeOtp, storeOtp } from "@/lib/sharing/directory/ratelimit";

const readOtpMock = readOtp as unknown as ReturnType<typeof vi.fn>;
const consumeOtpMock = consumeOtp as unknown as ReturnType<typeof vi.fn>;
const storeOtpMock = storeOtp as unknown as ReturnType<typeof vi.fn>;

function orcidSession(orcidId: string) {
  return { user: { email: null }, orcidId, expires: "2099-01-01T00:00:00Z" };
}

function postRequest(body: unknown): Request {
  return new Request("https://test.local/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build a valid stored-OTP record for a known code so verifyOtp passes. */
function storedFor(code: string) {
  const salt = randomBytes(16);
  return {
    saltHex: bytesToHex(salt),
    hashedOtp: hashOtp(code, salt),
    attempts: 0,
  };
}

beforeEach(() => {
  process.env.ORCID_EMAIL_ENC_KEY = "test-orcid-email-enc-key-16chars+";
  authMock.mockReset();
  storeOrcidEmailMock.mockClear();
  readOtpMock.mockReset();
  consumeOtpMock.mockClear();
  storeOtpMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- start ------------------------------------------------------------------

describe("orcid-email/start", () => {
  it("401s when there is no ORCID session", async () => {
    authMock.mockResolvedValue(null);
    const res = await startPost(postRequest({ email: "alice@wisc.edu" }));
    expect(res.status).toBe(401);
  });

  it("401s for a non-ORCID session (no orcidId)", async () => {
    authMock.mockResolvedValue({ user: { email: "x@y.z" }, expires: "2099" });
    const res = await startPost(postRequest({ email: "alice@wisc.edu" }));
    expect(res.status).toBe(401);
  });

  it("sends an OTP and returns the uniform ok for an ORCID session", async () => {
    authMock.mockResolvedValue(orcidSession("0000-0002-1825-0097"));
    const res = await startPost(postRequest({ email: "alice@wisc.edu" }));
    expect(res.status).toBe(200);
    expect(storeOtpMock).toHaveBeenCalledTimes(1);
  });

  it("400s on a malformed email", async () => {
    authMock.mockResolvedValue(orcidSession("0000-0002-1825-0097"));
    const res = await startPost(postRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(storeOtpMock).not.toHaveBeenCalled();
  });
});

// --- verify -----------------------------------------------------------------

describe("orcid-email/verify", () => {
  it("fails generically when there is no ORCID session (no binding)", async () => {
    authMock.mockResolvedValue(null);
    const res = await verifyPost(
      postRequest({ email: "alice@wisc.edu", otp: "123456" }),
    );
    expect(res.status).toBe(400);
    expect(storeOrcidEmailMock).not.toHaveBeenCalled();
  });

  it("does NOT bind when no OTP is pending (OTP is mandatory)", async () => {
    authMock.mockResolvedValue(orcidSession("0000-0002-1825-0097"));
    readOtpMock.mockResolvedValue(null);
    const res = await verifyPost(
      postRequest({ email: "alice@wisc.edu", otp: "123456" }),
    );
    expect(res.status).toBe(400);
    expect(storeOrcidEmailMock).not.toHaveBeenCalled();
  });

  it("does NOT bind on a wrong OTP", async () => {
    authMock.mockResolvedValue(orcidSession("0000-0002-1825-0097"));
    readOtpMock.mockResolvedValue(storedFor("000000"));
    const res = await verifyPost(
      postRequest({ email: "alice@wisc.edu", otp: "999999" }),
    );
    expect(res.status).toBe(400);
    expect(storeOrcidEmailMock).not.toHaveBeenCalled();
  });

  it("binds the email to the ORCID iD on a correct OTP", async () => {
    authMock.mockResolvedValue(orcidSession("0000-0002-1825-0097"));
    readOtpMock.mockResolvedValue(storedFor("424242"));
    const res = await verifyPost(
      postRequest({ email: "Alice@Wisc.edu", otp: "424242" }),
    );
    expect(res.status).toBe(200);
    expect(storeOrcidEmailMock).toHaveBeenCalledTimes(1);
    const [orcidId, canonicalEmail, emailHash] =
      storeOrcidEmailMock.mock.calls[0];
    expect(orcidId).toBe("0000-0002-1825-0097");
    // The email is canonicalized (lowercased) before binding.
    expect(canonicalEmail).toBe("alice@wisc.edu");
    // A non-empty peppered hash is passed (the directory/billing key).
    expect(typeof emailHash).toBe("string");
    expect(emailHash.length).toBeGreaterThan(0);
    // The single-use code is burned on success.
    expect(consumeOtpMock).toHaveBeenCalled();
  });

  it("links to an existing account by the same email hash (no special path)", async () => {
    // Two different ORCID iDs verifying the SAME email both bind to the SAME
    // peppered hash, which is exactly account-linking by proven email ownership.
    authMock.mockResolvedValue(orcidSession("0000-0002-1825-0097"));
    readOtpMock.mockResolvedValue(storedFor("111111"));
    await verifyPost(postRequest({ email: "shared@lab.edu", otp: "111111" }));
    const hashA = storeOrcidEmailMock.mock.calls[0][2];

    storeOrcidEmailMock.mockClear();
    authMock.mockResolvedValue(orcidSession("0000-0003-0000-0000"));
    readOtpMock.mockResolvedValue(storedFor("222222"));
    await verifyPost(postRequest({ email: "shared@lab.edu", otp: "222222" }));
    const hashB = storeOrcidEmailMock.mock.calls[0][2];

    expect(hashA).toBe(hashB);
  });
});
