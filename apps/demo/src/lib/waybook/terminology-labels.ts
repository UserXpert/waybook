export type ClientTerm = "client" | "patient";
export type StaffTerm = "staff" | "practitioner";
export type TerminologyPreferences = { clientTerm: ClientTerm; staffTerm: StaffTerm };

export function isClientTerm(value: unknown): value is ClientTerm {
  return value === "client" || value === "patient";
}

export function isStaffTerm(value: unknown): value is StaffTerm {
  return value === "staff" || value === "practitioner";
}

export function terminologyLabels(clientTerm: unknown, staffTerm: unknown) {
  return {
    client: clientTerm === "patient" ? "patient" : "client",
    clients: clientTerm === "patient" ? "patients" : "clients",
    staff: staffTerm === "practitioner" ? "practitioner" : "staff",
    staffPlural: staffTerm === "practitioner" ? "practitioners" : "staff",
    staffMember: staffTerm === "practitioner" ? "practitioner" : "staff member",
    staffMembers: staffTerm === "practitioner" ? "practitioners" : "staff members",
  } as const;
}

export type TenantTerminology = ReturnType<typeof terminologyLabels>;
export const defaultTenantTerminology = terminologyLabels("client", "staff");

export function titleTerminology(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}
