"use client";

import { useState } from "react";

type Location = { id: string; name: string; locationType: string; isOnlineBookable: boolean };
export function OnlineBookingLocations({ locations }: { locations: Location[] }) {
  const [enabled, setEnabled] = useState(() => locations.filter(location => location.isOnlineBookable).map(location => location.id));
  const [notice, setNotice] = useState("");
  return <div className="online-booking-tab__content"><div className="online-booking-tab__heading"><p className="online-booking-kicker">LOCATIONS</p><h2>Choose where customers can book</h2><span>At least one active location must be enabled for online booking.</span></div><div className="online-booking-settings__services">{locations.map(location => <div key={location.id}><input type="hidden" name="managedLocationIds" value={location.id} /><label className="waybook-form-toggle"><input type="checkbox" role="switch" name="onlineLocationIds" value={location.id} checked={enabled.includes(location.id)} onChange={event => { const checked = event.currentTarget.checked; if (!checked && enabled.length === 1) { setNotice("Keep at least one location enabled for online booking."); return; } setNotice(""); setEnabled(current => checked ? [...current, location.id] : current.filter(id => id !== location.id)); }} /><span aria-hidden="true" /><span><b>{location.name}</b><small>{location.locationType === "mobile" ? "Mobile location" : "Location"}</small></span></label></div>)}</div><p className="online-booking-location-notice" role="status">{notice || (!locations.length ? "Add an active location before accepting online bookings." : "")}</p></div>;
}
