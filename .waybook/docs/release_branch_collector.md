# Release-branch collector

The collector runs every 30 minutes and may append explicitly human-marked PRs to `release/ready`. It never merges or deploys `main`.

## Eligibility

- A human applies the `release-ready` label after review.
- The PR is open, non-draft, targets `main`, and comes from `UserXpert/waybook` (not a fork).
- Its exact current head SHA has successful Package Checks, E2E Tests, DB Integration Tests, and Schema history guard checks. Preview status is intentionally evaluated only for the combined release PR, not every constituent PR.
- Duplicate heads, stale heads, already-collected heads, and merge conflicts are skipped and logged. A conflict aborts only that tentative merge; existing release-branch history is never reset or force-pushed.

The job checks out and executes only the trusted `release/ready` branch workflow/script. It fetches candidate commit objects but never executes candidate PR code.

## Human release gate

A maintainer must bootstrap `release/ready` from current `main` once. The repository currently does not allow `GITHUB_TOKEN` to create pull requests, so the collector never creates or approves a PR. Because an unchanged branch cannot have a pull request, the collector may append the first eligible batch to that branch; a maintainer then opens the first non-draft `release/ready` → `main` pull request. After a release PR is merged, the next run may fast-forward `release/ready` to `main` only when the release tip is already an ancestor of `main`; it can then collect a fresh batch. If `release/ready` is ahead of `main` without an open release PR, it stops until a maintainer opens one. If the histories diverge, it fails closed and never resets or force-pushes.

After a successful collection push, the collector dispatches `Release branch validation` against `release/ready`, passing the exact collected SHA and exact `main` baseline as inputs. GitHub dispatches only branch or tag references, so every validation job first proves its dispatch ref and checkout both equal the requested SHA before it runs any project command. It runs isolated package, schema-history, integration, and E2E jobs with a read-only token and no production secrets. A dispatch is not a successful run; the human release review must wait for those jobs and for the combined release PR's Vercel preview before merging. The collector's `GITHUB_TOKEN` push does **not** trigger ordinary `push` workflows and is not evidence that combined CI or preview checks ran.

## Operational limitations

- Workflow-level `contents: write` is required solely to append to the existing release branch; `actions: write` is required solely to dispatch the read-only validation workflow. No repository Actions setting, PAT, secret, branch protection, or production configuration is changed by this workflow.
- If repository policy prevents the workflow token from pushing despite that narrow permission, an administrator must explicitly authorize that write capability or run the documented collection manually. Do not add a PAT as a workaround without a separate security decision.
- The collector treats the named required checks as a conservative release-readiness policy. Branch protection remains the authority for merge requirements.
- Scheduled GitHub Actions runs are best-effort and may be delayed. A maintainer can use `workflow_dispatch` to request a collection run when timing matters; it does not bypass the same eligibility or release gates.
- The combined jobs intentionally use the existing required-check names, but a workflow-dispatch run is not assumed to satisfy repository rules until an actual release PR shows those contexts as accepted. GitHub may also hold workflows created by a bot-updated PR for approval. Verify both behaviors during the first rollout before treating the automation as a merge gate.
