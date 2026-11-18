"use client";

import { useActionState, useState } from "react";
import { redeemGiftCardForAppointmentSale } from "@/app/app/sales/actions";

export function GiftCardTenderForm({ saleId, balanceCents }: { saleId: string; balanceCents: number }) {
  const [state, action, pending] = useActionState(redeemGiftCardForAppointmentSale, { error: null });
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  return <form action={action} className="tenant-drawer-form">
    <input type="hidden" name="saleId" value={saleId} />
    <div className="tenant-drawer-form__grid">
      <label>Gift-card number<input name="cardCode" autoComplete="off" required minLength={8} maxLength={40} value={code} onChange={event => setCode(event.target.value)} /></label>
      <label>Amount (DKK)<input name="amountDkk" type="number" min="0.01" max={balanceCents / 100} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
    </div>
    <p className="tenant-drawer-note">Named cards can only be used by their owner. One gift card can be used per appointment; the amount cannot exceed the service balance or card balance.</p>
    {state.error ? <p role="alert" className="tenant-drawer-form__error">{state.error}</p> : null}
    <button type="submit" disabled={pending}>{pending ? "Using gift card…" : "Use gift card"}</button>
  </form>;
}
