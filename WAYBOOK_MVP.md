# Waybook documentation entry point

Waybook documentation is deliberately decoupled to keep implementation context small while preserving factual consistency.

Start with [`.waybook/docs/00_manifest.md`](.waybook/docs/00_manifest.md). Then read **only** the topic document selected by its routing table, and update only that document after a meaningful change. Do not load the entire tree for a small feature.

The canonical documents are:

- [`00_manifest.md`](.waybook/docs/00_manifest.md) — current ledger and document-routing rules.
- [`01_architecture.md`](.waybook/docs/01_architecture.md) — topology, routing, tenancy, and security.
- [`02_auth_provisioning.md`](.waybook/docs/02_auth_provisioning.md) — identity, Better Auth, invitations, and business provisioning.
- [`03_booking_engine.md`](.waybook/docs/03_booking_engine.md) — availability, holds, confirmations, DST, and booking invariants.
- [`04_modules_ledger.md`](.waybook/docs/04_modules_ledger.md) — Control, dashboards, public UI, entitlements, and module proof.

Keep `waybook-baseline` unchanged.
