import { Bell, TriangleAlert } from "lucide-react";

type NotificationBannerProps = {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  tone?: "info" | "warning";
};

export function WaybookNotificationBanner({ label, children, action, tone = "info" }: NotificationBannerProps) {
  const Icon = tone === "warning" ? TriangleAlert : Bell;

  return (
    <section className={`waybook-feedback waybook-feedback--${tone} waybook-notification-banner`} aria-label={label}>
      <p role="status">
        <Icon aria-hidden="true" size={18} />
        <span>{children}</span>
      </p>
      {action}
    </section>
  );
}
