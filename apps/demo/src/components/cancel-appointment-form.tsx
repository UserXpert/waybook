"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CancellationResult } from "@/app/app/calendars/actions";

type Props = {
  bookingId: string;
  cancelAppointment: (formData: FormData) => Promise<CancellationResult>;
};

export function CancelAppointmentForm({ bookingId, cancelAppointment }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="appointment-drawer__delete"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await cancelAppointment(formData);
          if (result.error) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <button type="submit" disabled={isPending}>
        {isPending ? "Cancelling…" : "Cancel appointment"}
      </button>
      <small>Updates this booking’s status to Cancelled, releases the time, and retains its history and audit record.</small>
      {error ? <p className="appointment-drawer__form-error" role="alert">{error}</p> : null}
    </form>
  );
}
