"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getCalendarBookingMoveTargets, moveBookingOnCalendar } from "@/app/app/calendars/actions";

type DragPayload = { bookingId: string };

function payloadFromBooking(element: HTMLAnchorElement): DragPayload | null {
  const bookingId = new URL(element.href).searchParams.get("booking");
  return bookingId ? { bookingId } : null;
}

function destinationFromCell(element: HTMLElement) {
  const startsAt = element.dataset.calendarStartsAt;
  const teamMemberId = element.dataset.calendarTeamMemberId;
  return startsAt && teamMemberId ? { startsAt, teamMemberId } : null;
}

/**
 * A booking card sits above the grid, so event.target alone is not a reliable
 * representation of the cell the pointer is over. Resolve the destination by
 * the pointer's coordinates against cells that carry their explicit server
 * rendered staff/time identity. This deliberately refuses a gap or boundary
 * instead of guessing an adjacent staff column.
 */
function destinationCellAtPointer(event: DragEvent) {
  const pointerTarget = document.elementFromPoint(event.clientX, event.clientY);
  const grid = (pointerTarget ?? (event.target as Element | null))?.closest<HTMLElement>(
    ".waybook-week-calendar__grid",
  );
  if (!grid) return null;
  return Array.from(
    grid.querySelectorAll<HTMLElement>(
      "[data-calendar-drop-cell='true']",
    ),
  ).find((cell) => {
    const bounds = cell.getBoundingClientRect();
    return (
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom
    );
  }) ?? null;
}

/** Adds native pointer drag-and-drop without changing the calendar's link-first markup. */
export function CalendarBookingDragDrop() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const selector = ".tenant-dashboard-page .waybook-week-calendar";
    let dragPayload: DragPayload | null = null;
    // The normal calendar can be in "All services" mode. Its open cells are
    // a union and are not necessarily valid for the particular appointment
    // being dragged, so they must never decide a drop target client-side.
    let targetsReady = false;
    const dropCells = () => Array.from(document.querySelectorAll<HTMLElement>("[data-calendar-drop-cell='true']"));
    const clearHoverTargets = () => {
      dropCells().forEach((cell) => cell.classList.remove(
        "is-drop-target",
        "is-drop-pending",
        "is-drop-unavailable",
      ));
    };
    const clearDragTargets = () => {
      clearHoverTargets();
      dropCells().forEach((cell) => cell.classList.remove("is-drop-eligible"));
    };
    const targetKey = (target: { teamMemberId: string; startsAt: string }) => `${target.teamMemberId}|${target.startsAt}`;
    const onDragStart = (event: Event) => {
      const dragEvent = event as DragEvent;
      const booking = (dragEvent.target as Element | null)?.closest<HTMLAnchorElement>("a.waybook-week-calendar__entry.is-booking");
      const payload = booking ? payloadFromBooking(booking) : null;
      if (!booking || !payload || !dragEvent.dataTransfer) return;
      dragEvent.dataTransfer.effectAllowed = "move";
      dragEvent.dataTransfer.setData("application/x-waybook-booking", JSON.stringify(payload));
      dragEvent.dataTransfer.setData("text/plain", payload.bookingId);
      booking.classList.add("is-dragging");
      dragPayload = payload;
      targetsReady = false;
      clearDragTargets();
      const targets = dropCells()
        .map(destinationFromCell)
        .filter((target): target is { teamMemberId: string; startsAt: string } => Boolean(target));
      setMessage("Checking destinations for this appointment…");
      void getCalendarBookingMoveTargets({ bookingId: payload.bookingId, targets }).then((result) => {
        if (dragPayload?.bookingId !== payload.bookingId) return;
        if (result.error) {
          setMessage(result.error);
          return;
        }
        targetsReady = true;
        const approved = new Set(result.targets);
        dropCells().forEach((cell) => {
          const destination = destinationFromCell(cell);
          const isEligible = Boolean(destination && approved.has(targetKey(destination)));
          cell.classList.toggle("is-drop-eligible", isEligible);
        });
        setMessage(
          approved.size
            ? `${approved.size} verified destination${approved.size === 1 ? "" : "s"}. Highlighted times can accept this appointment.`
            : "No visible time can accept this appointment.",
        );
      }).catch(() => {
        if (dragPayload?.bookingId !== payload.bookingId) return;
        setMessage("Could not verify move destinations. Start the drag again.");
      });
    };
    const onDragEnd = (event: Event) => {
      (event.target as Element | null)?.closest("a.waybook-week-calendar__entry")?.classList.remove("is-dragging");
      clearDragTargets();
      dragPayload = null;
      targetsReady = false;
    };
    const onDragOver = (event: Event) => {
      const dragEvent = event as DragEvent;
      const cell = destinationCellAtPointer(dragEvent);
      if (!cell || !dragEvent.dataTransfer?.types.includes("application/x-waybook-booking") || !dragPayload) return;
      // A drop is unavailable until the server has evaluated the exact
      // booking service, duration, resource, staff and current block.
      if (!targetsReady) return;
      if (!cell.classList.contains("is-drop-eligible")) return;
      dragEvent.preventDefault();
      dragEvent.dataTransfer.dropEffect = "move";
      if (!cell.classList.contains("is-drop-target") && !cell.classList.contains("is-drop-pending") && !cell.classList.contains("is-drop-unavailable")) {
        // Compatibility is established for the entire gesture. Only clear
        // the transient hover state here; clearing the compatibility class
        // makes an incompatible "All services" cell appear droppable.
        clearHoverTargets();
        cell.classList.add("is-drop-target");
        setMessage("Release to move appointment.");
      }
    };
    const onDrop = (event: Event) => {
      const dragEvent = event as DragEvent;
      const cell = destinationCellAtPointer(dragEvent);
      if (!cell || !dragEvent.dataTransfer) return;
      const rawPayload = dragEvent.dataTransfer.getData("application/x-waybook-booking");
      const destination = destinationFromCell(cell);
      const isEligible = cell.classList.contains("is-drop-eligible");
      clearDragTargets();
      if (!rawPayload || !destination) return;
      if (!targetsReady) {
        setMessage("Still checking destinations. Start the drag again once available times are highlighted.");
        return;
      }
      if (!isEligible) return;
      dragEvent.preventDefault();
      try {
        const payload = dragPayload ?? JSON.parse(rawPayload) as DragPayload;
        setMessage("Moving appointment…");
        startTransition(async () => {
          const result = await moveBookingOnCalendar({ bookingId: payload.bookingId, startsAt: destination.startsAt, teamMemberId: destination.teamMemberId });
          setMessage(result.error ?? "Appointment moved.");
          if (!result.error) {
            router.refresh();
          }
        });
      } catch {
        setMessage("Could not move that appointment.");
      }
    };
    const calendars = document.querySelectorAll(selector);
    calendars.forEach((calendar) => {
      calendar.addEventListener("dragstart", onDragStart);
      calendar.addEventListener("dragend", onDragEnd);
      calendar.addEventListener("dragover", onDragOver);
      calendar.addEventListener("drop", onDrop);
    });
    return () => calendars.forEach((calendar) => {
      calendar.removeEventListener("dragstart", onDragStart);
      calendar.removeEventListener("dragend", onDragEnd);
      calendar.removeEventListener("dragover", onDragOver);
      calendar.removeEventListener("drop", onDrop);
    });
  }, [router, startTransition]);

  return message ? <p className="calendar-drag-feedback" role="status">{message}</p> : null;
}
