"use client";

import { useState } from "react";
import { FormToggle } from "@/components/form-toggle";

type Service = { id: string; title: string; durationMinutes: number; priceCents: number; isActive: boolean };

export function OnlineBookingServices({ services, selectedIds, initialShowPrices, currency }: { services: Service[]; selectedIds: string[]; initialShowPrices: boolean; currency: string }) {
  const [showPrices, setShowPrices] = useState(initialShowPrices);
  const formatPrice = (amount: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency, maximumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100);
  return <div className="online-booking-tab__content"><div className="online-booking-tab__heading"><p className="online-booking-kicker">SERVICES</p><h2>Choose what customers can book</h2><span>Choose the services and prices shown online.</span></div><div onChange={(event) => { const target = event.target as HTMLInputElement; if (target.name === "showPrices") setShowPrices(target.checked); }}><FormToggle name="showPrices" label="Show prices" description="Display service prices in public booking." defaultChecked={initialShowPrices} /></div><div className="online-booking-settings__services">{services.map((service) => <FormToggle key={service.id} name="visibleServiceIds" value={service.id} label={service.title} description={`${service.durationMinutes} min${showPrices ? ` · ${formatPrice(service.priceCents)}` : ""}${service.isActive ? "" : " · Inactive"}`} defaultChecked={service.isActive && selectedIds.includes(service.id)} disabled={!service.isActive} />)}</div></div>;
}
