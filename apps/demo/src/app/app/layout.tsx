import { TenantSuccessToast } from "@/components/tenant-success-toast";

export default function TenantDashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<TenantSuccessToast /></>;
}
