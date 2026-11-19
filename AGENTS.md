<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Form-field typography

- Never use bold text inside form fields. Entered values, placeholders, and selected dropdown values should use regular font weight; labels may be emphasized.

## Waybook development and release process

For implementation, release, or local-server work, follow [.waybook/docs/11_local_release_workflow.md](.waybook/docs/11_local_release_workflow.md):

- Before changing code, identify the actual checkout, branch, working-tree changes, and running server. Use `/Users/amit/Documents/Waybook` as the normal local checkout on this Mac, or a task worktree based on current `UserXpert/waybook` main. Preserve uncommitted work in every checkout.
- For parity checks run `npm run waybook:release:check` in the normal checkout. It compares its commit and dirty state with GitHub main, Vercel production, and the port 3333 server checkout. A feature branch is expected to differ before release; an unavailable check is not proof of alignment.
- Make changes on a task branch and track them in the relevant GitHub issue. Use a pull request and the required package, database integration, E2E, and migration-history checks. Verify affected UI flows on desktop and mobile; preserve production booking, authorization, tenant, and transactional invariants.
- A merge to main triggers production deployment. Before merging, review schema, configuration, data, rollback, and preview implications. After merging, verify the deployed commit and affected user-facing flow; report separately what is local, on GitHub, and in production. Never describe a change as deployed based only on a successful build or a different checkout.
- Code parity does not imply data or browser-preference parity. Do not copy, seed, or change production data to make it resemble local data. Use read-only schema checks and follow the database safeguards in the workflow. Do not silently apply schema changes during hosted builds or app startup. Preserve migration history and investigate unexpected records before schema writes.
- Keep issues open until their acceptance criteria and verification are complete. If a check, preview, database reconciliation, or production verification is incomplete, record the limitation instead of claiming completion.
