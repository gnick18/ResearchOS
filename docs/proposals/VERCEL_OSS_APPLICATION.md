# Vercel Open Source Program, Application Blurb (Spring 2026 cohort)

Ready-to-paste copy for the application. Fields are labeled to match the kind of questions the form tends to ask. Trim to fit. House voice, no em-dashes, no emojis.

Before submitting, confirm two program requirements. The GitHub repo must be public, and it must contain a Code of Conduct (a standard CODE_OF_CONDUCT.md from the Contributor Covenant is fine). If either is missing, add it first.

---

## Project name
ResearchOS

## One-line description
A free, open-source, local-first project-management app for science labs, built with Next.js on Vercel.

## Links
- Live app, https://research-os-xi.vercel.app/
- Repository, https://github.com/gnick18/ResearchOS
- License, AGPLv3

## What it is (short)
ResearchOS is a free, local-first project-management tool for research labs. It runs entirely in the browser with no backend, keeping every lab's data on their own disk through the File System Access API, so a lab owns and controls its research data instead of handing it to a vendor. It covers the day-to-day of running a lab, dependency-aware Gantt scheduling, lab notes and results with image and file attachments, a reusable methods and protocol library, multi-user shared folders, and instrument and calendar integrations.

## About the project (longer)
Most labs run on a mix of expensive closed platforms and scattered spreadsheets. ResearchOS is the free, open alternative, designed so that a lab's notes, methods, schedules, and results live in a folder the lab controls, synced through whatever cloud drive they already use. It is built for working scientists, with a PCR and protocol builder, a methods library, results and image management, multi-user accounts with shared-task editing, Telegram inbox ingestion, external calendar overlays, and exports aligned with NIH data-management-plan expectations. The goal is to make rigorous, reproducible lab organization available to every lab, including low-resource ones that cannot afford per-seat research software.

## Why it is open source
ResearchOS is AGPLv3 and free for every lab, with no paid tier and no per-seat fees. It is funded by a University of Wisconsin-Madison RISE fellowship today and voluntary donations later, deliberately so that it stays free for labs that could never pay for it. The AGPL license keeps it free and forkable in perpetuity and ensures any hosted version offers its source back to the community. Being open source is core to the mission, research tooling for the public good should be inspectable, ownable, and free.

## How it uses Vercel
The app is a Next.js 16 App Router project with React 19 and TypeScript, deployed on Vercel and served at research-os-xi.vercel.app. Because the architecture is local-first, the only server-side code is two thin serverless proxy routes that exist purely to work around CORS for the Telegram and ICS calendar integrations. Vercel Web Analytics is integrated. The platform credits would cover the project's frontend hosting for the year as its user base grows across academic labs.

## Maintainer
Grant R. Nickles, University of Wisconsin-Madison. Solo maintainer, actively developed.

## Anything else
ResearchOS is a real, in-production academic project used for managing live research, not a demo. It is non-commercial and committed to staying free and open under AGPLv3.
