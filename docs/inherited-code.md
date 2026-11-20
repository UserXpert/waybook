# Inherited-code inventory

Waybook's [product identity work](https://github.com/UserXpert/waybook/issues/45) covers naming, supported product claims and tooling defaults. The [code replacement work](https://github.com/UserXpert/waybook/issues/60) tracks inherited source and the evidence needed before changing its attribution. Renames, edits and package moves alone do not establish independent authorship.

## Baseline comparison

The table compares tracked paths in `waybook-baseline` (`d2e03d7`) with the pre-cleanup release (`f700d90`). Shared paths exist at the same path in both trees. Identical paths have the same Git blob ID. Renamed and edited files still require provenance review.

| Area | Baseline paths | Shared paths | Identical blobs | Current use |
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

## Retirement covered by this review

The old, unmounted demo gallery and its data, action, and Playwright fixtures were removed together. The application still uses `e2e/waybook.config.ts` for the supported desktop and mobile booking checks. The private CLI now reads the workspace registry by default and requires an explicit HTTPS registry for a remote fallback. Legacy CLI names and project files remain for compatibility.

## Replacement and verification

- Keep current product setup and release guidance in the [Waybook documentation index](README.md). The historical site retains existing reference URLs for review.
- Start with disconnected examples. Keep the CLI, registry generator, and docs resources together until their consumers can be retired or mapped to replacements.
- Before replacing live scheduling or transaction code, establish behavioral specifications and regression coverage for availability, daylight saving transitions, holds, retries, concurrency, tenant scope, migrations, and the desktop and mobile booking lifecycle. Use isolated data and the [release workflow](../.waybook/docs/11_local_release_workflow.md).
- Retain [the inherited notice](../THIRD_PARTY_NOTICES.md) during the transition. Notice removal and any ownership or licensing changes remain subject to the provenance and qualified legal review in #60.
