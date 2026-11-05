"use client";

import { usePathname, useRouter } from "next/navigation";

type Props = {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  staffCode: string | null;
  role: string;
  specialty: string | null;
  services: string | null;
  isActive: boolean;
};

export function StaffTableRow({ id, name, email, jobTitle, staffCode, role, specialty, services, isActive }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const open = () => router.push(`${pathname}?employee=${id}`);
  return <tr className="staff-table-row" role="link" tabIndex={0} aria-label={`Open staff details for ${name}`} onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}><td>{name}<small>{jobTitle ?? email}{staffCode ? ` · ${staffCode}` : ""}</small></td><td>{role}<small>{specialty ?? "—"}</small></td><td>{services ?? "No services assigned"}</td><td>{isActive ? "Active" : "Inactive"}</td></tr>;
}
