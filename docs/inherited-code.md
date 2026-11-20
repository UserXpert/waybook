# Inherited-code inventory

Waybook's [product identity work](https://github.com/UserXpert/waybook/issues/45) covers naming, supported product claims and tooling defaults. The [code replacement work](https://github.com/UserXpert/waybook/issues/60) tracks inherited source and the evidence needed before changing its attribution. Renames, edits and package moves alone do not establish independent authorship.

## Baseline comparison

The table compares tracked paths in `waybook-baseline` (`d2e03d7`) with the pre-cleanup release (`f700d90`). Shared paths exist at the same path in both trees. Identical paths have the same Git blob ID. Renamed and edited files still require provenance review.

| Area | Baseline paths | Shared paths | Identical blobs | Use at `f700d90` |
| --- | ---: | ---: | ---: | --- |
| `apps/demo` | 57 | 40 | 24 | Maintained Waybook app and inherited demo material. |
| `apps/docs` | 89 | 89 | 38 | Historical toolkit reference and static registry generation. |
| `packages/core` | 45 | 45 | 36 | Waybook computes persisted availability with `getAvailableSlots`. |
| `packages/db` | 23 | 23 | 15 | Waybook uses `createWaybookSql` for Control and tenant database connections. The workspace also contains inherited schema utilities. |
| `packages/server` | 41 | 41 | 31 | Provides inherited server tooling and tests. Live Waybook booking mutations call the app-owned transaction-conflict helper in `apps/demo/src/lib/waybook/transaction-conflicts.ts`. |
| `packages/d1` | 27 | 27 | 12 | Standalone inherited workspace built and tested with the repo. The Waybook app uses PostgreSQL. |
| `packages/cli` | 12 | 12 | 5 | Private component tooling; the registry generator reads the CLI registry definitions. |
| `registry/ui` | 47 | 47 | 37 | Inherited components used by the CLI and static registry tooling. Waybook's app-owned components live under `apps/demo/src/components`. |

Reproduce the path inventory with `git ls-tree -r waybook-baseline` and `git ls-tree -r f700d90`. Follow imports, workspace dependencies, tests, and registry-generation inputs before removing a group. An identical blob proves the file is unchanged at that path. A different blob can still contain inherited implementation.

## Completed technical slices

- [PR #100](https://github.com/UserXpert/waybook/pull/100) removed the unmounted demo gallery and D1 adapter and moved live database connections to the app-owned PostgreSQL connector.
- [PR #101](https://github.com/UserXpert/waybook/pull/101) replaced live booking and calendar availability. The maintained app builds without the inherited core, server, and database workspaces. Its desktop and mobile release tests remain under `apps/demo/e2e/waybook-tests/`.
- [PR #102](https://github.com/UserXpert/waybook/pull/102) retired the inherited CLI, component registry, and Astro reference site. The [historical reference index](archive/README.md) points to the preserved source and notes at their last revision. The standalone inherited core and server workspaces were also retired after live availability and retry handling moved into the app.
- [PR #103](https://github.com/UserXpert/waybook/pull/103) retired the legacy Drizzle workspace. The Waybook migration runner and all 56 Control and tenant SQL files moved to `database/waybook/` with unchanged filenames and Git blobs. The [release workflow](../.waybook/docs/11_local_release_workflow.md) governs migration and recovery operations.
- [PR #104](https://github.com/UserXpert/waybook/pull/104) replaced the browser icons with the Waybook mark from `apps/demo/public/brand/waybook-logo.svg` and retired the inherited preview assets and generator.
- [PR #105](https://github.com/UserXpert/waybook/pull/105) removed the stylesheet for retired marketing and demo screens. Current login, Control, operations and booking screens use a small shared Waybook page baseline. The unused inherited local setup, class helper and generated test state were retired.
- The root TypeScript preset was unused after the toolkit workspaces were retired. The application retains its own TypeScript configuration. The repository owner is the current GitHub code owner.

## Replacement and verification

- Keep current product setup and release guidance in the [Waybook documentation index](README.md).
- The package gate builds the app and runs its unit suite. PostgreSQL integration exercises the Waybook migration runner against disposable databases. Browser E2E and schema-history gates remain in place.
- Retain [the inherited notice](../THIRD_PARTY_NOTICES.md) during the transition. Notice removal and any ownership or licensing changes remain subject to the provenance and qualified legal review in #60.

## Evidence for licensing review

- Compare the imported baseline `d2e03d78f610ba967dbfa0acadafd441bf9ae1bb` with the current source tree. The merged PRs above contain the source and release evidence. The archive index pins the last toolkit revision and its notice. The `archive/lab-reconciled-20261121` tag also retains its original MIT `LICENSE`. The imported Git history remains reachable.
- After the TypeScript preset and code-owner changes, the remaining exact same-path matches with the imported baseline are the generated Next.js declaration file and the application ignore rules for Playwright output. Shared boilerplate also remains in build configuration and workflows. These comparisons help locate overlap and require provenance review alongside the implementation and asset history.
- GitHub reported the repository as private during this review. Issue #60 documents an earlier public period. Confirm what was distributed through source snapshots, clones, tags, releases and prior deployments, and which notices must accompany those copies.
- Inspect the exact release artifact and its shipped dependencies and assets. Start from `package-lock.json`, the application dependency manifest and the production build. Include bundled browser code, the optional native image libraries used by Sharp, and the Poppins font loaded by the app. Package metadata is inventory evidence.
- Ask the qualified reviewer to record which current source or artifacts may omit the Booking Kit notice, where historical notices must stay, and which terms apply to the owner's original contributions. Record the reviewed commit and artifacts before updating the current notice or closing #60.
