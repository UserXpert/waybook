# @waybook/cli

Private workspace CLI for inspecting and copying reference components and running the toolkit’s migration commands.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

This package is private to the Waybook workspace. It reads component sources from this repository. An explicit HTTPS registry URL is required when a component source is unavailable locally.

## Install

This package is currently private. From this workspace, build it and use its
`waybook` executable:

```bash
npm run build --workspace=@waybook/cli
./node_modules/.bin/waybook --help
```

## Quick Start

```bash
# Initialize a new project with config and env template
waybook init

# Add a UI component (shadcn/ui convention — you own the source)
waybook add booking-calendar

# List all available components
waybook list

# Run pending database migrations
waybook migrate
```

## Key Features

- **Component Registry** — Browse and add from 21+ React components and hooks
- **Dependency Resolution** — Automatically adds required component dependencies
- **Project Init** — Generates `waybook.config.ts` and `.env.local`
- **Migration Management** — Parse, list pending, and run database migrations
- **Manifest Tracking** — Tracks added components and detects local modifications
- **Copy-Paste Convention** — Components are copied into your project; you own and customize the source

## Documentation

Run `waybook --help` for the available commands. The legacy `thebookingkit` executable, project files, and API-key environment variable are still supported. When running from another directory, invoke the built `packages/cli/dist/bin.js` with Node. For the Waybook application’s setup and migration workflow, use the [repository README](../../README.md).

## License

MIT for inherited code. See [third-party notices](../../THIRD_PARTY_NOTICES.md).
