export const dashboardTints = ["neutral", "blue", "violet", "rose", "teal", "coral", "amber"] as const;
export type DashboardTint = (typeof dashboardTints)[number];
export const defaultDashboardTint: DashboardTint = "blue";

export const dashboardBackgrounds = ["ripple", "folds", "horizon", "linen", "plain"] as const;
export type DashboardBackground = (typeof dashboardBackgrounds)[number];
export const defaultDashboardBackground: DashboardBackground = "ripple";
