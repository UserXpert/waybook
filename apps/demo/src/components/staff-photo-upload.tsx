"use client";

import { Camera } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { showSuccessToast } from "@/lib/waybook/toast";

export function useStaffPhotoUpload(memberId: string | null, action: (data: FormData) => Promise<void>) {
  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const focusUploadFor = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pending && focusUploadFor.current) {
      if (focusUploadFor.current === memberId) uploadButton.current?.focus();
      focusUploadFor.current = null;
    }
  }, [memberId, pending]);

  function savePhoto(data: FormData, removing = false) {
    setError("");
    startTransition(async () => {
      try {
        await action(data);
        if (removing) focusUploadFor.current = memberId;
        showSuccessToast(removing ? "Profile photo removed." : "Profile photo saved.");
      } catch {
        setError(removing
          ? "Could not remove the profile photo. Try again."
          : "Could not upload photo. Use a JPG, PNG or WebP up to 250 KB and 2,400 × 2,400 pixels.");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  }

  function upload(file: File | undefined) {
    if (!file || !memberId || pending) return;
    if (file.size > 250_000) { setError("Choose an image smaller than 250 KB."); if (input.current) input.current.value = ""; return; }
    const data = new FormData();
    data.set("memberId", memberId);
    data.set("photo", file);
    savePhoto(data);
  }

  function remove(name: string) {
    if (!memberId || pending || !window.confirm(`Remove the profile photo for ${name}?`)) return;
    const data = new FormData();
    data.set("memberId", memberId);
    data.set("removePhoto", "on");
    savePhoto(data, true);
  }

  return { input, uploadButton, error, pending, upload, remove };
}

export function StaffPhotoUpload({ memberId, name, photoDataUrl, action }: { memberId: string; name: string; photoDataUrl: string | null; action: (data: FormData) => Promise<void> }) {
  const { input, uploadButton, error, pending, upload, remove } = useStaffPhotoUpload(memberId, action);
  return <div className="staff-photo-upload">
    <button ref={uploadButton} type="button" className="staff-workspace__avatar is-large staff-photo-upload__button" onClick={() => input.current?.click()} disabled={pending} aria-label={`${pending ? "Updating photo for" : "Change photo for"} ${name}`} title="Change profile photo">
      {photoDataUrl ? <img src={photoDataUrl} alt="" /> : name.slice(0, 1)}
      <span className="staff-photo-upload__camera" aria-hidden="true"><Camera size={14} /></span>
    </button>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => upload(event.target.files?.[0])} />
    {photoDataUrl ? <button type="button" className="profile-photo-remove" disabled={pending} onClick={() => remove(name)} aria-label={`Remove photo for ${name}`}>Remove photo</button> : null}
    {error ? <span className="staff-photo-upload__error" role="alert">{error}</span> : null}
  </div>;
}
