import Link from "next/link";
import type React from "react";
import { ArrowRight, CalendarPlus, ChartNoAxesCombined, Target, UsersRound } from "lucide-react";
import { fromZonedTime } from "date-fns-tz";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { tenantDayBounds, tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";

type UpcomingBooking = { id: string; startsAt: Date; endsAt: Date; status: "confirmed" | "arrived"; customerName: string; serviceTitle: string; teamMemberId: string | null };
type StaffWorkload = { id: string; name: string; jobTitle: string | null; bookingCount: number };
type AppointmentMetrics = { appointments: number; arrived: number; completed: number; paid: number };
type StaffTarget = { actualValueCents: number; targetValueCents: number; count: number };

function monthKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}`;
}

function monthBounds(date: Date, timezone: string) {
  const key = monthKey(date, timezone);
  const [year, month] = key.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return { key, start: fromZonedTime(`${key}-01T00:00:00`, timezone), end: fromZonedTime(`${next}-01T00:00:00`, timezone) };
}

function differenceLabel(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "No change from last month" : "New this month";
  const percentage = Math.round(((current - previous) / previous) * 100);
  return `${percentage > 0 ? "+" : ""}${percentage}% vs last month`;
}

export default async function TenantAppPage() {
  const { tenant, membership, isControlView } = await requireTenantWorkspace();
  const permissions = await staffPermissionContext(tenant, membership);

  if (!permissions.isManager) {
    throw new Error("You do not have permission to view the workspace overview.");
  }
  const db = tenantDb(tenant);
  const now = new Date();
  const today = tenantDayBounds(now, tenant.timezone);
  const currentMonth = monthBounds(now, tenant.timezone);
  const previousMonth = monthBounds(new Date(currentMonth.start.getTime() - 1), tenant.timezone);
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const [[settings], upcoming, workload, [metrics], [previousMetrics], [staffTarget]] = await Promise.all([
    db<{ name: string }[]>`SELECT name FROM tenant_settings WHERE tenant_id = ${tenant.id}`,
    db<UpcomingBooking[]>`SELECT b.id, b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, c.name AS "customerName", s.title AS "serviceTitle", tm.id AS "teamMemberId"
      FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
      WHERE b.tenant_id = ${tenant.id} AND b.ends_at > ${now} AND b.status IN ('confirmed', 'arrived') ORDER BY b.starts_at ASC LIMIT 3`,
    db<StaffWorkload[]>`SELECT tm.id, tm.name, tm.job_title AS "jobTitle", count(b.id)::int AS "bookingCount"
      FROM team_members tm LEFT JOIN bookings b ON b.team_member_id = tm.id AND b.tenant_id = tm.tenant_id AND b.starts_at >= ${today.start} AND b.starts_at < ${today.end} AND b.status IN ('confirmed', 'arrived', 'completed')
      WHERE tm.tenant_id = ${tenant.id} AND tm.is_active = true GROUP BY tm.id ORDER BY "bookingCount" DESC, tm.name ASC LIMIT 5`,
    db<AppointmentMetrics[]>`SELECT count(*)::int AS appointments, count(*) FILTER (WHERE status = 'arrived')::int AS arrived, count(*) FILTER (WHERE status = 'completed')::int AS completed, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM payment_records pr WHERE pr.booking_id = bookings.id AND pr.tenant_id = bookings.tenant_id AND pr.kind = 'payment'))::int AS paid FROM bookings WHERE tenant_id = ${tenant.id} AND starts_at >= ${currentMonth.start} AND starts_at < ${currentMonth.end}`,
    db<AppointmentMetrics[]>`SELECT count(*)::int AS appointments, count(*) FILTER (WHERE status = 'arrived')::int AS arrived, count(*) FILTER (WHERE status = 'completed')::int AS completed, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM payment_records pr WHERE pr.booking_id = bookings.id AND pr.tenant_id = bookings.tenant_id AND pr.kind = 'payment'))::int AS paid FROM bookings WHERE tenant_id = ${tenant.id} AND starts_at >= ${previousMonth.start} AND starts_at < ${previousMonth.end}`,
    db<StaffTarget[]>`WITH staff_targets AS (
        SELECT scope_id, target_value FROM performance_targets
        WHERE tenant_id = ${tenant.id} AND scope_type = 'staff' AND metric = 'booked_value_cents' AND period_start = ${currentMonth.key + "-01"}::date
      ), target_actuals AS (
        SELECT st.scope_id, coalesce(sum(b.booked_price_cents) FILTER (WHERE b.status <> 'cancelled'), 0)::int AS actual_value_cents
        FROM staff_targets st LEFT JOIN bookings b ON b.tenant_id = ${tenant.id} AND b.team_member_id = st.scope_id AND b.starts_at >= ${currentMonth.start} AND b.starts_at < ${currentMonth.end}
        GROUP BY st.scope_id
      )
      SELECT coalesce(sum(ta.actual_value_cents), 0)::int AS "actualValueCents",
        coalesce((SELECT sum(target_value) FROM staff_targets), 0)::int AS "targetValueCents",
        (SELECT count(*)::int FROM staff_targets) AS count
      FROM target_actuals ta`,
  ]);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, hour: "2-digit", minute: "2-digit" });
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, day: "numeric", month: "short" });
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, month: "long", year: "numeric" }).format(now);
  const maxWorkload = Math.max(1, ...workload.map((member) => member.bookingCount));
  const targetProgress = staffTarget.targetValueCents ? Math.min(100, Math.round(staffTarget.actualValueCents / staffTarget.targetValueCents * 100)) : 0;
  const currency = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 });
  const calendarPath = tenantPath(tenantSlug, "/app/calendars");
  const appointmentDate = tenantDateKey(now, tenant.timezone);
  const newAppointmentPath = `${calendarPath}?${new URLSearchParams({
    day: appointmentDate,
    week: weekStartForLocalDate(appointmentDate),
    view: "team",
    create: `${appointmentDate}T09:00`,
  })}`;
  const outcomeMetrics = [{ label: "Appointments", value: metrics.appointments, previous: previousMetrics.appointments }, { label: "In progress", value: metrics.arrived, previous: previousMetrics.arrived }, { label: "Completed", value: metrics.completed, previous: previousMetrics.completed }, { label: "With payment", value: metrics.paid, previous: previousMetrics.paid }];

  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={settings.name} active="overview" /><section className="dashboard-four"><header className="dashboard-four__header"><div><p>OPERATIONS HOME</p><h1>Good morning, {settings.name}</h1><span>{month} · {isControlView ? "Control view · read-only" : `${membership.role} · ${tenant.timezone}`}</span></div><Link className="waybook-primary-link" href={newAppointmentPath}><CalendarPlus aria-hidden="true" />New appointment</Link></header><div className="dashboard-four__grid"><section className="waybook-data-card dashboard-widget dashboard-widget--upcoming"><div className="dashboard-widget__title"><div><p><CalendarPlus aria-hidden="true" /> APPOINTMENTS</p><h2>Upcoming appointments</h2></div><Link href={tenantPath(tenantSlug, "/app/bookings")}>View all <ArrowRight aria-hidden="true" /></Link></div>{upcoming.length ? <ol className="upcoming-list">{upcoming.map((booking) => <li key={booking.id}><time><b>{day.format(booking.startsAt).split(" ")[0]}</b><span>{day.format(booking.startsAt).split(" ")[1]}</span></time><div><strong>{time.format(booking.startsAt)}–{time.format(booking.endsAt)}</strong><span>{booking.serviceTitle} · {booking.customerName}</span></div><Link className={`appointment-status appointment-status--${booking.status}`} href={booking.teamMemberId ? `${calendarPath}?${new URLSearchParams({ employee: booking.teamMemberId, booking: booking.id, week: weekStartForLocalDate(tenantDateKey(booking.startsAt, tenant.timezone)) })}` : tenantPath(tenantSlug, "/app/bookings")}>{booking.status === "arrived" ? "In progress" : "Confirmed"}</Link></li>)}</ol> : <p className="dashboard-widget__empty">No confirmed appointments are ahead. Create one from the Calendar.</p>}</section><section className="waybook-data-card dashboard-widget dashboard-widget--workload"><div className="dashboard-widget__title"><div><p><UsersRound aria-hidden="true" /> TODAY</p><h2>Staff workload</h2></div><Link href={tenantPath(tenantSlug, "/app/team")}>Manage staff <ArrowRight aria-hidden="true" /></Link></div><div className="workload-list">{workload.map((member) => <article key={member.id}><div className="workload-list__identity"><i aria-hidden><UsersRound /></i><div><strong>{member.name}</strong><span>{member.jobTitle || "Team member"}</span></div></div><div className="workload-list__measure"><b>{member.bookingCount}</b><span>{member.bookingCount === 1 ? "booking" : "bookings"}</span><i style={{ "--workload": `${member.bookingCount / maxWorkload * 100}%` } as React.CSSProperties} /></div></article>)}{workload.length === 0 ? <p className="dashboard-widget__empty">No active staff members yet.</p> : null}</div><p className="dashboard-widget__note">Bars compare today’s booked appointments across active staff; they are not availability capacity.</p></section><section className="waybook-data-card dashboard-widget dashboard-widget--metrics"><div className="dashboard-widget__title"><div><p><ChartNoAxesCombined aria-hidden="true" /> {month.toUpperCase()}</p><h2>Appointment outcomes</h2></div><Link href={tenantPath(tenantSlug, "/app/reports")}>Reports <ArrowRight aria-hidden="true" /></Link></div><dl className="outcome-grid">{outcomeMetrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd><small className={metric.value >= metric.previous ? "is-positive" : "is-negative"}>{differenceLabel(metric.value, metric.previous)}</small></div>)}</dl><p className="dashboard-widget__note">Counts use bookings beginning this month. “With payment” means at least one payment record, not net revenue.</p></section><section className="waybook-data-card dashboard-widget dashboard-widget--target"><div className="dashboard-widget__title"><div><p><Target aria-hidden="true" /> MONTHLY PLAN</p><h2>Staff target</h2></div><Link href={tenantPath(tenantSlug, "/app/targets")}>Manage targets <ArrowRight aria-hidden="true" /></Link></div>{staffTarget.count ? <div className="target-widget"><div className="target-widget__ring" style={{ "--progress": `${targetProgress * 3.6}deg` } as React.CSSProperties}><div><span>Booked value</span><strong>{currency.format(staffTarget.actualValueCents / 100)}</strong><small>of {currency.format(staffTarget.targetValueCents / 100)}</small></div></div><div><h3>{targetProgress}% of target</h3><p>{staffTarget.count} staff {staffTarget.count === 1 ? "target is" : "targets are"} included for {month}.</p><b>{currency.format(Math.max(0, staffTarget.targetValueCents - staffTarget.actualValueCents) / 100)} remaining</b></div></div> : <div className="target-widget target-widget--empty"><div className="target-widget__ring"><div><span>Staff target</span><strong>—</strong></div></div><div><h3>Set a monthly staff target</h3><p>Targets make booked-value progress visible here without inventing a goal.</p><Link className="waybook-primary-link" href={`${tenantPath(tenantSlug, "/app/targets")}?new=1`}>Set target</Link></div></div>}</section></div></section></main>;
}
