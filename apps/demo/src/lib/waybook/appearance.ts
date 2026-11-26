export const dashboardTints = ["neutral", "blue", "violet", "rose", "teal", "coral", "amber"] as const;
export type DashboardTint = (typeof dashboardTints)[number];
export const defaultDashboardTint: DashboardTint = "blue";

export const dashboardBackgrounds = ["ripple", "photo-1", "photo-2", "photo-3", "photo-4", "photo-5", "photo-6", "photo-7", "photo-8"] as const;
export type DashboardBackground = (typeof dashboardBackgrounds)[number];
export const defaultDashboardBackground: DashboardBackground = "ripple";

export const dashboardHeaders = ["auto", "light", "dark"] as const;
export type DashboardHeader = (typeof dashboardHeaders)[number];
export const defaultDashboardHeader: DashboardHeader = "auto";
