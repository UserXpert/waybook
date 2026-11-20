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

- PR #100 removed the unmounted demo gallery and D1 adapter and moved live database connections to the app-owned PostgreSQL connector.
- PR #101 replaced live booking and calendar availability. The maintained app builds without the inherited core, server, and database workspaces. Its desktop and mobile release tests remain under `apps/demo/e2e/waybook-tests/`.
- The inherited CLI, component registry, and Astro reference site have been retired together. The [historical reference index](archive/README.md) points to the preserved source and notes at their last revision. The active repository no longer builds or publishes the registry.

## Replacement and verification

- Keep current product setup and release guidance in the [Waybook documentation index](README.md).
- The inherited core and server packages remain in the workspace and CI. Review their remaining tooling consumers before retirement.
- Keep the live Control and tenant migration runner, checked SQL history, and PostgreSQL tests together. Verify database setup and existing-schema upgrades on isolated data under the [release workflow](../.waybook/docs/11_local_release_workflow.md) before removing the legacy database workspace.
- Retain [the inherited notice](../THIRD_PARTY_NOTICES.md) during the transition. Notice removal and any ownership or licensing changes remain subject to the provenance and qualified legal review in #60.
