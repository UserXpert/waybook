# Waybook documentation

Start with the [main README](../README.md) for product context, setup and the release workflow. Waybook is in development; the [delivery backlog](../.waybook/docs/07_delivery_backlog.md) and [pilot readiness record](../.waybook/docs/08_pilot_readiness.md) distinguish implemented and verified work from open items.

## Find the right document

| If you need to… | Start here |
| --- | --- |
| Set up locally, test or release | [Developer onboarding](../README.md#developer-onboarding) and [local-to-production workflow](../.waybook/docs/11_local_release_workflow.md) |
| Understand current product decisions and document ownership | [Manifest and routing guide](../.waybook/docs/00_manifest.md) and [documentation entry point](../WAYBOOK_MVP.md) |
| Understand tenant boundaries, data and routing | [Architecture](../.waybook/docs/01_architecture.md) |
| Work on identity, permissions or onboarding | [Authentication and provisioning](../.waybook/docs/02_auth_provisioning.md) |
| Change availability, booking holds or scheduling | [Booking engine](../.waybook/docs/03_booking_engine.md) |
| Find module behavior and verification | [Modules ledger](../.waybook/docs/04_modules_ledger.md) |
| Work on sales, packages, gift cards or payments | [Commerce foundation](../.waybook/docs/05_commerce_foundation.md) |
| Prioritize work or assess the pilot | [Delivery backlog](../.waybook/docs/07_delivery_backlog.md) and [pilot readiness](../.waybook/docs/08_pilot_readiness.md) |
| Handle support, recovery or email operations | [Pilot support runbook](../.waybook/docs/09_pilot_support_runbook.md) and [email delivery operations](../.waybook/docs/email_delivery_operations.md) |
| Review Denmark-first privacy requirements | [Privacy review](../.waybook/docs/10_denmark_privacy_review.md) |
| Contribute or work with coding agents | [Contributing](../CONTRIBUTING.md), [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md) |

The authoritative topic files remain under `.waybook/docs/` so existing links and workflows continue to work. Read only the files relevant to your task and update the owning document and GitHub issue when behavior or evidence changes.

## Historical material

Current hosting and pilot decisions are recorded in the manifest and readiness documents. The [AWS/RDS cutover note](../.waybook/docs/06_aws_rds_cutover.md) remains a historical Waybook decision record.
