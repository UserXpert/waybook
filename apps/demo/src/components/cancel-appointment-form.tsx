"use client";

import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { CancellationResult } from "@/app/app/calendars/actions";
import { cycleDialogTab } from "@/components/tenant-editor-dialog";

type Props = {
  bookingId: string;
  cancelAppointment: (formData: FormData) => Promise<CancellationResult>;
  onDismiss?: () => void;
};

export function CancelAppointmentForm({ bookingId, cancelAppointment, onDismiss }: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useLayoutEffect(() => {
    const confirmation = dialog.current;
    confirmation?.showModal();
    return () => confirmation?.close();
  }, []);

  function dismiss() {
    dialog.current?.close();
    onDismiss?.();
  }

  const description = "Cancelling releases the time and keeps the appointment history. Any gift-card payment returns to the original card.";
  const submit = (
    <button type="submit" disabled={isPending}>
      {isPending ? "Cancelling…" : "Cancel appointment"}
    </button>
  );
  const form = (
    <form
      className={onDismiss ? "appointment-cancel-confirmation__form" : "appointment-drawer__delete"}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          try {
            const result = await cancelAppointment(formData);
            if (result.error) {
              setError(result.error);
              return;
            }
            dismiss();
            router.refresh();
          } catch {
            setError("Could not confirm cancellation. Check the appointment status before trying again.");
          }
        });
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      {onDismiss ? <div className="appointment-cancel-confirmation__actions">
        <button className="waybook-action waybook-action--secondary" type="button" onClick={dismiss} disabled={isPending}>Keep appointment</button>
        {submit}
      </div> : <>{submit}<small>{description}</small></>}
      {error ? <p className="appointment-drawer__form-error" role="alert">{error}</p> : null}
    </form>
  );

  if (!onDismiss) return form;
  return <dialog className="client-form-modal appointment-cancel-confirmation" ref={dialog} role="alertdialog"
    aria-labelledby={headingId} aria-describedby={descriptionId}
    onKeyDown={(event) => { event.stopPropagation(); cycleDialogTab(event); }}
    onCancel={(event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isPending) dismiss();
    }}>
    <header><h2 id={headingId}>Cancel this appointment?</h2></header>
    <div className="client-form-modal__body">
      <p id={descriptionId}>{description}</p>
      {form}
    </div>
  </dialog>;
}
