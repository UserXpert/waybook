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

## Current technical-flow inventory — not a retention or compliance decision

The following is a source review of the maintained application at the time of
this document. It is intended to make the outstanding operational questions
testable; it is not an assertion that a field is appropriate to collect, that a
flow is enabled for every tenant, or that any legal obligation is met.

| Flow | Observed collection, storage or presentation path | Operational gap still requiring a decision or verification |
| --- | --- | --- |
| Public booking | The maintained public booking form collects name, email and optional phone, plus a versioned policy acknowledgement when configured. It does not expose a free-text note or file input in that flow. | Confirm the approved booking fields and service naming for the actual pilot; a service or appointment can still reveal health information. |
| Client records | Manager-authorized client forms collect contact details, tags and an `internal_notes` value. The client drawer displays those notes to authorized workspace users; the audit event records the changed field names rather than the note body. | Set permitted note content, access, retention, correction and deletion procedures. A UI label or warning would not technically prevent sensitive content. |
| Waitlist and staff-entered operational context | A manager can store a bounded waitlist note (1,000 characters); payment and gift-card forms accept bounded internal notes (500 characters). These notes are displayed in relevant staff-facing lists and records. | Decide whether each free-text field is needed for the pilot, define the operational guidance and establish retention/deletion behaviour before real data use. |
| Staff profiles | Staff details include contact fields, role/profile data and internal notes; staff photos are separately validated and access-controlled. | Verify actual users, access lifecycle, photo deletion and backup expiry. |
| Email delivery | The outbox can persist a rendered delivery snapshot containing recipient, sender, subject and message text once delivery is attempted. | Determine provider terms, delivery retention, retry visibility and removal from application, provider and backup copies. |
| Tenant-facing reporting | Client names, services and selected payment notes can appear in staff-facing reports and sales/client records. | Define role visibility, reporting retention, export handling and the supported correction/deletion process. |

### Source-review boundaries

- This review found no tenant self-service personal-data export or deletion
  route in the maintained application pages and public API directories. That is
  a gap to resolve, not proof that a separate administrative process does not
  exist.
- The current operational boundary excludes clinical records, but ordinary
  free-text fields remain capable of receiving sensitive information. Do not
  represent wording, character limits or the operations-only scope as a
  technical sensitive-data prevention control.
- Backups, provider copies, runtime logs and support material are outside the
  application schema review. Their actual retention and deletion behaviour must
  be verified from the deployed providers and agreed operating procedures.

## Decisions and evidence required before pilot

- Identify Waybook's contracting entity and the pilot clinic; determine controller and processor roles for each purpose, document processing instructions and execute applicable agreements. Roles depend on actual purposes and activities ([Datatilsynet](https://www.datatilsynet.dk/regler-og-vejledning/grundlaeggende-begreber/rollefordeling-dataansvarlig-og-databehandler)).
- Have counsel assess the Article 6 basis and, where applicable, the Article 9 condition and Danish requirements for each purpose. A clinic appointment or service can reveal health information even without a diagnosis or clinical note; the operations-only product boundary does not settle classification ([GDPR recital 35](https://eur-lex.europa.eu/eli/reg/2016/679)). Assess whether a DPIA is required.
- Complete processor/subprocessor terms, international-transfer assessment, customer-facing notices, staff notice and an accurate record of processing. Verify the actual deployed provider configuration and data locations rather than relying on intended regions.
- Agree defensible retention periods and responsibilities for each class of data, including audit, financial records, backups, logs and support material. Verify tenant-scoped export, correction and deletion procedures, including permitted exceptions and backup expiry; none is signed off here.
- Verify least-privilege access, staff-photo and tenant boundaries, audit coverage, incident contacts, breach notification responsibilities and an incident exercise. See `09_pilot_support_runbook.md`; its draft is not an exercised incident plan.
- Record counsel's review, accountable owner, approved pilot scope, remaining risks and evidence links. Keep issue #13 and the pilot gate open until these checks are complete.
