# Directory Live Test Runbook

A ~5-10 minute check that the identity directory works end to end against live Neon, Upstash, and Resend. It generates a keypair, registers it through the real signup, email-code, verify flow, then looks the keys back up.

Heads-up, building this test caught a real bug already (the signup signature was over the peppered email hash the client cannot compute), which is fixed and committed, so the round trip should now pass.

Everything below runs from the **frontend/** directory.

---

## One-time local env setup

1. Confirm the Vercel CLI works.
   ```
   npx vercel --version
   ```
   If this errors with command not found, tell me which terminal or environment you launch the app from.

2. Link the folder to the project (one time).
   ```
   npx vercel link
   ```
   Pick the **research-os** project when prompted.

3. Pull the environment variables into a local file.
   ```
   npx vercel env pull .env.local
   ```
   This pulls `DATABASE_URL`, `KV_REST_API_URL`, and `KV_REST_API_TOKEN`.

4. Open `frontend/.env.local` and add these three lines at the bottom:
   ```
   SHARING_ENABLED=true
   RESEND_API_KEY=re_your_real_key_here
   DIRECTORY_HMAC_PEPPER=any-random-string-is-fine-for-this-test
   ```
   - The pepper can be any string for a local test.
   - The Resend key must be your real one so the email actually sends.
   - If step 3 did not include `DATABASE_URL` or the two `KV_` variables, tell me and we will add them.

---

## Run the test

5. Start (or restart, so it loads the new `.env.local`) the dev server.
   ```
   npm run dev
   ```

6. In a second terminal, also from `frontend/`, run the smoke test with your own email.
   ```
   node scripts/sharing-directory-smoketest.mjs gnick317@gmail.com
   ```

7. The script will:
   - request a signup code (you should see a `200`),
   - send a 6-digit code to your inbox,
   - prompt you to paste that code,
   - verify and bind the keys,
   - look the email up and compare the keys.

   Watch for **PASS** on the last line.

---

## What to send me

Paste the script's output, whether it says PASS or throws anything. From there I can tell exactly which piece worked and fix anything that did not.

---

## Notes

- Use your own email so the code reaches you.
- Signup is rate-limited to 3 tries per 15 minutes per email, so if you re-run a few times and hit a limit, wait or use a slightly different address.
- The test writes one harmless row to your Neon directory table. It can be cleared later.
- If you see a `404` from signup, `SHARING_ENABLED` is not set to `true` in the running server (re-check `.env.local` and restart the dev server).
