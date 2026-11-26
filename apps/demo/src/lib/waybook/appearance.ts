export const dashboardTints = ["neutral", "blue", "violet", "rose", "teal", "coral", "amber"] as const;
export type DashboardTint = (typeof dashboardTints)[number];
export const defaultDashboardTint: DashboardTint = "blue";
