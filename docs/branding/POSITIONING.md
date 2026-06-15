# ResearchOS Positioning Framework

Built with the product-positioning method. House voice applies throughout (no em-dashes, no mid-sentence colons, no emojis, state the why). This is the foundation that the messaging framework, the brand rulebook voice, and all site copy inherit from. Last updated 2026-06-11.

---

## 0. POSITIONING STATEMENT

For academic researchers and the labs they work in who want a serious electronic lab notebook without handing their data and their grant money to a vendor, ResearchOS is a local-first, open-source research workspace that keeps every note, method, experiment, structure, and file in a plain folder the researcher owns. It replaces a stack of expensive single-purpose tools (the lab notebook, the chemistry drawer, the cloning tool, the stats package) with one free app. Unlike LabArchives and Benchling, which lock your work inside their cloud and bill per seat, ResearchOS leaves your data on your own disk, stays free and open source, and only ever charges cost-recovery for the optional cloud storage you choose to use.

---

## 1. CUSTOMERS

### Customers That Care

- **Bench scientists in biology and chemistry** who live in a lab notebook every day and want their protocols, gels, and results in one searchable place they control.
- **Principal investigators and lab heads** who are accountable for the lab's data, its funding, and its compliance, and who do not want a recurring per-seat bill for every student.
- **Graduate students** who join a lab, inherit a mess of folders and a paper notebook, and need their own space without paying for software out of a stipend.
- **Postdocs** who move between institutions and cannot afford to leave their data trapped in an account the old lab pays for.
- **Lab managers** who run inventory, onboarding, and shared protocols and need a single source of truth that survives people leaving.
- **Research-software-conscious scientists** who care about open source, reproducibility, and not being locked in, and who already distrust closed cloud notebooks.
- **Department and core-facility administrators** who buy site licenses today (LabArchives, Benchling) and are looking for something cheaper that researchers will actually adopt.

### Customer Use Cases

- A grad student records a PCR run, pastes the recipe and cycle conditions, attaches the gel photo, and finds it six months later by searching the plasmid name.
- A PI reviews a member's experiments before a lab meeting without logging into a separate billing portal or paying for an extra seat.
- A chemist draws a structure in the Chemistry Workbench, pulls the compound from PubChem, and links it straight into the experiment note, instead of paying for ChemDraw.
- A molecular biologist plans a cloning strategy in the sequence editor and checks the digest, instead of buying a SnapGene license.
- A researcher runs a t-test and makes a publication figure in the Data Hub, with the math validated against Prism and R, instead of buying GraphPad Prism.
- A lab writes its NIH data-management plan and can honestly say where the data lives, who owns it, and how it is retained, because the answer is "in the researcher's own folder."
- Two collaborators in different institutions co-edit a method in real time or send a one-time encrypted copy of a note, without a shared paid account.
- A postdoc leaving a lab exports their own work as a portable folder and walks away clean, with nothing left behind in someone else's subscription.

### Customer Problems and Pain Points

- ELN subscriptions cost hundreds of dollars per user per year, which a lab pays again every year for every student who rotates through.
- Cloud notebooks hold your research on the vendor's servers, so leaving means a migration fight and the data was never really yours.
- Labs run a separate paid tool for every job (notebook, chemistry, cloning, stats, inventory), and the licenses stack up.
- Compliance officers and NIH plans ask where the data lives and who controls it, and "a startup's cloud" is an uncomfortable answer.
- Researchers cannot verify that a closed stats or Tm tool computes the right number, so they trust a black box in their papers.
- Switching tools mid-project is terrifying, because export is lossy and history is trapped in the old system.
- Paper notebooks and ad-hoc folders are unsearchable, get lost, and do not survive a person leaving the lab.

---

## 2. PRODUCT AND OFFERING

### What are the product capabilities?

- Keep notes, methods, experiments, structures, sequences, and files in one local workspace.
- Draw and search chemical structures (Chemistry Workbench).
- Plan and inspect cloning and sequences (sequence editor).
- Run validated statistics and make figures (Data Hub).
- Build custom lab calculators and reuse method templates.
- Collaborate in real time and send one-time encrypted copies between researchers.
- Annotate photos, version notes, and recover prior states.
- Sync and back up the work you choose, to optional cloud storage.

### What are the product features?

- A local folder of plain files (the File System Access API), readable with or without ResearchOS.
- A CRDT-backed editing and history model (Loro) for notes, version control, and collaboration.
- Ketcher plus RDKit for chemistry, with PubChem import and literature search.
- A SnapGene-style sequence surface for cloning workflows.
- A native-JavaScript statistics engine, with every test checked against scipy, R, and Prism.
- End-to-end encrypted, transient sharing and a Cloudflare relay that never permanently stores data.
- A public /transparency page that recomputes Tm, alignment, and digest results against Biopython and primer3.
- Metered, cost-recovery cloud storage on Cloudflare R2 with a hard cost circuit breaker.

### What are the product benefits?

- You own your research, because it lives on your disk as files you can open anywhere.
- You stop paying per seat, because the app and every feature are free.
- You replace several expensive tools with one, which removes the stack of licenses.
- You can answer the compliance question honestly, because the data never has to leave your machine.
- You can trust the numbers in your paper, because the math is open and validated in public.
- You are never locked in, because export is the default state, not a panic button.
- You keep working offline, because nothing depends on a server being up.

### Key Unique Attributes

- Local-first by architecture, not as a feature toggle. The folder is the source of truth.
- Free and open source under AGPLv3, so the trust is verifiable, not promised.
- Solidarity pricing, where individuals and labs pay only what storage costs and larger institutions pay a little more to keep it free for everyone else.
- Public, reproducible validation of the science (the /transparency page), which closed competitors cannot match.
- One workspace that spans chemistry, sequences, stats, and the notebook, backed by a real Wisconsin LLC.
- A friendly, non-corporate brand (BeakerBot, Made in Madison) in a category full of cold enterprise tools.

### Embedded Value (and Proof)

- Grew out of work begun during a UW-Madison Distinguished Research Fellowship.
- The /transparency page shows our Tm, alignment, digest, and translation results matching Biopython and primer3, with the comparison run as a test gate.
- Open source on GitHub, so anyone can read exactly how their data is stored and computed.
- A real merchant of record with banking and Stripe set up, so paid storage, when it turns on, is accountable rather than a hobby link.
- A cost circuit breaker that pauses cloud writes before a runaway bill, which the local-first app survives with zero interruption.

### How does the product work?

1. The researcher opens a folder on their own computer. ResearchOS reads and writes that folder, and that folder is always the original.
2. They work locally, with the notebook, chemistry, sequences, stats, and calculators, fully offline if they want.
3. They optionally turn on cloud storage to sync, share a one-time copy, or co-edit with a collaborator.
4. A lab head can invite members into a shared pool, where only the PI pays and members never see a bill.
5. If they ever leave, they export their own work as a portable folder and take it with them.

### What does it look like?

- A clean desktop-style workspace in the browser (Chrome or Edge), local-first, light or dark.
- A friendly BeakerBot intro and mascot, with a pastel-rainbow liquid as the signature mark.
- Plain files and folders on disk that the researcher can browse outside the app.
- A public marketing site, a /transparency proof page, a /pricing page, and an open GitHub repository.

---

## 3. MARKET / PRODUCT CATEGORY / FRAME OF REFERENCE

### Market Category

- Electronic Lab Notebook (ELN)
- Research Data Management (RDM)
- Local-first / own-your-data software
- Open-source scientific software
- Bioinformatics and cheminformatics tooling
- Scientific data analysis and visualization
- Academic research collaboration tools

### Relevant Trends

- NIH and funder data-management-and-sharing mandates are pushing every lab to have a real plan for where data lives and how it is retained.
- Researchers and institutions are increasingly wary of vendor lock-in after price hikes and acquisitions in the ELN space.
- The local-first software movement is making "your data on your device" a credible, modern architecture rather than a downgrade.
- Open-source and reproducibility norms are rising in science, and closed black-box tools are losing trust.
- University budgets are tightening, and per-seat SaaS that scales with headcount is hard to sustain.
- AI assistance in research workflows is growing, which makes owning your own structured data more valuable, not less.
- Researchers expect consumer-grade, friendly software, not the cold enterprise tools the category has shipped for years.

---

## 4. COMPETITIVE ALTERNATIVES

If ResearchOS did not exist, researchers would fall back on a mix of paid notebooks, single-purpose tools, and do-it-yourself folders.

### Direct competitors (same job, same kind of solution: an ELN)

Most ELN vendors are global, sold into universities worldwide, so the meaningful split is by scale of buyer rather than by region.

- **Global vendors**: LabArchives, Benchling, eLabNext (eLabJournal), SciNote, RSpace, Labguru, Labfolder.
- **National / institutional**: university-run or department-built notebooks, OneNote templates blessed by a core facility, LabArchives institutional site licenses.
- **Regional**: localized resellers and institution-specific deployments of the global vendors above (the product is the same, the contract is local).

How they fall short:

- **LabArchives** offers a mature, compliance-friendly ELN and is widely site-licensed. It falls short because it bills around $330 per user per year, holds your data in its cloud, and makes leaving a migration project. The data was never really yours.
- **Benchling** offers a polished, powerful platform for molecular biology with strong cloud collaboration. It falls short because the free academic tier is the hook for cloud lock-in, your data lives on their servers, and pricing for anything beyond the basics climbs fast. You trade ownership for convenience.
- **SciNote, RSpace, eLabNext, Labguru, Labfolder** offer competent cloud ELNs with their own niches. They fall short on the same axis: per-seat or per-institution subscriptions, data held in a vendor cloud, and no public, verifiable proof of correctness for any science they compute.

### Secondary competitors (same job, different solution: the single-purpose tools ResearchOS folds in)

- **SnapGene** (~$1625 flat) for cloning and sequences. Excellent at its one job, but it is a separate paid license and does nothing for the rest of the notebook.
- **GraphPad Prism** (~$1000s) for statistics and figures. Trusted and capable, but closed, expensive, and unverifiable from the outside.
- **ChemDraw** for chemical structures. The category standard, and priced like it, for one slice of the workflow.
- **Quartzy** (~$1908 flat) for inventory and ordering. Useful, but yet another standalone subscription bolted onto the lab.
- They all fall short the same way: each solves one slice, each carries its own price and login, and none of them owns the notebook, so the lab still pays for and juggles a stack.

### Indirect competitors (different job, conflicting solution: the do-it-yourself stack)

- **Paper lab notebooks**: cheap and trusted, but unsearchable, easily lost, and gone when a person leaves.
- **OneNote / Notion / Google Docs**: flexible and familiar, but not built for science (no structures, sequences, validated stats, or compliance story) and, for the cloud ones, your data lives on someone else's servers.
- **Raw folders on a shared drive**: free and owned, but unstructured, unsearchable, and impossible to collaborate on safely.
- They fall short because they are not designed for research, so the lab gives up structure, search, validated computation, and a credible compliance answer in exchange for being free or familiar.

---

## How to use this document

- The **messaging framework** (taglines, value props, elevator pitch) is built from sections 0, 2, and 4.
- The **brand rulebook** voice and tone section points back here for what we stand for.
- All **site copy** (landing, /pricing, footer, wiki) should ladder up to the positioning statement and the differentiators in section 2.
- When a competitor or price changes, update section 4 here first, then [BILLING_FACTS.md](BILLING_FACTS.md) and the live copy.
