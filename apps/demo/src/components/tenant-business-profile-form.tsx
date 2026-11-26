"use client";

import { useActionState, useRef, useState } from "react";
import { saveBusinessProfile } from "@/app/app/settings/business-actions";
import { PhotoRemoveIcon } from "@/components/staff-photo-upload";
import { businessProfileFields, type BusinessProfile } from "@/lib/waybook/business-profile";

export function TenantBusinessProfileForm({ name, profile, logo }: { name: string; profile: BusinessProfile; logo?: string }) {
  const [state, action, pending] = useActionState(saveBusinessProfile, {});
  const [displayName, setDisplayName] = useState(name);
  const [fields, setFields] = useState(profile);
  const [logoToRemove, setLogoToRemove] = useState<string>();
  const logoInput = useRef<HTMLInputElement>(null);
  const removeLogo = Boolean(logo && logo === logoToRemove);
  return (
    <form className="workspace-business-form" action={action}>
      <label>Business name
        <input name="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={120} />
      </label>
      <fieldset>
        <legend>Business logo</legend>
        {logo && !removeLogo ? <div className="workspace-business-form__logo-preview">
          <img className="workspace-business-form__logo" src={logo} alt="Current business logo" />
          <button type="button" className="staff-photo-badge workspace-business-form__remove" disabled={pending}
            aria-label="Remove current logo" title="Remove current logo" onClick={() => {
              if (logoInput.current) logoInput.current.value = "";
              setLogoToRemove(logo);
              logoInput.current?.focus();
            }}><PhotoRemoveIcon /></button>
        </div> : null}
        {removeLogo ? <div className="workspace-business-form__logo-removal">
          <input type="hidden" name="removePhoto" value="on" />
          <span role="status">Logo will be removed when you save.</span>
          <button type="button" className="waybook-action waybook-action--secondary" disabled={pending}
            onClick={() => { setLogoToRemove(undefined); logoInput.current?.focus(); }}>Undo</button>
        </div> : null}
        <label>Upload logo <input ref={logoInput} aria-describedby="business-logo-hint" name="photo" type="file" accept="image/jpeg,image/png,image/webp"
          disabled={pending} onChange={(event) => { if (event.target.files?.length) setLogoToRemove(undefined); }} /></label>
        <small id="business-logo-hint">Used on the booking page and workspace sign-in. JPG, PNG or WebP up to 250 KB.</small>
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
