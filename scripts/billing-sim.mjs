#!/usr/bin/env node
// Thin CLI for the backend billing simulator (/api/dev/billing-sim). Seeds a fake
// lab + members + usage + plan + gift, then runs the REAL enforcement decision by
// email, so the lab-shared-pool model can be tested without devices or checkout.
//
// Setup: set BILLING_SIM_SECRET in the app env (and here), point BASE at the dev
// server (default http://localhost:3000). The app must be running.
//
//   BILLING_SIM_SECRET=xxx node scripts/billing-sim.mjs scenario \
//     --pi pi@lab.edu --pi-storage-mb 200 --members a@lab.edu:600,b@lab.edu:600
//   node scripts/billing-sim.mjs check a@lab.edu
//   node scripts/billing-sim.mjs reset pi@lab.edu a@lab.edu b@lab.edu
//
// No em-dashes, no emojis, no mid-sentence colons.

const BASE = process.env.BILLING_SIM_BASE || "http://localhost:3000";
const SECRET = process.env.BILLING_SIM_SECRET || "";

function flag(args, name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}

async function post(payload) {
  const res = await fetch(`${BASE}/api/dev/billing-sim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(SECRET ? { authorization: `Bearer ${SECRET}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (res.status === 404) {
    console.error(
      "404: gate rejected. Set BILLING_SIM_SECRET (matching the app env) or sign in as an admin.",
    );
    process.exit(1);
  }
  return json;
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "scenario") {
  // --members "a@x:600,b@x:600"  (email:storageMb, optional :writesK after another colon)
  const membersArg = flag(args, "members", "");
  const members = membersArg
    ? membersArg.split(",").map((m) => {
        const [email, storageMb, writesK] = m.split(":");
        return {
          email,
          storageMb: Number(storageMb || 0),
          writesK: Number(writesK || 0),
        };
      })
    : [];
  const payload = {
    action: "scenario",
    piEmail: flag(args, "pi"),
    piStorageMb: Number(flag(args, "pi-storage-mb", 0)),
    piWritesK: Number(flag(args, "pi-writes-k", 0)),
    plan: flag(args, "plan"),
    giftGb: Number(flag(args, "gift-gb", 0)),
    giftWritesM: Number(flag(args, "gift-writes-m", 0)),
    giftExpiresAt: flag(args, "gift-expires"),
    members,
  };
  console.log(JSON.stringify(await post(payload), null, 2));
} else if (cmd === "check") {
  const email = args[0];
  if (!email) {
    console.error("usage: check <email>");
    process.exit(1);
  }
  const r = await post({ action: "check", email });
  // pretty one-liner verdict + detail
  const verdict = r.wouldBlock
    ? `BLOCK (${r.reason})`
    : "OK (under limits)";
  console.log(`${email} -> ${verdict}`);
  console.log(
    `  pool: ${r.storageUsedMb}/${r.storageCapMb} MB storage, ${r.writesUsed}/${r.writesAllowance} writes (${r.period})`,
  );
  console.log(
    `  billing owner is a lab pool: ${r.billingOwnerIsLab} | enforcement live: ${r.enforcementLive}`,
  );
} else if (cmd === "reset") {
  console.log(JSON.stringify(await post({ action: "reset", emails: args }), null, 2));
} else {
  console.log(
    "usage:\n  scenario --pi <email> [--pi-storage-mb N] [--pi-writes-k N] [--plan plus] [--gift-gb N] [--gift-writes-m N] [--members a@x:600,b@x:600]\n  check <email>\n  reset <email...>",
  );
}
