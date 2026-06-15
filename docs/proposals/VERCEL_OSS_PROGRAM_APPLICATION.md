# Vercel Open Source Program application (draft)

Status: draft for Grant to review, edit, and submit. Submission is Grant's (his
account, his copy sign-off).
Drafted by: brand manager (Claude), 2026-06-07.

## Program facts (verified 2026-06-07)

- What you get if selected: $3,600 in Vercel platform credits over 12 months, an
  OSS Starter Pack of third-party service credits, and priority community support
  (dedicated Slack). After 12 months projects graduate to make room for new ones.
- Eligibility: actively maintained open source project, hosted on or intended for
  Vercel, measurable impact or growth potential, has a Code of Conduct, credits used
  only for the open source project. Nonprofits and small startups welcome. Larger
  funded companies are nudged to the separate Startups Program instead.
- Apply at `vercel.link/oss-apply` (redirects to `open-source-program.vercel.app`).
- TIMING. Spring 2026 closed June 3 (the Winter cohort was announced March 17, the
  program runs quarterly). We are targeting the SUMMER 2026 cohort, which by the
  pattern should open within a few weeks. We use the gap to build a little visible
  traction first (see the traction checklist at the bottom), then submit.

## Our eligibility, confirmed

- Open source: AGPLv3, `LICENSE` in repo, repo public at
  `github.com/gnick18/ResearchOS`.
- Code of Conduct: `CODE_OF_CONDUCT.md` present.
- Hosted on Vercel: yes, the app and demo deploy on Vercel.
- Actively maintained: daily commits, single primary maintainer (Grant).
- Funding posture: free and open core, sustained by voluntary donations; the
  project originated from a UW-Madison Distinguished Research Fellowship. A small Wisconsin LLC exists for optional
  metered cloud storage cost-recovery, not VC-funded, so the OSS Program (not the
  Startups Program) is the right fit. Worth a one-line mention so it is not a surprise.

## Ready-to-paste answers

The exact form fields can vary, so these are written to cover the usual questions.
Match each answer to whatever field the live form shows.

### Project name

ResearchOS

### One-line description

Local-first, open source research management for scientists. Experiments, lab notes,
methods, scheduling, and sequences, all stored in a folder on your own disk.

### Website / live URL

https://research-os.app  (hosted demo at https://research-os.app/demo, runs entirely
in the browser against synthetic data)

### Repository

https://github.com/gnick18/ResearchOS  (AGPLv3)

### What does your project do, and who is it for?

ResearchOS is a browser-based electronic lab notebook and research management tool
that keeps your data local-first. Your experiments, lab notes, reusable methods,
schedules, and DNA sequences live as plain JSON and markdown in a folder you choose
on your own machine, reached through the File System Access API. There is no account
to create and nothing leaves your computer unless you export it. It is built for
benchwork and computational researchers, lab heads, postdocs, grad students, and solo
scientists across academia, industry, and startups. It replaces a stack of separate
tools (a notebook, a methods binder, a scheduler, a sequence viewer) with one app the
researcher actually owns.

### Why does it matter? What is the impact?

Researchers are stuck choosing between cloud lab notebooks that lock their data behind
a vendor and a subscription, and a pile of disconnected files. ResearchOS gives them a
real alternative, full ownership of their data with no lock-in, while still getting
modern features like real-time collaboration, version history, in-silico cloning, and
NIH data-sharing support. It also helps labs meet the NIH Data Management and Sharing
Policy by guiding structured deposits to open repositories like Zenodo. Being AGPLv3
means a researcher can audit exactly what happens to their data, which is the whole
point for a tool that holds unpublished science.

### How is it hosted on / using Vercel?

The Next.js app and the public demo are deployed on Vercel. Because the app is
local-first, most logic runs in the browser, but Vercel hosts the app shell, the
marketing and welcome pages, the wiki and documentation, and the optional
collaboration and sharing backend (durable relay and identity directory) for users
who choose to share across folders.

### How will you use the credits?

Credits would cover hosting for the public app, the demo, and the documentation wiki,
plus the optional collaboration backend (the real-time relay and identity directory)
so we can keep those features free for the open source community rather than passing
costs to researchers. It directly lowers the cost of keeping ResearchOS free and open.

### Traffic, growth, or community signals

ResearchOS is early but moving fast. The repository was created in February 2026 and
already has more than 3,000 commits, with daily activity from the maintainer. It
originated from a UW-Madison Distinguished Research Fellowship and has a working hosted demo that
anyone can try in the browser with no signup. The pitch here is growth potential, a
sharp niche (a local-first, fully open ELN that researchers actually own) at a moment
when labs need NIH Data Management and Sharing compliance and a credible alternative
to vendor-locked notebooks.

Real numbers as of June 2026 (update right before submitting): the hosted demo is
already drawing roughly 20 to 30 visitors a day (Vercel Web Analytics), which for a
four-month-old project with no paid promotion is real early traction. GitHub repo
created 2026-02-15, roughly 3,300 commits, 1 primary contributor (the maintainer).
Add by submit time: the latest daily and monthly visit numbers, GitHub stars (grow
these before applying), any beta testers, and any lab or institutional pilots. Keep
it honest, the reviewers weight growth potential and do not reward inflated figures.

### Maintainer

Dr. Grant R. Nickles (PhD), University of Wisconsin-Madison. Primary author and
maintainer.

### License

GNU Affero General Public License v3 (AGPLv3).

### Code of Conduct

Yes, `CODE_OF_CONDUCT.md` in the repository.

## Traction to build before the Summer cohort opens

The application's weak spot is community signal (1 star, solo as of June 2026). The
gap before Summer is the time to fix that. Worth doing, roughly in order:

1. Share the repo and the hosted demo on Bluesky and LinkedIn to earn some genuine
   GitHub stars. Even 20 to 50 real stars changes the optics a lot.
2. Turn on Vercel Web Analytics on the demo (if not already) so there are real
   visit numbers to cite by submit time.
3. DONE 2026-06-07. Polished the repo front door (README badge row, sharper hero,
   stronger demo callout, canonical research-os.app URLs) and added CONTRIBUTING.md.
   Still to do, apply the "good first issue" label to a couple of real issues so that
   filter link is not empty.
4. Line up any lab or classmate willing to be named as an early adopter or pilot.
5. Ship the first YouTube companion tutorial (see the tutorials design doc), a real
   demo video strengthens the application.

## Before submitting, do these

1. Confirm the Summer cohort is open on the live form, note its deadline.
2. Update the growth answer with the latest GitHub stars, demo visits, and any
   pilots. Do not inflate.
3. Read every answer out loud against the brand voice rules (no em-dashes, no emojis,
   no AI-speak, no "We're excited to"). They already follow it, but check.
4. Decide whether to mention the LLC. Recommended one line so the metered-storage
   plan is transparent and they route you to the right program.
