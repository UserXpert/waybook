"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { StaffPhotoResult } from "@/app/app/team/actions";
import { showSuccessToast } from "@/lib/waybook/toast";

export type StaffPhotoAction = (data: FormData) => Promise<StaffPhotoResult>;

export function StaffPhotoCamera() {
  return (
    <span className="staff-photo-badge staff-photo-badge--camera" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M8.2 5.1 9.3 3h5.4l1.1 2.1H20a2.5 2.5 0 0 1 2.5 2.5v10.9A2.5 2.5 0 0 1 20 21H4a2.5 2.5 0 0 1-2.5-2.5V7.6A2.5 2.5 0 0 1 4 5.1h4.2ZM12 17.8a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6ZM5.3 9.4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        <circle cx="12" cy="13" r="3.1" />
      </svg>
    </span>
  );
}

export function PhotoRemoveIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm-3.9 7.1a1.2 1.2 0 0 1 1.7 0l2.2 2.2 2.2-2.2a1.2 1.2 0 0 1 1.7 1.7L13.7 12l2.2 2.2a1.2 1.2 0 0 1-1.7 1.7L12 13.7l-2.2 2.2a1.2 1.2 0 0 1-1.7-1.7l2.2-2.2-2.2-2.2a1.2 1.2 0 0 1 0-1.7Z" />
  </svg>;
}

export function useStaffPhotoUpload(memberId: string | null, action: StaffPhotoAction) {
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
        const result = await action(data);
        if (result.error) {
          setError(`Could not upload photo. ${result.error}`);
          return;
        }
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

export function StaffPhotoUpload({ memberId, name, photoDataUrl, action }: { memberId: string; name: string; photoDataUrl: string | null; action: StaffPhotoAction }) {
  const { input, uploadButton, error, pending, upload, remove } = useStaffPhotoUpload(memberId, action);
  return <div className="staff-photo-upload">
    <button ref={uploadButton} type="button" className="staff-workspace__avatar is-large staff-photo-upload__button" onClick={() => input.current?.click()} disabled={pending} aria-label={`${pending ? "Updating photo for" : "Change photo for"} ${name}`} title="Change profile photo">
      {photoDataUrl ? <img src={photoDataUrl} alt="" /> : name.slice(0, 1)}
      <StaffPhotoCamera />
    </button>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => upload(event.target.files?.[0])} />
    {photoDataUrl ? <button type="button" className="staff-photo-badge staff-photo-upload__remove" disabled={pending} onClick={() => remove(name)} aria-label={`Remove photo for ${name}`} title="Remove profile photo">
      <PhotoRemoveIcon />
    </button> : null}
    {error ? <span className="staff-photo-upload__error" role="alert">{error}</span> : null}
  </div>;
}
