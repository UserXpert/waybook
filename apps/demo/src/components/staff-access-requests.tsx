import { type TenantRecord } from "@/lib/waybook/database";
import { pendingStaffAccessRequests } from "@/lib/waybook/staff-access-requests";
import { StaffAccessRequestReview } from "./staff-access-request-review";

export async function StaffAccessRequests({ tenant }: { tenant: TenantRecord }) {
  const requests = await pendingStaffAccessRequests(tenant);
  if (!requests.length) return null;
  return (
    <section className="waybook-data-card staff-access-requests" aria-labelledby="staff-access-requests-title">
      <div className="waybook-section-heading">
        <div>
          <h2 id="staff-access-requests-title">Staff access requests</h2>
          <p>Check each request. Granting access creates a one-time invitation for you to share.</p>
        </div>
      </div>
      <ul>
        {requests.map(request => <StaffAccessRequestReview key={request.id} request={request} />)}
      </ul>
    </section>
  );
}
