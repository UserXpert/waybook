# Release-branch collector

The collector runs every 30 minutes and may append explicitly human-marked PRs to `release/ready`. It never merges or deploys `main`.

## Eligibility

- A human applies the `release-ready` label after review.
- The PR is open, non-draft, targets `main`, and comes from `UserXpert/waybook` (not a fork).
- Its exact current head SHA has successful Package Checks, E2E Tests, DB Integration Tests, Schema history guard, and Vercel preview checks.
- Duplicate heads, stale heads, already-collected heads, and merge conflicts are skipped and logged. A conflict aborts only that tentative merge; existing release-branch history is never reset or force-pushed.

The job checks out and executes only the trusted `release/ready` branch workflow/script. It fetches candidate commit objects but never executes candidate PR code.

## Human release gate

A maintainer must create the first non-draft `release/ready` → `main` pull request. The repository currently does not allow `GITHUB_TOKEN` to create pull requests, so the collector deliberately exits without pushing until that PR exists. It also never creates or approves a PR.

After collection, a human reviews that release PR and merges it. The normal `main` push then runs Package, E2E, and integration CI and triggers the normal Vercel production deployment. The collector's `GITHUB_TOKEN` push does **not** trigger ordinary `push` workflows; it is not evidence that combined CI or preview checks ran. Review/CI approval on the manually created release PR is required before merging.

## Operational limitations

- Workflow-level `contents: write` is required solely to append to the existing release branch. No repository Actions setting, PAT, secret, branch protection, or production configuration is changed by this workflow.
- If repository policy prevents the workflow token from pushing despite that narrow permission, an administrator must explicitly authorize that write capability or run the documented collection manually. Do not add a PAT as a workaround without a separate security decision.
- The collector treats the named required checks as a conservative release-readiness policy. Branch protection remains the authority for merge requirements.
