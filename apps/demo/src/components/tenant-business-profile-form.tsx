"use client";

import { useActionState, useState } from "react";
import { saveBusinessProfile } from "@/app/app/settings/business-actions";
import { businessProfileFields, type BusinessProfile } from "@/lib/waybook/business-profile";

export function TenantBusinessProfileForm({ name, profile, logo }: { name: string; profile: BusinessProfile; logo?: string }) {
  const [state, action, pending] = useActionState(saveBusinessProfile, {});
  const [displayName, setDisplayName] = useState(name);
  const [fields, setFields] = useState(profile);
  return (
    <form className="workspace-business-form" action={action}>
      <label>Business name
        <input name="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={120} />
      </label>
      <fieldset>
        <legend>Business logo</legend>
        {logo ? <img className="workspace-business-form__logo" src={logo} alt="Current business logo" /> : null}
        <label>Upload logo <input aria-describedby="business-logo-hint" name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>
        <small id="business-logo-hint">Used on the booking page and workspace sign-in. JPG, PNG or WebP up to 250 KB.</small>
        {logo ? <label className="workspace-business-form__remove"><input name="removePhoto" type="checkbox" /> Remove current logo</label> : null}
      </fieldset>
      <div className="workspace-business-form__fields">
        {businessProfileFields.map(({ key, label, type, maxLength, autoComplete }) => (
          <label key={key}>{label}
            <input name={key} type={type} maxLength={maxLength} autoComplete={autoComplete}
              value={fields[key] ?? ""} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
          </label>
        ))}
      </div>
      <button type="submit" className="waybook-action" disabled={pending}>{pending ? "Saving…" : "Save business details"}</button>
      {state.error ? <p className="waybook-feedback waybook-feedback--error" role="alert">{state.error}</p> : null}
      {state.saved ? <p className="waybook-feedback waybook-feedback--success" role="status">Business details saved.</p> : null}
    </form>
  );
}
