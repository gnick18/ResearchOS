# Setting up support@research-os.app (inbound forwarding)

Status, LIVE. `support@research-os.app` forwards to `researchos.llc@gmail.com` (the LLC inbox) via ForwardEmail on Vercel DNS. Destination changed 2026-06-17 from `gnickles@wisc.edu` to the LLC Google so support mail lands in the business inbox; the change was made by swapping the `forward-email` TXT record via the Vercel CLI and verified with `dig +short TXT research-os.app`. Originally set up + verified end to end 2026-06-04. The address is safe to publish.

As-built records (added in the Vercel team scope `grant-nickles-projects` -> Domains -> research-os.app -> DNS Records, all on the root unless noted):

```
MX   @        mx1.forwardemail.net.   priority 10
MX   @        mx2.forwardemail.net.   priority 10
TXT  @        forward-email=support:researchos.llc@gmail.com
TXT  @        v=spf1 a mx include:spf.forwardemail.net -all
TXT  _dmarc   v=DMARC1; p=none;
```

The existing `send.research-os.app` MX (Resend sending) was left untouched.

Goal, make `support@research-os.app` actually receive mail and forward it to a real inbox, so the address can be published (About page, footer, Code of Conduct, abuse contact) without bouncing.

## Why this approach

The domain's DNS lives on Vercel (nameservers `ns1.vercel-dns.com` / `ns2.vercel-dns.com`), not Cloudflare. Cloudflare Email Routing only works when the nameservers point at Cloudflare, so it is not usable here without moving DNS. The chosen path keeps DNS on Vercel and adds a free forwarder, no mailbox to run, no nameserver change.

Live DNS state when this was written (confirms the work is needed):

```
Nameservers:              ns1.vercel-dns.com / ns2.vercel-dns.com
Root MX:                  (none)   -> support@ bounces today
Root TXT / SPF:           (none)   -> root has no mail config
send.research-os.app MX:  feedback-smtp...amazonses.com  -> Resend SENDS via the send. subdomain
```

The root domain is clean for inbound mail. Resend's sending setup lives entirely on the `send.` subdomain, so the records below do not touch it and do not affect the live app.

## Provider

ForwardEmail.net (open-source, privacy-first, free). Forwarding is defined entirely by DNS records, so no account or dashboard is required. ImprovMX is a dashboard-based alternative with near-identical steps if you prefer clicking to editing TXT.

## Step 1, pick the destination inbox

Decide which real inbox should receive support mail (for example a wisc.edu address or a personal Gmail). Substitute it for `DESTINATION@yourinbox.com` below.

## Step 2, add the DNS records on Vercel

Vercel dashboard, the `research-os.app` project (or vercel.com -> Domains) -> DNS Records. Add these on the root (`@`):

| Type | Name | Value | Priority |
| --- | --- | --- | --- |
| MX | @ | `mx1.forwardemail.net` | 10 |
| MX | @ | `mx2.forwardemail.net` | 10 |
| TXT | @ | `forward-email=support:DESTINATION@yourinbox.com` | (n/a) |

The TXT line is what routes `support@research-os.app` to the destination inbox. For a catch-all instead (every address at the domain), drop the `support:` prefix and use `forward-email=DESTINATION@yourinbox.com`.

Before saving, open ForwardEmail.net's domain-setup screen and confirm the exact `mx1`/`mx2` hostnames and the `forward-email=` syntax. Their setup page is the authoritative source if anything has changed.

## Step 3 (optional but recommended), reduce spam-foldering

Not required for "does not bounce," but these help forwarded mail land in the inbox rather than spam. Add on the root:

| Type | Name | Value |
| --- | --- | --- |
| TXT | @ | `v=spf1 a mx include:spf.forwardemail.net -all` |
| TXT | _dmarc | `v=DMARC1; p=none;` |

## Step 4, verify

After the records save, confirm they are live and propagated:

```bash
dig +short MX research-os.app
dig +short TXT research-os.app
```

Expect the two `forwardemail.net` MX hosts and the `forward-email=...` TXT to appear. DNS propagation is usually quick on Vercel but can take a few minutes.

Then send a test message to `support@research-os.app` and confirm it lands in the destination inbox.

## Notes

- This does not let you SEND as `support@research-os.app`, only receive and forward. Sending continues to go through Resend on the `send.` subdomain. If you later want to reply as `support@`, configure ForwardEmail's outbound (or a Gmail "send as" alias) separately.
- Nothing here touches the live app or Resend, so it is safe to do at any time.
