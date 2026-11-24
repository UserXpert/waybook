"use client";

import { Camera } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { showSuccessToast } from "@/lib/waybook/toast";

export function useStaffPhotoUpload(memberId: string | null, action: (data: FormData) => Promise<void>) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function upload(file: File | undefined) {
    if (!file || !memberId) return;
    setError("");
    if (file.size > 250_000) { setError("Choose an image smaller than 250 KB."); if (input.current) input.current.value = ""; return; }
    const data = new FormData();
    data.set("memberId", memberId);
    data.set("photo", file);
    startTransition(async () => {
      try { await action(data); showSuccessToast("Profile photo saved."); }
      catch { setError("Could not upload photo. Use a JPG, PNG or WebP up to 250 KB and 2,400 × 2,400 pixels."); }
      finally { if (input.current) input.current.value = ""; }
    });
  }

  return { input, error, pending, upload };
}

export function StaffPhotoUpload({ memberId, name, photoDataUrl, action }: { memberId: string; name: string; photoDataUrl: string | null; action: (data: FormData) => Promise<void> }) {
  const { input, error, pending, upload } = useStaffPhotoUpload(memberId, action);
  return <div className="staff-photo-upload">
    <button type="button" className="staff-workspace__avatar is-large staff-photo-upload__button" onClick={() => input.current?.click()} disabled={pending} aria-label={`${pending ? "Uploading photo for" : "Change photo for"} ${name}`} title="Change profile photo">
      {photoDataUrl ? <img src={photoDataUrl} alt="" /> : name.slice(0, 1)}
      <span className="staff-photo-upload__camera" aria-hidden="true"><Camera size={14} /></span>
    </button>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => upload(event.target.files?.[0])} />
    {error ? <span className="staff-photo-upload__error" role="alert">{error}</span> : null}
  </div>;
}
