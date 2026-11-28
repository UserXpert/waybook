"use client";

import { Printer } from "lucide-react";
import { useEffect, useRef } from "react";

export function PrintReceiptButton({ onOpen = false }: { onOpen?: boolean }) {
  const prompted = useRef(false);
  useEffect(() => {
    if (!onOpen || prompted.current) return;
    prompted.current = true;
    window.print();
  }, [onOpen]);

  return <button type="button" className="waybook-action waybook-action--secondary" onClick={() => window.print()}>
    <Printer size={16} aria-hidden="true" /> Print receipt
  </button>;
}
