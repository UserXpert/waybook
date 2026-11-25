# Contributing to Waybook

Waybook is a Denmark-first booking operations application. Start with the [README](.waybook/docs/project_overview.md), [product manifest](.waybook/docs/00_manifest.md), and [delivery backlog](.waybook/docs/07_delivery_backlog.md) before changing behavior.

## Development

Use Node.js 22.12 or later, npm, and PostgreSQL. Follow the local setup in the README; verify database URLs point to disposable local databases before running migrations or seeds.

```sh
npm ci
npm run waybook:build
npm test --workspace=@waybook/app
```

Run focused package tests for shared scheduling or server changes. Database and browser tests require isolated test databases; the GitHub workflows document their setup. A passing local build alone does not establish hosted or pilot readiness.

## Changes and review

- Keep tenant isolation, role authorization, booking concurrency, and transactional audit behavior intact.
- Add meaningful tests for behavior changes and verify affected user flows at desktop and mobile sizes.
- Keep documentation and the relevant GitHub issue current; distinguish implemented behavior from planned features.
- Use a pull request and wait for package, integration, and E2E checks. Review migrations and deployment effects before merging.
- Preserve the copyright and permission notices in [LICENSE](LICENSE) and other applicable third-party notices.

Do not run production seeds or migrations from a development environment. Follow the [pilot readiness record](.waybook/docs/08_pilot_readiness.md) for release gates.
