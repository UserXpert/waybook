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
| Client records | Client forms collect contact details. They reject submissions containing free-text notes or tags. The profile, directory and client lookup omit the historical notes and tags. | Decide how previously stored values should be inventoried, retained, corrected or deleted. |
| Waitlist and checkout | Waitlist, appointment payment/refund, gift card and retail collection forms reject free-text notes. The workspace views omit the historical note fields. Appointment dates, service choices, waitlist availability and the payment ledger still use their existing operational fields. | Verify what references the pilot needs for accounting and reconcile any historical notes under the agreed retention procedure. |
| Staff profiles and availability | Staff profile forms reject internal notes, and staff time-off forms collect dates and times without an open-text reason. Staff photos remain separately validated and access-controlled. | Verify actual users, photo and access lifecycle, and what to do with previously stored notes and absence reasons. |
| Email delivery | The outbox can persist a rendered delivery snapshot containing recipient, sender, subject and message text once delivery is attempted. | Determine provider terms, delivery retention, retry visibility and removal from application, provider and backup copies. |
| Tenant-facing reporting | Client names and services can appear in staff-facing reports and sales/client records. Those views omit historical internal payment notes. | Define role visibility, reporting retention, export handling and the supported correction/deletion process. |

The note changes in issue #15 leave historical database values intact. Review
those values, any historical audit payloads, and backup retention as part of the
data-lifecycle decision in issue #13. Workspace-level content such as service
names and descriptions, closure labels and booking policy text remains editable
for its operational purpose. Review the actual pilot content and image use
before admitting real client data.

Workspace owners can select client or patient and staff or practitioner in
Settings. Migration `0056_tenant_terminology.sql` stores those choices per
tenant. The existing client and staff terms remain the default. The labels
do not change access rules, data fields or how appointment information may be
classified.

### Source-review boundaries

- This review found no tenant self-service personal-data export or deletion
  route in the maintained application pages and public API directories. That is
  a gap to resolve, not proof that a separate administrative process does not
  exist.
- General notes on the affected record forms are blocked at submission. Other
  fields, including names and editable catalogue text, can still be misused to
  include sensitive information. Check how those fields are used in the pilot.
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
