"use client";

import { useActionState, useState } from "react";
import { saveTenantTerminology } from "@/app/app/settings/terminology-actions";
import { isClientTerm, isStaffTerm, type TerminologyPreferences } from "@/lib/waybook/terminology-labels";
import styles from "./tenant-terminology-form.module.css";

export function TenantTerminologyForm({ preferences }: { preferences: TerminologyPreferences }) {
  const [clientTerm, setClientTerm] = useState(preferences.clientTerm);
  const [staffTerm, setStaffTerm] = useState(preferences.staffTerm);
  const [state, action, pending] = useActionState(saveTenantTerminology, {});

  return <form className={styles.form} action={action}>
    <div className={styles.fields}>
      <label>People who book<select name="clientTerm" value={clientTerm} disabled={pending} onChange={(event) => {
        if (isClientTerm(event.target.value)) setClientTerm(event.target.value);
      }}>
        <option value="client">Client</option>
        <option value="patient">Patient</option>
      </select></label>
      <label>People providing services<select name="staffTerm" value={staffTerm} disabled={pending} onChange={(event) => {
        if (isStaffTerm(event.target.value)) setStaffTerm(event.target.value);
      }}>
        <option value="staff">Staff</option>
        <option value="practitioner">Practitioner</option>
      </select></label>
    </div>
    <div className={styles.actions}>
      <button className="waybook-primary-link" type="submit" disabled={pending}>{pending ? "Saving…" : "Save terminology"}</button>
      {state.error ? <p role="alert">{state.error}</p> : state.saved ? <p role="status">Terminology saved.</p> : null}
    </div>
  </form>;
}
