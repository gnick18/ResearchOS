# Class Mode (teaching / classroom lane)

Status: roadmap, locked direction from the Owen Sullivan classroom pilot (Grant, 2026-06-17). Author: Billing/orchestrator lane.

## Vision

One ResearchOS login lets a lab head switch between their PERSONAL lab and the DIFFERENT CLASSES they teach, all on the same account. A class is a first-class workspace (a "class folder") alongside the personal lab, with teaching-specific tools layered on top of the existing research tools (sequences, primer design, phylo, data hub, lab notebook, methods/protocols).

This is a real, validated wedge into academia. Instructors already run "CURE" courses (Curriculum-based Undergraduate Research Experience) where the class IS research, so the same tools a lab uses are the tools a class needs, plus roster management and shared visibility.

## Why now

- Live classroom pilot lined up (Owen Sullivan, teaches genetics with a dry-lab component). He is willing to pilot in a real classroom.
- The enabling foundation already shipped (2026-06-16): a SINGLE login can point to MULTIPLE folders at the same time. That is the mechanism that lets one account hold "my lab" plus "Genetics 410 Spring" plus "Cell Bio Lab" as parallel contexts.
- Clear competitor to beat: Benchling's classroom. Its killer feature is roster sync from the LMS plus auto-invite emails plus a per-term folder where students can see each other's data.

## The multi-context account model

- One identity, many workspaces. A lab head picks a context (personal lab, or a class) and the app reskins to that context (PI chrome for the lab, instructor chrome for a class).
- Each class is its own folder/workspace with its own roster, shared materials, and student notebooks.
- FOUNDATION BUILT: one login -> multiple folders simultaneously. NEXT is the context switcher UI and the class-specific chrome/tools.
- This intersects the lab dormancy / mode-switch work (a PI dropping to solo) and the lab-identity lane. Same "what context am I in" plumbing.

## Class page feature set (prioritized by pilot signal)

1. ROSTER SYNC FROM THE LMS (highest-value per Owen). Sync the student roster from Moodle / Canvas into the class, and auto-email students to prompt account sign-up (exactly the Benchling behavior Owen called out as the single most useful tool). Start with Moodle + Canvas.
2. SHARED CLASS MATERIALS. The instructor uploads files (sequences, data tables) that are shared to ALL students, so the whole class can design primers or run stats together while the teacher demonstrates. Weekly protocol/method sharing (Owen shares protocols every week).
3. ASSIGNED TASKS AS METHODS. The instructor builds a checklist that gets sent to every student as a "method" protocol to follow, paired with a per-student lab notebook for their notes. (Lab notebook is a large part of the course grade, per Owen.)
4. SHARED VISIBILITY. A per-term class folder where students can see each other's data (the Benchling term-folder model). Instructor controls what is shared-to-all vs private.
5. HOMEWORK UPLOAD + GRADING. Students submit, instructor grades. (Grant floated this; confirm demand vs LMS overlap, since grading may stay in the LMS.)
6. CURE-AWARE FLEXIBILITY. Because every CURE course is based on a different lab's research, the class tools must be flexible/modular, not a fixed template. Needs differ per lab (Owen does primer design, cloning, multiple sequence alignment, phylo trees, structure analysis as a pair).

## Pilot intel (Owen Sullivan, verbatim-ish, 2026-06-17)

- Most instructors there run CURE-based labs. Upper-level labs are based on the lab's research, so needs differ per lab.
- Owen teaches genetics with primer design + cloning and a dry-lab portion (multiple sequence alignments, phylogenetic trees, structure analysis, done as a pair).
- A large part of the grade is the lab notebook.
- He shares protocols every week.
- He currently posts everything on Moodle (their Canvas).
- The single most useful tool would be syncing the student roster from Moodle into the interface. Benchling does this, syncs the roster and auto-emails students to prompt sign-up.
- In Benchling he made a folder specific to the term and could do all the same functions, and students could see each other's data.
- Next ask from him: a concrete list of what an instructor actually finds helpful on a classroom page, so we do not over-build. He will think on it.

## Tracked bug (from the same pilot)

PI CONTEXT LOST ON FOLDER RE-PICK. Owen logged in, was sent back to the choose-a-folder page, and after selecting a folder the page rendered as an INDIVIDUAL person, not a PI. It kept his name but nothing else of the lab/PI context. He had set up a new Google Drive folder today, different from yesterday's PI folder. This looks like a JSON/settings bug in how PI/lab context is detected when a folder is (re)connected, possibly interacting with the new one-login-multiple-folders feature. Grant requested the folder (SullivanLab-ResearchOS / Research.zip) to inspect the on-disk JSON. ACTION: diagnose from the sent folder, fix the PI-context detection on folder connect. Relevant to the dormancy/mode-switch lane (same "am I a PI here" resolution).

## Open decisions

- Class as a separate folder vs a sub-context of the lab folder (lean separate folder, matches Benchling term folders and the multi-folder foundation).
- LMS scope for v1 (Moodle + Canvas first, since the pilot is Moodle).
- Grading in-app vs deferring to the LMS (lean defer grading, lead with roster sync + shared materials + notebooks).
- Pricing: is Class Mode part of the Lab tier, a Department/Institution feature, or its own education SKU. Hold until the feature set firms up. Education pricing tends to want a flat per-class or per-seat academic rate, not the usage-metered Model A, so this is a real pricing question for later.
