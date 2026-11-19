# Denmark pilot privacy review — preliminary, open

This is an engineering inventory for issue #13, not legal approval or a complete record of processing. The pilot business, actual configuration and contracts must be reviewed with qualified Danish/EU counsel before real client data is admitted.

As of 2026-11-19, Waybook's operating and contracting legal entity has not been decided. Continue preparatory work, then identify the entity and complete the applicable agreements, notices and legal review before the pilot or release involving real client data.

## Data and locations to assess

| Data | Evidence in repository | Outstanding verification |
| --- | --- | --- |
| Account identity, sessions, memberships and platform audit | Control migration `0001_control.sql` | Actual operational access, session lifetime, log content, retention and deletion |
| Staff identity, email, phone, profile notes and photo | Tenant migrations `0001_operational.sql`, `0004_staff_profiles.sql`, `0051_staff_photos.sql` | Appropriate access, photo lifecycle, retention and deletion across copies |
| Client contact details and free-text notes | Tenant migrations `0001_operational.sql`, `0008_customer_notes_tags.sql` | Free text can contain sensitive information; warnings alone are not a technical prevention control. Determine safeguards and retention |
| Appointments, services, booking events and tenant audit | Tenant migration `0001_operational.sql` | Classify real pilot data, including potentially revealing service names; confirm access, retention and exports |
| Email outbox payloads and management tokens | Tenant migration `0001_operational.sql` | Determine payload contents, delivery provider, token lifetime and removal; manual communication is the pilot plan |
| Payment, refund, gift-card and package records | Tenant commerce migrations, including `0052_booking_gift_card_tender.sql` | Identify personal information, accounting retention, processor flows and deletion limits |
| Infrastructure, backups, logs and support copies | Vercel and Neon are the current hosting direction | Inventory actual providers, subprocessors, regions, transfer mechanisms, access, retention and deletion; a function/database region alone does not establish end-to-end residency |

The schema demonstrates possible storage, not that every feature is enabled or every field is populated in the pilot. Complete an inventory of actual flows, recipients, integrations and copies before signing off.

## Decisions and evidence required before pilot

- Identify Waybook's contracting entity and the pilot clinic; determine controller and processor roles for each purpose, document processing instructions and execute applicable agreements. Roles depend on actual purposes and activities ([Datatilsynet](https://www.datatilsynet.dk/regler-og-vejledning/grundlaeggende-begreber/rollefordeling-dataansvarlig-og-databehandler)).
- Have counsel assess the Article 6 basis and, where applicable, the Article 9 condition and Danish requirements for each purpose. A clinic appointment or service can reveal health information even without a diagnosis or clinical note; the operations-only product boundary does not settle classification ([GDPR recital 35](https://eur-lex.europa.eu/eli/reg/2016/679)). Assess whether a DPIA is required.
- Complete processor/subprocessor terms, international-transfer assessment, customer-facing notices, staff notice and an accurate record of processing. Verify the actual deployed provider configuration and data locations rather than relying on intended regions.
- Agree defensible retention periods and responsibilities for each class of data, including audit, financial records, backups, logs and support material. Verify tenant-scoped export, correction and deletion procedures, including permitted exceptions and backup expiry; none is signed off here.
- Verify least-privilege access, staff-photo and tenant boundaries, audit coverage, incident contacts, breach notification responsibilities and an incident exercise. See `09_pilot_support_runbook.md`; its draft is not an exercised incident plan.
- Record counsel's review, accountable owner, approved pilot scope, remaining risks and evidence links. Keep issue #13 and the pilot gate open until these checks are complete.
