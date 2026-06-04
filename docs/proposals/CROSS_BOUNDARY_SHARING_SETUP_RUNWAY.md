# Cross-Boundary Sharing, Human Setup Runway

Things Grant can set up ahead of the build, ordered by when they are needed. Already done, Neon, Upstash, and the Resend API key. This doc covers everything else you can do on your own time.

Security rule throughout. Put secret values straight into the Vercel project's Environment Variables (and later into `frontend/.env.local`), never into chat. The code references them by name and the orchestrator never needs to see them.

---

## 1. Cloudflare R2, the relay storage (Phase 2) [highest value to do early]

This is the storage that holds encrypted bundles in transit. It is the one piece with real account-setup friction, so doing it now is the most useful thing you can do.

One heads-up first. Cloudflare requires a payment method on file to activate R2, even for the free tier. The free tier is 10 GB storage with zero egress fees, and our usage sits far inside it, so you will not actually be charged. If putting a card down for a free service bothers you, there is a no-card fallback, see the note at the end of this section.

Steps.
1. Create a free Cloudflare account at dash.cloudflare.com.
2. In the left sidebar, open **R2 Object Storage** and activate it (this is where it asks for a payment method).
3. Create a bucket. Name it `researchos-relay`. Location, **Automatic** is fine.
4. Create an API token. In R2, open **Manage R2 API Tokens**, then **Create API Token**. Permission, **Object Read & Write**. Scope it to the `researchos-relay` bucket. No expiry. Create it.
5. It will show you, copy these (the secret is shown only once):
   - **Access Key ID**
   - **Secret Access Key**
   - your **Account ID** (also visible on the R2 overview page)
6. Add these to Vercel, your research-os project, Settings, Environment Variables, as (mark the secret one Sensitive, Production and Preview):
   - `R2_ACCOUNT_ID` = your account ID
   - `R2_ACCESS_KEY_ID` = the access key ID
   - `R2_SECRET_ACCESS_KEY` = the secret access key
   - `R2_BUCKET` = `researchos-relay`
7. Tell me when it is done. The bucket's CORS rules (which let the browser upload directly) are a small config step I will hand you when we build Phase 2.

No-card fallback. If you would rather not add a card, skip R2 entirely for now. We can start Phase 2 on Vercel Blob instead (added from the Vercel Storage tab in one click, no card), and switch to R2 later, since the storage layer is built behind a swappable adapter. Just tell me if you want to go that route.

---

## 2. Two app secrets you can add now (Phase 1b) [optional, quick]

These are just random strings, not accounts. You can generate and add them now, or leave them to me. If you want to do them, in a terminal run each command and paste the output into a Vercel env var (Sensitive, Production and Preview).

- `openssl rand -base64 32` then save as `AUTH_SECRET` (signs login sessions).
- `openssl rand -base64 32` then save as `DIRECTORY_HMAC_PEPPER` (protects directory hashes).

There is a third secret (a signing key for the transparency log) that is a keypair rather than a plain string, so I will generate that one with a script during the build and have you paste the result.

---

## 3. Donation setup (Phase 3) [has lead time, worth starting early]

The funding model is free-with-donations, routed so you never personally handle payments. Two pieces, one fast, one slow.

- **GitHub Sponsors (fast).** Go to github.com/sponsors and start the maintainer signup for your account. It needs a bank connection through Stripe and basic tax info. This is the quick, immediate donation channel.
- **UW Foundation gift account (slow, start the conversation now).** Email your department's Divisional Business Office and ask to set up a **Fund 233 gift account** for "ResearchOS, an open-source research tool." Frame it as a gift account to support a free tool, not a service you sell. University processes take weeks, so an early email is worth it. Keep the framing as "supporting open-source software built by a UW researcher," never "funding a university service," for the IP reasons in the funding doc.

---

## 4. Standing items (any time)

- **Apply to the Vercel Open Source Program.** The blurb is ready in `docs/proposals/VERCEL_OSS_APPLICATION.md`. Confirm the GitHub repo is public and has the Code of Conduct first (it now does), then apply while the cohort window is open. This is roughly 3,600 USD of credits.
- **Read your RISE fellowship award letter** for any IP-assignment clause. This is the single real legal risk flagged across the research, and it is worth a quick read plus, if anything looks unclear, a short email to the Office of the Vice Chancellor for Research (coiprogram@research.wisc.edu).
- **Resend sending domain (optional, only if you own a domain).** For email to deliver to anyone besides your own inbox, Resend needs a verified sending domain (a few DNS records). If you have a domain you control, you can verify it in the Resend dashboard. If not, the built-in test sender to your own inbox covers all development, and this can wait.

---

## 5. Confirm your CLI works (so the later env pull is painless)

When Phase 1b is ready you will pull the env vars to your machine. To make sure that will work, in the same terminal where `npm run dev` or `./start.sh` works for you, run `npx vercel --version`. If it prints a version, you are set. If it says command not found, tell me which terminal or environment you launch the app from and we will sort it then.

---

## What I need from you, summarized

Nothing is blocking right now. In rough priority, Cloudflare R2 (or tell me to use Vercel Blob instead), then the GitHub Sponsors signup and the UW gift-account email since those are slow, then the standing items whenever. The two app secrets and the Resend domain can wait for me to prompt you.
