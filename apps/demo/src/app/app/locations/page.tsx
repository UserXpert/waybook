import Link from "next/link";
import { FormToggle } from "@/components/form-toggle";
import { LocationHoursEditor } from "@/components/location-hours-editor";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import {
  currentTenantRouteSlug,
  requireTenantWorkspace,
} from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { logout } from "../../actions";
import {
  addLocationClosedDate,
  removeLocationClosedDate,
  saveLocation,
} from "./actions";

type Location = {
  id: string;
  name: string;
  locationType: "fixed" | "mobile";
  isOnlineBookable: boolean;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  isActive: boolean;
};
type Hours = {
  locationId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};
type ClosedDate = {
  id: string;
  locationId: string;
  localDate: string;
  reason: string | null;
};
const weekdays = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [0, "Sunday"],
] as const;

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    location?: string;
    new?: string;
    q?: string;
    after?: string;
  }>;
}) {
  const { location, new: createNew, q, after } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  const canManage =
    permissions.isManager || permissions.canManageServiceSettings;
  if (!canManage)
    throw new Error("You do not have permission to view location settings.");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const db = tenantDb(tenant);
  const search = (q ?? "").trim().slice(0, 100);
  const rawCursor = (after ?? "").trim();
  const cursor = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
    rawCursor,
  )
    ? rawCursor
    : null;
  const locationColumns =
    'SELECT id,name,location_type AS "locationType",is_online_bookable AS "isOnlineBookable",phone,address_line_1 AS "addressLine1",address_line_2 AS "addressLine2",city,region,postal_code AS "postalCode",is_active AS "isActive" FROM locations';
  const locationRows = await db.unsafe<Location[]>(
    locationColumns +
      " WHERE tenant_id=$1 AND ($2='' OR name ILIKE $3) AND ($4::uuid IS NULL OR (name,id) > (coalesce((SELECT name FROM locations WHERE tenant_id=$1 AND id=$4::uuid),''),$4::uuid)) ORDER BY is_active DESC,name,id LIMIT 51",
    [tenant.id, search, `%${search}%`, cursor],
  );
  const hasMoreLocations = locationRows.length > 50;
  const locations = locationRows.slice(0, 50);
  const selected =
    locations.find((item) => item.id === location) ??
    (location
      ? ((
          await db.unsafe<Location[]>(
            locationColumns + " WHERE tenant_id=$1 AND id=$2::uuid",
            [tenant.id, location],
          )
        )[0] ?? null)
      : null);
  const [hours, selectedClosedDates] = selected
    ? await Promise.all([
        db<
          Hours[]
        >`SELECT location_id AS "locationId", day_of_week AS "dayOfWeek", start_time AS "startTime", end_time AS "endTime" FROM location_hours WHERE tenant_id=${tenant.id} AND location_id=${selected.id}`,
        db<
          ClosedDate[]
        >`SELECT id, location_id AS "locationId", local_date::text AS "localDate", reason FROM location_closed_dates WHERE tenant_id=${tenant.id} AND location_id=${selected.id} ORDER BY local_date ASC`,
      ])
    : ([[], []] as [Hours[], ClosedDate[]]);
  const path = tenantPath(tenantSlug, "/app/locations");
  const panelOpen = Boolean(selected || createNew === "1");
  const moreLocationsHref =
    path +
    "?" +
    new URLSearchParams({
      ...(search ? { q: search } : {}),
      after: locations.at(-1)?.id ?? "",
    }).toString();
  return (
    <main className="waybook-data-page tenant-dashboard-page">
      <TenantDashboardNav
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        tenantName={tenant.name}
        active="locations"
      />
      <header>
        <div>
          <p>LOCATIONS · DATABASE-BACKED</p>
          <h1>{tenant.name}</h1>
          <span>
            Where services are delivered and appointments can be booked.
          </span>
        </div>
        <form action={logout}>
          <button>Sign out</button>
        </form>
      </header>
      <section className="waybook-data-card">
        <div className="waybook-section-heading">
          <div>
            <h2>Locations</h2>
            <p>
              Locations hold customer-facing contact details, online-booking
              state, and weekly opening hours.
            </p>
          </div>
          {canManage ? (
            <Link className="waybook-primary-link" href={`${path}?new=1`}>
              Add location
            </Link>
          ) : null}
        </div>
        <form method="get" className="waybook-list-filter">
          <label>
            Search locations
            <input
              name="q"
              type="search"
              defaultValue={search}
              placeholder="Location name"
            />
          </label>
          <button type="submit">Search</button>
        </form>
        <div className="waybook-service-list">
          {locations.map((item) => (
            <Link
              key={item.id}
              className="waybook-service-card"
              href={`${path}?location=${item.id}`}
            >
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.locationType === "mobile"
                    ? "Mobile service"
                    : "Fixed location"}{" "}
                  · {item.isOnlineBookable ? "Bookable online" : "Private"}
                </span>
                <small>
                  {[item.addressLine1, item.city].filter(Boolean).join(", ") ||
                    item.phone ||
                    "No contact details"}
                </small>
              </div>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
          {locations.length === 0 ? (
            <p>
              Add the first location before enabling location-specific booking.
            </p>
          ) : null}
        </div>
        {hasMoreLocations ? (
          <Link className="waybook-secondary-link" href={moreLocationsHref}>
            Load more locations
          </Link>
        ) : null}
      </section>
      {panelOpen ? (
        <div className="tenant-drawer-layer" role="presentation">
          <Link
            className="tenant-drawer-scrim"
            aria-label="Close location editor"
            href={path}
          />
          <aside
            className="tenant-drawer"
            aria-label={selected ? "Edit location" : "Add location"}
          >
            <header>
              <div>
                <p>LOCATIONS</p>
                <h2>{selected ? "Edit location" : "Add location"}</h2>
                <span>
                  Changes are tenant-scoped and used by the location-aware
                  booking foundation.
                </span>
              </div>
              <div className="tenant-drawer-header-actions">
                {canManage ? <button type="submit" form="location-editor-form">Save location</button> : null}
                <Link className="tenant-drawer-close" aria-label="Close location editor" href={path}>×</Link>
              </div>
            </header>
            {canManage ? (
              <>
                {
                  <form id="location-editor-form" action={saveLocation} className="tenant-drawer-form">
                    <input
                      type="hidden"
                      name="locationId"
                      value={selected?.id ?? ""}
                    />
                    <label>
                      Location name
                      <input
                        name="name"
                        defaultValue={selected?.name ?? ""}
                        required
                      />
                    </label>
                    <label>
                      Type
                      <select
                        name="locationType"
                        defaultValue={selected?.locationType ?? "fixed"}
                      >
                        <option value="fixed">
                          Fixed — customers come to you
                        </option>
                        <option value="mobile">
                          Mobile — you go to customers
                        </option>
                      </select>
                    </label>
                    <label>
                      Telephone
                      <input
                        name="phone"
                        type="tel"
                        defaultValue={selected?.phone ?? ""}
                      />
                    </label>
                    <label>
                      Address
                      <input
                        name="addressLine1"
                        defaultValue={selected?.addressLine1 ?? ""}
                      />
                    </label>
                    <label>
                      Address line 2
                      <input
                        name="addressLine2"
                        defaultValue={selected?.addressLine2 ?? ""}
                      />
                    </label>
                    <div className="tenant-drawer-form__grid">
                      <label>
                        City
                        <input
                          name="city"
                          defaultValue={selected?.city ?? ""}
                        />
                      </label>
                      <label>
                        Region
                        <input
                          name="region"
                          defaultValue={selected?.region ?? ""}
                        />
                      </label>
                      <label>
                        Postal code
                        <input
                          name="postalCode"
                          defaultValue={selected?.postalCode ?? ""}
                        />
                      </label>
                    </div>
                    <label className="tenant-drawer-check">
                      <input
                        type="checkbox"
                        name="isOnlineBookable"
                        defaultChecked={selected?.isOnlineBookable ?? true}
                      />{" "}
                      Customers can book this location online
                    </label>
                    <label className="tenant-drawer-check">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={selected?.isActive ?? true}
                      />{" "}
                      Active location
                    </label>
                    <LocationHoursEditor initialHours={hours} />
                  </form>
                }
                {selected ? (
                  <section className="tenant-drawer-form location-closed-dates">
                    <h3>Closed dates</h3>
                    <p>
                      Closed dates remove all public availability for this
                      location on the chosen local date.
                    </p>
                    <form action={addLocationClosedDate}>
                      <input
                        type="hidden"
                        name="locationId"
                        value={selected.id}
                      />
                      <label>
                        Date
                        <input name="localDate" type="date" required />
                      </label>
                      <label>
                        Reason
                        <input
                          name="reason"
                          placeholder="Holiday or private event"
                        />
                      </label>
                      <button className="location-closed-dates__add" type="submit">Add closed date</button>
                    </form>
                    <ul>
                      {selectedClosedDates.map((item) => (
                        <li key={item.id}>
                          <span>
                            <strong>{item.localDate}</strong>
                            <small>{item.reason ?? "Closed"}</small>
                          </span>
                          <form action={removeLocationClosedDate}>
                            <input
                              type="hidden"
                              name="locationId"
                              value={selected.id}
                            />
                            <input
                              type="hidden"
                              name="closedDateId"
                              value={item.id}
                            />
                            <button type="submit">Remove</button>
                          </form>
                        </li>
                      ))}
                      {selectedClosedDates.length === 0 ? (
                        <li>No closed dates scheduled.</li>
                      ) : null}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : (
              <p className="tenant-drawer-note">
                Read-only access: location records cannot be changed with your
                role.
              </p>
            )}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
