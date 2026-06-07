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
- TIMING CAUTION. Every source lists the Spring cohort deadline as June 3, and today
  is June 7, so the Spring window may have just closed. The program runs every 3
  months, so if Spring is closed, target the Summer cohort. These answers carry over.

## Our eligibility, confirmed

- Open source: AGPLv3, `LICENSE` in repo, repo public at
  `github.com/gnick18/ResearchOS`.
- Code of Conduct: `CODE_OF_CONDUCT.md` present.
- Hosted on Vercel: yes, the app and demo deploy on Vercel.
- Actively maintained: daily commits, single primary maintainer (Grant).
- Funding posture: free and open core, funded in part by the UW-Madison RISE
  Initiative plus voluntary donations. A small Wisconsin LLC exists for optional
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

(Fill in real numbers before submitting. Candidates to include: GitHub stars and
contributors, monthly active users or demo visits if tracked, beta tester count,
the RISE Initiative funding, any institutional pilots or lab adopters, social
following on Bluesky and LinkedIn and YouTube.) Honest framing is best, this is an
early but actively developed project with a clear niche and a working hosted demo.

### Maintainer

Dr. Grant R. Nickles (PhD), University of Wisconsin-Madison. Primary author and
maintainer.

### License

GNU Affero General Public License v3 (AGPLv3).

### Code of Conduct

Yes, `CODE_OF_CONDUCT.md` in the repository.

## Before submitting, do these

1. Confirm the cohort is actually open on the live form. If Spring closed June 3,
   note the Summer open date and submit then.
2. Drop real numbers into the traffic/growth answer. Pull GitHub stars/contributors
   and any usage you track. Do not inflate, the reviewers value honesty and growth
   potential over raw size.
3. Read every answer out loud against the brand voice rules (no em-dashes, no emojis,
   no AI-speak, no "We're excited to"). They already follow it, but check.
4. Decide whether to mention the LLC. Recommended one line so the metered-storage
   plan is transparent and they route you to the right program.
