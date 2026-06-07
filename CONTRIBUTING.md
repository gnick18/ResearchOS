# Contributing to ResearchOS

Thanks for taking an interest in ResearchOS. It is a local-first, open-source research workspace, and it gets better when working scientists and developers pitch in. Bug reports, feature ideas, documentation fixes, and code are all welcome.

Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before opening an issue or a pull request.

## Ways to help

- **Report a bug.** Open an [issue](https://github.com/gnick18/ResearchOS/issues) with what you did, what you expected, and what happened. Browser and OS help a lot, since ResearchOS leans on the File System Access API (Chrome and Edge are the tested browsers).
- **Suggest a feature.** Open an issue and describe the workflow you want. Concrete bench or lab-management scenarios are the most useful.
- **Fix something small.** Typos, docs, and clear bugs are great first contributions. Look at the [good first issues](https://github.com/gnick18/ResearchOS/labels/good%20first%20issue).
- **Write code.** See the setup and workflow below.

## Local setup

```bash
git clone https://github.com/gnick18/ResearchOS.git
cd ResearchOS/frontend
npm install
npm run dev                 # http://localhost:3000
```

Open the app in Chrome or Edge, then connect an empty folder on your machine. The app is fully client-side, so you do not need any environment variables or a server account to develop the core features.

## Before you open a pull request

Run the same checks CI runs, from the `frontend/` directory:

```bash
cd frontend
npm test                    # vitest unit tests
npm run test:e2e            # Playwright end-to-end against the dev server
npx tsc --noEmit            # type check
npm run lint                # eslint, expect 0 errors on main
```

CI runs all four on every push to `main` and on every pull request. Coverage reports and Playwright traces are uploaded as workflow artifacts.

## Working with the codebase

- `AGENTS.md` documents repo conventions, known traps, and the development audit trail. Skim it before a larger change.
- New code that touches network paths, IndexedDB writes, or on-disk credential storage should be discussed in an issue first so the privacy and security model stays coherent. `SECURITY_AUDIT.md` and `/wiki/security` describe that model.
- Keep changes scoped. Smaller pull requests are easier to review and land faster.

## License

By contributing, you agree that your contributions are licensed under the GNU Affero General Public License v3.0 or later, the same license as the rest of ResearchOS. See [LICENSE](LICENSE).
