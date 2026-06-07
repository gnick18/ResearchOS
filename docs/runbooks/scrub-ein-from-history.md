# Runbook: scrub the EIN + bank-4 from git history

Status: prepared 2026-06-05, run later in a maintenance window. DESTRUCTIVE,
read the whole thing first.

The EIN and a bank last-4 were briefly committed to source. They are already
removed from the latest tree (commits removing them are on main). This purges
them from the rest of history. It rewrites commit SHAs from the point they were
introduced, so it requires a force-push and a coordinated re-sync.

IMPORTANT: this file is in the public repo, so it contains NO real values, only
placeholders. You substitute the real EIN and bank-4 in a LOCAL file that is
never committed.

## Before you start

- Confirm `git-filter-repo` is installed (`git filter-repo --version`). If not,
  `brew install git-filter-repo`.
- Pick a QUIET window. There are many active worktrees; a force-push makes every
  one of them diverge. The clean way is to first make sure all in-flight work is
  merged to main (or captured), so nothing important is sitting only on a local
  branch off the old history.
- The mirror clone in step 1 doubles as your backup of the pre-scrub state. Keep
  it until you have confirmed everything works.

## Steps

1. Note the remote URL and make a fresh mirror clone (this is the working copy
   AND the backup):

   ```bash
   ORIGIN=$(git -C ~/Desktop/ResearchOS remote get-url origin)
   git clone --mirror "$ORIGIN" /tmp/ros-scrub.git
   cd /tmp/ros-scrub.git
   ```

2. Create the replacements file LOCALLY (never commit it). Substitute your real
   EIN for `YOUR_EIN_HERE` and your bank last-4 for `LAST4`:

   ```bash
   cat > /tmp/scrub-expr.txt <<'EOF'
   YOUR_EIN_HERE==>REDACTED-EIN
   LAST4 (Stripe payouts==>XXXX (Stripe payouts
   EOF
   ```

   The first line catches the EIN in both file contents and commit messages. The
   second catches the bank-4 by its unique surrounding text, so it never touches
   the unrelated `.hmm` data files that happen to contain "9490".

3. Run the rewrite over blobs AND commit messages:

   ```bash
   git filter-repo --replace-text /tmp/scrub-expr.txt --replace-message /tmp/scrub-expr.txt --force
   ```

4. Verify it is gone from all of history (both should print nothing):

   ```bash
   git log --all -S "YOUR_EIN_HERE" --oneline
   git log --all --grep "YOUR_EIN_HERE" --oneline
   ```

5. Force-push the rewritten history. filter-repo removes the `origin` remote on
   purpose, so re-add it first:

   ```bash
   git remote add origin "$ORIGIN"
   git push --force --all origin
   git push --force --tags origin
   ```

6. Re-sync everything that points at the old history:
   - Your main checkout: `cd ~/Desktop/ResearchOS && git fetch origin && git reset --hard origin/main` (this discards any local divergence on main, so make sure main was pushed/merged first).
   - Every worktree with unmerged commits off the old history: cherry-pick that work onto the new main, or recreate the branch from the new main. Any branch still on the old commits will RE-INTRODUCE the EIN if pushed, so do not push stale branches.
   - Anyone else who cloned, and any fork, must re-clone. Delete forks you control.

7. Ask GitHub to purge caches. After a force-push, the old commit SHAs can still
   be reachable by direct URL until GitHub garbage-collects them. Open a GitHub
   Support request to expire/purge the old commits, and confirm the old SHA URLs
   404.

8. Cleanup:

   ```bash
   rm /tmp/scrub-expr.txt          # it has your real EIN
   # keep /tmp/ros-scrub.git until you have confirmed everything works, then:
   # rm -rf /tmp/ros-scrub.git
   ```

## Honest caveats

- This is irreversible on the remote once force-pushed. The mirror in /tmp is
  your only rollback, do not delete it until you are sure.
- A scrub is never 100%. Anyone who already cloned or forked, and any cached
  view, keeps the old data. An EIN cannot be rotated like a password, so treat
  it as having been exposed regardless, and watch for business-identity or
  tax-refund fraud (unexpected IRS notices, accounts opened in the LLC name).
- Run only when the parallel work is paused/merged. Mid-flight, this will
  scramble active sessions.
