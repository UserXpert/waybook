import { type TenantRecord } from "@/lib/waybook/database";
import { outstandingStaffAccessRequests } from "@/lib/waybook/staff-access-requests";
import { StaffAccessRequestPanel } from "./staff-access-request-review";

export async function StaffAccessRequests({ tenant }: { tenant: TenantRecord }) {
  return <StaffAccessRequestPanel requests={await outstandingStaffAccessRequests(tenant)} />;
}
